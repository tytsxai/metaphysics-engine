export const isUrlTooLong = (req) => {
  const url = req?.originalUrl || req?.url || '';
  const MAX_URL_LENGTH = parseInt(process.env.MAX_URL_LENGTH) || 16384;
  return url.length > MAX_URL_LENGTH;
};

export const parseIdParam = (value) => {
  if (typeof value !== 'string') return null;
  const num = parseInt(value, 10);
  return Number.isFinite(num) && num > 0 ? num : null;
};

export const sanitizeQueryParam = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

export const sanitizeNextPath = (value) => {
  if (typeof value !== 'string') return '/profile';
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith('/')) return '/profile';
  if (trimmed.startsWith('//')) return '/profile';
  if (trimmed.includes('://')) return '/profile';
  return trimmed;
};

export const isLocalUrl = (value) => {
  if (!value || typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname.startsWith('127.0.0.')
    );
  } catch {
    return false;
  }
};
export const isWhitespaceOnly = (value) =>
  typeof value === 'string' && value.length > 0 && value.trim().length === 0;

export const isValidCalendarDate = (year, month, day) => {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

/**
 * 性别规范化。只接受 male/female（及中文 男/女、单字母 m/f），大小写不敏感。
 * 非法值返回 null —— 调用方必须 400，禁止静默当女命（会反转大运/命卦/大限）。
 */
export const normalizeGender = (value) => {
  if (typeof value !== 'string') return null;
  const g = value.trim().toLowerCase();
  if (g === 'male' || g === 'm' || g === '男') return 'male';
  if (g === 'female' || g === 'f' || g === '女') return 'female';
  return null;
};

export const validateBaziInput = (raw) => {
  const birthYear = Number(raw?.birthYear);
  const birthMonth = Number(raw?.birthMonth);
  const birthDay = Number(raw?.birthDay);
  const birthHour = Number(raw?.birthHour);
  const genderRaw = raw?.gender;
  if (
    isWhitespaceOnly(genderRaw) ||
    isWhitespaceOnly(raw?.birthLocation) ||
    isWhitespaceOnly(raw?.timezone)
  ) {
    return { ok: false, payload: null, reason: 'whitespace' };
  }
  const gender = normalizeGender(genderRaw);
  const birthLocation =
    typeof raw?.birthLocation === 'string' ? raw.birthLocation.trim() : raw?.birthLocation;
  const timezone = typeof raw?.timezone === 'string' ? raw.timezone.trim() : raw?.timezone;
  if (birthLocation === '' || timezone === '') {
    return { ok: false, payload: null, reason: 'whitespace' };
  }

  if (
    !Number.isInteger(birthYear) ||
    birthYear < 1 ||
    birthYear > 9999 ||
    !Number.isInteger(birthMonth) ||
    birthMonth < 1 ||
    birthMonth > 12 ||
    !Number.isInteger(birthDay) ||
    birthDay < 1 ||
    birthDay > 31 ||
    !Number.isInteger(birthHour) ||
    birthHour < 0 ||
    birthHour > 23 ||
    !gender ||
    !isValidCalendarDate(birthYear, birthMonth, birthDay)
  ) {
    return { ok: false, payload: null, reason: 'invalid' };
  }

  return {
    ok: true,
    payload: {
      ...raw,
      birthYear,
      birthMonth,
      birthDay,
      birthHour,
      gender,
      birthLocation,
      timezone,
    },
  };
};
