# SCES-Server-Vercel — 服务端（Vercel 部署版）

学生综合素质测评管理系统（SCES）· 服务端，面向 **Vercel 托管**的部署形态，接口能力与 [SCES-Server](https://github.com/this-is-h/SCES-Server)（linux/windows 自部署版）一致：授权、配置下发、批次下发、状态同步、管理后台。

> 契约唯一权威在 SCES-Server 仓库（`contracts/`：OpenAPI 3.1 + unit-config schema + 种子 + DDL）。本仓 `contracts/` 是**受控镜像**（脚本同步、勿手改），两套服务端实现逐字段对齐契约，不重复定义接口。

## 部署形态

| 层 | 选型 | 说明 |
|----|------|------|
| 框架 | **Nuxt 4**（Vercel 官方支持 Full-stack framework） | API 与管理后台同仓同源部署；页面 SPA 模式（`ssr: false`），按需可经 `routeRules` 开 SSR |
| API | Nitro catch-all（`server/api/[...path].ts`） | `toWebRequest()` 桥接 Hono 应用分发 `/api/v1/**`；契约行为不变 |
| 数据库 | Supabase Postgres（免费版） | Supavisor **事务池**连接串（端口 6543），`prepare: false`；DDL 见 `supabase/migrations/`（`schema-web.sql` 逐字节镜像） |
| 文件存储 | 不使用 | 契约无文件接口；数据主权红线：服务端不存分数明细、证明材料、任何私钥 |
| 密钥面 | 仅 `DATABASE_URL` + `TOKEN_SIGNING_SECRET` | 不走 PostgREST/anon key，DB 访问用池化连接串 |

## 状态

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| M0 骨架 | health 探活、契约镜像与比对、迁移镜像、verify 门禁 | 已完成 |
| M1 单位与授权 | 接口 1–4：`authorize`、`public-key`、`rebind`、`license/status`；令牌只存哈希、换机月限 3 次、审计 | 已完成 |
| M2 批次与申请 | 接口 5–13：批次创建/状态/下发、学生端注册与查询、批量状态、新一轮审核、公开单位树；严格限流已挂授权/注册/查询 | 已完成（63 用例通过） |
| M2.5 全栈化 | 迁移 Nuxt 4 全栈框架：API（Hono 桥接）+ 管理后台同仓同源；生产已上线 `sces.thisish.cn` | 已完成 |
| M3 后台 | 接口 14–21 + 管理后台前端（Nuxt UI：单位/授权码、配置模板与配置查看、批次、换机、审计日志）；种子导入脚本 `import-seeds`；契约新增 `GET /admin/templates/{id}/versions/{version}/{revision}/config` | 已完成（95 用例通过，生产已验证） |
| M4 加固 | 契约对齐测试收口、部署链路验证（需 Supabase/Vercel 凭证） | 待建 |

`GET /api/v1/health` 已可用（返回 `architecture: "web"`：本实现与 SCES-Server `web/` 同属 Node + PostgreSQL 架构）。

## 目录形态

| 路径 | 职责 |
|------|------|
| `nuxt.config.ts`、`app/` | Nuxt 配置与管理后台页面（SPA，`app/pages/admin/`） |
| `server/api/[...path].ts` | Nitro catch-all：桥接 `/api/**` 到 Hono 应用 |
| `server/utils/` | Hono 业务层：`app.ts`/`routes/`（装配与路由）、`db/`+`repos/`（SQL 抽象与仓储）、`lib/`+`http/`（哈希、错误、鉴权守卫、审计）、`schemas/`（zod） |
| `contracts/` | 契约受控镜像（openapi/unit-config schema/种子/双方言 DDL，勿手改） |
| `supabase/migrations/` | 建库 DDL 的 Supabase 载体（`schema-web.sql` 逐字节副本） |
| `scripts/` | `sync-contracts` / `check-contracts` / `apply-migrations` / `vercel-cli`（token 包装） |
| `tests/` | vitest：PGlite 跑同一份 DDL 的集成用例 + 契约红线断言 |

## 命令

```sh
pnpm install
pnpm verify            # type-check + 契约比对 + 测试（提交前门禁）
pnpm test              # vitest（PGlite 真实 Postgres 语义）
pnpm sync:contracts    # 从 SCES-Server/contracts 同步镜像（SCES_CONTRACTS_SOURCE 可覆盖源）
pnpm db:migrate        # 把 supabase/migrations/*.sql 执行到 DATABASE_URL（幂等，可重放）
```

本地开发：`pnpm exec nuxt dev`（管理后台 http://localhost:3000/admin，API 同源 `/api/v1/**`）；环境变量见 `.env.example`（`DATABASE_URL` 用 **Transaction pooler** 连接串）。

## 约定（新会话必读）

- 简化版 Git Flow + Conventional Commits（husky/commitlint 强制）；分支模型与提交规范见 `CONTRIBUTING.md`。
- `main` 绑定 Vercel 生产部署，禁止直推；日常开发在 `develop`，任务从 develop 拉 `feature/*`。
- 契约改动流程：先改 SCES-Server `contracts`（`build` + `verify`）→ 本仓 `pnpm sync:contracts` → 实现与测试对齐；`pnpm check:contracts` 会把关镜像未被手改、且未落后于权威源。
- 数据主权红线：`applyId` / `unitToken` 只存 SHA-256 哈希；不存分数明细、证明材料、私钥。
