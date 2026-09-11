# SCES-Server-Vercel — CLAUDE

学生综合素质测评管理系统（SCES）· 服务端（Vercel 部署版）。能力与 SCES-Server 一致：授权、配置下发、批次下发、状态同步、管理后台。

## 开发规范（必读，新会话遵守）

采用**简化版 Git Flow** 与 **Conventional Commits**，commit-msg 钩子强制；详情见 `CONTRIBUTING.md`。新会话新任务：先 `git fetch` + 从 develop 拉 `feature/*`/`bugfix/*`/`chore/*` 分支，阶段 commit（`<type>(<scope>): <subject>`，subject 祈使句、首字母小写、≤50 字符、句尾无句号），开发者确认后合并回 develop 并推送。

### 分支模型
- `main`（生产，绑定 Vercel，禁直推）、`develop`（日常默认分支）
- `feature/*`/`bugfix/*`/`chore/*`（从 develop 创建，合并回 develop）；`hotfix/*`（从 main 创建）

### 提交规范
格式：`<type>(<scope>): <subject>`；type ∈ feat/fix/docs/style/refactor/perf/test/chore/build/ci/revert；scope 可选小写（web/api/contracts/db/admin/schema/openapi/docs/build/ci/deps）；subject ≤50 字符、小写祈使句、无句号。

### 红线
- 契约唯一权威 = SCES-Server `contracts/`（OpenAPI 3.1 + unit-config.schema.json）；**双仓同批共改**：契约问题（如 `unit_type` 去留）直接在 SCES-Server 契约改（`build` + `verify`），同批 `pnpm sync:contracts` 落到本仓（`docs/api.md` 随之再生成），实现/测试对齐后两仓一起提交。
- 数据主权：服务端不存分数明细/证明材料/私钥；`applyId`/`unitToken` 只存 SHA-256 哈希。
- 部署目标：Vercel（Nuxt 全栈 + Node runtime + Supabase 托管 Postgres）。

## 状态
**文档中心**：`docs/index.md`（API / 架构 / 数据库 / 开发 / 部署五册，新会话查文档先看这里）。
**Nuxt 4 全栈框架**（Vercel 官方支持）：API 与管理后台同仓同源，生产 `sces.thisish.cn`。入口 `server/api/[...path].ts` 把 `/api/**` 桥接给 Hono 应用（`server/utils/`，含路由/仓储/守卫/审计）；管理后台页面在 `app/pages/admin/`（SPA，**Nuxt UI v4**：`app.vue` 壳 UDashboardGroup + 侧栏；页面：单位/授权码、配置模板（含配置内容查看）、批次、换机记录、审计日志、登录/改密）。契约受控镜像（`contracts/`，`sync:contracts` + `check:contracts`）；建库迁移镜像（`supabase/migrations/`，`db:migrate`）；种子导入 `scripts/import-seeds.mjs`（幂等，`contracts/seed/*.json` → 单位+模板+授权码）。已实现接口 1–21 全量，96 条用例覆盖。待建：M4 加固收尾。
