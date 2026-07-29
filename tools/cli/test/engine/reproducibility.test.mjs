import assert from 'node:assert/strict';
import test from 'node:test';

import { bazi, baziJson } from '../helpers.mjs';

/**
 * 声明出来的可复现性，拿真实引擎验一遍。
 *
 * 这是这批元数据里唯一**会说谎而没人察觉**的部分：副作用标错了迟早有人踩到，
 * 归属标错了命令会从导出清单里消失 —— 都是看得见的症状。而"标了 deterministic
 * 其实每次都变"没有任何症状，直到某个调用方拿它当回归基准，隔天收到一片 diff。
 *
 * 与 test/ 下其余用例的区别：这里**必须有引擎在跑**。所以它是 `bazi test` 的
 * 独立目标（engine），引擎没起时整个目标记 skipped —— 不是悄悄跳过几条断言。
 *
 * 只钉一个方向：**声明可复现的必须真的可复现**。
 * 反方向（标了 not-reproducible 的是不是真的会变）在一次运行里证不了：
 * `calc daily` 的不可复现来自"隔天就变"，同一秒内连调两次当然一样。
 */

const schema = () => baziJson(['schema', '--scope', 'capability']).payload.data;

/** 示例是唯一一份"确定能跑通"的真实参数；带引号的按空格拆会拆坏，跳过。 */
const argvFromExample = (example) =>
  example
    .split(/\s+/)
    .slice(1)
    .filter((t) => t !== '--json');

const REPRODUCIBLE_WITH_EXAMPLE = new Set(['deterministic', 'conditional']);

test('引擎在跑时，声明可复现的能力必须真的可复现', async (t) => {
  const status = baziJson(['stack', 'status']).payload;
  if (!status.data?.ready) {
    // 不是 t.skip：那样会静默变绿。让整条用例失败太吵，所以这里退而求其次 ——
    // diagnostic 会出现在 `bazi test engine` 的输出里，而目标级的跳过由
    // test.mjs 的 blockedReason 负责（`--fail-on-skip` 能把它变成硬失败）。
    t.diagnostic('引擎未就绪，跳过可复现性验证；先跑 bazi stack up');
    return;
  }

  for (const entry of schema().catalog) {
    const example = entry.examples[0];
    if (!example || example.includes('"')) continue;
    if (!REPRODUCIBLE_WITH_EXAMPLE.has(entry.reproducibility)) continue;

    // conditional 的示例未必给全了条件（比如"当下起课"那条），给全了才该稳定。
    const argv = argvFromExample(example);
    const missing = (entry.reproducibilityRequires || []).filter(
      (name) => !argv.includes(`--${name}`)
    );
    if (missing.length) continue;

    await t.test(`${entry.name} 连调两次结果一致`, () => {
      const first = bazi([...argv, '--json']);
      const second = bazi([...argv, '--json']);
      assert.equal(first.code, 0, `bazi ${argv.join(' ')} 退了 ${first.code}：${first.stdout}`);
      assert.equal(second.code, 0);
      assert.equal(
        first.stdout,
        second.stdout,
        `${entry.name} 声明 ${entry.reproducibility}，但同样的输入给出了不同的输出 —— ` +
          '要么引擎里混进了随时间变化的字段，要么这条声明该改成 not-reproducible'
      );
    });
  }
});
