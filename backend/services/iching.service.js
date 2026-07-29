/**
 * 周易起卦。
 *
 * 两种起法都出自梅花易数，先天八卦数为准（乾一兑二离三震四巽五坎六艮七坤八）：
 *
 * - **三数起卦**：一数定上卦，二数定下卦，三数之和定动爻。给定数字即确定性。
 * - **时间起卦**：年支数、农历月、农历日、时支数四者相加取卦。
 *
 * 时间起卦此前是编造的：拿公历年份整数（如 2026）当年数、拿「分」入卦、
 * 还一次产出两个动爻。梅花易数用的是**年支序数**（子一至亥十二）与**农历**月日，
 * 最小粒度是时辰不是分钟，且动爻只有一个。
 */

import { Solar } from 'lunar-javascript';

import { TRIGRAMS, hexagramByTrigrams, hexagramByLines } from '../data/ichingHexagrams.js';

/** 地支序数：子一、丑二……亥十二。梅花易数的年数与时数都取它。 */
const BRANCH_ORDER = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const branchNumber = (branch) => {
  const index = BRANCH_ORDER.indexOf(branch);
  return index === -1 ? null : index + 1;
};

const normalizeNumber = (value, modulo) => {
  const safe = Math.abs(Number(value));
  if (!Number.isFinite(safe)) return null;
  const remainder = safe % modulo;
  return remainder === 0 ? modulo : remainder;
};

const pickTrigram = (value) => {
  const index = normalizeNumber(value, 8);
  if (!index) return null;
  return TRIGRAMS[index - 1];
};

const buildHexagram = (upper, lower) => {
  if (!upper || !lower) return null;
  return hexagramByTrigrams.get(`${upper.id}-${lower.id}`) || null;
};

const applyChangingLines = (hexagram, changingLines = []) => {
  if (!hexagram || !changingLines.length) return hexagram;
  const nextLines = [...hexagram.lines];
  changingLines.forEach((line) => {
    const index = Math.min(Math.max(line, 1), 6) - 1;
    nextLines[index] = nextLines[index] ? 0 : 1;
  });
  return hexagramByLines.get(nextLines.join('')) || { ...hexagram, lines: nextLines };
};

const deriveChangingLinesFromNumbers = (numbers) => {
  if (!Array.isArray(numbers) || numbers.length !== 3) return [];
  // Traditional Plum Blossom method: sum of numbers modulo 6 for changing line
  const sum = numbers.reduce((total, value) => total + Number(value), 0);
  const changingLine = normalizeNumber(sum, 6);
  return changingLine ? [changingLine] : [];
};

/**
 * 时间起卦（梅花易数年月日时起例）。
 *
 * 上卦 = (年支数 + 农历月 + 农历日) ÷ 8 之余，
 * 下卦 = (年支数 + 农历月 + 农历日 + 时支数) ÷ 8 之余，
 * 动爻 = 同一个和 ÷ 6 之余。余零则取满数（8 或 6）。
 *
 * 闰月按归本月取（与紫微同一口径）。返回 null 表示日期无法解析。
 *
 * @param {object} moment 公历年月日时
 */
const buildTimeDivinationNumbers = (moment) => {
  // 默认参数只挡 undefined，null 会一路穿到解构那里炸掉
  if (!moment || typeof moment !== 'object') return null;
  const y = Number(moment.year);
  const m = Number(moment.month);
  const d = Number(moment.day);
  const h = Number(moment.hour);
  if (![y, m, d, h].every(Number.isFinite)) return null;

  const lunar = Solar.fromYmdHms(y, m, d, h, 0, 0).getLunar();
  const yearNumber = branchNumber(lunar.getYearZhi());
  const hourNumber = branchNumber(lunar.getTimeZhi());
  if (!yearNumber || !hourNumber) return null;

  // 闰月以负数表示，取绝对值即归本月
  const lunarMonth = Math.abs(lunar.getMonth());
  const lunarDay = lunar.getDay();

  const upperSum = yearNumber + lunarMonth + lunarDay;
  const lowerSum = upperSum + hourNumber;
  return {
    upperSum,
    lowerSum,
    lunar: {
      yearZhi: lunar.getYearZhi(),
      yearNumber,
      month: lunarMonth,
      isLeapMonth: lunar.getMonth() < 0,
      day: lunarDay,
      timeZhi: lunar.getTimeZhi(),
      hourNumber,
    },
  };
};

/** 时间起卦的动爻：与下卦同一个和取六之余，只有一个动爻。 */
const deriveChangingLinesFromTimeContext = (timeContext) => {
  const numbers = buildTimeDivinationNumbers(timeContext);
  if (!numbers) return [];
  const changingLine = normalizeNumber(numbers.lowerSum, 6);
  return changingLine ? [changingLine] : [];
};

const getDetailedLines = (hexagram, changingLines = []) => {
  if (!hexagram?.lines) return [];
  return hexagram.lines.map((bit, idx) => {
    const position = idx + 1;
    const isChanging = changingLines.includes(position);
    // 1 = Yang, 0 = Yin
    let status = '';
    if (bit === 1) {
      status = isChanging ? 'Old Yang (Moving)' : 'Young Yang (Stable)';
    } else {
      status = isChanging ? 'Old Yin (Moving)' : 'Young Yin (Stable)';
    }
    return { position, bit, isChanging, status };
  });
};

export {
  normalizeNumber,
  branchNumber,
  pickTrigram,
  buildHexagram,
  applyChangingLines,
  deriveChangingLinesFromNumbers,
  buildTimeDivinationNumbers,
  deriveChangingLinesFromTimeContext,
  getDetailedLines,
};
