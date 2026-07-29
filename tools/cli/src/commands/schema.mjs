import { defineCommand } from '../core/registry.mjs';
import { EXIT_MEANING, usageError } from '../core/errors.mjs';
import { FORMATS, SCOPES, INVOCATION, buildTools } from '../core/toolSchema.mjs';

/**
 * 把命令树导出成 agent tool schema。
 *
 * 这是能力层通向上层 Runtime（Tool Registry）的接口之一：调用方不再需要读
 * `help --json` 再自己翻译一遍，直接拿这份定义喂给模型即可。另一条路是 `bazi mcp`，
 * 两者共用 core/toolSchema.mjs 里的同一份生成逻辑，不存在第二份手写清单。
 */

const pickOne = (value, allowed, flag, fallback) => {
  if (value === undefined) return fallback;
  if (!allowed.includes(value)) {
    throw usageError(`${flag} 只接受 ${allowed.join(' / ')}，收到 "${value}"`, {
      next: `bazi schema ${flag} ${allowed[0]} --json`,
    });
  }
  return value;
};

export const schemaCommand = defineCommand({
  name: 'schema',
  summary: '把命令树导出成 agent tool schema（供上层 Runtime 的 Tool Registry 装载）',
  effect: 'read-only',
  description:
    '从 `help --json` 的同一棵命令树生成，不存在第二份手写清单 —— 新增命令后无需改这里。\n' +
    '不需要引擎在跑：纯本地生成。\n\n' +
    '默认只导出算法能力（calc / cast）。运维命令要用 --scope ops 显式取，\n' +
    '因为它们会改这个仓库，其中还有破坏性的，不该默认变成模型随手可调的工具。\n\n' +
    '要的是一个能直接挂给 Agent 的 MCP server 而不是一份定义，用 `bazi mcp`。\n\n' +
    '文本模式下 stdout 就是裸的工具数组，可以直接重定向成文件；\n' +
    '--json 模式外面套标准信封，并额外带一份 catalog（参数到 argv 的映射与调用约定）。',
  usage: 'bazi schema [--format anthropic|openai|mcp] [--scope capability|ops|all] [--json]',
  flags: [
    {
      name: 'format',
      type: 'string',
      choices: FORMATS,
      default: 'anthropic',
      summary: '目标格式：anthropic 用 input_schema，openai 包一层 function，mcp 用 inputSchema',
    },
    {
      name: 'scope',
      type: 'string',
      choices: SCOPES,
      default: 'capability',
      summary: '导出范围：capability 只要算法能力，ops 只要运维命令，all 全要',
    },
  ],
  examples: [
    { note: '拿到算法能力的工具定义', command: 'bazi schema --json' },
    { note: '存成文件喂给上层', command: 'bazi schema --format openai' },
    { note: '连运维命令一起导出', command: 'bazi schema --scope all --format mcp --json' },
  ],
  run: ({ flags, out, root }) => {
    const format = pickOne(flags.format, FORMATS, '--format', 'anthropic');
    const scope = pickOne(flags.scope, SCOPES, '--scope', 'capability');

    // 直接走真实命令树 —— 它就是 `help --json` 的来源。两者不会分叉这件事
    // 由契约测试守着（catalog 里每条 path 都要能在 help --json 的树里解析出来）。
    const { tools, catalog } = buildTools({ root, format, scope });

    return out.ok(
      {
        format,
        scope,
        cli: 'bazi',
        exitCodes: EXIT_MEANING,
        invocation: INVOCATION,
        tools,
        catalog,
      },
      // 文本模式只打工具数组：这条命令的产物本来就是机器读的，套壳反而不好用
      (data) => JSON.stringify(data.tools, null, 2)
    );
  },
});
