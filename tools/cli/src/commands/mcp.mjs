import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import { defineCommand } from '../core/registry.mjs';
import { EXIT, EXIT_MEANING, envError, usageError } from '../core/errors.mjs';
import { SCOPES, buildTools, argvForToolCall } from '../core/toolSchema.mjs';
import { run } from '../core/proc.mjs';

/**
 * 把这个 CLI 直接挂成 MCP server。
 *
 * `bazi schema` 导出的是一份**定义**，装载它仍然要调用方自己写胶水：拼 argv、起进程、
 * 解析信封、把退出码翻译成"下一步做什么"。这条命令把那段胶水收进仓库里 —— 因为它属于
 * 能力层：怎么把一次工具调用还原成命令、退出码各自意味着什么，都是这个 CLI 自己的知识，
 * 让每个调用方各实现一遍，就是让同一份契约在仓库外面被复制 N 份。
 *
 * 工具定义与 `bazi schema` 同源（core/toolSchema.mjs），不存在第二份清单。
 *
 * **实现是薄的，而且刻意保持薄**：每次工具调用都 spawn 一次真实 CLI，而不是在进程内
 * 直接调 run()。这样参数校验、必填检查、破坏性操作的安全闸、退出码语义全部原样继承 ——
 * 尤其是安全闸：进程内直调等于把 `assertDestructiveAllowed` 绕过去了，而那正是
 * MCP 场景下最需要它的时候（工具是长期挂在 Agent 上的）。
 */

const SDK_PACKAGE = '@modelcontextprotocol/sdk';
const CLI_BIN = fileURLToPath(new URL('../../bin/bazi.mjs', import.meta.url));
const REPO_ROOT = path.resolve(path.dirname(CLI_BIN), '../../..');

/**
 * SDK 是动态 import 的，不是顶层依赖。
 *
 * 顶层 import 会让 `bazi doctor` 这种"专门用来诊断环境没装好"的命令，
 * 在环境没装好时自己先崩掉。缺依赖是 exit 3 加一条可执行的安装命令，
 * 与 CLI 其余部分处理环境问题的方式一致。
 */
const loadSdk = async () => {
  try {
    const [{ Server }, { StdioServerTransport }, types] = await Promise.all([
      import(`${SDK_PACKAGE}/server/index.js`),
      import(`${SDK_PACKAGE}/server/stdio.js`),
      import(`${SDK_PACKAGE}/types.js`),
    ]);
    return { Server, StdioServerTransport, types };
  } catch (error) {
    throw envError(`${SDK_PACKAGE} 没装上，MCP server 起不来`, {
      hint: '这个包只有 `bazi mcp` 用到，CLI 的其余命令不依赖它。',
      next: 'npm install',
      details: { package: SDK_PACKAGE, reason: error?.message },
    });
  }
};

/**
 * 读 package.json 里的版本号，别在这里手写一个会和它对不上的常量。
 * 用 fs 而不是 import attributes：后者的语法当前的 ESLint 解析器还不认。
 */
const readVersion = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
};

/**
 * 一次工具调用 → 一次真实 CLI 执行。
 *
 * 返回给模型的是 CLI 的 JSON 信封原文：里面的 hint / next / exitMeaning 正是
 * 模型决定下一步要读的东西，重新包装一遍只会把它们弄丢。
 */
