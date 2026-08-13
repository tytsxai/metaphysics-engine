/**
 * 真太阳时校正所需的出生地经度解析。
 *
 * 这一层的输出直接进排盘（`resolveChartTime`），不是元信息：经度每偏离标准经线 1 度差
 * 4 分钟，在跨时区大国里足以把时柱推到隔壁一柱。因此"认不出地名"不是无害的降级，
 * 而是一次静默的口径改变 —— 调用方拿到的是按钟表时间排的盘，却不知道。
 *
 * 曾经的实现只认 ASCII：`normalizeLocationKey` 把非 `[a-z0-9\s,.-]` 的字符全部替换成空格，
 * 于是"北京"归一化成空串，中文地名 100% 认不出。一个中文命理引擎，最常见的输入形态
 * 恰好是唯一不被支持的那种，而失败路径又是静默的。
 */

/**
 * 归一化。保留 CJK 统一表意文字与假名/谚文，其余标点压成空格。
 *
 * 中文地名之间不写空格（"北京市"），所以归一化后仍是连写的一串 —— 匹配靠的是
 * 表里同时登记了"北京"和"北京市"两个键，以及下面按长度降序的子串兜底。
 */
const normalizeLocationKey = (value) => {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/（[^）]*）/g, ' ')
    .replace(/[^a-z0-9\s,.\-぀-ヿ㐀-䶿一-鿿가-힯]/g, ' ')
    .replace(/[\s,.-]+/g, ' ')
    .trim();
};

/**
 * 城市表。坐标取城市中心点，精度到 0.0001 度。
 *
 * 城市尺度（直径 0.2~0.5 度）在真太阳时上折合约 1~2 分钟，正常情况下不影响时柱归属；
 * 只有出生时刻本就压在时柱边界上时才可能翻边。要更高精度的调用方直接传
 * `"39.9042,116.4074"` 坐标串，那条路径不查表。
 *
 * `cn` 是中文名，`aliases` 收常见别名与不带后缀/带后缀的写法。所有键都会被登记进查找表。
 */
