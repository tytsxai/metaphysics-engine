# 关键模块与核心逻辑

> 改算法前先读 [SKILL.md](../.claude/skills/bazi-cli/SKILL.md)。那份写的是「错了不报错」的口径；本篇写代码落在哪、谁调用谁。

边界一句话：**结构归引擎，断语归调用方。** 三传、安星、定局、游年必须算准；庙旺、格局名目、神煞吉凶轻重不进引擎。

## 分层

| 层              | 目录                                       | 允许做什么                         | 禁止做什么                     |
| --------------- | ------------------------------------------ | ---------------------------------- | ------------------------------ |
| HTTP            | `backend/routes/`                          | 读 body/query、调 service、写 JSON | 算法、缓存键、流派规则         |
| 少量 controller | `backend/controllers/`                     | 与 route 同类，历史拆分            | 新增能力不必再加这一层         |
| 算法            | `backend/services/*.service.js`            | 纯函数排盘/起课                    | 碰 `req`/`res`、读未声明的 env |
| 静态表          | `backend/constants/`、`backend/data/`      | 干支、星曜、牌库、卦象             | 把断语写成「吉/凶」默认值      |
| 配置 / 基础设施 | `backend/config/`、`middleware/`、`utils/` | 校验、时区、缓存、限流             | 术数规则                       |
| CLI             | `tools/cli/`                               | 参数 → HTTP → 退出码               | 再实现一遍算法                 |

加一门新术数要动哪几处见 [CONTRIBUTING.md](../CONTRIBUTING.md)。漏 OpenAPI 快照 CI 会红。

## 共享基座

这三层被多门术数共用。改这里等于同时改八字、六壬、奇门、八宅的交节行为。

### `jieqi.service.js`

给精确到分的墙钟，定它落在哪个节气或中气。比较用 `YYYYMMDDHHmm` 整数，不经 `Date`，避免服务器时区把东八区节气表漂走。

必须走这一层的原因：以前各体系自己比「日」，同一张生辰会落进不同节气。另外 `getJieQiTable()` 混有拼音键，只扫中文键会把每年冬至到年末判成大雪，奇门阴阳遁整盘颠倒。

入口：`resolveSolarTerm`、`resolveLiChun`、`resolveLiChunYear`。

### `ganzhi.service.js` + `constants/ganzhi.js`

纳音、藏干（本气/中气/余气）、十二长生、合冲刑害破会、五行局、旬空。纳音 60 条与 `lunar-javascript` 逐条比对。八字断命与紫微五行局都从这里取。

### `solarTime.service.js`

真太阳时 = 经度差 + 均时差。地名表 `KNOWN_LOCATIONS`（88 城，含中文/别名）。认不出不报错，只跳过校正。坐标串 `"纬度,经度"` 永远可靠。

`chartTime.locationResolution.status` 取值：`applied` / `unresolved` / `no-timezone` / `absent` / `disabled`。只有 `applied` 表示这张盘用了校正后的时刻。

## 八字：两段式

```
resolveChartTime          calculations.service.js
        │
        ├─ 当地墙钟 ± 真太阳时  →  日柱、时柱
        └─ 换算东八区           →  年柱、月柱、起运（termReference）
        │
performCalculation        lunar-javascript + setSect(2)
        │
analyzeBaziChart          bazi.service.js
        │
        ├ weightedElements   藏干加权，月支 ×2（只加月支，不加月干）
        ├ strength           同党 >55% 身强 / <45% 身弱
        ├ usefulGod          扶抑法；中和局不硬凑
        ├ shensha / relations / xunkong
        └ luckCycles         起运时刻 + 逐年流年
```

`calculations.service` 负责排出四柱；`bazi.service` 负责拿四柱断命。两边不互相 import 断命逻辑，避免循环依赖。换藏干权重、旺衰阈值、用神法，只改 `bazi.service.js` 顶部的口径声明。

`getBaziCalculation` 包一层缓存。路由走它，不要直接 `performCalculation` 除非测试要绕过缓存。

性别必须经 `normalizeGender`。非法值不得静默当女命——会反转大运顺逆。

## 其他术数

