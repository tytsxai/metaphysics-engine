import { usageError } from './errors.mjs';

/**
 * 副作用等级 —— 每条可执行命令必须声明的元数据。
 *
 * 这不是文档字段，是**同一份数据的两个读者**：`bazi schema` 按它生成 readOnlyHint /
 * destructiveHint（上层的安全拦截读这个），help 按它渲染标记（人读这个）。
 * 靠"命令名看着像只读"或"它属于 calc 所以是只读"推断都会在某天说谎 ——
 * 推断的前提变了不会有任何报错，而说谎的那一刻正是安全闸该拦住的那一刻。
 *
 *   read-only     不改任何东西（纯计算、查询、预演）
 *   local-write   会改本机状态：进程、.env 的单个键、依赖、运行态文件
 *   destructive   会不可逆地丢掉已有内容，必须过 assertDestructiveAllowed
 *
 * 取最坏情况标注：`doctor --fix` 会写，所以 doctor 整条是 local-write；
 * `env init` 只有 --force 才覆盖，但整条按 destructive 标，实际是否拦截由
 * 运行时的 assertDestructiveAllowed 精确判断。宁可标重，不可标轻。
 */
export const EFFECTS = ['read-only', 'local-write', 'destructive'];

/** 命令归属：capability 是这个项目对外输出的算法能力，ops 是维护本仓库的。 */
export const KINDS = ['capability', 'ops'];

/**
 * 可复现性 —— 调用方最容易误判的一点，所以是声明而不是靠命令名分组。
 *
 *   deterministic     给定输入必然同样输出，可用于回归比对
 *   conditional       确定与否取决于怎么调用，note 说清条件，requires 列出把哪些参数
 *                     给全就能拿到可复现的结果（有些条件不是"补参数"能满足的，可以不给）
 *   not-reproducible  同样输入不保证同样输出（重新随机，或恒取引擎当下）
 *
 * 曾经这份数据按命令树的第一段一刀切（calc 全确定、cast 全不确定），两边都是错的：
 * `calc daily` 压根没有日期参数可给，恒不可复现；`cast iching --numbers` 是确定性的。
 * 调用方照着一刀切的标注去做回归比对，会拿到一个每天都在变的"基准"。
 */
export const REPRODUCIBILITY_KEYS = ['deterministic', 'conditional', 'not-reproducible'];

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

/** 定义期的写错立刻炸掉，别等到导出的 schema 里出现一个谁都不认识的值。 */
const assertOneOf = (value, allowed, field, name) => {
  if (value === undefined || allowed.includes(value)) return;
  throw new Error(`命令 ${name} 的 ${field} 只能是 ${allowed.join(' / ')}，收到 "${value}"`);
};

const normalizeReproducibility = (spec) => {
  const value = spec.reproducibility;
  if (!value) return null;
  assertOneOf(value.key, REPRODUCIBILITY_KEYS, 'reproducibility.key', spec.name);
  // conditional 不说明条件等于没标：调用方仍然不知道要给什么才拿得到可复现的结果。
  if (value.key === 'conditional' && !value.note) {
    throw new Error(`命令 ${spec.name} 标了 conditional，就必须用 note 说清楚"什么情况下才确定"`);
  }
  return { key: value.key, note: value.note || '', requires: value.requires || undefined };
};

export const defineCommand = (spec) => {
  assertOneOf(spec.effect, EFFECTS, 'effect', spec.name);
  assertOneOf(spec.kind, KINDS, 'kind', spec.name);

  return {
    name: spec.name,
    aliases: spec.aliases || [],
    summary: spec.summary || '',
    description: spec.description || '',
    usage: spec.usage || '',
    args: spec.args || [],
    flags: spec.flags || [],
    examples: spec.examples || [],
    /**
     * 契约三件套。都可以由父节点继承（见 inheritContract）：整棵 calc 子树同为
     * 只读的算法能力，在根上声明一次即可；stack 子树各不相同，就逐条声明。
     */
    effect: spec.effect,
    kind: spec.kind,
    reproducibility: normalizeReproducibility(spec),
    /**
     * 能不能作为 agent tool 暴露出去。默认能 —— 声明成 false 的是那些
     * **一次工具调用装不下**的命令：长驻前台进程跑起来就不返回，模型调用它只会挂住，
     * 而 `bazi mcp` 自己被暴露出去还会让 server 里再起一个 server。
     *
     * 这是命令自己的声明，不是 toolSchema 那边按名字维护的一张排除表 ——
     * 那种表会在新增同类命令时静默漏掉，而漏掉的表现是模型的一次调用永远不返回。
     */
    exposeAsTool: spec.exposeAsTool !== false,
    /**
     * 破坏性是 effect 的**派生**，不是第二个真源 —— 两个字段各写各的，
     * 迟早会出现"标了 destructive 但 effect 说只读"这种自相矛盾的声明。
     */
    get destructive() {
      return this.effect === 'destructive';
    },
    commands: spec.commands || [],
    run: spec.run,
  };
};

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

