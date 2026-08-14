# 这个 PR 做了什么

<!-- 一两句话说清楚改了什么、为什么。关联 issue 写 Closes #123 -->

## 类型

- [ ] `fix` 修 bug
- [ ] `feat` 新能力
- [ ] `docs` 文档
- [ ] `refactor` / `test` / `chore` / `ci`

## 如果动了算法

- [ ] 依据是：<!-- 典籍 / 流派 / 对照工具，没有依据的算法改动没法验证 -->
- [ ] 补了测试，且测试样例有典籍或流派依据
- [ ] 涉及流派选择的地方已就地注明，并同步进 `.claude/skills/bazi-cli/SKILL.md`
- [ ] 没有把「断语」硬编码进引擎（庙旺利陷、格局吉凶、神煞轻重留给调用方）

## 如果动了接口

- [ ] 更新了 `backend/services/apiSchema.service.js`
- [ ] 跑了 `npm -C backend run generate:openapi` 并**提交了** `docs/openapi.json`
- [ ] 同步更新了 `docs/api.md`
- [ ] 如果加了 CLI 命令：声明了 `effect` 与 `reproducibility`

## 如果动了配置 / 部署 / 模块边界

- [ ] 按 `docs/README.md` 的同步表改了对应文档
- [ ] `./scripts/check-docs.sh` 通过

## 验证

- [ ] `./bazi test` 全绿（cli + lint + backend + engine）
- [ ] `npm run format:check` 通过

<!-- 贴关键输出，或说明为什么某个目标跑不了。
     注意 ./bazi test 的目标被 skip 时也返回 0，请一并确认 summary.skipped -->

```

```

## 影响面与风险

<!-- 破坏性变更？改了默认口径？影响已有调用方？没有就写「无」 -->
