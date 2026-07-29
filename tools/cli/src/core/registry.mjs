import { usageError } from './errors.mjs';

/**
 * 全局标志：每条命令都接受，不需要各自声明。
 */
export const GLOBAL_FLAGS = [
  { name: 'json', type: 'boolean', summary: '输出结构化 JSON（stdout 只有 JSON，其余走 stderr）' },
  { name: 'quiet', alias: 'q', type: 'boolean', summary: '静默进度输出' },
  { name: 'dry-run', type: 'boolean', summary: '只说明会做什么，不真正执行' },
  { name: 'yes', alias: 'y', type: 'boolean', summary: '确认破坏性操作' },
  { name: 'help', alias: 'h', type: 'boolean', summary: '显示帮助' },
];

export const defineCommand = (spec) => ({
  name: spec.name,
  aliases: spec.aliases || [],
  summary: spec.summary || '',
  description: spec.description || '',
  usage: spec.usage || '',
  args: spec.args || [],
  flags: spec.flags || [],
  examples: spec.examples || [],
  /** 破坏性命令要打标，help --json 里 Agent 能一眼看出哪些需要 --yes */
  destructive: Boolean(spec.destructive),
  commands: spec.commands || [],
  run: spec.run,
});

const matchChild = (node, token) =>
  (node.commands || []).find((c) => c.name === token || c.aliases.includes(token));

/** 沿命令树下钻，返回 {node, path, rest} */
export const resolveCommand = (root, argv) => {
  let node = root;
  const commandPath = [];
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === '--') break;
    if (token.startsWith('-')) break;
    const child = matchChild(node, token);
    if (!child) break;
    node = child;
    commandPath.push(child.name);
    index += 1;
  }
  return { node, commandPath, rest: argv.slice(index) };
};

const flagSpecFor = (node, name) =>
  [...GLOBAL_FLAGS, ...(node.flags || [])].find((f) => f.name === name || f.alias === name);

/** 第一条示例就是最好的 next —— 它必定可跑，capability 测试会逐条解析验证。 */
const firstExample = (node) => {
  const example = (node.examples || [])[0];
  if (!example) return undefined;
  return typeof example === 'string' ? example : example.command;
};

/**
 * 必填校验：集中在这里，命令自己不再各写一遍 `if (flags.x === undefined) throw`。
 *
 * `required` 之所以必须是声明式的，是因为它有第二个读者：`bazi schema` 导出的
 * agent tool schema 直接读这个字段。写在 run 里的检查它看不见 —— 那样导出的
 * schema 会声称"什么都不必填"，调用方拿着它构造出必然失败的调用。
 */
const assertRequired = (node, flags, positionals) => {
  const missing = [];
  for (const spec of node.flags || []) {
    if (spec.required && flags[spec.name] === undefined) missing.push(`--${spec.name}`);
  }
  (node.args || []).forEach((arg, index) => {
    if (arg.required && positionals[index] === undefined) missing.push(`<${arg.name}>`);
  });
  if (!missing.length) return;
  throw usageError(`缺少必填参数：${missing.join(' ')}`, {
    next: firstExample(node),
    details: { missing },
  });
};

const coerce = (spec, raw) => {
  if (spec.type === 'number') {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw usageError(`--${spec.name} 需要一个数字，收到 "${raw}"`);
    }
    return value;
  }
  return raw;
};

/**
 * 解析剩余 token。规则：
 *   --flag / --no-flag        布尔
 *   --key=value / --key value 取值
 *   -x                        短别名
 *   --                        之后全部原样透传（passthrough）
 */
export const parseArgs = (node, rest) => {
  const flags = {};
  const positionals = [];
  const passthrough = [];
  let i = 0;

  while (i < rest.length) {
    const token = rest[i];

    if (token === '--') {
      passthrough.push(...rest.slice(i + 1));
      break;
    }

    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      const rawName = eq >= 0 ? body.slice(0, eq) : body;
      const inlineValue = eq >= 0 ? body.slice(eq + 1) : undefined;

      if (rawName.startsWith('no-') && !flagSpecFor(node, rawName)) {
        const spec = flagSpecFor(node, rawName.slice(3));
        if (spec && spec.type === 'boolean') {
          flags[spec.name] = false;
          i += 1;
          continue;
        }
      }

      const spec = flagSpecFor(node, rawName);
      if (!spec) {
        throw usageError(`未知选项 --${rawName}`, {
          next: `bazi ${node.name === 'bazi' ? '' : node.name} --help`.trim(),
        });
      }
      if (spec.type === 'boolean') {
        flags[spec.name] = inlineValue === undefined ? true : inlineValue !== 'false';
        i += 1;
        continue;
      }
      const value = inlineValue !== undefined ? inlineValue : rest[i + 1];
      if (value === undefined || (inlineValue === undefined && value.startsWith('--'))) {
        throw usageError(`--${spec.name} 缺少取值`);
      }
      const coerced = coerce(spec, value);
      if (spec.type === 'list') {
        flags[spec.name] = [...(flags[spec.name] || []), coerced];
      } else {
        flags[spec.name] = coerced;
      }
      i += inlineValue !== undefined ? 1 : 2;
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      const spec = flagSpecFor(node, token.slice(1));
      if (!spec) {
        throw usageError(`未知选项 ${token}`, { next: `bazi ${node.name} --help` });
      }
      if (spec.type === 'boolean') {
        flags[spec.name] = true;
        i += 1;
        continue;
      }
      const value = rest[i + 1];
      if (value === undefined) throw usageError(`${token} 缺少取值`);
      const coerced = coerce(spec, value);
      if (spec.type === 'list') flags[spec.name] = [...(flags[spec.name] || []), coerced];
      else flags[spec.name] = coerced;
      i += 2;
      continue;
    }

    positionals.push(token);
    i += 1;
  }

  // 补默认值
  for (const spec of [...GLOBAL_FLAGS, ...(node.flags || [])]) {
    if (flags[spec.name] === undefined && spec.default !== undefined) {
      flags[spec.name] = spec.default;
    }
  }

  // --help 要放行：否则 `bazi calc bazi --help` 会先炸在缺参上，帮助永远看不到。
  if (!flags.help) assertRequired(node, flags, positionals);

  return { flags, positionals, passthrough };
};

