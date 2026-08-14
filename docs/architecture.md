# 架构

> 与代码同步。能力清单以 `./bazi help --json` 为准，不要在这里维护命令表。

Metaphysics Engine 是自部署的**算法能力层**：把八字、紫微、六爻、六壬、奇门、八宅、择吉、姓名、塔罗、周易、星座、合盘以及可选的 AI 解读，收敛成一套 HTTP 接口和一个面向 Agent 的 CLI。界面、账号、持久化都属于调用方。

## 一句话

**无状态纯计算 + 一个可选缓存 + 一层程序化客户端。**

进程不持有跨请求状态：没有数据库、没有会话、没有用户、不写业务文件。Redis 只镜像八字排盘缓存，摘掉它结果不变，只是跨实例命中率下降。`./bazi` 不实现算法，只把 HTTP 语义翻译成退出码。

这条约束直接决定了：

- 扩容就是多起进程，不需要粘性会话
- 部署可以整体销毁重建：没有迁移，没有备份恢复
- 测试不需要数据库容器；`engine` 目标除外，它要打正在跑的引擎
- 排查时不存在「数据脏了」——同样输入应得到同样结构（声明为 `not-reproducible` 的能力除外）

```
调用方（你的后端 / 客户端 / Agent / MCP host）
        │
        ├─ HTTP + JSON ─────────────────────────────┐
        │                                           │
        └─ ./bazi calc|cast [--json]                │
              └─ ./bazi mcp  (stdio，内部再 spawn CLI)
                                                    ▼
┌──────────────────────────────────────────────────────────┐
│  Express 中间件链                                        │
│  helmet → CORS → compression → requestId →               │
│  httpMetrics → json → validation → pino →                │
│  /live /health /metrics（限流之前）→                     │
│  urlLength → rateLimit → /api → /api-docs                │
├──────────────────────────────────────────────────────────┤
│  routes/         HTTP 入口，只做参数编解码               │
│  controllers/    calendar / synastry / zodiac 三处       │
│  services/       全部算法与业务逻辑                      │
│  constants/ data/  干支、星曜、塔罗、六十四卦            │
└──────────────────────────────────────────────────────────┘
        │                              │
        ▼                              ▼
  Redis（可选，纯缓存）         AI Provider（可选）
                               OpenAI / Anthropic / mock
```

## 三个运行面

| 面   | 是什么                         | 谁启动                                 | 状态落在哪                                  |
| ---- | ------------------------------ | -------------------------------------- | ------------------------------------------- |
| 引擎 | `backend/server.js`，对外 HTTP | `./bazi stack up`，或容器 / 进程管理器 | 无。日志在 `.tmp/cli/`（仅 CLI 托管时）     |
| CLI  | `./bazi`，仓库根入口           | 每次调用一个短进程                     | 不持有算法状态；`.env` 由它注入子进程       |
| MCP  | `./bazi mcp`，stdio            | MCP host                               | 每次工具调用再 spawn 一次 CLI，安全闸不绕过 |

把 CLI 指到别的引擎：设 `BAZI_API_URL`。`stack` 只管理本机进程，与该变量无关。

## 目录

```text
metaphysics-engine/
├── backend/
│   ├── server.js            # 中间件链、探针、优雅停机、启动校验
│   ├── bootstrap/           # Express 4 异步错误传播补丁
│   ├── config/              # app（配置）、logger（pino）、redis
│   ├── routes/              # 按术数拆的 HTTP 入口
│   ├── controllers/         # calendar / synastry / zodiac
│   ├── services/            # 算法与业务，见 modules.md
│   ├── middleware/          # cors / docs / error / rateLimit / requestId / …
│   ├── constants/ data/     # 静态表与牌库卦象
│   ├── lib/concurrency.js   # AI 并发闸
│   ├── utils/               # 校验、时区、脱敏、civilDate
│   ├── scripts/             # start.mjs（容器 PID 1）、generate-openapi.js
│   └── test/
├── tools/cli/               # ./bazi
│   ├── src/commands/        # calc / cast / setup / doctor / env / stack / test / schema / mcp
│   └── src/core/            # apiClient、registry、toolSchema、stackState
├── docs/
├── scripts/                 # CI 守卫、部署验证
├── docker-compose.yml       # 本地可选 Redis
├── docker-compose.prod.yml  # 生产参考栈
└── bazi                     # CLI 入口
```

没有 `prisma/`、没有前端、没有备份脚本。存储层删除时它们一起走了。

## 一次八字排盘怎么走

```
POST /api/bazi/calculate
  → validation.middleware     形状护栏（数组、深度、键数、字符串长度）
  → rateLimit（严格桶）       排盘走 20% 配额
  → routes/bazi.js            参数校验与编解码
  → cache.service             键覆盖全部排盘输入；命中则带 x-bazi-cache: hit 返回
  → calculations.resolveChartTime
        ├ 中国地点缺时区 → 默认 Asia/Shanghai
        ├ 真太阳时校正当地墙钟 → chartTime.used
        └ 同一时刻换算东八区 → chartTime.termReference（年月柱 / 节气）
  → lunar-javascript 排四柱（sect=2，晚子不换日）
  → bazi.service              藏干加权、旺衰、用神、神煞、刑冲合会
  → 写回缓存，x-bazi-cache: miss
```