const callTool = async (entry, args) => {
  const argv = argvForToolCall(entry, args);
  const result = await run(process.execPath, [CLI_BIN, ...argv], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const exit = result.code ?? 1;
  const stdout = (result.stdout || '').trim();

  // 正常路径下 stdout 必是一个 JSON 信封（argv 里强制带了 --json）。
  // 解析不了说明 CLI 自己崩在了信封之外 —— 那种情况要把 stderr 交出去，
  // 而不是回一个空对象让模型以为调用成功了。
  let payload;
  try {
    payload = stdout ? JSON.parse(stdout) : null;
  } catch {
    payload = null;
  }

  if (!payload) {
    payload = {
      ok: false,
      exit,
      exitMeaning: EXIT_MEANING[exit] || 'unknown',
      error: (result.stderr || '').trim() || `bazi ${entry.path} 没有产出 JSON 输出`,
      hint: 'CLI 在写出信封之前就退出了，这不是可预期的失败路径。',
      command: `bazi ${entry.path}`,
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    // 退出码是判据，不是 payload.ok —— 信封解析失败时 ok 字段可能压根不存在。
    isError: exit !== EXIT.OK,
  };
};

export const mcpCommand = defineCommand({
  name: 'mcp',
  summary: '把这个 CLI 挂成 MCP server（stdio），让 Agent 原生调用算法能力',
  effect: 'read-only',
  kind: 'ops',
  /** 长驻前台进程，一次工具调用装不下；何况把自己暴露出去等于 server 里再起 server。 */
  exposeAsTool: false,
  description:
    '长驻前台进程，用 stdio 说 MCP 协议。工具定义与 `bazi schema` 同源，不是另写一份。\n\n' +
    'stdout 归协议独占，日志和进度一律走 stderr —— 往 stdout 写一个字节就会破坏协议帧。\n' +
    '因此这条命令忽略 --json：它没有"结果信封"可输出。\n\n' +
    '默认只暴露算法能力（calc / cast），全部只读。运维命令要用 --scope 显式放进来，\n' +
    '其中的破坏性操作仍然受 CLI 自己的安全闸约束（缺 --yes 会退 7），\n' +
    '因为每次调用都是真的去跑一次 CLI，而不是在进程内绕过它。\n\n' +
    '引擎要先起着：算法能力是引擎的客户端，`bazi stack up --only api`。',
  usage: 'bazi mcp [--scope capability|ops|all]',
  flags: [
    {
      name: 'scope',
      type: 'string',
      choices: SCOPES,
      default: 'capability',
      summary: '暴露哪些命令：capability 只给算法能力，ops 只给运维命令，all 全给',
    },
  ],
  examples: [
    { note: '起 server（一般由 MCP 客户端代为拉起，不手敲）', command: 'bazi mcp' },
    { note: '连运维命令一起暴露', command: 'bazi mcp --scope all' },
  ],
  run: async ({ flags, out, root }) => {
    const scope = flags.scope ?? 'capability';
    if (!SCOPES.includes(scope)) {
      throw usageError(`--scope 只接受 ${SCOPES.join(' / ')}，收到 "${scope}"`, {
        next: 'bazi mcp --scope capability',
      });
    }

    const { Server, StdioServerTransport, types } = await loadSdk();
    const { tools, catalog } = buildTools({ root, format: 'mcp', scope });
    const byName = new Map(catalog.map((entry) => [entry.name, entry]));

    const server = new Server(
      { name: 'metaphysics-engine', version: readVersion() },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(types.ListToolsRequestSchema, async () => ({ tools }));

    server.setRequestHandler(types.CallToolRequestSchema, async (request) => {
      const entry = byName.get(request.params.name);
      if (!entry) {
        // 未知工具名回 isError 而不是抛协议错：模型能读到这段文字并自我纠正，
        // 协议级错误则只会让它看到一个不知所云的失败。
        return {
          content: [
            {
              type: 'text',
              text: `没有名为 "${request.params.name}" 的工具。当前 scope=${scope}，可用工具：${[...byName.keys()].join(', ')}`,
            },
          ],
          isError: true,
        };
      }
      return callTool(entry, request.params.arguments || {});
    });

    // 进度写 stderr。stdout 从这一刻起归 transport 独占。
    out.step(`MCP server 就绪：scope=${scope}，${tools.length} 个工具`);
    out.detail(`工具名：${[...byName.keys()].join(', ')}`);

    await server.connect(new StdioServerTransport());

    // 服务器活到 stdio 关闭为止。close 事件后 Node 事件循环会自然清空，
    // 这里显式等一下，免得 run() 一返回 main 就把退出码写了。
    await new Promise((resolve) => {
      server.onclose = resolve;
      process.stdin.on('close', resolve);
    });

    return EXIT.OK;
  },
});