// ---------------------------------------------------------------- help 渲染

const flagLine = (spec) => {
  const alias = spec.alias ? `-${spec.alias}, ` : '    ';
  const value = spec.type === 'boolean' ? '' : ` <${spec.type === 'list' ? 'value…' : spec.type}>`;
  const left = `  ${alias}--${spec.name}${value}`;
  const choices = spec.choices ? ` (${spec.choices.join('|')})` : '';
  const mark = spec.required ? ' [必填]' : '';
  return `${left.padEnd(34)}${spec.summary || ''}${choices}${mark}`;
};

export const renderHelp = (node, commandPath) => {
  const full = ['bazi', ...commandPath].join(' ');
  const lines = [];

  if (node.summary) lines.push(node.summary, '');
  if (node.description) lines.push(node.description, '');

  lines.push('用法:');
  if (node.usage) {
    lines.push(`  ${node.usage}`);
  } else if (node.commands.length) {
    lines.push(`  ${full} <子命令> [选项]`);
  } else {
    const argSig = node.args
      .map((a) => `${a.required ? `<${a.name}>` : `[${a.name}]`}${a.variadic ? '...' : ''}`)
      .join(' ');
    lines.push(`  ${full} ${argSig} [选项]`.replace(/\s+/g, ' '));
  }
  lines.push('');

  if (node.commands.length) {
    lines.push('子命令:');
    const width = Math.max(...node.commands.map((c) => c.name.length)) + 2;
    for (const child of node.commands) {
      const mark = child.destructive ? ' [破坏性]' : '';
      lines.push(`  ${child.name.padEnd(width)}${child.summary}${mark}`);
    }
    lines.push('');
  }

  if (node.args.length) {
    lines.push('参数:');
    const width = Math.max(...node.args.map((a) => a.name.length)) + 2;
    for (const arg of node.args) {
      const choices = arg.choices ? ` (${arg.choices.join('|')})` : '';
      const mark = arg.required ? ' [必填]' : '';
      lines.push(`  ${arg.name.padEnd(width)}${arg.summary || ''}${choices}${mark}`);
    }
    lines.push('');
  }

  if (node.flags.length) {
    lines.push('选项:');
    for (const spec of node.flags) lines.push(flagLine(spec));
    lines.push('');
  }

  lines.push('通用选项:');
  for (const spec of GLOBAL_FLAGS) lines.push(flagLine(spec));

  if (node.examples.length) {
    lines.push('', '示例:');
    for (const example of node.examples) {
      if (typeof example === 'string') lines.push(`  ${example}`);
      else lines.push(`  # ${example.note}`, `  ${example.command}`);
    }
  }

  lines.push('', '提示: `bazi help --json` 输出完整命令树（机器可读），这是能力清单的唯一真源。');

  return lines.join('\n');
};

/**
 * 机器可读的完整命令树 —— SKILL.md 不抄命令列表，就是靠这个。
 *
 * globalFlags 只在树根出现一次（每个节点都挂一遍纯属噪音），但**必须出现**：
 * 这里是能力清单的唯一真源，漏了它 Agent 就发现不了 --yes / --dry-run ——
 * 而这两个恰好是遇到 exit 7 时唯一的出路。
 */
export const toJsonTree = (node, commandPath = [], { root = true } = {}) => ({
  name: node.name,
  path: commandPath.join(' '),
  summary: node.summary,
  description: node.description || undefined,
  usage: node.usage || undefined,
  destructive: node.destructive || undefined,
  args: node.args.length ? node.args : undefined,
  flags: node.flags.length ? node.flags : undefined,
  globalFlags: root ? GLOBAL_FLAGS : undefined,
  examples: node.examples.length ? node.examples : undefined,
  commands: node.commands.length
    ? node.commands.map((child) => toJsonTree(child, [...commandPath, child.name], { root: false }))
    : undefined,
});
