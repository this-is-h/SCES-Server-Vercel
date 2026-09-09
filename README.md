# SCES-Server-Vercel — 服务端（Vercel 部署版）

学生综合素质测评管理系统（SCES）· 服务端，面向 **Vercel 托管**的部署形态，接口能力与 [SCES-Server](https://github.com/this-is-h/SCES-Server)（linux/windows 自部署版）一致：授权、配置下发、批次下发、状态同步、管理后台。

> 契约唯一权威在 SCES-Server 仓库（`contracts/`，OpenAPI 3.1 + unit-config schema + 种子 + DDL）；两套服务端实现逐字段对齐契约，不重复定义接口。

## 状态

- 仓库骨架已就绪（约定、钩子、校验），**服务端实现尚未建设**（计划与 SCES-Server 的 `web/`（Fastify + PostgreSQL）共用契约与业务设计，按 Vercel 平台能力落地部署形态：Node runtime 无服务器函数 + 托管 Postgres，见后续设计文档）。
- 暂无服务器/暂不便自部署时，本仓库产物可直接托管于 Vercel（git 集成：`develop`→`main` 合并触发生产部署，PR 触发预览）。

## 约定（新会话必读）

- 本仓库采用**简化版 Git Flow** + **Conventional Commits**，由 husky/commitlint 钩子强制。分支模型与提交规范见 `CONTRIBUTING.md`。
- `main` 绑定 Vercel 生产部署，禁止直推；日常开发在 `develop`，任务从 develop 拉 `feature/*`/`bugfix/*`/`chore/*` 分支，完成后合并回 develop。
- 契约改动流程：先改 SCES-Server/`contracts`（openapi.yaml / unit-config.schema.json），`build` + `verify` 通过后同步到本实现；本仓**不改**契约源。

## 目录形态（规划）

| 路径 | 形态 | 状态 |
|------|------|------|
| `contracts/` | `@sces/contracts` git 依赖（非子目录，引用 SCES-Server 仓库 tag） | 实现时接入 |
| `api/`（或 web/） | Vercel 无服务器函数（Node + 托管 Postgres） | 尚未建设 |

## 常用命令

```sh
pnpm install
# 实现落地后：
# pnpm build / pnpm verify / pnpm test
```
