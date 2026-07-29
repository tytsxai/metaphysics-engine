import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeLocationKey,
  resolveLocationCoordinates,
  describeLocationResolution,
  listKnownLocations,
} from '../services/solarTime.service.js';
import { performCalculation, resolveChartTime } from '../services/calculations.service.js';

const BASE = {
  birthYear: 1990,
  birthMonth: 5,
  birthDay: 12,
  birthHour: 10,
  birthMinute: 0,
  gender: 'male',
  timezoneOffsetMinutes: 480,
};

/**
 * 这一组守的是一个曾经真实存在的静默失败：归一化只保留 `[a-z0-9\s,.-]`，
 * 于是所有中文地名都被清成空串，真太阳时校正被跳过，排出来的是钟表时间的盘，
 * 而调用方收到的响应和校正成功时长得一样（都没有报错）。
 */
describe('中文地名解析', () => {
  it('归一化保留 CJK，不再把中文清成空串', () => {
    assert.equal(normalizeLocationKey('北京'), '北京');
    assert.notEqual(normalizeLocationKey('上海市'), '');
  });

  it('常见中文地名都解析得出经度', () => {
    for (const name of [
      '北京',
      '上海',
      '广州',
      '深圳',
      '杭州',
      '西安',
      '乌鲁木齐',
      '台北',
      '香港',
    ]) {
      const resolved = resolveLocationCoordinates(name);
      assert.ok(resolved, `${name} 应能解析出坐标`);
      assert.ok(Number.isFinite(resolved.longitude), `${name} 的经度应是有限数`);
    }
  });

  it('带行政区后缀的长地址靠子串兜底命中最具体的那个', () => {
    assert.equal(resolveLocationCoordinates('北京市')?.name, 'Beijing');
    assert.equal(resolveLocationCoordinates('南京市江宁区')?.name, 'Nanjing');
    assert.equal(resolveLocationCoordinates('中国广东省深圳市')?.name, 'Shenzhen');
  });

  it('繁体写法与英文写法指向同一条记录', () => {
    assert.equal(
      resolveLocationCoordinates('臺北')?.name,
      resolveLocationCoordinates('台北')?.name
    );
    assert.equal(
      resolveLocationCoordinates('纽约')?.name,
      resolveLocationCoordinates('New York')?.name
    );
    assert.equal(
      resolveLocationCoordinates('東京')?.name,
      resolveLocationCoordinates('Tokyo')?.name
    );
  });

  it('坐标串仍然走不查表的那条路径', () => {
    const resolved = resolveLocationCoordinates('39.9042,116.4074');
    assert.equal(resolved.source, 'coordinates');
    assert.equal(resolved.longitude, 116.4074);
  });

  /**
   * 表的自洽性。加城市时把中文名打错、或忘了它会被归一化成别的键，
   * 都不会报错，只会在运行时静默认不出 —— 这条用例把那种错误变成红灯。
   */
  it('表里每条记录的中英文名都能解析回它自己', () => {
    for (const entry of listKnownLocations()) {
      for (const label of [entry.name, entry.cn].filter(Boolean)) {
        const resolved = resolveLocationCoordinates(label);
        assert.ok(resolved, `${label} 登记在表里却解析不出来`);
        assert.equal(
          resolved.longitude,
          entry.longitude,
          `${label} 解析到了别的城市（${resolved.name}）`
        );
      }
    }
  });

  it('补全清单带中文名，供调用方按中文搜索', () => {
    const locations = listKnownLocations();
    assert.ok(locations.length > 50, `城市表太小：${locations.length}`);
    assert.ok(locations.some((item) => item.cn === '北京'));
    assert.ok(
      locations.every((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude)),
      '每条记录都必须有可用坐标'
    );
  });

  it('认不出的地名返回 null，不猜一个坐标出来', () => {
    assert.equal(resolveLocationCoordinates('无此地名的火星城'), null);
    assert.equal(resolveLocationCoordinates(''), null);
    assert.equal(resolveLocationCoordinates(null), null);
  });

  /**
   * 子串兜底的反面：短别名不能下场做子串扫描。
   * `la`(Los Angeles) 藏在 `Atlantis` 里，`京`(北京) 藏在"东京""京都"里 ——
   * 撞上不会报错，只会拿错误的经度排出一个看起来很正常的盘。
   */
  it('短别名不参与子串兜底，不在无关词里误命中', () => {
    assert.equal(resolveLocationCoordinates('Atlantis'), null, 'la 不该在 Atlantis 里命中');
    assert.equal(resolveLocationCoordinates('Flatland'), null);
    assert.equal(resolveLocationCoordinates('京都'), null, '京 不该在京都里命中北京');
    // 但精确写出缩写时仍然认得
    assert.equal(resolveLocationCoordinates('LA')?.name, 'Los Angeles');
    assert.equal(resolveLocationCoordinates('HK')?.name, 'Hong Kong');
  });

  it('同为中文两字的地名之间不互相误命中', () => {
    assert.equal(resolveLocationCoordinates('东京')?.name, 'Tokyo');
    assert.equal(resolveLocationCoordinates('南京')?.name, 'Nanjing');
    assert.equal(resolveLocationCoordinates('南宁')?.name, 'Nanning');
    assert.equal(resolveLocationCoordinates('西安')?.name, "Xi'an");
    assert.equal(resolveLocationCoordinates('西宁')?.name, 'Xining');
  });
});

