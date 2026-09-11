# 开发指南

## 目录

- [环境搭建](#环境搭建)
- [常用命令](#常用命令)
- [契约同步流程](#契约同步流程)
- [测试体系](#测试体系)
- [代码规范](#代码规范)
- [Git 分支与提交](#git-分支与提交)
- [常见问题](#常见问题)

---

## 环境搭建

```sh
# 依赖：Node 20+ / pnpm 10+
pnpm install

# 环境变量（Supabase 控制台取值，见 deployment.md）
cp .env.example .env
# DATABASE_URL=<Supavisor 事务池连接串>
# TOKEN_SIGNING_SECRET=<openssl rand -hex 32>
# ADMIN_INITIAL_PASSWORD=<≥8 位，仅本地开发用>
```

本地跑两个进程即可开发：

```sh
pnpm exec nuxt dev        # http://localhost:3000（后台 /admin，API /api/v1/**）
```

无本地 Postgres 需求——开发库直接用 Supabase（或本地起 PGlite 脚本自测）；**测试**完全不需要外部数据库（PGlite WASM 内存库）。

## 常用命令

| 命令 | 作用 |
|------|------|
| `pnpm dev`（即 `nuxt dev`） | 本地开发服务器（UI + API 同源） |
| `pnpm test` | vitest 全量（96 用例，无需外部服务） |
| `pnpm type-check` | tsc --noEmit |
| `pnpm verify` | **门禁** = type-check + check:contracts + test |
| `pnpm sync:contracts` | 从 SCES-Server/contracts 同步受控镜像（SCES_CONTRACTS_SOURCE 可覆盖源路径） |
| `pnpm check:contracts` | 校验镜像未被手改且未落后权威源 |
| `pnpm db:migrate` | 幂等应用迁移到 Supabase（读 .env DATABASE_URL） |
| `node scripts/import-seeds.mjs [name…]` | 导入 `contracts/seed/*.json`（单位+模板+授权码），幂等 |

**提交前必须 `pnpm verify` 全绿**（pre-commit 钩子会跑 type-check，commit-msg 校验提交格式）。

## 契约同步流程

> **双仓协同**：Vercel 仓为当前主力开发线；SCES-Server 为契约权威。契约改动请改 SCES-Server/contracts/openapi.yaml，再在 Vercel 仓执行 `pnpm sync:contracts` 重新生成 docs/api.md。

接口/DDL/schema 的唯一权威在 **SCES-Server 仓库 `contracts/`**。改动流程：

```
1. SCES-Server 仓库：改 contracts/openapi.yaml（或 schema-web.sql / unit-config.schema.json）
   → pnpm --filter @sces/contracts build   # 生成 api-contract.md / 种子
   → pnpm --filter @sces/contracts verify  # 四链校验（种子/OpenAPI/DDL/文档）
   → 提交合并到 SCES-Server develop
2. Vercel 仓：pnpm sync:contracts          # 同步镜像（contracts/ + supabase/migrations/ + 运行时 schema）
3. Vercel 仓：实现/调整 routes + repos + 测试
4. pnpm verify 全绿后提交
```

`pnpm check:contracts` 逐字节比对镜像与 manifest——**手改镜像会被拦下**；落后权威源同样报错（改了 SCES-Server 却忘了 sync 属同类问题，同批提交即可避免）。

新增端点三件事（参考 `DELETE /admin/units/{unitId}` 的完整示例）：

1. 契约 openapi.yaml 加 path + `verify-openapi.mjs` 的 `EXPECTED` 清单加行（契约侧两个提交）；
2. `routes/*.ts` 实现（zod strict 解析 + repos 编排 + `recordAudit` 落审计）；
3. `tests/*.test.ts` 加用例（包络、错误文案、状态码逐项断言）。

## 测试体系

```
tests/
├─ helpers/
│  ├─ db.ts         # PGlite 内存库：跑与生产同一份 0001_init.sql
│  ├─ fixtures.ts   # seedTestUnit（一级+二级+授权码+published 模板）/ loadTestSeed
│  ├─ http.ts       # readData / readError（解契约包络）
│  └─ stub-db.ts    # 故障注入（事务失败路径）
├─ admin-auth.test.ts     # 接口 14–17：会话生命周期/改密/首登建号
├─ admin-manage.test.ts   # 接口 18–21：单位/授权码/模板/运维（21 用例）
├─ authorize.test.ts      # 接口 1：核验/换机失效/过期
├─ batches.test.ts        # 接口 5/6/11：状态机/唯一性/下发
├─ apply-status.test.ts   # 接口 7/8/9/12/13：状态单调/轮次/隐私
├─ license-status.test.ts # 接口 4
├─ public-key.test.ts     # 接口 2：JWK 校验
├─ rebind.test.ts         # 接口 3：月限/超频 pending
├─ schema.test.ts         # 数据主权红线（列清单白名单）
└─ health.test.ts
```

写用例的约定：

- **每用例独立 PGlite + 独立 Hono 实例**（`createHonoApp({ db: ctx.db })`），限流计数互不串扰；
- 断言契约**可观察行为**（包络、错误文案、状态码、副作用行数），不断言实现细节；
- 涉及隐私的红线（哈希列、无明文列）在 `schema.test.ts` 用列清单白名单把关，新表/新列必须同步更新白名单。

## 代码规范

- **TypeScript strict**（`tsc --noEmit` 门禁）；仓储层行类型显式声明（`ConfigTemplateRow` 等）；
- 请求体一律 `z.strictObject`（多传字段即 400，契约 additionalProperties: false 对齐）；
- 错误处理：业务错误抛 `ApiError(status, 中文文案)`，由 `app.onError` 统一出口；仓储层不抛 HTTP 错误；
- SQL：仓储层模板字符串 + 参数化（禁止拼接用户输入）；时间戳一律 `Date.now()` epoch ms；
- UI：Nuxt UI v4 组件优先；服务端契约错误文案经 `extractApiError` 透传给用户（`app/utils/api-error.ts`）。

## Git 分支与提交

简化版 Git Flow + Conventional Commits（husky 强制）：

```
main      生产，绑定 Vercel，禁直推
develop   日常默认分支（PR 指向这里）
feature/* bugfix/* chore/*   从 develop 拉，完成合回 develop
hotfix/*  从 main 拉，合回 main 与 develop
```

提交格式：`<type>(<scope>): <subject>`——subject ≤50 字符、小写祈使句、无句号；scope 可选（api/admin/contracts/db/docs/deps…）。commitlint 拒绝违规提交。

## 常见问题

**Q：测试全绿但生产行为不一致？**
先查驱动差异：postgres.js 与 PGlite 的类型映射（BIGINT→string 是踩过的坑，已在 `db/client.ts` 的 `types.bigint.parse` 对齐）。新增列时用真实 postgres.js 连接验证一次线类型。

**Q：限流在本地怎么触发？**
60 秒 30 次，键 `(path, ip)`；重启 dev server 即清零（内存计数）。

**Q：如何新增管理后台页面？**
`app/pages/admin/<name>.vue` + `definePageMeta({ title })`（navbar 标题自动取）；侧栏菜单在 `app/app.vue` 的 `items` 里加一项；API 调用统一走 `useAdminAuth().api()`（401 自动刷新重放）。

**Q：种子数据从哪来？**
`contracts/seed/*.json`（权威：SCES-Server 契约仓）。`pnpm sync:contracts` 镜像后，`node scripts/import-seeds.mjs` 幂等导入生产：一级+二级单位、published 模板、授权码（已有有效码则跳过；`SEED_LICENSE_<UNITID>` 环境变量可指定码值）。
