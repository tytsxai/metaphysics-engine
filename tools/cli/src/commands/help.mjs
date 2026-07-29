import {
  contractAlong,
  defineCommand,
  renderHelp,
  resolveCommand,
  toJsonTree,
} from '../core/registry.mjs';
import { EXIT_MEANING } from '../core/errors.mjs';
import { usageError } from '../core/errors.mjs';

/**
 * 能力清单的唯一真源。
 *
 * SKILL.md 刻意不抄命令列表 —— 抄了就会腐化。Agent 想知道"能做什么"，
 * 永远是跑 `bazi help --json`，而不是读文档里的表格。
 */
/**
 * `--json` 帮助的统一信封。
 *
 * `bazi help --json`、`bazi --json`、`bazi env --json`、`bazi env init --help --json`
 * 必须长得一模一样 —— Agent 不该因为"从哪条路要到的帮助"而拿到不同形状的东西。
 */
/**
 * root 不能省：`bazi help calc bazi --json` 是从中间节点开始渲染的，
 * 契约（kind / effect / 可复现性）声明在 calc 那一层，不沿路径算一遍就会
 * 拿到默认值 —— 一条只读的能力命令会显示成归属 ops 且副作用未知。
 */
export const helpPayload = (node, commandPath, root) => ({
  ok: true,
  command: 'bazi help',
  data: {
    cli: 'bazi',
    exitCodes: EXIT_MEANING,
    tree: toJsonTree(node, commandPath, {
      inherited: root ? contractAlong(root, commandPath.slice(0, -1)) : {},
    }),
  },
});

export const helpCommand = defineCommand({
  name: 'help',
  summary: '输出命令树；--json 是机器可读的完整能力清单',
  effect: 'read-only',
  description:
    '不带参数输出顶层帮助；带命令路径输出那一条的帮助。\n' +
    '--json 额外附带退出码含义表，Agent 靠它把退出码翻译成下一步动作。',
  usage: 'bazi help [命令路径...] [--json]',
  args: [{ name: 'command', variadic: true, summary: '命令路径，如 `help stack up`' }],
  examples: [
    { note: '拿到全部能力（Agent 首选）', command: 'bazi help --json' },
    { note: '只看某条命令', command: 'bazi help stack up' },
  ],
  run: ({ positionals, flags, out, root }) => {
    const { node, commandPath, rest } = resolveCommand(root, positionals);
    if (rest.length) {
      throw usageError(`没有名为 "${rest[0]}" 的命令`, { next: 'bazi help --json' });
    }

    if (flags.json) {
      process.stdout.write(`${JSON.stringify(helpPayload(node, commandPath, root), null, 2)}\n`);
      return 0;
    }

    process.stdout.write(`${renderHelp(node, commandPath, contractAlong(root, commandPath))}\n`);
    return out.ok({}, () => '');
  },
});
