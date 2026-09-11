# 部署与运维

> 生产形态：Vercel（Nuxt Node runtime，git 集成自动部署）+ Supabase Postgres（Supavisor 事务池）。域名 `sces.thisish.cn`。

## 目录

- [初次部署清单](#初次部署清单)
- [环境变量](#环境变量)
- [Supabase 配置](#supabase-配置)
- [Vercel 配置](#vercel-配置)
- [日常发布流程](#日常发布流程)
- [种子导入](#种子导入)
- [运维操作手册](#运维操作手册)
- [故障排查](#故障排查)
- [免费层额度与限制](#免费层额度与限制)

---

## 初次部署清单

1. **Supabase**：建项目 → 取事务池连接串（步骤见下）
2. **Vercel**：导入 GitHub 仓库 → 框架选 Nuxt（自动识别）→ 配置环境变量（见下）
3. **数据库迁移**：本地 `pnpm db:migrate`（读 .env 的 DATABASE_URL）
4. **首次登录**：配置 `ADMIN_INITIAL_PASSWORD` 后访问 `/admin/login`，用 `admin` + 该密码登录（服务端自动建号），**立即改密**
5. **导入种子**：`node scripts/import-seeds.mjs`（单位/模板/授权码）
6. **改密后**可从 Vercel 删除 `ADMIN_INITIAL_PASSWORD`（仅首次建号用）

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | ✅ | Supavisor **事务池**连接串（端口 6543），形如 `postgres://postgres.<ref>:<pw>@<region>.pooler.supabase.com:6543/postgres` |
| `TOKEN_SIGNING_SECRET` | ✅ | 后台 JWT 的 HMAC 密钥；生成 `openssl rand -hex 32`；**轮换会使全部 accessToken 立即失效**（refreshToken 不受影响） |
| `ADMIN_INITIAL_PASSWORD` | 首次 | ≥8 位；空库时首次 login 自动建 `admin` 号（mustChangePassword=true）；建号后可删 |

Vercel 侧 target 建议 `production + preview`；本地放 `.env`（已 gitignore）。

## Supabase 配置

连接串取法：Project Settings → Database → Connection string → **Transaction pooler**。

- 必须用**事务池**（6543）而非会话池（5432）——serverless 每实例连接少且短命；
- 客户端已配置 `prepare: false`（事务池不支持预处理语句，`db/client.ts` 已设）+ `max: 1`（每实例一连接，池侧复用）+ `ssl: require`；
- 迁移可走事务池（DDL 幂等，`schema_migrations` 表记录版本）。

## Vercel 配置

- **Git 集成**：`develop` → `main` 合并触发生产部署；PR 触发 preview 部署。也可手动触发：

  ```sh
  # scripts/vercel-cli.mjs 包装了 token（从 .env VERCEL_TOKEN 读）
  # 或直接调 API：
  POST https://api.vercel.com/v13/deployments
  { "name": "sces-server-vercel", "target": "production",
    "gitSource": { "type": "github", "org": "...", "repo": "SCES-Server-Vercel", "ref": "develop" } }
  ```

- **注意**：仅 push develop 不一定触发 production（仓库 Git 设置决定）；以 API 手动触发为准。
- 构建产物：`.output/`（Nitro）；无额外 build 配置需求。

## 日常发布流程

```
1. develop 上 feature/* 合并 → pnpm verify 全绿
2. 若涉及契约/DDL：先走契约仓流程 → pnpm sync:contracts → pnpm db:migrate
   （迁移先行：新代码上线前旧库结构必须就位）
3. develop → main 合并（或 API 手动部署 develop）
4. 部署后冒烟：GET /api/v1/health + /admin/login 可达
5. 回滚：Vercel 控制台 Promote 上一个 READY 部署（秒级）；数据库回滚需手动（迁移幂等但无 down）
```

## 种子导入

```sh
set -a && source .env && set +a
node scripts/import-seeds.mjs                 # 全部（contracts/seed/*.json）
node scripts/import-seeds.mjs test-1          # 指定种子
SEED_LICENSE_NXU_LX=XXXX-XXXX-XXXX-XXXX node scripts/import-seeds.mjs lixing-shuyuan
```

幂等性：单位/模板按主键冲突跳过；单位已有 active 授权码则跳过签发。可安全重复执行。

## 运维操作手册

### 管理员密码重置

无法自助（无邮件通道）。用服务端直连数据库更新：将 scrypt 新哈希写入 `admin_user.password_hash` 并置 `must_change_password=1`。生成哈希可临时复用 `server/utils/lib/hash.ts` 的 `hashPassword`（Node REPL）。改密后记得删其 refresh_token 行。

### 作废某书院授权

后台 UI（单位详情 → 授权码 → 作废）或 API。级联：该码全部 unitToken 立即失效，书院端下次请求 401。

### 书院换机超频放行

后台「换机记录」页 → `pending` 行 → 放行（作废旧码按剩余期签发新码）或拒绝。

### 数据备份

Supabase 免费层无自动 PITR。建议周期性 `pg_dump`（事务池连接串可用 `psql`/`pg_dump --no-prepared-statements`）；数据量小（仅状态与模板），全量导出成本低。

### 审计追溯

后台「审计日志」页（游标分页），或直接查 `audit_log` 表（含 IP 与 target）。保留策略：当前无自动清理，免费层存储上限内可长期保留。

## 故障排查

| 症状 | 排查 |
|------|------|
| `health` 200 但业务接口全 500 | `DATABASE_URL` 失效/密码轮换；Vercel Functions 日志看 postgres 连接错误 |
| 登录 401 但密码正确 | `TOKEN_SIGNING_SECRET` 是否与签发时不一致（JWT 校验失败）；或账号被删 |
| 书院端突然全 401 | 授权码被作废/过期（查 `license.status`），或单位被禁用 |
| `expiresAt` 变字符串 | 检查是否绕过了 `db/client.ts`（直连 postgres.js 未配 `types.bigint.parse`） |
| 429 频繁 | 实例内存限流的正常行为；同一出口 IP 共享 30 次/分钟额度 |
| UI 全白无样式 | 检查 `app/assets/css/main.css` 第一行是否为 `@import "tailwindcss"`（缺失则 utility 类全丢，构建产物 CSS 仅 ~9KB；正常应 ~190KB+） |

## 免费层额度与限制

| 资源 | 免费额度 | 本应用特征 |
|------|----------|------------|
| Vercel Functions | 100 GB-hrs/月 | `max: 1` 连接、轻查询；余量大 |
| Vercel 带宽 | 100 GB/月 | 后台 SPA + JSON API；余量大 |
| Supabase 数据库 | 500 MB | 仅状态/模板/审计；长期瓶颈是 audit_log（可周期归档清理） |
| Supabase egress | 5 GB/月 | JSON 响应小；余量大 |
| 限流 | 实例内存 | 多实例独立计数（如实语义，见 architecture.md 权衡表） |
