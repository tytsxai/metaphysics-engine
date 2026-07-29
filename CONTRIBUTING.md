# 参与共建 BaZi Master / Contributing

> English speakers: this guide is written in Simplified Chinese because the codebase's comments and
> commit history are. Issues and pull requests in English are equally welcome — see
> [English notes](#english-notes) at the bottom.

先说清楚这个项目的形态，能省下很多来回：BaZi Master 是一个**算法能力层**，
以自部署 HTTP API + 程序化 CLI 交付。它没有前端，没有账号系统，没有数据库，
引擎是无状态纯计算。这个边界是刻意的，不是「还没做」——详见
[README 的项目定位](README.md#项目定位--project-snapshot)。

## 30 秒把环境跑起来

```bash
git clone https://github.com/tytsxai/bazi-master.git
cd bazi-master
./bazi setup && ./bazi doctor && ./bazi stack up
./bazi test
```

只需要 Node.js 20+ 和 npm，不需要 Docker、数据库、Redis。
`./bazi doctor` 对每个失败项都会给出可以直接粘贴执行的修复命令。

用 `./bazi`，不要手搓 `node server.js`——手动起的进程 CLI 管不到，之后停不掉。
完整命令树：`./bazi help --json`（这是能力清单的唯一真源，文档刻意不重复它）。

## 我们最需要哪类帮助

按对项目价值排序，越靠前越欢迎：

### 1. 术数口径的校对与纠错（价值最高）

这个项目最难的部分不是写代码，是**「写错了也不会报错」**：三传取法、安星链条、
拆补定局、游年翻卦、节气交接的时刻精度——错了不会抛异常，只会安静地给出一张错盘。
仓库里已经修掉的这类问题包括月令加倍误作用于月干（导致 22% 的盘旺衰判反）、
冬至跨年整段判错、时间起卦取数是编造的（见 [CHANGELOG.md](CHANGELOG.md)）。

如果你懂某一门术数，帮忙核对排盘结果是最有价值的贡献。报告时请用
[排盘口径问题模板](https://github.com/tytsxai/bazi-master/issues/new?template=algorithm_discrepancy.yml)，并尽量给出：

- 完整可复现的输入（年月日时、性别、地点、时区）
- 引擎当前输出 vs 你认为正确的输出
- **依据的流派或典籍**——这一条最关键

注意区分两种情况，处理方式完全不同：

| 情况         | 例子                               | 怎么处理                                             |
| ------------ | ---------------------------------- | ---------------------------------------------------- |
| **算错了**   | 三传取法漏了一个宗门、纳甲干支排错 | 是 bug，直接修，补测试                               |
| **流派不同** | 闰月归本月 vs 折半、晚子时换不换日 | 不是 bug。就地注明当前口径，必要时做成参数，不改默认 |

引擎的边界是**结构归引擎，断语归调用方**：盘怎么排有唯一正确答案，必须精准；
盘怎么解（庙旺利陷、奇门格局名目、神煞吉凶轻重）各家出入极大，刻意不塞进能力层。
提 PR 想加「断语」之前，请先在 issue 里讨论。

已知的口径选择逐条写在
[.claude/skills/bazi-cli/SKILL.md](.claude/skills/bazi-cli/SKILL.md)——改算法之前先读这一份。

### 2. 补新的术数能力

目前覆盖：八字、紫微斗数、六爻纳甲、大六壬、奇门遁甲、八宅风水、择吉黄历、姓名五格、
合盘、塔罗、周易、星座。想补别的（梅花易数、七政四余、小六壬、六十四卦爻辞……）
先开一个 issue 说明取法依据，再动手。落地清单见[加一个新能力要动哪几处](#加一个新能力要动哪几处)。

### 3. 接口契约、文档与翻译

- `docs/api.md` 的示例与实际响应对不上
- `README.en.md` / `llms.txt` 的英文表述不地道或已过期
- 缺其他语言的 README（日语、繁体中文等）
- OpenAPI 描述字段不清楚

### 4. Agent 接入

`./bazi schema` 已经能导出 anthropic / openai / mcp 三种形状的 tool schema。
欢迎补真实 Runtime 的接入示例、MCP server 封装、或反馈 schema 在你的 Agent 框架里不好用的地方。

### 5. 生态客户端

前端、小程序、Bot、SDK 都不会进主仓（那会模糊能力层的边界），
但欢迎开 issue 把你的项目链接过来，我们放进 README 的生态列表。

## 提 Issue 之前

1. 搜一下[已有 issue](https://github.com/tytsxai/bazi-master/issues)
2. 跑 `./bazi doctor --json`，环境问题它多半能直接告诉你答案
3. 报 bug 请附 `./bazi` 命令的 `--json` 输出，或 `curl` 的完整请求与响应
4. **安全问题不要开公开 issue**，见 [SECURITY.md](SECURITY.md)

## 改代码

### 加一个新能力要动哪几处

漏掉任何一处 CI 都会红，按顺序来：

| 步骤 | 位置                                            | 说明                                           |
| ---- | ----------------------------------------------- | ---------------------------------------------- |
| 1    | `backend/services/<name>.service.js`            | 算法本体。纯函数，不碰 req/res                 |
| 2    | `backend/routes/<name>.js`                      | HTTP 入口，只做参数编解码                      |
| 3    | `backend/routes/api.js`                         | 挂载 router                                    |
| 4    | `backend/services/apiSchema.service.js`         | 接口契约                                       |
| 5    | `npm -C backend run generate:openapi`           | 重新生成 `docs/openapi.json`，**必须提交**     |
| 6    | `backend/test/<name>.test.js`                   | 算法测试，用有典籍依据的样例                   |
| 7    | `tools/cli/src/commands/calc.mjs` 或 `cast.mjs` | CLI 子命令，声明 `effect` 与 `reproducibility` |
| 8    | `docs/api.md`                                   | 人读的接口文档                                 |
| 9    | `.claude/skills/bazi-cli/SKILL.md`              | 这门术数的语义边界与选定口径                   |

第 4、5 步是最容易漏的：`docs/openapi.json` 是外部消费者读的产物，
CI 会重新生成再 `git diff --exit-code`，不一致就直接失败。

改 CLI 本身之前，先读 SKILL.md 的「要改 CLI 本身的时候」那一节——
那里列的不是风格建议，是契约测试会当场拦下来的硬约束（`--json` 的 stdout 纯净度、
退出码语义、每条命令必须声明副作用等级与可复现性）。

### 本地质量门槛

提 PR 前把这些跑绿，跟 CI 是同一套：

```bash
./bazi test              # cli + lint + backend + engine 四个目标
npm run format           # Prettier 会改文件，format:check 在 CI 里是硬门槛
```

CI（[.github/workflows/ci.yml](.github/workflows/ci.yml)，Node 20.x 与 22.x 双跑）依次卡：

1. `./scripts/check-repo-artifacts.sh`——防止构建产物、截图、大文件被提交
2. `npm run lint` + `npm run format:check`
3. `./scripts/check-env-template.sh`——生产模板必须覆盖代码读取的每个环境变量
4. OpenAPI 快照一致性
5. `npm audit --omit=dev --audit-level=high`（只审运行时依赖）
6. backend 测试 + CLI 契约测试
7. 拿真实引擎验证能力契约里声明的可复现性

> `./bazi test` 的目标未就绪时会记 `skipped` 并**照样返回 0**。
> 读 `summary.skipped`，别只看退出码；要让「什么都没跑」变成硬失败就加 `--fail-on-skip`。

### 提交信息

沿用仓库现有的 Conventional Commits 风格，正文用中文，说清楚**为什么**改：

```
fix(bazi): 月令加倍只作用于月支，月干此前被误加倍导致 22% 的盘旺衰判反
feat(cli): bazi schema —— 把命令树导出成 agent tool schema
docs: 把契约声明同步进知识层与 README
```

常用类型：`feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `style` / `ci`。
scope 用模块名（`bazi` / `ziwei` / `liuyao` / `liuren` / `qimen` / `cli` / `api`…）。

### Pull Request 检查清单

- [ ] `./bazi test` 全绿，`npm run format:check` 通过
- [ ] 动了接口 → 重新生成并提交了 `docs/openapi.json`
- [ ] 动了算法 → 补了测试，且测试样例有典籍或流派依据
- [ ] 涉及流派选择 → 在代码里就地注明，并同步进 SKILL.md
- [ ] 动了行为/配置/部署方式 → 同步更新了对应文档
- [ ] 一个 PR 只做一件事

### 不会被接受的改动

不是质量问题，是边界问题，请先开 issue 讨论：

- 往仓库里塞前端代码或 UI 框架
- 加回账号系统、数据库、会话、历史记录、收藏
- 把「断语」硬编码进引擎（庙旺利陷表、奇门格局吉凶、神煞轻重）
- 为了迎合某一流派而改默认口径，且不保留原口径
- 大规模无关重构、或引入没有明确收益的新依赖

## 行为准则

对事不对人。术数流派分歧只讨论依据和典籍，不评判信仰。
不接受人身攻击、骚扰和歧视性言论。

## 许可

提交贡献即表示同意你的代码以 [MIT 许可证](LICENSE)发布。

## English notes

BaZi Master is a **capability layer**: a stateless, self-hostable calculation API plus an
agent-callable CLI. No frontend, no accounts, no database — by design, not by omission.

Getting started:

```bash
./bazi setup && ./bazi doctor && ./bazi stack up && ./bazi test
```

The most valuable contributions are **corrections to the divination algorithms themselves**.
These algorithms fail silently — a wrong three-transmission derivation or star placement raises no
error, it just returns a wrong chart. If you know one of these traditions, verifying output against
a canonical source is worth more than any code cleanup.

When reporting a discrepancy, please distinguish:

- **A bug** — the algorithm is objectively wrong (missing derivation gate, wrong stem-branch pair).
  We fix it and add a test.
- **A school difference** — leap-month handling, late-Zi day rollover. Not a bug. We document the
  chosen school in place and may expose a parameter, but we don't silently change the default.

The engine's governing boundary: **casting belongs to the engine, interpretation to the caller.**
How a chart is cast has one correct answer. How it is read varies by school and is deliberately
left to you, with every ingredient emitted.

Before opening a PR: run `./bazi test` and `npm run format:check`; if you touched the API surface,
regenerate and commit `docs/openapi.json`. Commit messages follow Conventional Commits (Chinese
bodies are the norm, English is fine). Security issues go to [SECURITY.md](SECURITY.md), not to a
public issue.

---

## 维护者备忘 / Maintainer notes

GitHub 仓库的 About 描述与 Topics 直接影响 GitHub 站内搜索和外部索引，建议设置为：

```bash
gh repo edit tytsxai/bazi-master \
  --description "开源命理算法能力层：八字/紫微斗数/六爻/大六壬/奇门遁甲/风水/择吉/塔罗/周易/星座排盘，以无状态 HTTP API 与 Agent 可调用 CLI 交付。Open-source stateless BaZi & Chinese metaphysics calculation API for apps and AI agents." \
  --homepage "https://github.com/tytsxai/bazi-master#readme" \
  --add-topic bazi --add-topic bazi-chart --add-topic bazi-api \
  --add-topic ziwei --add-topic ziwei-doushu --add-topic liuyao \
  --add-topic qimen --add-topic fengshui --add-topic tarot --add-topic iching \
  --add-topic astrology --add-topic divination --add-topic fortune-telling \
  --add-topic chinese-metaphysics --add-topic calculation-engine \
  --add-topic rest-api --add-topic openapi --add-topic agent-tools \
  --add-topic mcp --add-topic stateless --add-topic self-hosted \
  --add-topic nodejs --add-topic express
```