const LOCATION_TABLE = [
  // —— 直辖市与特别行政区 ——
  {
    name: 'Beijing',
    cn: '北京',
    latitude: 39.9042,
    longitude: 116.4074,
    aliases: ['北京市', '京'],
  },
  { name: 'Shanghai', cn: '上海', latitude: 31.2304, longitude: 121.4737, aliases: ['上海市'] },
  { name: 'Tianjin', cn: '天津', latitude: 39.3434, longitude: 117.3616, aliases: ['天津市'] },
  {
    name: 'Chongqing',
    cn: '重庆',
    latitude: 29.563,
    longitude: 106.5516,
    aliases: ['重庆市', 'chungking'],
  },
  {
    name: 'Hong Kong',
    cn: '香港',
    latitude: 22.3193,
    longitude: 114.1694,
    aliases: ['hongkong', 'hk', '香港特别行政区'],
  },
  { name: 'Macau', cn: '澳门', latitude: 22.1987, longitude: 113.5439, aliases: ['macao', '澳門'] },

  // —— 省会 / 自治区首府 ——
  {
    name: 'Guangzhou',
    cn: '广州',
    latitude: 23.1291,
    longitude: 113.2644,
    aliases: ['广州市', '廣州', 'canton'],
  },
  { name: 'Shenzhen', cn: '深圳', latitude: 22.5431, longitude: 114.0579, aliases: ['深圳市'] },
  { name: 'Hangzhou', cn: '杭州', latitude: 30.2741, longitude: 120.1551, aliases: ['杭州市'] },
  { name: 'Nanjing', cn: '南京', latitude: 32.0603, longitude: 118.7969, aliases: ['南京市'] },
  {
    name: 'Jinan',
    cn: '济南',
    latitude: 36.6512,
    longitude: 117.1201,
    aliases: ['济南市', '濟南'],
  },
  { name: 'Hefei', cn: '合肥', latitude: 31.8206, longitude: 117.2272, aliases: ['合肥市'] },
  { name: 'Fuzhou', cn: '福州', latitude: 26.0745, longitude: 119.2965, aliases: ['福州市'] },
  { name: 'Nanchang', cn: '南昌', latitude: 28.682, longitude: 115.8579, aliases: ['南昌市'] },
  {
    name: 'Zhengzhou',
    cn: '郑州',
    latitude: 34.7466,
    longitude: 113.6254,
    aliases: ['郑州市', '鄭州'],
  },
  {
    name: 'Wuhan',
    cn: '武汉',
    latitude: 30.5928,
    longitude: 114.3055,
    aliases: ['武汉市', '武漢'],
  },
  {
    name: 'Changsha',
    cn: '长沙',
    latitude: 28.2282,
    longitude: 112.9388,
    aliases: ['长沙市', '長沙'],
  },
  {
    name: 'Shenyang',
    cn: '沈阳',
    latitude: 41.8057,
    longitude: 123.4315,
    aliases: ['沈阳市', '瀋陽'],
  },
  {
    name: 'Changchun',
    cn: '长春',
    latitude: 43.8171,
    longitude: 125.3235,
    aliases: ['长春市', '長春'],
  },
  {
    name: 'Harbin',
    cn: '哈尔滨',
    latitude: 45.8038,
    longitude: 126.534,
    aliases: ['哈尔滨市', '哈爾濱'],
  },
  {
    name: 'Shijiazhuang',
    cn: '石家庄',
    latitude: 38.0428,
    longitude: 114.5149,
    aliases: ['石家庄市', '石家莊'],
  },
  { name: 'Taiyuan', cn: '太原', latitude: 37.8706, longitude: 112.5489, aliases: ['太原市'] },
  {
    name: 'Hohhot',
    cn: '呼和浩特',
    latitude: 40.8414,
    longitude: 111.7519,
    aliases: ['呼和浩特市'],
  },
  {
    name: "Xi'an",
    cn: '西安',
    latitude: 34.3416,
    longitude: 108.9398,
    aliases: ['西安市', 'xian', 'xi an'],
  },
  {
    name: 'Lanzhou',
    cn: '兰州',
    latitude: 36.0611,
    longitude: 103.8343,
    aliases: ['兰州市', '蘭州'],
  },
  {
    name: 'Xining',
    cn: '西宁',
    latitude: 36.6171,
    longitude: 101.7782,
    aliases: ['西宁市', '西寧'],
  },
  {
    name: 'Yinchuan',
    cn: '银川',
    latitude: 38.4872,
    longitude: 106.2309,
    aliases: ['银川市', '銀川'],
  },
  {
    name: 'Urumqi',
    cn: '乌鲁木齐',
    latitude: 43.8256,
    longitude: 87.6168,
    aliases: ['乌鲁木齐市', '烏魯木齊'],
  },
  { name: 'Chengdu', cn: '成都', latitude: 30.5728, longitude: 104.0668, aliases: ['成都市'] },
  {
    name: 'Guiyang',
    cn: '贵阳',
    latitude: 26.6477,
    longitude: 106.6302,
    aliases: ['贵阳市', '貴陽'],
  },
  { name: 'Kunming', cn: '昆明', latitude: 25.0389, longitude: 102.7183, aliases: ['昆明市'] },
  { name: 'Lhasa', cn: '拉萨', latitude: 29.652, longitude: 91.1721, aliases: ['拉萨市', '拉薩'] },
  {
    name: 'Nanning',
    cn: '南宁',
    latitude: 22.817,
    longitude: 108.3665,
    aliases: ['南宁市', '南寧'],
  },
  { name: 'Haikou', cn: '海口', latitude: 20.0444, longitude: 110.1999, aliases: ['海口市'] },
  {
    name: 'Taipei',
    cn: '台北',
    latitude: 25.033,
    longitude: 121.5654,
    aliases: ['臺北', '台北市'],
  },

  // —— 其他常见城市 ——
  {
    name: 'Qingdao',
    cn: '青岛',
    latitude: 36.0671,
    longitude: 120.3826,
    aliases: ['青岛市', '青島'],
  },
  {
    name: 'Dalian',
    cn: '大连',
    latitude: 38.914,
    longitude: 121.6147,
    aliases: ['大连市', '大連'],
  },
  {
    name: 'Xiamen',
    cn: '厦门',
    latitude: 24.4798,
    longitude: 118.0894,
    aliases: ['厦门市', '廈門'],
  },
  {
    name: 'Suzhou',
    cn: '苏州',
    latitude: 31.2989,
    longitude: 120.5853,
    aliases: ['苏州市', '蘇州'],
  },
  { name: 'Wuxi', cn: '无锡', latitude: 31.4912, longitude: 120.3119, aliases: ['无锡市', '無錫'] },
  {
    name: 'Ningbo',
    cn: '宁波',
    latitude: 29.8683,
    longitude: 121.544,
    aliases: ['宁波市', '寧波'],
  },
  {
    name: 'Wenzhou',
    cn: '温州',
    latitude: 27.9938,
    longitude: 120.6994,
    aliases: ['温州市', '溫州'],
  },
  {
    name: 'Dongguan',
    cn: '东莞',
    latitude: 23.0207,
    longitude: 113.7518,
    aliases: ['东莞市', '東莞'],
  },
  { name: 'Foshan', cn: '佛山', latitude: 23.0219, longitude: 113.1214, aliases: ['佛山市'] },
  { name: 'Zhuhai', cn: '珠海', latitude: 22.2707, longitude: 113.5767, aliases: ['珠海市'] },
  {
    name: 'Shantou',
    cn: '汕头',
    latitude: 23.354,
    longitude: 116.6822,
    aliases: ['汕头市', '汕頭'],
  },
  {
    name: 'Luoyang',
    cn: '洛阳',
    latitude: 34.6197,
    longitude: 112.4539,
    aliases: ['洛阳市', '洛陽'],
  },
  { name: 'Tangshan', cn: '唐山', latitude: 39.6304, longitude: 118.1804, aliases: ['唐山市'] },
  {
    name: 'Baotou',
    cn: '包头',
    latitude: 40.6574,
    longitude: 109.8403,
    aliases: ['包头市', '包頭'],
  },
  {
    name: 'Kashgar',
    cn: '喀什',
    latitude: 39.4677,
    longitude: 75.9938,
    aliases: ['喀什市', 'kashi'],
  },
  { name: 'Kaohsiung', cn: '高雄', latitude: 22.6273, longitude: 120.3014, aliases: ['高雄市'] },
  {
    name: 'Taichung',
    cn: '台中',
    latitude: 24.1477,
    longitude: 120.6736,
    aliases: ['臺中', '台中市'],
  },

  // —— 国际城市 ——
  {
    name: 'Tokyo',
    cn: '东京',
    latitude: 35.6762,
    longitude: 139.6503,
    aliases: ['東京', 'とうきょう'],
  },
  { name: 'Osaka', cn: '大阪', latitude: 34.6937, longitude: 135.5023, aliases: ['おおさか'] },
  { name: 'Seoul', cn: '首尔', latitude: 37.5665, longitude: 126.978, aliases: ['首爾', '서울'] },
  { name: 'Singapore', cn: '新加坡', latitude: 1.3521, longitude: 103.8198, aliases: ['星加坡'] },
  {
    name: 'Kuala Lumpur',
    cn: '吉隆坡',
    latitude: 3.139,
    longitude: 101.6869,
    aliases: ['kl'],
  },
  { name: 'Bangkok', cn: '曼谷', latitude: 13.7563, longitude: 100.5018, aliases: [] },
  { name: 'Jakarta', cn: '雅加达', latitude: -6.2088, longitude: 106.8456, aliases: ['雅加達'] },
  { name: 'Manila', cn: '马尼拉', latitude: 14.5995, longitude: 120.9842, aliases: ['馬尼拉'] },
  { name: 'London', cn: '伦敦', latitude: 51.5074, longitude: -0.1278, aliases: ['倫敦'] },
  { name: 'Paris', cn: '巴黎', latitude: 48.8566, longitude: 2.3522, aliases: [] },
  { name: 'Berlin', cn: '柏林', latitude: 52.52, longitude: 13.405, aliases: [] },
  { name: 'Rome', cn: '罗马', latitude: 41.9028, longitude: 12.4964, aliases: ['羅馬'] },
  { name: 'Madrid', cn: '马德里', latitude: 40.4168, longitude: -3.7038, aliases: ['馬德里'] },
  { name: 'Moscow', cn: '莫斯科', latitude: 55.7558, longitude: 37.6173, aliases: [] },
  {
    name: 'New York',
    cn: '纽约',
    latitude: 40.7128,
    longitude: -74.006,
    aliases: ['new york city', 'nyc', '紐約'],
  },
  {
    name: 'Los Angeles',
    cn: '洛杉矶',
    latitude: 34.0522,
    longitude: -118.2437,
    aliases: ['la', '洛杉磯'],
  },
  {
    name: 'San Francisco',
    cn: '旧金山',
    latitude: 37.7749,
    longitude: -122.4194,
    aliases: ['sf', '舊金山', '三藩市'],
  },
  { name: 'Chicago', cn: '芝加哥', latitude: 41.8781, longitude: -87.6298, aliases: [] },
  { name: 'Seattle', cn: '西雅图', latitude: 47.6062, longitude: -122.3321, aliases: ['西雅圖'] },
  { name: 'Boston', cn: '波士顿', latitude: 42.3601, longitude: -71.0589, aliases: ['波士頓'] },
  { name: 'Houston', cn: '休斯顿', latitude: 29.7604, longitude: -95.3698, aliases: ['休斯頓'] },
  { name: 'Toronto', cn: '多伦多', latitude: 43.6532, longitude: -79.3832, aliases: ['多倫多'] },
  { name: 'Vancouver', cn: '温哥华', latitude: 49.2827, longitude: -123.1207, aliases: ['溫哥華'] },
  { name: 'Sydney', cn: '悉尼', latitude: -33.8688, longitude: 151.2093, aliases: ['雪梨'] },
  { name: 'Melbourne', cn: '墨尔本', latitude: -37.8136, longitude: 144.9631, aliases: ['墨爾本'] },
  { name: 'Auckland', cn: '奥克兰', latitude: -36.8485, longitude: 174.7633, aliases: ['奧克蘭'] },
  { name: 'Sao Paulo', cn: '圣保罗', latitude: -23.5558, longitude: -46.6396, aliases: ['聖保羅'] },
  {
    name: 'Mexico City',
    cn: '墨西哥城',
    latitude: 19.4326,
    longitude: -99.1332,
    aliases: [],
  },
  { name: 'Cape Town', cn: '开普敦', latitude: -33.9249, longitude: 18.4241, aliases: ['開普敦'] },
  { name: 'Nairobi', cn: '内罗毕', latitude: -1.2921, longitude: 36.8219, aliases: ['內羅畢'] },
  { name: 'Lagos', cn: '拉各斯', latitude: 6.5244, longitude: 3.3792, aliases: [] },
  { name: 'Cairo', cn: '开罗', latitude: 30.0444, longitude: 31.2357, aliases: ['開羅'] },
  { name: 'Mumbai', cn: '孟买', latitude: 19.076, longitude: 72.8777, aliases: ['孟買'] },
  {
    name: 'Delhi',
    cn: '德里',
    latitude: 28.7041,
    longitude: 77.1025,
    aliases: ['new delhi', '新德里'],
  },
  {
    name: 'Bangalore',
    cn: '班加罗尔',
    latitude: 12.9716,
    longitude: 77.5946,
    aliases: ['bengaluru'],
  },
  { name: 'Dubai', cn: '迪拜', latitude: 25.2048, longitude: 55.2708, aliases: ['杜拜'] },
];