**缓存键必须覆盖全部排盘输入。** 基础是 `年-月-日-时-性别`，后缀追加分钟、地点、时区、`trueSolarTime: false`。以后再加会影响排盘的因子，必须进这个键。

海外出生是**两套时刻**：年柱月柱看 `termReference`（东八区比节气），日柱时柱看当地 `used`（时辰是当地太阳位置）。国内两者相同。细节与「错了不报错」的坑见 [SKILL.md](../.claude/skills/bazi-cli/SKILL.md)。

## 缓存

两层，都可以整个失效而不影响正确性：

1. 进程内 LRU：`BAZI_CACHE_TTL_MS`（默认 6h）、`BAZI_CACHE_MAX_ENTRIES`（默认 500）
2. Redis 镜像：配了 `REDIS_URL` 才有，让多实例共享第 1 层

`GET /api/system/cache-status` 看 Redis 连通性和镜像是否生效。

限流也可以用 Redis 做跨实例计数。没配 Redis 时每个实例各自一个桶，N 个实例实际放行约 `N × RATE_LIMIT_MAX`。这不是故障，启动时打一条 warning。`bazi_rate_limit_degraded=1` 只表示「配了 Redis 却用不上」。

## 并发与超时

`lib/concurrency.js` 只闸 AI 解读。超出直接 429（CLI 译成退出码 5）。排盘是纯 CPU，不走这道闸。

AI 还有两层超时：`fetchWithTimeout` 管到响应头；`fetchStreamWithTimeout` 管流式空闲。供应商发完头就卡住时，后者避免读循环永久占着并发槽。

## 安全

| 层面    | 措施                                                    |
| ------- | ------------------------------------------------------- |
| HTTP 头 | helmet                                                  |
| CORS    | `CORS_ALLOWED_ORIGINS` 白名单；无 Origin 的调用不受影响 |
| 输入    | 体大小、URL 长度、数组、嵌套、键数、字符串都有上限      |
| 限流    | 生产默认开；全局桶 + 排盘/AI 严格桶                     |
| 文档    | `/api-docs` Basic Auth；生产缺 `DOCS_PASSWORD` 拒绝启动 |
| 指标    | `/metrics` 需 Bearer；生产未配 token 返回 404           |
| 错误    | 生产 5xx 不回内部细节                                   |
| 日志    | `utils/redact.js` 脱敏                                  |

`TRUST_PROXY` 必须填跳数（一层 nginx 填 `1`）。填 `true` 等于信任任意 `X-Forwarded-For`，限流可被伪造头绕过。

## 观测与停机

- 日志：pino JSON，带 request id；探针路径不记访问日志
- 存活：`GET /live` —— 只看进程，给容器 healthcheck / autoheal
- 就绪：`GET /api/ready` —— 含依赖，给负载均衡摘流；SIGTERM 后立即 503
- 深度：`GET /health` —— 与 ready 同类检查，排水期间同样 503
- 指标：`GET /metrics` Prometheus 文本；不统计探针路径，不打 route 标签

收到 SIGTERM：`/health` 与 `/api/ready` 立即 503（约 +2ms）→ 等 `SHUTDOWN_DRAIN_MS` → 关监听 → 等在途请求，上限 `GRACEFUL_SHUTDOWN_TIMEOUT_MS`。排水必须小于编排层 stop grace。对照表在 [env.production.template](../env.production.template) 和 [PRODUCTION.md](../PRODUCTION.md)。

容器里 PID 1 是 `backend/scripts/start.mjs`，只做一件事：把 SIGTERM 转给 `server.js`。不要改成 `npm start`，npm/sh 不保证转发信号。

## 测试目标

| 目标      | 测什么                                               | 要不要引擎 |
| --------- | ---------------------------------------------------- | ---------- |
| `cli`     | 退出码、`--json` 单文档、安全闸、schema 与命令树一致 | 否         |
| `lint`    | 根级 ESLint                                          | 否         |
| `backend` | 路由、算法、中间件、配置、健康检查                   | 否         |
| `engine`  | 声明可复现的能力命令连调两次必须一致                 | 是         |

`./bazi test` 目标未就绪会记 `skipped` 并仍退 0。读 `summary.skipped`；CI 用 `--fail-on-skip`。另有独立的镜像 job：生产模式、不配 Redis 冒烟。

## 相关文档

- [modules.md](modules.md) —— 模块与核心逻辑
- [deployment.md](deployment.md) —— 三种部署
- [configuration.md](configuration.md) —— 配置
- [operations.md](operations.md) —— 运维排错
- [SKILL.md](../.claude/skills/bazi-cli/SKILL.md) —— 算法口径
