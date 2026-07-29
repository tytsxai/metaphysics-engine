import assert from 'node:assert/strict';
import test from 'node:test';

import { bazi, baziJson } from './helpers.mjs';

/**
 * 导出的 tool schema 的契约。
 *
 * 这份 schema 的读者是上层 Runtime 的 Tool Registry，它按 schema 构造调用、
 * 按 catalog 拼 argv。所以这里要证的不是"字段齐不齐"，而是**schema 说的和 CLI 干的
 * 是同一件事**：声明必填的确实会被拦下、声明的参数确实存在、拼出来的 argv 确实能跑。
 *
 * 这三条任何一条断了，表现都是"模型照着 schema 构造出一个 CLI 不认的调用"——
 * 报的是用法错，排查的人却会去怀疑模型。
 */

const schema = (args = []) => baziJson(['schema', ...args]).payload.data;
const tree = () => baziJson(['help']).payload.data.tree;

const resolveInTree = (root, argv) => {
  let node = root;
  for (const token of argv) {
    const child = (node.commands || []).find((c) => c.name === token);
    if (!child) return null;
    node = child;
  }
  return node;
};

test('schema --json 是标准信封，且不需要引擎在跑', () => {
  const { payload, code } = baziJson(['schema']);
  assert.equal(code, 0);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.format, 'anthropic');
  assert.equal(payload.data.scope, 'capability');
  assert.equal(Array.isArray(payload.data.tools), true);
  assert.equal(payload.data.tools.length > 0, true, '导出了 0 个工具，等于这个能力层不存在');
});

test('文本模式的 stdout 就是裸的工具数组，可以直接重定向成文件', () => {
  const { stdout, code } = bazi(['schema']);
  assert.equal(code, 0);
  const tools = JSON.parse(stdout);
  assert.equal(Array.isArray(tools), true);
  assert.deepEqual(
    tools.map((t) => t.name),
    schema().tools.map((t) => t.name)
  );
});

test('默认只导出算法能力，运维命令要显式取', () => {
  const capability = schema();
  assert.equal(
    capability.catalog.every((c) => c.kind === 'capability'),
    true,
    '默认范围里混进了运维命令 —— 它们会改仓库，不该默认变成模型可调的工具'
  );

  const ops = schema(['--scope', 'ops']);
  assert.equal(
    ops.catalog.every((c) => c.kind === 'ops'),
    true
  );

  const all = schema(['--scope', 'all']);
  assert.equal(all.tools.length, capability.tools.length + ops.tools.length);
});

test('工具名唯一，且符合 MCP 的命名限制', () => {
  const names = schema(['--scope', 'all']).tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, '工具名重复，调用方无法区分');
  for (const name of names) {
    assert.match(name, /^[a-zA-Z0-9_-]{1,64}$/, `${name} 不是合法的工具名`);
  }
});

test('每个工具都对应一条真实存在、且可执行的命令', () => {
  const root = tree();
  for (const entry of schema(['--scope', 'all']).catalog) {
    const node = resolveInTree(root, entry.argv);
    assert.notEqual(node, null, `${entry.name} 的 argv 在 help --json 的命令树里解析不出来`);
    assert.equal(
      node.commands,
      undefined,
      `${entry.name} 指向的是命令分组，分组不能执行 —— 这条工具调用必定失败`
    );
    assert.equal(entry.path, entry.argv.join(' '));
  }
});

