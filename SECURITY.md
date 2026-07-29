# 安全策略 / Security Policy

## 报告漏洞 / Reporting a vulnerability

**请不要开公开 issue。**

请通过 GitHub 的
[Private vulnerability reporting](https://github.com/tytsxai-stack/metaphysics-engine/security/advisories/new)
私下提交（仓库 Security 标签页）。请附上受影响的版本或 commit、复现步骤、以及你判断的影响面。

这是一个个人维护的开源项目，没有 SLA。会尽快确认并处理，修复后在
[CHANGELOG.md](CHANGELOG.md) 记录，并在 advisory 里致谢报告者（除非你不希望署名）。

Please report privately via GitHub's private vulnerability reporting rather than a public issue.
Include the affected version or commit, reproduction steps, and your assessment of the impact.
This is a personally maintained open-source project with no SLA.

## 支持范围 / Scope

只维护 `main` 分支和最新 release。旧版本不做回溯修复。

### 属于本项目的安全问题

- 引擎自身的漏洞：注入、DoS、越权读取、依赖漏洞
- 运维面暴露：`/api-docs` 或 `/metrics` 的鉴权被绕过
- 限流可被绕过、CORS 配置失效
- 密钥或环境变量泄漏进日志、响应体、错误堆栈

### 不属于本项目的安全问题

引擎是**无状态纯计算**：不存数据、不认用户、没有数据库、不写文件，所有业务接口都是公开的、无鉴权的。
这是刻意的设计——账号、鉴权、持久化都属于调用方。因此以下不算漏洞：

- 「业务接口不需要登录」——项目没有账号系统，这是设计而非缺陷
- 「服务直接暴露在公网上不安全」——服务默认只绑定 `127.0.0.1:4000`（`BACKEND_BIND_ADDR`），
  TLS 终结和公网入口由部署者的反向代理负责，见 [PRODUCTION.md](PRODUCTION.md)
- 部署者自己的配置错误：`TRUST_PROXY` 填成 `true` 导致 `X-Forwarded-For` 可伪造、
  `METRICS_TOKEN` 未设置就把 `/metrics` 经公网反代出去、`DOCS_PASSWORD` 用弱口令
- AI Provider（OpenAI / Anthropic）自身的问题
- 命理、占星结果的准确性——见 [README 的限制与免责声明](README.md#限制与免责声明--limitations)

## 部署者的安全基线 / Deployer checklist

自部署时这几项由你负责，模板与说明见
[env.production.template](env.production.template) 与 [PRODUCTION.md](PRODUCTION.md)：

- `DOCS_PASSWORD` 必填，缺了进程在生产模式下启动即退出
- `TRUST_PROXY` 填**跳数**（一层 nginx 就填 `1`），不要填 `true`——那等于让客户端完全控制
  `X-Forwarded-For`，限流可被一个请求头绕过
- `METRICS_TOKEN` 设好，且 `/metrics` 不要经公网反代暴露
- `CORS_ALLOWED_ORIGINS` 按实际浏览器调用方收紧
- HTTPS 终结在你的反向代理上，引擎本身不处理 TLS
- `npm audit --omit=dev --audit-level=high` 已是 CI 门槛，自部署时建议在发布流水线里同样跑
