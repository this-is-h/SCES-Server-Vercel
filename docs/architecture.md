# 架构与实现

> 版本基线：Nuxt 4.5 + Hono 4.9 + postgres.js 3.4 + @nuxt/ui 4.11；契约 OpenAPI 3.1（权威：SCES-Server `contracts/`）。

## 目录

- [总体形态](#总体形态)
- [请求生命周期](#请求生命周期)
- [分层与目录职责](#分层与目录职责)
- [关键实现](#关键实现)
- [数据主权红线](#数据主权红线)
- [测试体系](#测试体系)
- [已知权衡（决策记录）](#已知权衡决策记录)

---

## 总体形态

```
┌─────────────────────────────── Vercel ───────────────────────────────┐
│  Nuxt 4 应用（Node runtime，ssr: false）                              │
│                                                                      │
│  app/                        server/                                 │
│  ├─ pages/admin/*  (SPA)     ├─ api/[...path].ts  ← 唯一服务端入口    │
│  └─ composables/*            └─ utils/                               │
│                                  ├─ app.ts      Hono 应用工厂         │
│                                  ├─ routes/*    接口层（契约冻结）     │
│                                  ├─ http/       守卫/限流/解析        │
│                                  ├─ repos/*     SQL 仓储层            │
│                                  ├─ schemas/*   zod + Ajv2020        │
│                                  ├─ lib/        token/hash/audit     │
│                                  └─ db/         postgres.js 客户端    │
└──────────────────────────────────────┬───────────────────────────────┘
                                       │ TLS / Supavisor 事务池
                                       ▼
                              Supabase Postgres
```

**为什么是 Nuxt + Hono 双栈**（决策记录，见 `server/api/[...path].ts` 注释）：

- Nuxt 提供 Vercel 官方支持的全栈形态，管理后台 UI（`app/pages/admin/`）与 API 同仓同源部署；
- API 业务层保持 Hono——它受 OpenAPI 契约冻结、有完整契约测试，迁移到 h3 文件路由无收益。Hono handler 即 web 标准 fetch 接口，`h3` 的 `toWebRequest` 原生桥接，两层零适配。

管理后台是登录后内部系统：`ssr: false`（纯 SPA，省服务函数调用，免费额度敏感）。

## 请求生命周期

以 `POST /api/v1/authorize` 为例：

```
1. Vercel Node runtime 收到请求
2. Nuxt server route server/api/[...path].ts
   └─ toWebRequest(event) → app.fetch()（h3 → Hono 零适配桥接）
3. Hono 中间件链（app.ts createHonoApp 工厂）：
   a. 注入 db 到 context（c.set('db', ...)）
   b. 严格限流（authorize/login/register/query 四端点，先于路由注册）
4. 路由 handler（routes/authorize.ts）：
   a. zod strict 解析请求体（失败 → ApiError 400）
   b. 仓储层查询/事务（repos/，经事务保证多表写入原子性）
   c. 组装契约响应包络 { ok: true, data }
5. 错误出口（app.onError）：
   ApiError  → { ok: false, error } + 对应状态码
   其他异常  → console.error + 500 通用文案（不泄露内部信息）
```

生产单例：`app.ts` 底部 `export default createHonoApp({ db: lazyDb })`——模块级创建一次，Vercel 实例内复用；`lazyDb` 延迟到首次查询才建连（冷启动友好）。

## 分层与目录职责

| 层 | 目录 | 职责 | 禁止 |
|----|------|------|------|
| 入口桥接 | `server/api/[...path].ts` | h3 → Hono | 业务逻辑 |
| 接口层 | `server/utils/routes/*` | 请求解析（zod）、编排、响应组装 | 直接写 SQL |
| 守卫/横切 | `server/utils/http/*` | 单位令牌校验、授权可用性断言、限流、IP 解析 | — |
| 仓储层 | `server/utils/repos/*` | SQL 与行类型；事务在接口层编排 | HTTP 概念 |
| Schema | `server/utils/schemas/*` | zod 请求 schema；unit-config Ajv2020 校验 | — |
| 基础库 | `server/utils/lib/*` | admin-token（HS256）、hash（scrypt/SHA-256/授权码）、audit、jwk、errors | — |
| DB 客户端 | `server/utils/db/*` | postgres.js 封装（类型化 query/transaction）、BIGINT→number 对齐 | 业务 SQL |
| UI | `app/pages/admin/*` + `composables` | 管理后台 SPA（Nuxt UI v4） | SQL/契约逻辑 |

依赖方向：`routes → repos → db`，`routes → http/lib`；仓储层不 import HTTP 概念。

## 关键实现

### 认证体系（三套令牌）

| 令牌 | 算法/存储 | TTL | 失效时机 |
|------|-----------|-----|----------|
| 单位令牌 unitToken | 明文仅下发一次；库中 `token_hash`（SHA-256，UNIQUE） | 跟随授权码 `expires_at` | 换机（旧 installId 全失效）、授权码作废（级联）、单位删除（级联） |
| 后台访问令牌 accessToken | HS256 JWT（`TOKEN_SIGNING_SECRET`），无状态 | 15 分钟 | 自然过期（刷新换新） |
| 后台刷新令牌 refreshToken | 明文仅下发一次；库中 SHA-256 | 30 天 | 登出（删全部）、改密（删全部）、删除（过期惰性） |

实现：`server/utils/lib/admin-token.ts`（sign/verify）、`server/utils/http/guards.ts`（`requireUnitToken` 联表校验令牌→授权→单位三级状态）、`server/utils/routes/admin-auth.ts`（后台会话）。

密码：scrypt（`scrypt$N$r$p$salt$hash` 格式，`timingSafeEqual` 比对）。首次启动且配置 `ADMIN_INITIAL_PASSWORD` 时自动建 `admin` 号并强制改密。

### 限流

`http/rate-limit.ts`：实例内固定窗口，键 `(path, clientIp)`，60s/30 次，惰性清理防膨胀。有状态中间件在 `createHonoApp` 工厂内创建——每个应用实例独立计数（测试与部署互不串扰）。多实例语义限制见 [api.md 限流节](./api.md#限流)。

### 契约校验（unit-config）

`schemas/unit-config.ts`：Ajv2020 编译运行时镜像 `schemas/unit-config.schema.json`（`sync:contracts` 同步、`check:contracts` 逐字节把关），与契约侧 verify-seeds 同编译方式——**上传校验强度与契约校验完全一致**，两处 schema 不会漂移。

### 前台会话（管理后台）

`app/composables/useAdminAuth.ts`：accessToken 仅内存 `useState`（不落 localStorage，降低 XSS 面）；refreshToken 存 sessionStorage（标签页级）；`api()` 包装函数 401 时自动刷新并**重放原请求一次**（并发 401 单飞，`refreshing` promise 去重）。

### BIGINT 序列化对齐

postgres.js 默认把 BIGINT 列返回为 `string`，PGlite 返回 `number`——测试全绿但生产 `expiresAt` 会变字符串（真实踩过的坑）。`db/client.ts` 配置 `types.bigint.parse: Number`，两驱动行为对齐，契约 `EpochMs: number` 全链路成立。

## 数据主权红线

契约与架构共同约束（`tests/schema.test.ts` 有红线断言）：

1. **不存分数明细、证明材料、私钥**——学生数据以 `.dyf` 加密文件为载体，服务端只有状态机与公钥；
2. **隐私哈希化**：`applyId → apply_id_hash`、`unitToken → token_hash`、`refreshToken → token_hash`，明文仅下发一次，服务端不可逆推；
3. **applyId 接口防枚举**：未知 id 返回 `status: "unknown"` 而非 404，并挂严格限流。

## 测试体系

| 维度 | 实现 |
|------|------|
| 运行时 | **PGlite**（WASM Postgres）跑与生产**同一份 DDL**（`supabase/migrations/0001_init.sql`，即契约 schema-web.sql 镜像）——测试库结构 = 生产库结构 |
| 隔离 | 每用例独立内存库 + 独立 Hono 实例（`createHonoApp({ db })`），限流计数互不串扰 |
| 覆盖 | 96 用例：契约行为（包络/错误文案/状态码）、状态机单调性、限流触发、数据主权红线断言、BIGINT 类型对齐 |
| 门禁 | `pnpm verify` = type-check + 契约镜像逐字节比对 + vitest 全量 |

## 已知权衡（决策记录）

| 决策 | 理由 | 代价/缓解 |
|------|------|-----------|
| 限流为实例内存 | 免费层无共享存储 | 多实例独立计数；语义如实记录，不假装全局 |
| ssr: false | 后台内部系统无需 SEO；省函数调用 | 无 SSR 优势；可接受 |
| Hono 而非 h3 文件路由 | 契约冻结 + 测试资产保护 | 一层 12 行桥接文件 |
| `max: 1` 连接池 | Supavisor 事务池模式每实例一连接 | 并发靠池侧复用 |
| 刷新令牌不轮换 | 简化客户端 | 泄露窗口 30 天；改密/登出即失效 |
| schema 以受控镜像进 `server/utils/schemas/` | Nitro 不打包 repo 根 `contracts/` | `check:contracts` 保证与镜像逐字节一致 |
