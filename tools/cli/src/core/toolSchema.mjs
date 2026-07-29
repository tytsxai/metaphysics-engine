import { GLOBAL_FLAGS, inheritContract } from './registry.mjs';

/**
 * 把命令树翻译成 agent tool schema。
 *
 * 两个读者共用这一份：`bazi schema` 把它导出给上层 Runtime 装载，`bazi mcp` 直接用它
 * 应答 tools/list。**必须是同一份**——两条路各生成一遍的话，模型通过 MCP 看到的工具
 * 和调用方导出的定义会慢慢分叉，而分叉的表现是"模型按 schema 构造了一个 CLI 不认的调用"：
 * 报的是用法错，排查的人却会去怀疑模型。
 *
 * 这个文件里**不出现任何命令名**：归属（capability / ops）、副作用、可复现性全部读命令
 * 自己的声明。这里曾经有过两张按命令名写死的表，代价是新增一条能力命令会被默认归成运维、
 * 于是静默不被导出，而整棵 calc 子树被一刀切标成"确定"也掩盖了 daily 恒不可复现这种真实差异。
 */

export const FORMATS = ['anthropic', 'openai', 'mcp'];
export const SCOPES = ['capability', 'ops', 'all'];

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
  if (!children.length)
    return node.run && node.exposeAsTool !== false ? [{ node, path, contract }] : [];
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
const annotationsOf = (node, contract) => {
  const annotations = {
    title: node.summary || undefined,
    readOnlyHint: contract.effect === 'read-only' ? true : undefined,
    destructiveHint: contract.effect === 'destructive' ? true : undefined,
  };
  // 值为 undefined 的键要真的删掉，不能只靠 JSON 序列化把它们抹掉：
  // 内存里拿到这个对象的消费者会看到 `'destructiveHint' in annotations === true`，
  // 于是一条只读命令被当成"声明过破坏性、只是值不明"。
  for (const [key, value] of Object.entries(annotations)) {
    if (value === undefined) delete annotations[key];
  }
  return annotations;
};

export const buildTools = ({ root, format, scope }) => {
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
      if (Object.keys(annotations).length) tool.annotations = annotations;
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

/** 调用方靠这段把一次工具调用还原成 argv，不用去猜拼法。 */
export const INVOCATION = {
  binary: 'bazi',
  argvFrom: 'catalog[].argv 是命令路径；catalog[].parameters 说明每个 property 拼成什么',
  positional: '按 index 顺序追加在命令路径之后；variadic 为真时把数组元素逐个追加',
  flagBoolean: '值为 true 时追加 flag 本身，false 则整个省略',
  flagValue: '追加 flag 与取值两个 token（值不要自己加引号，交给 argv 传参）',
  alwaysAppend: ['--json'],
  note: '退出码就是下一步：3 去修环境、4 改请求、5 原样重试、7 停下来问人。',
};

/**
 * 把一次工具调用还原成 argv —— 上面 INVOCATION 那段散文的可执行版本。
 *
 * `bazi mcp` 用它把模型传来的参数对象拼成真实命令。它必须与 INVOCATION 描述的规则
 * 完全一致：文字描述给外部调用方看，这个函数是自家 MCP server 的实现，两者说的
 * 是同一套拼法，契约测试拿同一批 catalog 逐条比对。
 *
 * 未在 catalog 里声明的参数会被丢弃而不是透传 —— 模型偶尔会自造参数名，
 * 原样拼进 argv 只会撞上"未知选项"退 2，还不如当它没说。
 */
export const argvForToolCall = (entry, args = {}) => {
  const argv = [...entry.argv];
  const positionals = [];

  for (const parameter of entry.parameters) {
    const value = args?.[parameter.property];
    if (value === undefined || value === null) continue;

    if (parameter.kind === 'positional') {
      positionals[parameter.index] = parameter.variadic
        ? (Array.isArray(value) ? value : [value]).map(String)
        : [String(value)];
      continue;
    }

    if (typeof value === 'boolean') {
      // false 是"不加这个开关"，不是"加一个值为 false 的开关"
      if (value) argv.push(parameter.flag);
      continue;
    }

    // list 型选项重复出现：--number 1 --number 2
    for (const item of Array.isArray(value) ? value : [value]) {
      argv.push(parameter.flag, String(item));
    }
  }

  // 位置参数按声明顺序补回命令路径之后。中间缺项说明前面的可选参数没给，
  // 此时后面的也不能拼 —— 那会让第二个值被当成第一个。
  for (const group of positionals) {
    if (!group) break;
    argv.push(...group);
  }

  argv.push(...INVOCATION.alwaysAppend);
  return argv;
};