/**
 * 国际城市（表中「国际城市」段）。其余表内城市按中国处理。
 * 本引擎时间体系以中国为主：中国地点缺时区时默认 Asia/Shanghai（北京时间）。
 */
const INTERNATIONAL_CITY_NAMES = new Set([
  'Tokyo',
  'Osaka',
  'Seoul',
  'Singapore',
  'Kuala Lumpur',
  'Bangkok',
  'Jakarta',
  'Manila',
  'London',
  'Paris',
  'Berlin',
  'Rome',
  'Madrid',
  'Moscow',
  'New York',
  'Los Angeles',
  'San Francisco',
  'Chicago',
  'Seattle',
  'Boston',
  'Houston',
  'Toronto',
  'Vancouver',
  'Sydney',
  'Melbourne',
  'Auckland',
  'Sao Paulo',
  'Mexico City',
  'Cape Town',
  'Nairobi',
  'Lagos',
  'Cairo',
  'Mumbai',
  'Delhi',
  'Bangalore',
  'Dubai',
]);

/**
 * 查找表：每个城市的英文名、中文名、别名都登记成键，指向同一条记录。
 *
 * 从 `LOCATION_TABLE` 生成而不是手写 —— 手写过一次，代价是 New York 的三个写法各占一行，
 * 加一个城市要记得加三行，而漏掉的那行不会报错，只会在运行时静默认不出。
 */