test('schema 里的每个参数都是真实存在的选项或位置参数', () => {
  const root = tree();
  const globals = new Set(root.globalFlags.map((f) => f.name));
  const problems = [];

  for (const entry of schema(['--scope', 'all']).catalog) {
    const node = resolveInTree(root, entry.argv);
    const ownFlags = new Set((node.flags || []).map((f) => f.name));
    const ownArgs = (node.args || []).map((a) => a.name);
    for (const parameter of entry.parameters) {
      if (parameter.kind === 'positional') {
        if (ownArgs[parameter.index] !== parameter.property) {
          problems.push(`${entry.name} 的位置参数 ${parameter.property} 与命令的 args 对不上`);
        }
        continue;
      }
      if (!ownFlags.has(parameter.property) && !globals.has(parameter.property)) {
        problems.push(`${entry.name} 声明了不存在的选项 --${parameter.property}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('声明为必填的参数，CLI 真的会拦下来', () => {
  // 这是整份 schema 里最容易说谎的字段：写在 run 里的检查 schema 看不见，
  // 反过来 schema 上标了 required 而 CLI 放行，调用方就会漏传参数还以为没事。
  for (const entry of schema().catalog) {
    const required = entry.parameters.filter((p) => p.required);
    if (!required.length) continue;
    const { code, payload } = baziJson([...entry.argv]);
    assert.equal(
      code,
      2,
      `${entry.name} 声明了必填参数 ${required.map((p) => p.property).join(' / ')}，` +
        `但什么都不给时退了 ${code} 而不是 2`
    );
    assert.equal(payload.code, 'usage');
  }
});

test('没有过度声明必填：第一条示例必须能满足全部必填项', () => {
  // 反方向的守卫。多标一个 required，模型就会被迫编造一个本不需要的值。
  const problems = [];
  for (const entry of schema(['--scope', 'all']).catalog) {
    const example = entry.examples[0];
    if (!example) continue;
    const tokens = example.split(/\s+/);
    for (const parameter of entry.parameters.filter((p) => p.required)) {
      const present =
        parameter.kind === 'positional'
          ? tokens.length > entry.argv.length + 1
          : tokens.some((t) => t === parameter.flag || t.startsWith(`${parameter.flag}=`));
      if (!present) {
        problems.push(`${entry.name} 把 ${parameter.property} 标成了必填，但示例里并没有给它`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

/** 按 invocation 那段约定，把一次工具调用还原成 argv —— 上层要实现的就是这个函数。 */
const argvFromToolCall = (entry, toolCall, alwaysAppend = []) => {
  const argv = [...entry.argv];
  const positionals = entry.parameters
    .filter((p) => p.kind === 'positional')
    .sort((a, b) => a.index - b.index);

  for (const parameter of positionals) {
    const value = toolCall[parameter.property];
    if (value === undefined) continue;
    if (parameter.variadic) argv.push(...[].concat(value).map(String));
    else argv.push(String(value));
  }

  for (const parameter of entry.parameters.filter((p) => p.kind === 'flag')) {
    const value = toolCall[parameter.property];
    if (value === undefined) continue;
    if (typeof value === 'boolean') {
      if (value) argv.push(parameter.flag);
      continue;
    }
    for (const item of [].concat(value)) argv.push(parameter.flag, String(item));
  }

  return [...argv, ...alwaysAppend];
};

/** 从示例反推出一次工具调用 —— 示例是唯一一份"确定能跑"的真实参数。 */
const toolCallFromExample = (entry, tool) => {
  const properties = (tool.input_schema || tool.inputSchema).properties;
  const tokens = entry.examples[0].split(/\s+/).slice(1 + entry.argv.length);
  const call = {};
  const positionals = entry.parameters
    .filter((p) => p.kind === 'positional')
    .sort((a, b) => a.index - b.index);
  let positionalAt = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.startsWith('--')) {
      const name = token.slice(2);
      if (!entry.parameters.some((p) => p.property === name)) continue; // --json 之类的全局标志
      if (properties[name]?.type === 'boolean') call[name] = true;
      else {
        call[name] = tokens[i + 1];
        i += 1;
      }
      continue;
    }
    const parameter = positionals[positionalAt];
    if (!parameter) continue;
    if (parameter.variadic) call[parameter.property] = [...(call[parameter.property] || []), token];
    else {
      call[parameter.property] = token;
      positionalAt += 1;
    }
  }
  return call;
};

test('按 catalog 的映射拼出来的 argv，每条能力都真能跑', async (t) => {
  // 端到端证明这套映射规则可用。只测一条命令是不够的：位置参数、可变参数、布尔、
  // 带取值的选项分散在不同命令上，映射规则真正会出错的地方恰恰是那几条特殊的。
  // dry-run 不发请求，所以不依赖引擎在跑。
  const data = schema();
  for (const entry of data.catalog) {
    // 带引号的示例（--location "Beijing, CN"）按空格拆会拆坏，那不是映射规则的问题
    if (!entry.examples.length || entry.examples[0].includes('"')) continue;
    await t.test(entry.name, () => {
      const tool = data.tools.find((x) => x.name === entry.name);
      const toolCall = { ...toolCallFromExample(entry, tool), 'dry-run': true };
      const argv = argvFromToolCall(entry, toolCall, data.invocation.alwaysAppend);
      const { code, stdout } = bazi(argv);
      assert.equal(code, 0, `按 catalog 拼出的 argv 跑挂了：bazi ${argv.join(' ')}`);
      assert.equal(JSON.parse(stdout).ok, true);
    });
  }
});

test('可变位置参数导成数组，不被砍成单值', () => {
  // `bazi env set A=1 B=2` 一次能写多个键。导成 string 的话，调用方按 schema
  // 一次只能传一个 —— 命令的能力被 schema 悄悄砍掉一半，而且不会报错。
  const data = schema(['--scope', 'all']);
  const variadic = data.catalog.flatMap((entry) =>
    entry.parameters.filter((p) => p.variadic).map((p) => ({ entry, p }))
  );
  assert.equal(variadic.length > 0, true, '一个可变参数都没有，标记大概率丢了');
  for (const { entry, p } of variadic) {
    const tool = data.tools.find((t) => t.name === entry.name);
    assert.equal(
      tool.input_schema.properties[p.property].type,
      'array',
      `${entry.name} 的 ${p.property} 是可变参数，却导成了单值`
    );
  }
});

test('三种格式各自的形状正确，且不夹带 API 不认的字段', () => {
  const anthropic = schema(['--format', 'anthropic']).tools[0];
  assert.deepEqual(Object.keys(anthropic).sort(), ['description', 'input_schema', 'name']);

  const openai = schema(['--format', 'openai']).tools[0];
  assert.deepEqual(Object.keys(openai).sort(), ['function', 'type']);
  assert.equal(openai.type, 'function');
  assert.deepEqual(Object.keys(openai.function).sort(), ['description', 'name', 'parameters']);

  const mcp = schema(['--format', 'mcp']).tools[0];
  assert.equal(typeof mcp.inputSchema, 'object');
  assert.equal(mcp.input_schema, undefined);
  for (const key of Object.keys(mcp)) {
    assert.equal(
      ['name', 'description', 'inputSchema', 'annotations'].includes(key),
      true,
      `mcp 格式里出现了非法字段 ${key}`
    );
  }
});

test('每条能力都声明了可复现性，且不可复现的说法进了工具描述', () => {
  // 调用方最容易踩的坑就是拿一个不可复现的结果做断言或幂等重试。
  // 这件事只写在 SKILL.md 里不够 —— 装载 schema 的 Runtime 不一定读得到那份文档。
  const data = schema();
  const keys = ['deterministic', 'conditional', 'not-reproducible'];

  for (const entry of data.catalog) {
    assert.equal(
      keys.includes(entry.reproducibility),
      true,
      `${entry.name} 的可复现性是 ${entry.reproducibility} —— 能力命令必须声明它`
    );
    const tool = data.tools.find((t) => t.name === entry.name);
    assert.match(tool.description, /可复现性：/, `${entry.name} 的描述里没有可复现性说明`);
    if (entry.reproducibility === 'not-reproducible') {
      assert.match(tool.description, /不同|不保证/, `${entry.name} 没说清结果不可复现`);
    }
  }

  // 按子树一刀切标注是这份数据最早的形态，两个方向都错过，所以两个方向都钉住：
  const daily = data.catalog.find((c) => c.name === 'bazi_calc_daily');
  assert.equal(daily.reproducibility, 'not-reproducible', 'daily 没有日期参数，恒取引擎当日');
  const iching = data.catalog.find((c) => c.name === 'bazi_cast_iching');
  assert.equal(iching.reproducibility, 'conditional', '给定数字起卦是确定性的，不能标成恒不可复现');
});

test('conditional 必须说清条件，且 requires 指向真实存在的选项', () => {
  const root = tree();
  const data = schema(['--scope', 'all']);
  for (const entry of data.catalog.filter((c) => c.reproducibility === 'conditional')) {
    const tool = data.tools.find((t) => t.name === entry.name);
    assert.match(
      tool.description,
      /可复现性：.+/,
      `${entry.name} 标了 conditional 却没说明什么情况下才确定`
    );
    for (const name of entry.reproducibilityRequires || []) {
      const node = resolveInTree(root, entry.argv);
      assert.equal(
        (node.flags || []).some((f) => f.name === name),
        true,
        `${entry.name} 的 requires 提到 --${name}，但这条命令没有这个选项`
      );
    }
  }
});

test('每条可执行命令都声明了副作用', () => {
  // 缺了会怎样：上层的安全拦截读不到等级，只能按"未知"处理 —— 要么全放行，
  // 要么全拦，两种都会让这道闸失去意义。所以这是硬门禁，不是文档建议。
  const effects = ['read-only', 'local-write', 'destructive'];
  for (const entry of schema(['--scope', 'all']).catalog) {
    assert.equal(
      effects.includes(entry.effect),
      true,
      `${entry.name} 的 effect 是 ${entry.effect} —— 新增命令必须声明 effect（见 registry.mjs 的 EFFECTS）`
    );
  }
});

test('MCP 的 readOnly / destructive 提示与声明的副作用一致', () => {
  const data = schema(['--scope', 'all', '--format', 'mcp']);
  const byName = new Map(data.catalog.map((c) => [c.name, c]));
  for (const tool of data.tools) {
    const entry = byName.get(tool.name);
    const annotations = tool.annotations || {};
    assert.equal(
      annotations.readOnlyHint === true,
      entry.effect === 'read-only',
      `${tool.name} 的 readOnlyHint 与 effect=${entry.effect} 不符 —— 安全拦截读的就是这个字段`
    );
    assert.equal(annotations.destructiveHint === true, entry.effect === 'destructive');
  }
});

test('会写东西的命令，描述里必须写明它会写', () => {
  // 只进 MCP 的 annotations 不够：anthropic / openai 两种格式没有放 annotation 的地方，
  // 模型能看到的只有 description。
  const data = schema(['--scope', 'ops']);
  for (const entry of data.catalog.filter((c) => c.effect !== 'read-only')) {
    const tool = data.tools.find((t) => t.name === entry.name);
    assert.match(
      tool.description,
      /副作用|破坏性操作/,
      `${entry.name} 会改本机状态，但描述里只字未提`
    );
  }
});

test('破坏性命令导出时必须带上确认参数', () => {
  const data = schema(['--scope', 'ops']);
  const destructive = data.catalog.filter((c) => c.destructive);
  assert.equal(destructive.length > 0, true, '运维范围里一条破坏性命令都没有，标记大概率丢了');
  for (const entry of destructive) {
    assert.equal(
      entry.parameters.some((p) => p.property === 'yes'),
      true,
      `${entry.name} 是破坏性命令，schema 里却没有 yes —— 调用方将永远拿到 exit 7`
    );
  }
  // 反过来：非破坏性命令不该出现 yes，否则模型会顺手把它设成 true
  for (const entry of schema(['--scope', 'all']).catalog.filter((c) => !c.destructive)) {
    assert.equal(
      entry.parameters.some((p) => p.property === 'yes'),
      false,
      `${entry.name} 不是破坏性命令，不该暴露 yes`
    );
  }
});

test('--format / --scope 给了不认识的值是用法错', () => {
  for (const args of [
    ['schema', '--format', 'nope'],
    ['schema', '--scope', 'nope'],
  ]) {
    const { code, payload } = baziJson(args);
    assert.equal(code, 2, `bazi ${args.join(' ')} 应该是用法错`);
    assert.equal(payload.code, 'usage');
  }
});
