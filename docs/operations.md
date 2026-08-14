# 运维与排错

日常盯什么、探针怎么接、坏了先看哪。生产排水、告警表达式和 Nginx 全文在 [PRODUCTION.md](../PRODUCTION.md)。配置键在 [configuration.md](configuration.md)。

## 日常命令

本地（CLI 托管的进程）：

```bash
./bazi stack status --json
./bazi stack logs --tail 60
./bazi doctor --json
./bazi env check --json
```

容器：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail 80 backend
docker compose -f docker-compose.prod.yml exec redis redis-cli ping
```

远端能力调用：

```bash
BAZI_API_URL=https://api.example.com ./bazi calc bazi --birth 1990-05-20T14:30 --gender male --json
```

失败时不要读人类错误文案猜意图，看退出码：

| 码  | 含义                               | 下一步                                                           |
| --- | ---------------------------------- | ---------------------------------------------------------------- |
| 0   | 成功                               | 继续。测试还要看 `summary.skipped`                               |
| 1   | 结果失败 / 引擎内部错 / 端点不存在 | 看日志或 `code: endpoint_missing`                                |
| 2   | 用法错                             | `--help`，别盲试参数                                             |
| 3   | 环境未就绪                         | 照 `next` 修，原样重试                                           |
| 4   | 请求被拒                           | 改参数                                                           |
| 5   | 限流或瞬时失败                     | 等几秒原样重试                                                   |
| 7   | 安全闸                             | `--dry-run` 给用户看，得到明确同意再 `--yes`。不要自己补 `--yes` |

`next` 是一条可复制的 `bazi` 命令。优先执行它。

## 探针接法（接错会自己制造事故）

| 探针 | 路径             | 给谁                       | 排水时   |
| ---- | ---------------- | -------------------------- | -------- |
| 存活 | `GET /live`      | 容器 healthcheck、autoheal | 仍 200   |
| 就绪 | `GET /api/ready` | 负载均衡摘流               | 立即 503 |
| 深度 | `GET /health`    | 人工、部分编排             | 立即 503 |

- **重启用 `/live`。** 它不碰 Redis。若 autoheal 打 `/api/ready`，缓存抖十秒就会重启引擎，把一次无害抖动放大成冷启动。
- **摘流用 `/api/ready`。** SIGTERM 后它立刻失败，此时进程仍在服务存量请求。LB 应摘流，不要重启。

`/health` 与 `/api/ready` 的深度结果按 `HEALTH_CACHE_TTL_MS` 缓存，并注册在限流之前。不要把它们暴露成无鉴权的公网扫描面还关缓存。

## 该盯的信号

进程活着但每个请求 500 时，`/live`、`/health`、`bazi_up`、`bazi_dependency_up` 全是绿的。必须盯请求指标：

| 指标                                                | 何时响                        |
| --------------------------------------------------- | ----------------------------- |
| `bazi_http_requests_total{status_class="5xx"}` 占比 | 持续 >5%                      |
| `bazi_http_request_duration_seconds` p95            | 纯计算接口到 1s，事件循环被占 |
| `bazi_http_rate_limited_total`                      | 配额过小或有人在扫            |
| `bazi_http_requests_in_flight`                      | 堆积                          |
| `bazi_rate_limit_degraded`                          | 配了 Redis 却用不上           |
| `bazi_shutting_down`                                | 发布窗口预期为 1              |
| `bazi_dependency_up`                                | 非排水期掉到 0                |

指标不带 route 标签（公开接口 + 扫描器 = 基数爆炸）。定位接口看 pino 日志里的 URL 和 request id。

Prometheus 规则原文见 [PRODUCTION.md](../PRODUCTION.md)。

## 排错

先看进程在不在、是谁起的。

```bash
./bazi stack status --json
```

`managedBy`：`bazi`（能停）/ `foreign`（端口被别人占，CLI 拒绝 kill）/ `null`（没在跑）。

**不要** `kill $(lsof -ti:4000)`。那会误伤另一个终端或 worktree。告诉使用者端口被占，让他们决定。

| 症状                          | 先看                             | 常见原因                                                 |
| ----------------------------- | -------------------------------- | -------------------------------------------------------- |
| `stack up` 立刻退             | `stack logs`；CLI 会压成一条诊断 | 端口占用；生产缺 `DOCS_PASSWORD`；依赖没装               |
| `managedBy: foreign`          | 谁占用了 `PORT`                  | 手动起过 `node server.js`，或别的项目                    |
| 连不上，CLI 退 3              | `stack status`                   | 引擎没起                                                 |
| `/health` 503                 | 响应 `checks`                    | 只有 Redis 挂时业务其实还能用；排水中则是发布            |
| 探针一律 500                  | 镜像版本                         | v0.2.1 之前生产不配 Redis 会让深度检查恒 500。换当前镜像 |
| 全站一起 429                  | `TRUST_PROXY`                    | 跳数错了，`req.ip` 变成代理地址                          |
| 浏览器 CORS                   | `CORS_ALLOWED_ORIGINS`           | 服务端到服务端不受影响                                   |
| `/metrics` 404                | `METRICS_TOKEN`                  | 生产未配就是 404，不是故障                               |
| `/metrics` 401                | Authorization                    | 配了 token 但没带或带错                                  |
| `/api-docs` 401               | Basic Auth                       | 生产预期行为                                             |
| 滚动发布 502                  | `SHUTDOWN_DRAIN_MS`              | 小于 LB 探测间隔 × 失败阈值                              |
| 容器起来就退                  | 日志 `[config]`                  | 缺 `DOCS_PASSWORD`                                       |
| 排盘与预期差一柱              | `x-bazi-cache`、`chartTime`      | 见下节                                                   |
| `endpoint_missing`            | CLI 与引擎版本                   | 重启/升级引擎，不要改参数                                |
| `bazi test` 退 0 但没跑到东西 | `summary.skipped`                | 加 `--fail-on-skip`                                      |

### 盘不对，命令却退 0

这类不会报错。按这个顺序对：

1. 响应头 `x-bazi-cache`：hit 时先怀疑键没覆盖新因子，或命中了别的出生地的盘。
2. `chartTime.used` vs `chartTime.trueSolarTime.clockTime`：校正是否生效。
3. `chartTime.locationResolution.status`：`unresolved` / `no-timezone` 会静默退回钟表时间。
4. `chartTime.termReference`：海外出生年月柱按东八区，和 `used` 差一个时区是正常的。
5. 对照 [SKILL.md](../.claude/skills/bazi-cli/SKILL.md) 的选定口径（晚子、闰月、中气换将、拆补、转盘）。对不上先分清是 bug 还是另一派。

给了地点仍不校正：表里没有该地名。改传 `"纬度,经度"`。

要复现历史钟表盘：`trueSolarTime: false`。

## 日志

- 本地 CLI：`./bazi stack logs --tail 60`（文件在 `.tmp/cli/`）
- 容器：`docker compose ... logs backend`，pino JSON 在 stdout
- 探针路径不写访问日志
- `unresolved` / `no-timezone` 会在服务端打 warn，便于发现该补城市表或调用方一直漏时区

启动失败时 CLI 把日志压成一条诊断，认得出的特征（`EADDRINUSE`、`DOCS_PASSWORD`、缺模块）直接翻译成下一条命令。

## 安全闸与破坏性操作

`./bazi env init --force` 会覆盖 `.env`（里面可能有真实 API Key）。没有 `--yes` 退 7。`NODE_ENV=production` 硬拒绝，加任何参数都绕不过。

先 `--dry-run`，把会改的东西告诉人，得到明确同意再 `--yes`。

## 升级检查单

1. 读 [CHANGELOG.md](../CHANGELOG.md) 里相对当前版本的条目
2. 若新增环境变量：补模板、compose、`.env.production`
3. 滚动发布，确认 `/api/ready` 与一次真实排盘
4. 跑 `./scripts/verify-deployment.sh`
5. 回滚预案：上一镜像可直接切回