const KNOWN_LOCATIONS = new Map();
for (const entry of LOCATION_TABLE) {
  const record = {
    name: entry.name,
    cn: entry.cn,
    latitude: entry.latitude,
    longitude: entry.longitude,
    /** `cn` = 中国（含港澳台）；`intl` = 海外 */
    region: INTERNATIONAL_CITY_NAMES.has(entry.name) ? 'intl' : 'cn',
  };
  for (const key of [entry.name, entry.cn, ...(entry.aliases || [])]) {
    const normalized = normalizeLocationKey(key);
    if (normalized) KNOWN_LOCATIONS.set(normalized, record);
  }
}

/**
 * 坐标是否落在中国用时范围（大陆+海南+台港澳的粗略包围盒）。
 * 朝鲜/日韩经度偏东已排除；印度等需靠城市表 region，裸坐标无法 100% 区分。
 */
const isChinaCoordinates = (latitude, longitude) => {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  // 台湾
  if (lon >= 119 && lon <= 122.5 && lat >= 21.5 && lat <= 25.5) return true;
  // 港澳
  if (lon >= 113.5 && lon <= 114.6 && lat >= 22.0 && lat <= 22.7) return true;
  // 大陆（东至约 123°，避开首尔 126°+）
  if (lon >= 73 && lon <= 123 && lat >= 18 && lat <= 54) return true;
  return false;
};

