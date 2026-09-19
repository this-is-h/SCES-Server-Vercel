# SCES-Server-Vercel 文档中心

学生综合素质测评管理系统（SCES）· 服务端（Vercel + Nuxt 全栈 + Supabase Postgres）。

## 文档目录

| 文档 | 内容 | 适合读者 |
|------|------|----------|
| [api.md](./api.md) | 全部 35 个 HTTP 端点详细版（由权威契约文档装配生成）：认证方式、每个接口的参数表/请求响应示例/错误码、限流、契约溯源 | 前端/客户端开发、联调 |
| [architecture.md](./architecture.md) | 架构与实现方式：Nuxt 全栈形态、Hono 桥接、请求生命周期、数据主权红线、认证与限流实现 | 维护者、评审 |
| [database.md](./database.md) | 数据库：12 张表结构、关系、级联规则、索引、迁移流程、隐私设计 | 维护者、DBA |
| [development.md](./development.md) | 开发指南：环境搭建、命令、测试体系、契约同步流程、Git 分支与提交规范 | 新加入的开发者 |
| [deployment.md](./deployment.md) | 部署与运维：Vercel 配置、Supabase 配置、环境变量、种子导入、域名与回滚 | 运维、发布负责人 |
| [production-readiness.md](./production-readiness.md) | 生产审查结论、已验证能力、部署前置条件与明确的范围边界 | 发布负责人、架构评审 |

## 30 秒概览

```
浏览器/客户端
   │
   ▼
Vercel（Nuxt 4 全栈，ssr: false）
   ├─ app/pages/admin/*      管理后台 SPA（Nuxt UI v4）
   └─ server/api/[...path].ts  → server/utils/app.ts（Hono 应用）
                                    ├─ routes/*   21 个业务接口 + 探活
                                    ├─ guards/*   单位令牌/授权校验/限流
                                    ├─ repos/*    SQL 仓储层
                                    └─ db/*       postgres.js（Supavisor 事务池）
                                          │
                                          ▼
                                    Supabase Postgres
```

  - **双仓协同**：Vercel 版为当前主力开发线；SCES-Server 为契约权威。契约改动请改 SCES-Server/contracts/openapi.yaml，再在 Vercel 仓执行 `pnpm sync:contracts` 重新生成 docs/api.md。
  - **数据主权红线**：服务端不存分数明细、证明材料、私钥；`applyId`/`unitToken`/`refreshToken` 只存 SHA-256 哈希。
  - **门禁**：`pnpm verify` = type-check + 契约比对 + Vitest；CI 另执行 `pnpm build:vercel` 和 `pnpm check:built-api`。实测记录见生产检查报告。
  - **部署形态**：Vercel（Nuxt 4 全栈 + Node runtime + Supabase Postgres）；域名 `sces.thisish.cn`。
