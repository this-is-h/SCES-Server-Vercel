# SCES-Server-Vercel — Agents — Agents

本仓库的 Claude Code 子代理约定（与 SCES-Server 同构，实现落地后补充 server-dev/server-review 等定义）。

## 当前重点

- 仓库骨架与约定已就绪（简化版 Git Flow + Conventional Commits + commit-msg 钩子）。
- 服务端实现尚未建设：计划以 SCES-Server 契约（`contracts/`）为唯一权威，Node（Fastify 同构）+ 托管 Postgres 部署到 Vercel，功能与 SCES-Server 一致。
- 红线：契约单一权威、数据主权（服务端不存分数明细/证明材料/私钥，applyId/unitToken 只存哈希）。