/**
 * 是否按中国时区体系处理该出生地。
 * 中国地点缺 timezone 时可默认 Asia/Shanghai；海外必须显式传时区。
 */
const isChinaLocation = (location) => {
  if (!location) return false;
  if (location.region === 'cn') return true;
  if (location.region === 'intl') return false;
  // 坐标串路径无 region
  if (location.source === 'coordinates') {
    return isChinaCoordinates(location.latitude, location.longitude);
  }
  return false;
};

/** 中国默认民用时区：全国钟表统一按北京时间记，真太阳时再用经度回拨。 */
const DEFAULT_CHINA_TIMEZONE = 'Asia/Shanghai';

/**
 * 参与子串兜底的键。**不是所有键都够格**。
 *
 * 兜底是为了让"南京市江宁区"能命中"南京"，但同一个机制会让任意短键在无关词里撞上：
 * `la`（Los Angeles）出现在 `Atlantis` 里，`京`（北京）出现在"东京""京都"里。
 * 撞上的后果不是报错，是拿着错误的经度去排盘 —— 比认不出更糟。
 *
 * 门槛按字型分开：中文地名两个字就是完整地名（北京/上海），拉丁字母两三个字符
 * 只可能是缩写（la/hk/sf/nyc）。缩写仍然可以精确匹配，只是不下场做子串扫描。
 *
 * 扫描顺序取键长降序 —— 最具体的匹配优先，且与表的书写顺序无关。
 */
