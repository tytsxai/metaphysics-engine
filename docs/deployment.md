# 部署

三种形态共用同一个无状态引擎。没有迁移、没有种子数据、没有必须先起的数据库。选一种跑通，再用 [operations.md](operations.md) 接探针和排错。

| 形态     | 适用                     | 入口                      | Redis          |
| -------- | ------------------------ | ------------------------- | -------------- |
| 本地进程 | 开发、改算法、跑测试     | `./bazi stack up`         | 不需要         |
| 容器     | 本机预发、单机生产参考栈 | `docker-compose.prod.yml` | 编排里带，可删 |
| 服务器   | 前面加反向代理的生产     | 容器或 systemd + nginx    | 可选           |

无论哪种：生产必须有 `DOCS_PASSWORD`；默认不要把引擎端口直接暴露到公网。

## 1. 本地进程

前置：Node.js 20+、npm 9+。不需要 Docker。

```bash
git clone https://github.com/tytsxai/metaphysics-engine.git
cd metaphysics-engine
./bazi setup          # 装依赖，从 .env.example 生成 .env
./bazi doctor         # 失败项带可执行 fix；或 ./bazi doctor --fix
./bazi stack up       # 幂等；已在跑则跳过
./bazi stack status --require-ready --json
```

引擎默认 `http://127.0.0.1:4000`。

```bash
curl -s http://127.0.0.1:4000/live
./bazi calc bazi --birth 1990-05-20T14:30 --gender male --json
./bazi test --fail-on-skip --json
```

不要手动 `node server.js`：那样起的进程 `managedBy=foreign`，`stack down` 停不掉。需要盯 stdout 时用 `NODE_ENV=development npm -C backend run dev`，并自己管这个进程。

验证多实例缓存再起本地 Redis：

```bash
docker compose up -d redis
# 在 .env 里设 REDIS_URL=redis://127.0.0.1:6379 后 ./bazi stack restart
```

`docker-compose.yml` 只有 redis 一个服务，不是完整应用栈。

运行态在 `.tmp/cli/`（pid、日志），已 gitignore。整个删掉再 `stack up` 即可。

把 CLI 指到已经在跑的实例：

```bash
BAZI_API_URL=https://api.example.com ./bazi calc bazi --birth 1990-05-20T14:30 --gender male --json
```

## 2. 容器

镜像定义在 [backend/Dockerfile](../backend/Dockerfile)：

- 基础：`node:20-alpine`
- `npm ci --omit=dev`（生产镜像不含测试依赖）
- 用户 `node`，不跑 root
- `CMD ["node", "scripts/start.mjs"]` —— PID 1 必须是它，才能把 SIGTERM 交给 `server.js`
- 自带 HEALTHCHECK 打 `/live`

不要用 `npm start` 当容器入口。

### 单独跑引擎（无 Redis）

这是文档声称支持、CI `image` job 也在冒烟的形态：

```bash
docker build -f backend/Dockerfile -t metaphysics-engine:local .
docker run --rm -p 127.0.0.1:4000:4000 \
  -e NODE_ENV=production \
  -e PORT=4000 \
  -e BIND_HOST=0.0.0.0 \
  -e DOCS_PASSWORD='改成足够长的随机串' \
  -e BACKEND_BASE_URL=http://127.0.0.1:4000 \
  metaphysics-engine:local
```

`/health` 此时 `redis.status=disabled`，HTTP 200。业务排盘可用。

### 生产参考栈（引擎 + Redis + autoheal）

```bash
cp env.production.template .env.production
# 至少改：DOCS_PASSWORD、BACKEND_BASE_URL、CORS_ALLOWED_ORIGINS、TRUST_PROXY
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
API_BASE_URL=http://127.0.0.1:4000 ./scripts/verify-deployment.sh
```

要点：

- compose 把 `REDIS_URL` 钉成 `redis://redis:6379`。要接托管 Redis，改 `environment` 段，不要只改 env 文件里的键却不透传。
- 宿主端口默认 `127.0.0.1:4000`。TLS 和公网入口交给你自己的反代。
- Redis 关持久化（`--save ''`）、设 `maxmemory` + `volatile-lru`。里面只有可重算的缓存。
- autoheal 观察 `autoheal=true` 且 unhealthy 的容器。healthcheck 必须是 `/live`，不能是 `/api/ready`：Redis 抖一下不应重启引擎。
- 日志驱动钉了 `max-size` / `max-file`。Docker 默认 json-file 无上限。
- `stop_grace_period: 30s` 必须大于 `SHUTDOWN_DRAIN_MS + GRACEFUL_SHUTDOWN_TIMEOUT_MS`。

不想挂 Docker socket：删掉 `autoheal` 服务。

## 3. 服务器

推荐路径：上面的 compose 栈跑在内网，前面一层 nginx（或等价反代）终止 TLS。

最小反代（只暴露业务 API，不转发 `/metrics` 和 `/api-docs`）：

```nginx
server {
  listen 443 ssl http2;
  server_name api.example.com;
  ssl_certificate     /path/to/fullchain.pem;
  ssl_certificate_key /path/to/privkey.pem;

  location /api {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /live {
    proxy_pass http://127.0.0.1:4000;
  }
}
```

- `TRUST_PROXY=1`（若前面还有 CDN，按实际跳数加）。
- 反代 `client_max_body_size` 与 `JSON_BODY_LIMIT` 对齐，大请求在边缘被拒。
- 公网部署建议在反代再加一层限流。套了 CDN 要设 `set_real_ip_from` / `real_ip_header`，否则全站共用一个限流桶。
- `/metrics` 只从内网抓：`curl -H "Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:4000/metrics`

不走 Docker、用 systemd 时：用 `backend/scripts/start.mjs` 做 ExecStart，注入与生产模板相同的变量，`Environment=NODE_ENV=production`，`Restart=on-failure`。探针接法不变。

上线前读 [PRODUCTION.md](../PRODUCTION.md) 的排水对照表、告警规则和安全要点。配置项见 [configuration.md](configuration.md)。

## 发布与回滚

引擎无状态：滚动重启即可，没有「新版本已经改过库」的问题。

1. 构建并替换镜像（或拉新代码后重建）
2. 新实例 `/api/ready` 200 后再把流量切过去
3. `API_BASE_URL=https://api.example.com ./scripts/verify-deployment.sh`
4. 回滚：切回上一镜像重启

滚动期间新旧进程会同时服务。不要在一次发布里做不兼容的请求体变更。

## 验证清单

| 检查                               | 期望                                            |
| ---------------------------------- | ----------------------------------------------- |
| `GET /live`                        | 200，`status: alive`                            |
| `GET /health`                      | 200；无 Redis 时 `checks.redis.status=disabled` |
| `GET /api/ready`                   | 200，`status: ready`                            |
| `POST /api/bazi/calculate`         | 200，带 `pillars`                               |
| `GET /metrics`（未配 token，生产） | 404                                             |
| `GET /api-docs.json`（生产匿名）   | 401                                             |
| `docker stop` / SIGTERM            | 进程退出码 0；ready 先于关端口变 503            |
