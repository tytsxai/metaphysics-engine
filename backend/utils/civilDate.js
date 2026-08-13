/**
 * 子初换日：23 点起进入次日子时。
 *
 * 时家奇门、大六壬、六爻取日干支时，夜子（23:00–24:00）与次日 0 点同属一个子时，
 * 日柱应按次日计。八字晚子派（sect=2）则日柱不换、仅时干按次日遁 —— 那是另一套
 * 口径，不走这里。
 *
 * 用 lunar-javascript 的 Solar.next 做日历进位，避免手写月末/年末。
 */

import { Solar } from 'lunar-javascript';

/**
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @param {number} hour 0–23
 * @returns {{ year: number, month: number, day: number, rolled: boolean }}
 */
export const resolveDayForHour = (year, month, day, hour) => {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const h = Number(hour);
  if (![y, m, d].every(Number.isFinite)) {
    return { year: y, month: m, day: d, rolled: false };
  }
  if (!Number.isFinite(h) || h < 23) {
    return { year: y, month: m, day: d, rolled: false };
  }
  const next = Solar.fromYmd(y, m, d).next(1);
  return {
    year: next.getYear(),
    month: next.getMonth(),
    day: next.getDay(),
    rolled: true,
  };
};