| 模块               | 入口职责                                                        | 选定口径（换派改这一处）                                   | 明确不做 |
| ------------------ | --------------------------------------------------------------- | ---------------------------------------------------------- | -------- |
| `ziwei.service`    | 农历 → 命宫干支纳音 → 五行局 → 紫微 → 天府 → 诸星 → 四化 / 大限 | 年干支按正月初一；闰月归本月                               | 庙旺利陷 |
| `liuyao.service`   | 装卦不是起卦：吃 `lines`，排八宫世应纳甲六亲六神伏神            | 变爻六亲仍以本卦之宫为我；八宫由七条规则算，无 64 行表     | 摇卦     |
| `liuren.service`   | 月将加时 → 天地盘 → 四课 → 九宗门三传 → 十二天将                | 中气换将；八专在遥克之前；子初换日                         | 断课吉凶 |
| `qimen.service`    | 拆补定局 → 地盘三奇六仪 → 值符值使 → 转盘星门神                 | 拆补法 + 转盘法；子初换日；中五无门无神                    | 格局名目 |
| `fengshui.service` | 八宅命卦与游年；黄历历注；姓名五格                              | 立春定年；外格 = 天格+地格−人格；笔画由调用方给            | 吉凶断语 |
| `iching.service`   | 数字起卦（确定）或时间起卦                                      | 卦名与《周易》序号在 `data/ichingHexagrams.js`，与六爻共用 | —        |
| `tarot.service`    | 牌库 + 牌阵随机                                                 | 每次重新抽，不可复现                                       | —        |
| `zodiac.service`   | 星座、运势、上升、配对                                          | 描述性英文关键词保留原文                                   | —        |
| `synastry.service` | 两组出生信息交叉：日主十神、夫妻宫、柱关系、五行互补            | 复用八字排盘                                               | —        |

六壬取传次第不可调换：`贼克 → 比用 → 涉害 → [八专] → 遥克 → 别责 / 昴星`。伏吟、返吟由将时关系先于其余七门判定。

奇门两套飞泊不能混：地盘三奇六仪走九宫（中五占一位）；星门神走洛书八宫环（中五寄坤二）。

## 基础设施模块

| 文件                             | 职责                                                 |
| -------------------------------- | ---------------------------------------------------- |
| `cache.service`                  | `buildBaziCacheKey`、进程内 LRU、可选 Redis 镜像     |
| `health.service`                 | 深度检查快照；未配 Redis 记 `disabled` 且 `ok: true` |
| `httpMetrics.service`            | 请求量 / 延迟 / 429 / 在途；跳过探针路径             |
| `metrics.service`                | Prometheus 文本；鉴权                                |
| `lifecycle.service`              | 排水开关；探针读它                                   |
| `ai.service` / `prompts.service` | mock / OpenAI / Anthropic，并发闸 + 流式空闲超时     |
| `apiSchema.service`              | OpenAPI 唯一来源                                     |
| `lib/concurrency.js`             | AI 并发槽                                            |

## CLI 模块

```
bin/bazi.mjs
  → main.mjs          解析命令树
  → commands/*        每条命令声明 kind / effect / reproducibility
  → core/apiClient    HTTP → 退出码（能力命令必须走这里）
  → core/registry     flag 声明、required/choices/variadic
  → core/toolSchema   schema 与 mcp 共用
  → core/stackState   .tmp/cli/ 里的 pid 与日志
```

约束（测试会拦）：

- 失败抛 `CliError`，带可执行的 `next`
- `--json` 时 stdout 只有一个 JSON 文档
- 必填写在声明上，不写在 `run` 里（否则导出的 schema 会说参数可选）
- 能力命令走 `callApi`，请求带 `connection: close`
- `kind` 缺省是 `ops`，新的能力组必须显式 `kind: 'capability'`

`stack` 只托管一个 `api` 进程。没有 `--only`。看到 `managedBy: foreign` 时不要按端口杀进程。

## 请求在引擎里的位置

`backend/routes/api.js` 挂载：

`/ai` `/bazi` `/ziwei` `/tarot` `/iching` `/liuyao` `/liuren` `/qimen` `/fengshui` `/zodiac` `/locations` `/synastry` `/calendar`

另在 `server.js` 根上挂 `/live`、`/health`、`/metrics`、`/api-docs`。`/api/live`、`/api/health`、`/api/ready` 是别名。

人读字段说明在 [api.md](api.md)。机器契约在 [openapi.json](openapi.json)。