const CJK_PATTERN = /[぀-ヿ㐀-䶿一-鿿가-힯]/;
const isSubstringCandidate = (key) => (CJK_PATTERN.test(key) ? key.length >= 2 : key.length >= 4);

const SUBSTRING_KEYS = [...KNOWN_LOCATIONS.keys()]
  .filter(isSubstringCandidate)
  .sort((a, b) => b.length - a.length);

/**
 * 坐标串。两个值都落在 ±90 内时无法从数值本身判断顺序，此时按通行的 `纬度,经度` 解释；
 * 只要有一个超出 ±90，顺序就是确定的，按能自洽的那种解释。
 */
const parseCoordinatePair = (value) => {
  if (typeof value !== 'string') return null;
  const match = value.match(/(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  const absFirst = Math.abs(first);
  const absSecond = Math.abs(second);
  if (absFirst <= 90 && absSecond <= 180) {
    return { latitude: first, longitude: second, source: 'coordinates' };
  }
  if (absFirst <= 180 && absSecond <= 90) {
    return { latitude: second, longitude: first, source: 'coordinates' };
  }
  return null;
};

const resolveLocationCoordinates = (birthLocation) => {
  if (typeof birthLocation !== 'string') return null;
  const trimmed = birthLocation.trim();
  if (!trimmed) return null;
  const parsedCoords = parseCoordinatePair(trimmed);
  if (parsedCoords) return parsedCoords;
  const key = normalizeLocationKey(trimmed);
  if (!key) return null;
  const entry = KNOWN_LOCATIONS.get(key);
  if (entry) return { ...entry, source: 'known' };
  for (const knownKey of SUBSTRING_KEYS) {
    if (key.includes(knownKey)) {
      return { ...KNOWN_LOCATIONS.get(knownKey), source: 'known' };
    }
  }
  return null;
};

/**
 * 出生地解析的诊断结果 —— 这是"校正没生效"从静默变成可见的地方。
 *
 * `trueSolarTime` 只回答"校正生没生效"，回答不了"为什么没生效"，而所有原因在
 * `trueSolarTime: null` 上是混在一起的：没填出生地、显式关掉、填了但认不出、
 * 认出来了却没有时区可用 —— 调用方看到的东西一模一样，但只有后两种是他能改的。
 *
 * `status` 报的是**校正的最终下场**，不是"地名查得到吗"。这两者会分叉：地名认出来了
 * 但没有时区偏移时，标准经线无从算起，校正照样不生效。一个只说"解析成功"的诊断字段
 * 在这里会亲手制造它本来要消除的那种静默。
 *
 * 单独出一个字段而不是把 `trueSolarTime` 换成带 `applied: false` 的对象：后者会把
 * 既有调用方的 `if (trueSolarTime)` 判断从"没生效"翻成"生效了"。
 */
const STATUS_HINT = {
  applied: null,
  absent: '未提供 birthLocation，按钟表时间排盘。要启用真太阳时校正就传出生地。',
  disabled: '调用方显式传了 trueSolarTime: false，按钟表时间排盘。',
  unresolved:
    '出生地无法解析成经度，已跳过真太阳时校正，本次按钟表时间排盘。' +
    '改用 GET /api/locations 里列出的名称，或直接传 "纬度,经度"（如 "39.9042,116.4074"）。',
  'no-timezone':
    '出生地认出来了，但没有时区偏移，标准经线无从算起，真太阳时校正未生效，' +
    '本次按钟表时间排盘。中国地点可省略时区（默认 Asia/Shanghai）；' +
    '海外地点必须传 timezone（如 "America/New_York"）或 timezoneOffsetMinutes。',
};

/**
 * @param timezoneOffsetMinutes 已解析出的时区偏移。传 undefined 表示调用方还没算，
 *   此时不对时区下判断 —— 只报地名本身认不认得，避免谎报一个 no-timezone。
 */
const describeLocationResolution = ({
  birthLocation,
  trueSolarTime,
  timezoneOffsetMinutes,
} = {}) => {
  const input = typeof birthLocation === 'string' ? birthLocation.trim() : null;
  const matched = input ? resolveLocationCoordinates(input) : null;

  const status = (() => {
    if (trueSolarTime === false) return 'disabled';
    if (!input) return 'absent';
    if (!matched) return 'unresolved';
    if (timezoneOffsetMinutes !== undefined && !Number.isFinite(timezoneOffsetMinutes)) {
      return 'no-timezone';
    }
    return 'applied';
  })();

  const hit = status === 'applied' || status === 'no-timezone' ? matched : null;

  return {
    status,
    input: input || null,
    matched: hit ? { name: hit.name ?? null, cn: hit.cn ?? null } : null,
    source: hit?.source ?? null,
    hint: STATUS_HINT[status],
  };
};

/** 去重后的城市清单，供 /api/locations 补全。坐标串那条路径不需要出现在补全里。 */
const listKnownLocations = () =>
  LOCATION_TABLE.map((entry) => ({
    name: entry.name,
    cn: entry.cn ?? null,
    latitude: entry.latitude,
    longitude: entry.longitude,
  })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

const computeTrueSolarTime = ({
  birthYear,
  birthMonth,
  birthDay,
  birthHour,
  birthMinute = 0,
  timezoneOffsetMinutes,
  longitude,
}) => {
  if (!Number.isFinite(timezoneOffsetMinutes) || !Number.isFinite(longitude)) return null;
  const year = Number(birthYear);
  const month = Number(birthMonth);
  const day = Number(birthDay);
  const hour = Number(birthHour);
  const minute = Number.isFinite(Number(birthMinute)) ? Number(birthMinute) : 0;
  if (![year, month, day, hour].every(Number.isFinite)) return null;

  // 1. Longitude Correction (4 minutes per degree from standard meridian)
  const offsetHours = timezoneOffsetMinutes / 60;
  const standardMeridian = offsetHours * 15;
  const longitudeCorrection = (longitude - standardMeridian) * 4;

  // 2. Equation of Time (EoT) Correction
  // Simple but effective approximation for astronomical calculations
  const baseUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const startOfYear = Date.UTC(year, 0, 1);
  const dayOfYear = Math.floor((baseUtc - startOfYear) / (24 * 60 * 60 * 1000)) + 1;
  const b = (360 / 365) * (dayOfYear - 81);
  const bRad = (b * Math.PI) / 180;
  const eotCorrection = 9.87 * Math.sin(2 * bRad) - 7.53 * Math.cos(bRad) - 1.5 * Math.sin(bRad);

  const totalCorrectionMinutes = longitudeCorrection + eotCorrection;
  const correctedDate = new Date(baseUtc + totalCorrectionMinutes * 60000);

  return {
    applied: true,
    correctionMinutes: Math.round(totalCorrectionMinutes * 100) / 100,
    longitudeCorrection: Math.round(longitudeCorrection * 100) / 100,
    eotCorrection: Math.round(eotCorrection * 100) / 100,
    correctedDate,
    corrected: {
      year: correctedDate.getUTCFullYear(),
      month: correctedDate.getUTCMonth() + 1,
      day: correctedDate.getUTCDate(),
      hour: correctedDate.getUTCHours(),
      minute: correctedDate.getUTCMinutes(),
    },
  };
};

export {
  normalizeLocationKey,
  resolveLocationCoordinates,
  describeLocationResolution,
  computeTrueSolarTime,
  listKnownLocations,
  isChinaLocation,
  isChinaCoordinates,
  DEFAULT_CHINA_TIMEZONE,
};
