import assert from 'node:assert/strict';
import test from 'node:test';

import { rootCommand } from '../src/main.mjs';
import { buildTools, argvForToolCall, INVOCATION } from '../src/core/toolSchema.mjs';
import { baziJson } from './helpers.mjs';

/**
 * MCP server 的契约测试。
 *
 * 真正起一个 server 需要 SDK 与 stdio 往返，那属于冒烟；这里守的是更容易悄悄坏掉的
 * 两件事：**工具清单与 `bazi schema` 同源**，以及**参数还原成 argv 的规则和文档说的一致**。
 * 两者任何一条破了，症状都是"模型构造了一个 CLI 不认的调用"——报的是用法错，
 * 排查的人却会去怀疑模型。
 */

const toolsFor = (scope) => buildTools({ root: rootCommand, format: 'mcp', scope });

test('MCP 工具清单与 bazi schema 的导出同源', () => {
  const built = toolsFor('capability');
  const { payload } = baziJson(['schema', '--format', 'mcp', '--scope', 'capability']);

  assert.deepEqual(
    built.tools.map((t) => t.name),
    payload.data.tools.map((t) => t.name),
    'MCP 暴露的工具与 schema 导出的必须逐条一致'
  );
  assert.deepEqual(built.tools, payload.data.tools, '连 inputSchema 与 annotations 都不该有差异');
});

test('默认 scope 只暴露算法能力，且全部标为只读', () => {
  const { tools, catalog } = toolsFor('capability');
  assert.ok(tools.length > 0, 'capability scope 不该是空的');
  for (const entry of catalog) {
    assert.equal(entry.kind, 'capability', `${entry.name} 不是算法能力却被默认暴露`);
    assert.equal(entry.destructive, false, `${entry.name} 是破坏性的，不该默认暴露`);
  }
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} 缺 readOnlyHint`);
  }
});

/**
 * 破坏性命令即使被显式放进 scope，也仍然要靠 CLI 自己的安全闸拦住 ——
 * MCP server 每次调用都真的去跑一次 CLI，就是为了不把这道闸绕过去。
 */
test('破坏性命令带 destructiveHint 与 yes 参数，且只在 all/ops 下出现', () => {
  const destructive = toolsFor('all').catalog.filter((entry) => entry.destructive);
  assert.ok(destructive.length > 0, '仓库里应当存在破坏性命令，否则这条用例失去意义');

  for (const entry of destructive) {
    const tool = toolsFor('all').tools.find((t) => t.name === entry.name);
    assert.equal(tool.annotations?.destructiveHint, true, `${entry.name} 缺 destructiveHint`);
    assert.ok(
      entry.parameters.some((p) => p.property === 'yes'),
      `${entry.name} 是破坏性的，必须暴露 yes 参数，否则模型无路可走`
    );
  }
});

test('参数还原成 argv 的规则与 INVOCATION 描述一致', async (t) => {
  const { catalog } = toolsFor('capability');
  const bazi = catalog.find((entry) => entry.path === 'calc bazi');
  assert.ok(bazi, 'calc bazi 应当在能力清单里');

  await t.test('选项拼成 --flag value，并强制附加 --json', () => {
    const argv = argvForToolCall(bazi, { birth: '1990-05-20T14:30', gender: 'male' });
    assert.deepEqual(argv, [
      'calc',
      'bazi',
      '--birth',
      '1990-05-20T14:30',
      '--gender',
      'male',
      '--json',
    ]);
    assert.deepEqual(INVOCATION.alwaysAppend, ['--json']);
  });

  await t.test('布尔 false 是"不加这个开关"，不是加一个值为 false 的开关', () => {
    const argv = argvForToolCall(bazi, { birth: 'x', gender: 'male', 'dry-run': false });
    assert.ok(!argv.includes('--dry-run'));
    const enabled = argvForToolCall(bazi, { birth: 'x', gender: 'male', 'dry-run': true });
    assert.ok(enabled.includes('--dry-run'));
    assert.ok(!enabled.includes('true'), '布尔开关不该带上取值');
  });

  await t.test('未声明的参数被丢弃，而不是原样拼进 argv', () => {
    const argv = argvForToolCall(bazi, { birth: 'x', gender: 'male', 胡编的参数: 'v' });
    assert.ok(!argv.includes('--胡编的参数'));
    assert.ok(!argv.includes('v'));
  });

  await t.test('undefined 与 null 都当作没给', () => {
    const argv = argvForToolCall(bazi, { birth: 'x', gender: 'male', location: null });
    assert.ok(!argv.includes('--location'));
  });
});

test('可变位置参数被逐个追加，而不是拼成一个 token', () => {
  const { catalog } = buildTools({ root: rootCommand, format: 'mcp', scope: 'ops' });
  const variadic = catalog.find((entry) => entry.parameters.some((p) => p.variadic));
  if (!variadic) return; // 仓库里暂时没有这类命令时不强求

  const parameter = variadic.parameters.find((p) => p.variadic);
  const argv = argvForToolCall(variadic, { [parameter.property]: ['A=1', 'B=2'] });
  assert.ok(argv.includes('A=1') && argv.includes('B=2'), '每个元素都要独立成为一个 token');
});

/**
 * catalog 里的每条路径都必须真能被 CLI 解析出来。这条用例是"工具清单不会指向
 * 一条不存在的命令"的最后一道保险 —— 模型照着清单调用，撞上的会是用法错。
 */
test('每个工具的等价命令都真实存在', async (t) => {
  for (const entry of toolsFor('all').catalog) {
    await t.test(`bazi ${entry.path} --help`, () => {
      const { payload } = baziJson([...entry.argv, '--help']);
      assert.equal(payload.ok, true, `bazi ${entry.path} 解析不出来`);
    });
  }
});

test('mcp 命令自己不出现在暴露的工具清单里', () => {
  const names = toolsFor('all').catalog.map((entry) => entry.path);
  assert.ok(!names.includes('mcp'), 'MCP server 把自己也暴露成工具会让模型递归起 server');
});
