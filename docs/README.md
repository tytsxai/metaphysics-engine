# 文档体系

> 更新：2026-08-14。本页是文档地图与同步约定，不是能力清单。
> 命令以 `./bazi help --json` 为准，接口以 [openapi.json](openapi.json) 为准。

Metaphysics Engine 是无状态术数算法能力层：常驻引擎提供 HTTP，`./bazi` 是面向 Agent 的薄客户端。仓库不含前端、账号和数据库。接手时按下面的顺序读，即可独立运行、排错、改算法和加能力。

## 接手第一天

```bash
./bazi setup && ./bazi doctor && ./bazi stack up
./bazi test --fail-on-skip --json
curl -s http://127.0.0.1:4000/live
```

然后按角色选读：

| 你要做什么               | 先读                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 弄清系统怎么拼起来       | [architecture.md](architecture.md)                                                                                                               |
| 改某一门术数或加新能力   | [modules.md](modules.md) → [../CONTRIBUTING.md](../CONTRIBUTING.md) → [../.claude/skills/bazi-cli/SKILL.md](../.claude/skills/bazi-cli/SKILL.md) |
| 本地 / 容器 / 服务器部署 | [deployment.md](deployment.md)                                                                                                                   |
| 配环境变量               | [configuration.md](configuration.md)                                                                                                             |
| 上线后怎么盯、怎么排     | [operations.md](operations.md)                                                                                                                   |
| 调 HTTP 接口             | [api.md](api.md) + [openapi.json](openapi.json)                                                                                                  |
| 日常开发与测试           | [development.md](development.md)                                                                                                                 |

根目录还有入口文档：[README.md](../README.md)（项目定位）、[PRODUCTION.md](../PRODUCTION.md)（生产细节）、[CONTRIBUTING.md](../CONTRIBUTING.md)（改动门槛）。

## 文档地图

| 文档                                                                       | 职责                                      | 真源                                                                           |
| -------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| [architecture.md](architecture.md)                                         | 运行形态、目录、请求链、缓存、观测、停机  | `backend/server.js`、`tools/cli/`                                              |
| [modules.md](modules.md)                                                   | 关键模块、调用关系、核心排盘路径          | `backend/services/`、`tools/cli/src/`                                          |
| [configuration.md](configuration.md)                                       | 环境变量、注入方式、默认值、易错项        | [env.production.template](../env.production.template)、`backend/config/app.js` |
| [deployment.md](deployment.md)                                             | 本地、容器、服务器三种部署                | `docker-compose*.yml`、`backend/Dockerfile`                                    |
| [operations.md](operations.md)                                             | 日常运维、探针、排错                      | `./bazi stack`、`/live` `/health` `/api/ready` `/metrics`                      |
| [api.md](api.md)                                                           | 给人读的 HTTP 导览                        | [openapi.json](openapi.json)（由 `apiSchema.service.js` 生成）                 |
| [development.md](development.md)                                           | 本地开发、脚本、调试                      | `./bazi`、`package.json`                                                       |
| [faq.md](faq.md)                                                           | 常见判断题                                | 以上各篇                                                                       |
| [../PRODUCTION.md](../PRODUCTION.md)                                       | 生产栈细节：排水、Nginx、告警规则         | `docker-compose.prod.yml`、`lifecycle.service.js`                              |
| [../.claude/skills/bazi-cli/SKILL.md](../.claude/skills/bazi-cli/SKILL.md) | 算法语义边界与 CLI 契约（错了不报错的坑） | 各 `*.service.js` 就地注释                                                     |
| [../CONTRIBUTING.md](../CONTRIBUTING.md)                                   | 加能力要动哪几处、质量门槛、不做清单      | CI、测试                                                                       |

**不要抄进文档的东西：** `./bazi` 的命令清单、flag 全集、HTTP 字段全集。它们会腐化。分别去跑 `./bazi help --json` 和读 `docs/openapi.json`。

## 文档与代码如何保持同步

每一类改动都有唯一真源；文档只解释真源讲不清的语义、顺序和坑。

| 改了什么                       | 必须同步                                                                                                                                                                 | 由谁守住                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| HTTP 路径 / 请求响应形状       | `backend/services/apiSchema.service.js` → `npm -C backend run generate:openapi` → 提交 `docs/openapi.json`；人读导览改 [api.md](api.md)                                  | CI：`git diff --exit-code -- docs/openapi.json` |
| 环境变量                       | [env.production.template](../env.production.template)、`docker-compose.prod.yml` 的 `environment`、[.env.example](../.env.example)、[configuration.md](configuration.md) | CI：`scripts/check-env-template.sh`             |
| CLI 命令 / 退出码 / `next`     | `tools/cli/src/`；**不要**把命令表抄进 README                                                                                                                            | `./bazi test cli`                               |
| 算法口径（流派）               | 代码就地注释 + [SKILL.md](../.claude/skills/bazi-cli/SKILL.md)                                                                                                           | 人工；PR 模板有勾选                             |
| 部署方式 / 探针含义 / 停机时序 | [deployment.md](deployment.md)、[operations.md](operations.md)、[../PRODUCTION.md](../PRODUCTION.md)                                                                     | 镜像冒烟 job；人工核对                          |
| 模块边界 / 请求链              | [architecture.md](architecture.md)、[modules.md](modules.md)                                                                                                             | 人工；结构变了就改这两篇                        |
| 过期命令与错误仓库地址         | 全文不得再出现已删除的 CLI 写法                                                                                                                                          | CI：`scripts/check-docs.sh`                     |

提交前最小集合：

```bash
./bazi test --fail-on-skip --json
npm run format:check
./scripts/check-docs.sh
```

动了接口再加 `npm -C backend run generate:openapi`。动了算法再补有典籍或流派依据的测试。

## 仓库外不要去对的线

公开仓库 [tytsxai/bazi-master](https://github.com/tytsxai/bazi-master)（冻结 `v0.2.0`）是另一条全栈社区版，与本仓库不共享代码。不要把两边的改动搬来搬去。授权见 [LICENSE](../LICENSE)。
