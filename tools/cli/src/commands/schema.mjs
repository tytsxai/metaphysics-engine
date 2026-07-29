import { GLOBAL_FLAGS, defineCommand, inheritContract } from '../core/registry.mjs';
import { EXIT_MEANING } from '../core/errors.mjs';
import { usageError } from '../core/errors.mjs';

/**
 * 把命令树导出成 agent tool schema。
 *
 * 这是能力层通向上层 Runtime（Tool Registry）的唯一接口：调用方不再需要读
 * `help --json` 再自己翻译一遍，直接拿这份定义喂给模型即可。
 *
 * **必须从命令树生成，不能手写一份。** 手写的清单和 `help --json` 一定会分叉，
 * 而分叉的表现是"模型按 schema 构造了一个 CLI 根本不认的调用"—— 报的是用法错，
 * 排查的人却会去怀疑模型。
 *
 * 同理由，这个文件里**不出现任何命令名**：归属（capability / ops）、副作用、
 * 可复现性全部读命令自己的声明。这里曾经有过两张按命令名写死的表，
 * 代价是新增一条能力命令会被默认归成运维、于是静默不被导出，
 * 而整棵 calc 子树被一刀切标成"确定"也掩盖了 daily 恒不可复现这种真实差异。
 */

const FORMATS = ['anthropic', 'openai', 'mcp'];
const SCOPES = ['capability', 'ops', 'all'];

/** 出现在工具参数里的全局标志。json 由调用约定强制附加，quiet / help 对调用方无意义。 */
const EXPOSED_GLOBAL_FLAGS = ['dry-run', 'yes'];

const JSON_TYPE = { boolean: 'boolean', number: 'number', string: 'string', list: 'array' };

/** 工具名：命令路径拍平。MCP 要求 ^[a-zA-Z0-9_-]{1,64}$，命令名本身只有小写字母。 */
const toolNameOf = (path) => ['bazi', ...path].join('_');

/**
 * 收集所有可执行节点（有 run 的叶子），顺带把契约沿树继承下来。
 * 分组节点跑不了，不该出现在工具清单里。
 */
const collectLeaves = (node, path = [], inherited = {}) => {
  const contract = inheritContract(node, inherited);
  const children = node.commands || [];
  if (!children.length) return node.run ? [{ node, path, contract }] : [];
  return children.flatMap((child) => collectLeaves(child, [...path, child.name], contract));
};

const schemaForSpec = (spec) => {
  const type = JSON_TYPE[spec.type] || 'string';
  const property = { type };
  if (type === 'array') property.items = { type: 'string' };
  if (spec.summary) property.description = spec.summary;
  // 数组的取值集合属于元素，挂在数组本身上等于要求整个数组等于某个枚举值
  if (spec.choices) {
    if (type === 'array') property.items.enum = spec.choices;
    else property.enum = spec.choices;
  }
  if (spec.default !== undefined) property.default = spec.default;
  return property;
};

/**
 * 参数表。位置参数与选项在这里被抹平成同一批 property —— 模型不该关心
 * 一个值最终是拼在命令后面还是拼成 `--flag`，那是 catalog 里的映射负责的事。
 */
const parametersOf = (node, contract) => {
  const parameters = [];

  (node.args || []).forEach((arg, index) => {
    // 可变位置参数（`bazi env set A=1 B=2`）必须导成数组，否则调用方按 schema
    // 一次只能传一个值 —— 命令支持的能力被 schema 悄悄砍掉一半。
    const spec = { ...arg, type: arg.variadic ? 'list' : 'string' };
    parameters.push({
      property: arg.name,
      kind: 'positional',
      index,
      variadic: Boolean(arg.variadic),
      required: Boolean(arg.required),
      schema: schemaForSpec(spec),
    });
  });

  for (const flag of node.flags || []) {
    parameters.push({
      property: flag.name,
      kind: 'flag',
      flag: `--${flag.name}`,
      required: Boolean(flag.required),
      schema: schemaForSpec(flag),
    });
  }

  for (const name of EXPOSED_GLOBAL_FLAGS) {
    // --yes 只对破坏性命令有意义：非破坏性命令上它是个纯噪音选项，
    // 而模型看到一个叫 yes 的布尔参数很容易顺手设成 true。
    if (name === 'yes' && contract.effect !== 'destructive') continue;
    const spec = GLOBAL_FLAGS.find((f) => f.name === name);
    if (!spec) continue;
    parameters.push({
      property: spec.name,
      kind: 'flag',
      flag: `--${spec.name}`,
      required: false,
      schema: schemaForSpec(spec),
    });
  }

  return parameters;
};

