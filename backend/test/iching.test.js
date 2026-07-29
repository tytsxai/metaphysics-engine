import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeNumber,
  pickTrigram,
  buildHexagram,
  applyChangingLines,
  deriveChangingLinesFromNumbers,
  buildTimeDivinationNumbers,
  deriveChangingLinesFromTimeContext,
} from '../services/iching.service.js';

test('normalizeNumber returns modulo for multiples and null for invalid', () => {
  assert.equal(normalizeNumber(8, 8), 8);
  assert.equal(normalizeNumber(0, 8), 8);
  assert.equal(normalizeNumber(-9, 8), 1);
  assert.equal(normalizeNumber('16', 8), 8);
  assert.equal(normalizeNumber('not-a-number', 8), null);
});

test('pickTrigram selects the correct trigram by normalized index', () => {
  assert.equal(pickTrigram(1)?.name, 'Qian');
  assert.equal(pickTrigram(8)?.name, 'Kun');
  assert.equal(pickTrigram(9)?.name, 'Qian');
  assert.equal(pickTrigram(-1)?.name, 'Qian');
  assert.equal(pickTrigram('x'), null);
});

test('buildHexagram constructs a hexagram from two trigrams', () => {
  const upper = pickTrigram(1);
  const lower = pickTrigram(8);
  const hexagram = buildHexagram(upper, lower);
  assert.ok(hexagram);
  assert.equal(hexagram?.upperTrigram?.name, 'Qian');
  assert.equal(hexagram?.lowerTrigram?.name, 'Kun');
  assert.deepEqual(hexagram?.lines, [0, 0, 0, 1, 1, 1]);
});

test('applyChangingLines flips valid line positions and clamps indices', () => {
  const base = buildHexagram(pickTrigram(1), pickTrigram(2));
  assert.ok(base);
  const changed = applyChangingLines(base, [6, 7, 0]);
  assert.deepEqual(base?.lines, [1, 1, 0, 1, 1, 1]);
  assert.deepEqual(changed?.lines, [0, 1, 0, 1, 1, 1]);
});

test('deriveChangingLinesFromNumbers derives a single normalized line', () => {
  assert.deepEqual(deriveChangingLinesFromNumbers([1, 2, 3]), [6]);
  assert.deepEqual(deriveChangingLinesFromNumbers([0, 0, 0]), [6]);
  assert.deepEqual(deriveChangingLinesFromNumbers([1, 2]), []);
});

test('deriveChangingLinesFromTimeContext 用农历与地支序数，且只出一个动爻', () => {
  // 2024-12-25 09:30 = 甲辰年 十一月廿五 巳时
  // 年支辰=5，月11，日25 → 上卦和 41；加时支巳=6 → 下卦和 47；47 ÷ 6 余 5
  const timeContext = { year: 2024, month: 12, day: 25, hour: 9, minute: 30 };
  assert.deepEqual(deriveChangingLinesFromTimeContext(timeContext), [5]);
  assert.deepEqual(deriveChangingLinesFromTimeContext(null), []);

  // 分钟不入卦：同一时辰内任何分钟都是同一卦
  assert.deepEqual(
    deriveChangingLinesFromTimeContext({ ...timeContext, minute: 0 }),
    deriveChangingLinesFromTimeContext({ ...timeContext, minute: 59 })
  );
});

test('时间起卦的上下卦和取农历月日与地支序数', () => {
  const numbers = buildTimeDivinationNumbers({ year: 2024, month: 12, day: 25, hour: 9 });
  assert.equal(numbers.lunar.yearZhi, '辰');
  assert.equal(numbers.lunar.yearNumber, 5);
  assert.equal(numbers.lunar.month, 11);
  assert.equal(numbers.lunar.day, 25);
  assert.equal(numbers.lunar.timeZhi, '巳');
  assert.equal(numbers.upperSum, 5 + 11 + 25);
  assert.equal(numbers.lowerSum, 5 + 11 + 25 + 6);
  assert.equal(buildTimeDivinationNumbers(null), null);
});

test('闰月按归本月入卦，与紫微同一口径', () => {
  // 2023-03-25 是闰二月初四
  const numbers = buildTimeDivinationNumbers({ year: 2023, month: 3, day: 25, hour: 0 });
  assert.equal(numbers.lunar.isLeapMonth, true);
  assert.equal(numbers.lunar.month, 2, '闰二月按二月计');
});