describe('中文地名真的参与排盘', () => {
  it('中文地名与等价坐标串排出同一个盘', () => {
    const byChinese = performCalculation({ ...BASE, birthLocation: '乌鲁木齐' });
    const byCoords = performCalculation({ ...BASE, birthLocation: '43.8256,87.6168' });
    assert.deepEqual(byChinese.pillars, byCoords.pillars);
  });

  it('西部中文地名把时柱推到与钟表时间不同的一柱', () => {
    const clock = performCalculation({ ...BASE, trueSolarTime: false });
    const solar = performCalculation({ ...BASE, birthLocation: '乌鲁木齐' });
    assert.ok(solar.chartTime.trueSolarTime?.applied, '真太阳时应已生效');
    assert.notDeepEqual(solar.pillars.hour, clock.pillars.hour, '回拨逾两小时必须改变时柱');
  });

  it('生效时同时带出英文名与中文名', () => {
    const chart = performCalculation({ ...BASE, birthLocation: '北京' });
    assert.equal(chart.chartTime.trueSolarTime.location.name, 'Beijing');
    assert.equal(chart.chartTime.trueSolarTime.location.cn, '北京');
  });
});

/**
 * `trueSolarTime: null` 把几种完全不同的情况压成了同一个值，其中只有 unresolved
 * 与 no-timezone 是调用方能改的。locationResolution 就是用来把它们分开的。
 */
describe('真太阳时校正下场的诊断', () => {
  it('五种状态各自可辨', () => {
    assert.equal(describeLocationResolution({ birthLocation: '北京' }).status, 'applied');
    assert.equal(describeLocationResolution({ birthLocation: '火星城' }).status, 'unresolved');
    assert.equal(describeLocationResolution({}).status, 'absent');
    assert.equal(
      describeLocationResolution({ birthLocation: '北京', trueSolarTime: false }).status,
      'disabled'
    );
    assert.equal(
      describeLocationResolution({ birthLocation: '北京', timezoneOffsetMinutes: null }).status,
      'no-timezone'
    );
  });

  /**
   * 地名查得到 ≠ 校正生效。没有时区偏移就算不出标准经线，排盘照样退回钟表时间 ——
   * 一个只报"地名解析成功"的诊断字段会在这里亲手制造它本来要消除的那种静默。
   */
  it('地名认得但缺时区时报 no-timezone，而不是谎报已校正', () => {
    const chart = performCalculation({
      birthYear: 1990,
      birthMonth: 5,
      birthDay: 12,
      birthHour: 10,
      gender: 'male',
      birthLocation: '乌鲁木齐',
      // 不给 timezone / timezoneOffsetMinutes
    });
    assert.equal(chart.chartTime.locationResolution.status, 'no-timezone');
    assert.equal(chart.chartTime.trueSolarTime, null, '缺时区时校正不该生效');
    assert.equal(chart.chartTime.used.hour, 10, '应退回钟表时间');
    assert.match(chart.chartTime.locationResolution.hint, /timezone/);
    // 认出来了这件事仍然要说，否则调用方会以为是地名写错了
    assert.equal(chart.chartTime.locationResolution.matched.cn, '乌鲁木齐');
  });

  it('认不出时给出可执行的下一步，并回显原始输入', () => {
    const diagnosis = describeLocationResolution({ birthLocation: '火星城' });
    assert.equal(diagnosis.input, '火星城');
    assert.match(diagnosis.hint, /纬度,经度|api\/locations/);
    assert.equal(diagnosis.matched, null);
  });

  it('已校正时没有 hint，并说明命中来源', () => {
    const diagnosis = describeLocationResolution({ birthLocation: '北京' });
    assert.equal(diagnosis.hint, null);
    assert.equal(diagnosis.source, 'known');
    assert.equal(diagnosis.matched.cn, '北京');
  });

  it('排盘结果里带诊断，认不出时明确说明本次按钟表时间', () => {
    const chart = performCalculation({ ...BASE, birthLocation: '火星城' });
    assert.equal(chart.chartTime.locationResolution.status, 'unresolved');
    assert.equal(chart.chartTime.trueSolarTime, null, 'unresolved 时校正必须没生效');
    assert.equal(chart.chartTime.used.hour, 10, '应退回钟表时间');
  });

  /**
   * 判断「校正是否生效」的判据仍然是 trueSolarTime，不是这个新字段 ——
   * 新增诊断不能把既有调用方的 `if (trueSolarTime)` 判断翻个面。
   */
  it('未生效时 trueSolarTime 仍严格为 null', () => {
    for (const payload of [
      { birthLocation: '火星城' },
      {},
      { birthLocation: '北京', trueSolarTime: false },
    ]) {
      assert.equal(resolveChartTime({ ...BASE, ...payload }).trueSolarTime, null);
    }
  });

  it('生效时 clockTime 只有时刻，不重复挂诊断字段', () => {
    const resolved = resolveChartTime({ ...BASE, birthLocation: '乌鲁木齐' });
    assert.equal(resolved.trueSolarTime.clockTime.locationResolution, undefined);
    assert.equal(resolved.trueSolarTime.clockTime.hour, 10);
  });
});
