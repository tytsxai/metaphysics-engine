import { logger } from '../config/logger.js';
import express from 'express';
import { Solar } from 'lunar-javascript';

import { buildLiuyaoChart } from '../services/liuyao.service.js';

const router = express.Router();

/**
 * 起卦日的干支与月建。六爻断卦离不开月建日辰 —— 不给日期就取当日，
 * 但那样结果不可复现，所以响应里会原样回显所用日期。
 *
 * 给了 hour 时：23 点按子初换日取日干支；月建走节气精确到时
 * （getMonthInGanZhiExact），与引擎其余术数的节气口径一致。
 */
const resolveCastDate = (body) => {
  const { year, month, day, hour } = body || {};
  const now = new Date();
  const y = Number.isInteger(Number(year)) ? Number(year) : now.getFullYear();
  const m = Number.isInteger(Number(month)) ? Number(month) : now.getMonth() + 1;
  const d = Number.isInteger(Number(day)) ? Number(day) : now.getDate();
  const hasHour = Number.isInteger(Number(hour));
  const h = hasHour ? Number(hour) : 12;

  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1 || y > 9999) return null;
  if (hasHour && (h < 0 || h > 23)) return null;

  // 月建按实际占时节气；日柱在 23 点按子初换日
  const momentLunar = Solar.fromYmdHms(y, m, d, hasHour ? h : 12, 0, 0).getLunar();
  const monthGz =
    typeof momentLunar.getMonthInGanZhiExact === 'function'
      ? momentLunar.getMonthInGanZhiExact()
      : momentLunar.getMonthInGanZhi();

  let dayLunar = momentLunar;
  if (hasHour && h >= 23) {
    const next = Solar.fromYmd(y, m, d).next(1);
    dayLunar = Solar.fromYmd(next.getYear(), next.getMonth(), next.getDay()).getLunar();
  }

  return {
    date: { year: y, month: m, day: d, ...(hasHour ? { hour: h } : {}) },
    dayGanzhi: dayLunar.getDayInGanZhi(),
    monthBranch: monthGz[1],
    provided: year !== undefined && month !== undefined && day !== undefined,
  };
};

const parseLines = (body) => {
  const { lines } = body || {};
  if (!Array.isArray(lines) || lines.length !== 6) return null;
  const parsed = lines.map((value) => (Number(value) ? 1 : 0));
  if (lines.some((value) => value !== 0 && value !== 1 && value !== '0' && value !== '1')) {
    return null;
  }
  return parsed;
};

const parseChangingLines = (body) => {
  const { changingLines } = body || {};
  if (changingLines === undefined) return [];
  if (!Array.isArray(changingLines)) return null;
  const parsed = changingLines.map((value) => Number(value));
  if (parsed.some((value) => !Number.isInteger(value) || value < 1 || value > 6)) return null;
  return parsed;
};

router.post('/chart', (req, res) => {
  const lines = parseLines(req.body);
  if (!lines) {
    return res.status(400).json({ error: 'Provide six lines (0 = yin, 1 = yang), bottom first.' });
  }

  const changingLines = parseChangingLines(req.body);
  if (changingLines === null) {
    return res.status(400).json({ error: 'changingLines must be an array of positions 1..6.' });
  }

  const castDate = resolveCastDate(req.body);
  if (!castDate) return res.status(400).json({ error: 'Invalid cast date.' });

  try {
    const chart = buildLiuyaoChart(lines, {
      changingLines,
      dayGanzhi: castDate.dayGanzhi,
      monthBranch: castDate.monthBranch,
    });
    if (!chart) return res.status(400).json({ error: 'Unable to build chart from given lines.' });
    return res.json({ ...chart, castDate });
  } catch (error) {
    logger.error({ err: error, requestId: req.id }, 'Liuyao chart failed');
    return res.status(500).json({ error: 'Calculation error' });
  }
});

export default router;
