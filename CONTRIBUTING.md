# 开发约定

先说清楚这个项目的形态，能省下很多来回：这是一个**算法能力层**，以自部署 HTTP API +
程序化 CLI 交付。它没有前端，没有账号系统，没有数据库，引擎是无状态纯计算。
这个边界是刻意的，不是「还没做」——详见 [README 的项目定位](README.md#项目定位--project-snapshot)。

## 30 秒把环境跑起来

```bash
git clone https://github.com/tytsxai-stack/metaphysics-engine.git
cd metaphysics-engine
./bazi setup && ./bazi doctor && ./bazi stack up
./bazi test
```

只需要 Node.js 20+ 和 npm，不需要 Docker、数据库、Redis。
`./bazi doctor` 对每个失败项都会给出可以直接粘贴执行的修复命令。

用 `./bazi`，不要手搓 `node server.js`——手动起的进程 CLI 管不到，之后停不掉。
完整命令树：`./bazi help --json`（这是能力清单的唯一真源，文档刻意不重复它）。

## 动算法之前

这个项目最难的部分不是写代码，是**「写错了也不会报错」**：三传取法、安星链条、
拆补定局、游年翻卦、节气交接的时刻精度——错了不会抛异常，只会安静地给出一张错盘。
已经修掉的这类问题包括月令加倍误作用于月干（导致 22% 的盘旺衰判反）、
冬至跨年整段判错、时间起卦取数是编造的（见 [CHANGELOG.md](CHANGELOG.md)）。

所以改算法前先把问题归到哪一类，两类的处理方式完全不同：

| 情况         | 例子                               | 怎么处理                                             |
| ------------ | ---------------------------------- | ---------------------------------------------------- |
| **算错了**   | 三传取法漏了一个宗门、纳甲干支排错 | 是 bug，直接修，补测试                               |
| **流派不同** | 闰月归本月 vs 折半、晚子时换不换日 | 不是 bug。就地注明当前口径，必要时做成参数，不改默认 |

判定依据必须落到**流派或典籍**，不能只有「我记得是这样」。改动带的测试样例同样要有依据，
否则测试只是把当前实现又抄了一遍。

引擎的边界是**结构归引擎，断语归调用方**：盘怎么排有唯一正确答案，必须精准；
盘怎么解（庙旺利陷、奇门格局名目、神煞吉凶轻重）各家出入极大，刻意不塞进能力层。

已知的口径选择逐条写在
[.claude/skills/bazi-cli/SKILL.md](.claude/skills/bazi-cli/SKILL.md)——改算法之前先读这一份。

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

第 4、5 步是最容易漏的：`docs/openapi.json` 是接口消费者读的产物，
CI 会重新生成再 `git diff --exit-code`，不一致就直接失败。

改 CLI 本身之前，先读 SKILL.md 的「要改 CLI 本身的时候」那一节——
那里列的不是风格建议，是契约测试会当场拦下来的硬约束（`--json` 的 stdout 纯净度、
退出码语义、每条命令必须声明副作用等级与可复现性）。

### 本地质量门槛

提交前把这些跑绿，跟 CI 是同一套：

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
6. backend 测试 + CLI 契约测试（22.x 那条腿另跑覆盖率门槛）
7. 拿真实引擎验证能力契约里声明的可复现性
8. 构建生产镜像，并**以生产模式、且不配 Redis** 起容器做冒烟：探针、鉴权默认值、
   一次真实排盘、SIGTERM 退 0

第 8 条是独立的 `image` job，因为它守的是前七条都看不见的东西：上面全部跑在源码
检出、开发或测试模式下，而运维实际部署的是镜像、跑的是 `NODE_ENV=production`。
这个盲区里曾同时躺着两个已发布的缺陷——`backend/Dockerfile` 还在 COPY 早已删掉的
`prisma/`（镜像根本构建不出来），以及生产模式下不配 `REDIS_URL` 会让 `/health`、
`/api/ready`、`/metrics` 全部 500（负载均衡永远不会把流量放进来）。两个都在一片
全绿的测试里活了下来。容器不继承 runner 的 `CI=true`，看到的就是真实生产环境。

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

### 改动自查清单

- [ ] `./bazi test` 全绿，`npm run format:check` 通过
- [ ] 动了接口 → 重新生成并提交了 `docs/openapi.json`
- [ ] 动了算法 → 补了测试，且测试样例有典籍或流派依据
- [ ] 涉及流派选择 → 在代码里就地注明，并同步进 SKILL.md
- [ ] 动了行为/配置/部署方式 → 同步更新了对应文档
- [ ] 一次提交只做一件事

### 不做的改动

不是质量问题，是边界问题：

- 往仓库里塞前端代码或 UI 框架
- 加回账号系统、数据库、会话、历史记录、收藏
- 把「断语」硬编码进引擎（庙旺利陷表、奇门格局吉凶、神煞轻重）
- 为了迎合某一流派而改默认口径，且不保留原口径
- 大规模无关重构、或引入没有明确收益的新依赖

带 React 前端的 Web 全栈社区版（公开仓库 [tytsxai/bazi-master](https://github.com/tytsxai/bazi-master)，
冻结在 `v0.2.0`）与本仓库是两条完全隔离、互不同步的独立代码库：本仓库不共享、不采用那条线的任何
代码、数据或资产。不要试图把两边的改动搬来搬去。授权边界见 [LICENSE](LICENSE)。
