# SCES-Server-Vercel — CLAUDE

学生综合素质测评管理系统（SCES）· 服务端（Vercel 部署版）。能力与 SCES-Server 一致：授权、配置下发、批次下发、状态同步、管理后台。

## 开发规范（必读，新会话遵守）

采用**简化版 Git Flow** 与 **Conventional Commits**，commit-msg 钩子强制；详情见 `CONTRIBUTING.md`。新会话新任务：先 `git fetch` + 从 develop 拉 `feature/*`/`bugfix/*`/`chore/*` 分支，阶段 commit（`<type>(<scope>): <subject>`，subject 祈使句、首字母小写、≤50 字符、句尾无句号），开发者确认后合并回 develop 并推送。

### 分支模型
- `main`（生产，绑定 Vercel，禁直推）、`develop`（日常默认分支）
- `feature/*`/`bugfix/*`/`chore/*`（从 develop 创建，合并回 develop）；`hotfix/*`（从 main 创建）

### 提交规范
格式：`<type>(<scope>): <subject>`；type ∈ feat/fix/docs/style/refactor/perf/test/chore/build/ci/revert；scope 可选小写（web/schema/openapi/docs/build/ci/deps）；subject ≤50 字符、小写祈使句、无句号。

### 红线
- 接口唯一权威 = SCES-Server `contracts/`（OpenAPI 3.1 + unit-config.schema.json）；本仓不重定义接口，契约改动先走 SCES-Server 的 `build` + `verify`。
- 数据主权：服务端不存分数明细/证明材料/私钥；`applyId`/`unitToken` 只存 SHA-256 哈希。
- 部署目标：Vercel（Node runtime + 托管 Postgres）；功能在后续里程碑实现。

## 状态
骨架已就绪（README/CONTRIBUTING/husky/commitlint）。服务端实现（web/、契约接入、部署配置）尚未建设。
