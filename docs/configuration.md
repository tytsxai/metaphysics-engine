# 配置说明

> 完整键名与生产注释以仓库根 [env.production.template](../env.production.template) 为准。
> CI 用 `scripts/check-env-template.sh` 保证模板覆盖后端真实读取的每个变量。
> 新增变量必须同时：写入该模板、写入 `docker-compose.prod.yml` 的 `environment`、在本页补一行。

## 变量怎么进进程

后端**不引入 dotenv**。`node server.js` 只读真实环境变量。

| 启动方式                                      | 变量从哪来                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `./bazi stack up`                             | CLI 解析仓库根 `.env`，注入子进程；真实 `process.env` 优先                                                    |
| `NODE_ENV=development npm -C backend run dev` | 你自己 export，或进程管理器注入                                                                               |
| `docker compose -f docker-compose.prod.yml`   | compose 的 `environment` 段显式透传。`--env-file` 只做 compose 自己的替换，**不会**自动把文件里所有键灌进容器 |
| systemd / k8s                                 | `EnvironmentFile` / ConfigMap / Secret                                                                        |

开发模板：[.env.example](../.env.example)。`./bazi setup` / `./bazi env init` 用它生成 `.env`。查看与改键用 `./bazi env`。

`BAZI_API_URL` 只给 CLI 用，用来把 `calc`/`cast` 指到远端引擎。`stack` 不管它。

## 开发 vs 生产

开发环境一个变量都不必填。生产环境**唯一硬性必填**是 `DOCS_PASSWORD`：缺了它 `validateProductionConfig` 让进程退出。其余缺失只打 warning。

`./bazi env check` 按当前 `NODE_ENV` 用同一口径校验。

## 进程与绑定

| 变量                | 默认                             | 说明                                                                                        |
| ------------------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| `NODE_ENV`          | （空）                           | `production` 打开启动校验、限流默认、文档鉴权                                               |
| `PORT`              | `4000`                           | 监听端口                                                                                    |
| `BIND_HOST`         | 生产 `0.0.0.0`，开发 `127.0.0.1` | 进程在容器/主机内监听的地址。容器内用 `0.0.0.0` 是对的                                      |
| `BACKEND_BIND_ADDR` | `127.0.0.1`                      | **compose 发布到宿主的网卡**，不是 Node 的 listen。发布到 `0.0.0.0` 会写 iptables，绕过 ufw |
| `BACKEND_BASE_URL`  | `http://localhost:$PORT`         | 只用于 OpenAPI `servers`。生产不要指向 localhost（除非 `ALLOW_LOCALHOST_PROD=true`）        |
| `LOG_LEVEL`         | pino 默认                        | `trace`…`fatal`                                                                             |

## 优雅停机与 HTTP 超时

| 变量                           | 默认                  | 说明                                            |
| ------------------------------ | --------------------- | ----------------------------------------------- |
| `SHUTDOWN_DRAIN_MS`            | 生产 `5000`，其它 `0` | SIGTERM 后 readiness 先 503、仍接存量请求的窗口 |
| `GRACEFUL_SHUTDOWN_TIMEOUT_MS` | `10000`               | 关监听后等在途请求                              |
| `SHUTDOWN_TIMEOUT_MS`          | `10000`               | 前者未设时的别名                                |
| `SERVER_KEEP_ALIVE_TIMEOUT_MS` | Node 默认             | keep-alive                                      |
| `SERVER_HEADERS_TIMEOUT_MS`    | Node 默认             | 必须大于 keep-alive；代码会自动抬高             |
| `SERVER_REQUEST_TIMEOUT_MS`    | Node 默认             | 整请求                                          |

排水必须：**大于** LB 探测间隔 × 失败阈值，**小于** `stop_grace_period` / `terminationGracePeriodSeconds`。默认 5000 只够 nginx 被动检查。k8s 建议 35000，ALB 建议 65000，并同步抬高停机宽限。实测时序见 [PRODUCTION.md](../PRODUCTION.md)。

## 网络、CORS、代理