const inputSchemaOf = (parameters) => {
  const properties = {};
  const required = [];
  for (const parameter of parameters) {
    properties[parameter.property] = parameter.schema;
    if (parameter.required) required.push(parameter.property);
  }
  return { type: 'object', properties, required, additionalProperties: false };
};

/**
 * 副作用要进 description，不能只进 MCP 的 annotations —— anthropic / openai
 * 两种格式里没有放 annotation 的地方，模型能看到的只有这段文字。
 */
const EFFECT_NOTE = {
  'read-only': null, // 只读是默认预期，写出来是噪音
  'local-write': '副作用：会改本机状态（进程 / 配置 / 依赖），不是只读查询。',
  destructive: '破坏性操作：会不可逆地丢掉已有内容，需要把 yes 设为 true 才会真正执行。',
};

const descriptionOf = (node, path, contract) =>
  [
    node.summary,
    node.description,
    contract.reproducibility ? `可复现性：${contract.reproducibility.note}` : null,
    contract.effect ? EFFECT_NOTE[contract.effect] : null,
    `等价命令：bazi ${path.join(' ')}`,
  ]
    .filter(Boolean)
    .join('\n\n');

const wrapForFormat = (format, { name, description, inputSchema }) => {
  if (format === 'openai') {
    return { type: 'function', function: { name, description, parameters: inputSchema } };
  }
  if (format === 'mcp') return { name, description, inputSchema };
  return { name, description, input_schema: inputSchema };
};

/**
 * MCP 的 annotations 正好装得下这些提示，别的格式塞进去会被 API 当成非法字段拒掉。
 *
 * 两个 hint 都从声明的 effect 直接派生。这里曾经写的是"属于 capability 就算只读"——
 * 今天恰好成立（能力命令都是纯计算），但那是**推断**：哪天加一条会写文件的能力命令，
 * 这个字段就会说谎，而读它的正是上层的安全拦截。
 */
const annotationsOf = (node, contract) => ({
  title: node.summary || undefined,
  readOnlyHint: contract.effect === 'read-only' ? true : undefined,
  destructiveHint: contract.effect === 'destructive' ? true : undefined,
});

const buildTools = ({ root, format, scope }) => {
  const tools = [];
  const catalog = [];

  for (const { node, path, contract } of collectLeaves(root)) {
    if (scope !== 'all' && scope !== contract.kind) continue;

    const name = toolNameOf(path);
    const parameters = parametersOf(node, contract);
    const inputSchema = inputSchemaOf(parameters);
    const tool = wrapForFormat(format, {
      name,
      description: descriptionOf(node, path, contract),
      inputSchema,
    });
    if (format === 'mcp') {
      const annotations = annotationsOf(node, contract);
      if (Object.values(annotations).some((v) => v !== undefined)) tool.annotations = annotations;
    }
    tools.push(tool);

    catalog.push({
      name,
      path: path.join(' '),
      argv: path,
      kind: contract.kind,
      /** 副作用是调用方做权限判断的依据，比 destructive 这个布尔多两档。 */
      effect: contract.effect,
      destructive: contract.effect === 'destructive',
      reproducibility: contract.reproducibility?.key ?? null,
      reproducibilityRequires: contract.reproducibility?.requires,
      parameters: parameters.map(
        ({ property, kind: parameterKind, flag, index, variadic, required }) => ({
          property,
          kind: parameterKind,
          flag,
          index,
          variadic,
          required,
        })
      ),
      examples: (node.examples || []).map((e) => (typeof e === 'string' ? e : e.command)),
    });
  }

  return { tools, catalog };
};

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
        /** 调用方靠这段把一次工具调用还原成 argv，不用去猜拼法。 */
        invocation: {
          binary: 'bazi',
          argvFrom: 'catalog[].argv 是命令路径；catalog[].parameters 说明每个 property 拼成什么',
          positional: '按 index 顺序追加在命令路径之后；variadic 为真时把数组元素逐个追加',
          flagBoolean: '值为 true 时追加 flag 本身，false 则整个省略',
          flagValue: '追加 flag 与取值两个 token（值不要自己加引号，交给 argv 传参）',
          alwaysAppend: ['--json'],
          note: '退出码就是下一步：3 去修环境、4 改请求、5 原样重试、7 停下来问人。',
        },
        tools,
        catalog,
      },
      // 文本模式只打工具数组：这条命令的产物本来就是机器读的，套壳反而不好用
      (data) => JSON.stringify(data.tools, null, 2)
    );
  },
});
