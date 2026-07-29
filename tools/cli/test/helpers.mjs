import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BIN = path.join(ROOT, 'tools/cli/bin/bazi.mjs');
const ENV_FILE = path.join(ROOT, '.env');

/**
 * 用子进程跑 CLI —— 这是唯一能真正验证契约的方式。
 *
 * 直接 import main() 测不出退出码，也测不出"有没有东西偷偷写进 stdout"，
 * 而这两件事恰好是 Agent 唯一依赖的东西。
 */
export const bazi = (args, { env = {}, timeout = 60_000 } = {}) => {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, NO_COLOR: '1', ...env },
  });
  if (result.error) throw result.error;
  return {
    args,
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

/**
 * 跑一条 --json 命令，并断言 stdout 恰好是一个 JSON 文档。
 *
 * JSON.parse 对尾随内容会直接抛错，所以"能 parse"本身就等价于
 * "stdout 里没有第二个文档、没有进度行、没有子进程噪音"。
 */
export const baziJson = (args, options) => {
  const result = bazi([...args, '--json'], options);
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `\`bazi ${args.join(' ')} --json\` 的 stdout 不是单个 JSON 文档：${error.message}\n` +
        `--- stdout ---\n${result.stdout.slice(0, 2000)}\n--- stderr ---\n${result.stderr.slice(0, 1000)}`
    );
  }
  return { ...result, payload };
};

/**
 * 让「.env 已存在」这个前提成立 —— 依赖破坏性闸的用例必须先调它。
 *
 * `env init --force` 只有在文件**已经存在**时才是破坏性的（不存在时它和普通 init
 * 等价，直接创建并退 0）。开发者本机总有一份 .env，于是这些用例一直是绿的；
 * 而 CI 是干净检出，没有 .env，同一批用例会退 0 而不是 7 —— 表现成"安全闸失效了"，
 * 实际是这条用例的前提从来没建立过。这类"本机绿、CI 红"最难查，所以前提要显式建。
 *
 * 用 CLI 自己的 `env init`（幂等、非破坏）：已存在时一个字节都不会动。
 * 刻意不删回去 —— 删 .env 才是真正危险的操作，而多出来的这份就是 `bazi setup`
 * 本来也会生成的那份。
 */
export const ensureEnvFile = () => {
  if (fs.existsSync(ENV_FILE)) return;
  const result = bazi(['env', 'init', '--json']);
  if (result.code !== 0) {
    throw new Error(`测试前提没建立：bazi env init 退了 ${result.code}\n${result.stdout}`);
  }
};

/** 遍历 help --json 的命令树 */
export const walkTree = (node, visit, depth = 0) => {
  visit(node, depth);
  for (const child of node.commands || []) walkTree(child, visit, depth + 1);
};