/**
 * 契约继承：子命令没声明就用父的。
 *
 * kind 缺省是 ops —— 新增一条命令忘了声明归属时，它会落在"运维"这边，
 * 于是不会被 `bazi schema` 默认导出。反过来缺省成 capability 的话，
 * 一条会改仓库的命令会悄悄进入模型可调的工具清单。缺省值要往安全那边偏。
 */
export const inheritContract = (node, inherited = {}) => ({
  kind: node.kind || inherited.kind || 'ops',
  effect: node.effect || inherited.effect || null,
  reproducibility: node.reproducibility || inherited.reproducibility || null,
});

/** 沿命令路径把契约继承一路算下来 —— `bazi help calc bazi` 也要拿到 calc 那层的声明。 */
export const contractAlong = (root, commandPath) => {
  let node = root;
  let contract = inheritContract(root);
  for (const token of commandPath) {
    const child = matchChild(node, token);
    if (!child) break;
    node = child;
    contract = inheritContract(child, contract);
  }
  return contract;
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

const EFFECT_CN = {
  'read-only': '只读（不改任何东西）',
  'local-write': '会改本机状态（进程 / 配置 / 依赖）',
  destructive: '破坏性（会丢掉已有内容，需要 --yes）',
};

const REPRODUCIBILITY_CN = {
  deterministic: '同样输入必然同样输出，可用于回归比对',
  conditional: '给全下列参数才可复现',
  'not-reproducible': '同样输入不保证同样输出，不要用于断言或幂等重试',
};

export const renderHelp = (node, commandPath, contract = inheritContract(node)) => {
  const full = ['bazi', ...commandPath].join(' ');
  const lines = [];

  if (node.summary) lines.push(node.summary, '');
  if (node.description) lines.push(node.description, '');

  // 副作用与可复现性对人同样是"动手之前要知道的事"，不该只存在于 --json 里。
  if (contract.effect || contract.reproducibility) {
    if (contract.effect) lines.push(`副作用: ${EFFECT_CN[contract.effect] || contract.effect}`);
    if (contract.reproducibility) {
      const { key, requires } = contract.reproducibility;
      const detail = requires?.length ? `：${requires.map((r) => `--${r}`).join(' ')}` : '';
      lines.push(`可复现性: ${REPRODUCIBILITY_CN[key] || key}${detail}`);
    }
    lines.push('');
  }

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
export const toJsonTree = (node, commandPath = [], { root = true, inherited = {} } = {}) => {
  const contract = inheritContract(node, inherited);
  return {
    name: node.name,
    path: commandPath.join(' '),
    summary: node.summary,
    description: node.description || undefined,
    usage: node.usage || undefined,
    kind: contract.kind,
    /** 继承来的也照样输出：读者要的是"这条命令会不会写"，不是"它在哪一层声明的"。 */
    effect: contract.effect || undefined,
    reproducibility: contract.reproducibility || undefined,
    destructive: contract.effect === 'destructive' || undefined,
    args: node.args.length ? node.args : undefined,
    flags: node.flags.length ? node.flags : undefined,
    globalFlags: root ? GLOBAL_FLAGS : undefined,
    examples: node.examples.length ? node.examples : undefined,
    commands: node.commands.length
      ? node.commands.map((child) =>
          toJsonTree(child, [...commandPath, child.name], { root: false, inherited: contract })
        )
      : undefined,
  };
};