| 变量                      | 默认                            | 说明                                            |
| ------------------------- | ------------------------------- | ----------------------------------------------- |
| `CORS_ALLOWED_ORIGINS`    | 空；开发额外放行 localhost:3000 | 逗号分隔。无 Origin 的服务端/Agent 调用不受影响 |
| `TRUST_PROXY`             | 关                              | **跳数**。一层 nginx 填 `1`。不要填 `true`      |
| `JSON_BODY_LIMIT`         | `1mb`                           | `express.json` 缓冲上限                         |
| `MAX_URL_LENGTH`          | `16384`                         |                                                 |
| `MAX_INPUT_ARRAY_LENGTH`  | `1000`                          | JSON 形状护栏                                   |
| `MAX_INPUT_DEPTH`         | `10`                            |                                                 |
| `MAX_INPUT_KEYS`          | `200`                           |                                                 |
| `MAX_INPUT_STRING_LENGTH` | `10000`                         |                                                 |

## 缓存与 Redis

| 变量                                     | 默认             | 说明                                |
| ---------------------------------------- | ---------------- | ----------------------------------- |
| `REDIS_URL`                              | 空               | 可选。不配则进程内缓存 + 每实例限流 |
| `REDIS_CONNECT_TIMEOUT_MS`               | 实现默认         | 连接超时                            |
| `BAZI_CACHE_TTL_MS`                      | `21600000`（6h） |                                     |
| `BAZI_CACHE_MAX_ENTRIES`                 | `500`            | 进程内上限                          |
| `REDIS_MAXMEMORY` / `REDIS_MEMORY_LIMIT` | `256mb` / `512m` | 仅 compose 里的 redis 服务          |

生产未配 `REDIS_URL` 时 `/health` 报 `redis.status=disabled` 且整体仍 200。这是支持的部署形态。

## 限流

| 变量                   | 代码默认                             | 说明                                       |
| ---------------------- | ------------------------------------ | ------------------------------------------ |
| `RATE_LIMIT_WINDOW_MS` | 生产 `60000`，开发 `0`（关）         |                                            |
| `RATE_LIMIT_MAX`       | 生产 **`120`**（未设置时），开发 `0` | 模板里常写成 `100`。以进程实际读到的值为准 |

排盘和 AI 解读再套一层严格桶：`max(5, floor(RATE_LIMIT_MAX / 5))`。探针和 `/metrics` 在限流之前，不会被打满配额。

## AI

只影响 `*/ai-interpret` 与 `full-analysis`，不影响排盘。

| 变量                                    | 默认                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `AI_PROVIDER`                           | 有 OpenAI 钥则 `openai`，否则有 Anthropic 钥则 `anthropic`，否则 `mock` |
| `OPENAI_API_KEY` / `OPENAI_MODEL`       | 空 / `gpt-4o-mini`                                                      |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | 空 / `claude-3-5-sonnet-20240620`                                       |
| `AI_MAX_TOKENS`                         | `700`                                                                   |
| `AI_TIMEOUT_MS`                         | `15000`                                                                 |

单次请求体里的 `provider` 可覆盖，填不可用的供应商返回 400。`GET /api/ai/providers` 看当前生效值。

## 文档、指标、Sentry

| 变量                                    | 说明                                       |
| --------------------------------------- | ------------------------------------------ |
| `DOCS_USER`                             | 默认 `admin`                               |
| `DOCS_PASSWORD`                         | 生产必填                                   |
| `METRICS_TOKEN`                         | Bearer。生产留空则 `/metrics` 返回 404     |
| `HEALTH_CACHE_TTL_MS`                   | 默认生产 1000。深度检查结果复用；`0` 关闭  |
| `SENTRY_DSN`                            | 可选。只在生产且有 DSN 时初始化            |
| `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` | 区分环境、把错误钉到某次发布               |
| `SENTRY_TRACES_SAMPLE_RATE`             | 默认 `0.1`                                 |
| `SENTRY_PROFILES_SAMPLE_RATE`           | 默认 `0`（贵）                             |
| `ALLOW_LOCALHOST_PROD`                  | 允许生产 `BACKEND_BASE_URL` 指向 localhost |

## 仅 compose / 运维侧

这些不是 Node 读的，只出现在 `docker-compose.prod.yml`：

`BACKEND_MEMORY_LIMIT`、`AUTOHEAL_INTERVAL`、`AUTOHEAL_START_PERIOD`、`AUTOHEAL_DOCKER_TIMEOUT`。

autoheal 需要 Docker socket，等价于宿主 root。不能接受就删掉该服务，改用编排层重启策略。

## 改配置之后

1. 本地：改 `.env`，`./bazi stack restart`（CLI 起的进程会带上新文件）
2. 容器：改 `.env.production` 后 `docker compose ... up -d`（只改 env、镜像没变时也会重建容器）
3. 确认：`./bazi env check` 或看启动日志里的 `[config]` warning
