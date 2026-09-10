# 贡献指南（SCES-Server-Vercel · 服务端 Vercel 部署版）

采用简化版 Git Flow 与 Conventional Commits（约定式提交），由钩子与 CI 强制落地（与 SCES-Server 同规）。

## 分支模型
| 分支 | 生命周期 | 用途 |
|---|---|---|
| main | 永久 | 生产分支，绑定 Vercel 生产部署（git 集成）；**禁止直接提交/推送**，只接受 develop→main 的发布合并 |
| develop | 永久 | 日常开发主分支（默认分支），所有 PR 指向这里 |
| feature/* / bugfix/* / chore/* | 短期 | 从 develop 创建，完成合并回 develop |
| hotfix/* | 短期 | 从 main 创建，完成合并回 main 与 develop |

规则：分支名须符合前缀（CI 拒违规）；develop/main 开保护（强制 PR + 状态检查；main 禁直推）。

## 提交规范（commit-msg 强制）
格式 `<type>(<scope>): <subject>`；type ∈ feat/fix/docs/style/refactor/perf/test/chore/build/ci/revert；
scope 小写（web/api/contracts/db/admin/schema/openapi/docs/build/ci/deps）；
subject ≤50 字符、小写、祈使句、句尾无句号；header ≤72。

## 钩子与 CI 门禁
- `commit-msg`：commitlint（消息格式不合规直接拒绝；pre-commit/CI 门禁随实现落地后补）。
- CI（实现落地后）：编译 + 契约一致性校验 + `pnpm audit`(high) + gitleaks + 分支名校验。

## 接口一致性（红线）
对外接口以 SCES-Server `contracts/` 为唯一权威；本仓改动接口前必须先到 SCES-Server 改契约并 `build` + `verify`，再同步实现。数据主权红线同 SCES-Server：不存分数明细/证明材料/私钥，`applyId`/`unitToken` 只存 SHA-256 哈希。
