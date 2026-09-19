# 接入前检查记录

检查日期：2026-09-19。范围：SCES-Server 权威契约、SCES-Server-Vercel 代码和构建、独立 Supabase staging 实库写入验收、Vercel 配置隔离与生产只读探针。

**结论：本地验证及 staging 实库脚本通过，正式接入验收仍未通过。** preview 配置已与 production 隔离；真实 Vercel 部署验收、生产备份恢复及业务权限闭环尚待完成。不能据此宣称“满足所有生产需求”。

## 已实际执行

| 检查 | 实际结果 | 证据与限制 |
|---|---|---|
| 锁定依赖安装 | 通过 | 两仓使用 Corepack 调用 pnpm 10.9.0；服务端补充直接依赖 tailwindcss 4.3.3 |
| 契约 build + verify | 通过 | 种子 1010、OpenAPI 1213、双方言 DDL 1496、文档 2407 项断言；35 个操作 |
| 服务端 pnpm verify | 通过 | 类型检查、9 个镜像比对、15 个测试文件，123 项测试全部通过；JSON 传输修正后另跑 29 项针对性回归通过 |
| Vercel 生产构建 | 通过 | Nuxt 4.5.2 / Nitro 2.13.4；生成 .vercel/output；约 3.35 MB 函数产物 |
| 构建产物 HTTP 检查 | 通过 | 实际 Nitro/Hono listener 在回环地址运行，9 项检查；包含 Node 24 产物声明，故障测试不连接远程库 |
| 生产依赖漏洞审计 | 通过 | pnpm audit --prod --audit-level high，npm 官方接口返回 No known vulnerabilities found |
| 初次迁移、旧结构升级、重复执行 | 通过（本地） | 使用生产迁移 runner 和 PGlite；版本时间戳为 BIGINT |
| 迁移失败回滚 | 通过（本地 + staging） | 故意失败后 DDL 与迁移版本记录均回滚 |
| 全部种子导入与重复导入 | 通过（本地 + staging） | 三份种子；重复导入不重复签发授权 |
| staging 首次迁移、并发 runner、重复执行 | 通过 | 空 public schema 应用 0001–0003；并发第二个 runner 跳过已执行版本；12 张表均启用 RLS |
| 三进程真实 API 联调 | 通过 | 实际构建 listener，独立进程/连接；刷新竞争只有一方成功，激活、模板发布、注册/版本推进通过 |
| 500 条批量同步 | 通过（指定拓扑） | 本机 HTTP → 远程 PostgreSQL：首次请求 7525 ms；重复请求、反序重叠并发均通过，不是 Vercel 压测 |
| 共享限流 | 通过（行为检查） | 三进程、同 IP 35 次查询：30 成功、5 次 429 且有 Retry-After；不代表校园容量达标 |
| 备份恢复 | 通过（仅 PGlite 本地快照） | 恢复到独立实例，核对单位、模板、授权、审计、限流、迁移记录；**不是 Supabase/pg_dump 生产恢复演练** |
| Vercel 配置与线上探针 | 已隔离配置、生产只读核对 | 三项 preview 凭据独立，生产原值不变；已有部署不会自动更新配置 |
| 契约 GitHub CI / gitleaks | 通过并合并 develop | SCES-Server PR #3，合并 2bddcd0；契约构建、供应链、密钥扫描通过 |
| 服务端 GitHub CI / preview | 待 PR 验证 | 不直接推送 main、不手动发布 develop 到生产 |

本机运行 Node 24.19.0，Vercel 项目 Node 24.x；已修正 Nitro 自动探测上限导致产物错误声明 Node 22 的问题，显式产物和 CI 均使用 Node 24。构建存在上游弃用/注释告警，但退出码为 0；字体网络依赖已关闭。

## 环境隔离与实库验收

2026-09-19 通过 scripts/inspect-environment.mjs 核对：

- 项目 sces-server-vercel 存在 READY 的 production 和 preview 部署。
- 初查 DATABASE_URL、TOKEN_SIGNING_SECRET、ADMIN_INITIAL_PASSWORD 共用 production/preview 记录；已拆分 target，preview 使用 staging 及随机生成的独立密钥、初始密码，回读确认生产原值未改变。
- 用户提供的 STAGING_DATABASE_URL 已连接成功；按 Supabase 项目身份（同时识别直连/池化地址）核实与本地 DATABASE_URL、Vercel production 不同。新库初始 public schema 为空。
- Vercel production branch 实测为 main。现有旧 preview 部署仍可能使用旧配置，不能作为隔离验收目标；必须验证新 Git 部署。
- https://sces.thisish.cn/api/v1/health 返回 200。
- https://sces.thisish.cn/api/v1/health/ready 返回 404。
- https://sces.thisish.cn/admin/login 返回 200。
- 线上响应尚未包含本次新增的 X-Request-Id、X-Content-Type-Options；加固版本未上线。
- 本地 DATABASE_URL 指向的远程数据库只登记 0001_init.sql 和 0002_enable_rls.sql，11 张表启用 RLS，没有 batch.key_id、unit.config_template_id、rate_limit_bucket。
- 本地 DATABASE_URL 与 Vercel production 按项目身份核实为同一项目；staging 是另一项目。当前配置为 Supabase 直连，仅有 IPv6 DNS，Vercel 运行时连通性尚须验收。

生产数据库未执行迁移或写入，生产代码/别名未改变，也未取得生产备份。staging 已执行迁移、种子及验收写入；随机测试账号、单位、模板、批次、申请、会话及对应审计/限流记录已清理，三份标准种子保留。没有删除用户业务数据。

最新通过的实库运行：2026-09-19 11:24:16–11:27:16 UTC，10 项检查全部通过，脱敏报告在本地 `.vercel/staging-acceptance.json`（不入库）。可通过 `pnpm check:staging` 重现；脚本验证隔离，遇到已有但未升级的 schema 拒绝自动迁移，需先备份。

实测失败记录也保留在验收结论中：首次并发注册曾失败，后续多次通过但不能消除广域网下的偶发风险；原逐项事务批量请求超过 240 秒；集合写入首版被 postgres.js 二次 JSON 编码导致 500。这两项批量问题已修复并在最新实库运行中通过。验收数据装载脚本早期漏写 created_at 的错误也已修正，不计为业务接口缺陷。

## 本轮检查发现并修复

- 迁移引导表错误使用 INTEGER 存毫秒时间；事务池上使用会话锁：改为 BIGINT 与 pg_advisory_xact_lock，DDL 和迁移记录同事务提交。
- 实际生产构建缺少 tailwindcss 直接依赖；字体模块使构建依赖外网：补齐依赖，按 Nuxt UI 的依赖解析顺序关闭字体模块。
- 新刷新令牌未在后台页面保存；多组件可重复刷新；登出刷新后仍提交旧凭证：统一单飞刷新、持久化轮换令牌、登出重试重新读取凭证。
- JWT exp 使用毫秒：改为标准秒，API 的 accessTokenExpiresAt 保持毫秒；登录、刷新、改密的账号锁顺序一致。
- 配置模板上传错误绑定父级单位、重复草稿上传触发唯一冲突：改为绑定配置中的单位并限定草稿更新；发布使用事务锁。
- 首次注册与新审核轮次缺少稳定锁对象：同 applyId 的写入使用事务级锁；批量与单条共用推进逻辑；错误结果不返回其他批次的状态和版本。
- 历史 keyId 被自动伪造：取消默认值；历史记录如实返回 null，新建批次严格必填。批次创建仅接受正式的 { batch: ... }。
- 种子脚本遇到过期授权仍重复签发：每份种子原子导入，保留未作废授权；不再打印授权码。
- OpenAPI 批量结果 allOf 与 additionalProperties:false 冲突：声明独立结果对象；readiness 加入契约校验清单。
- 原测试只执行初始 DDL：改为执行全部迁移，并新增真实 runner、旧结构升级和恢复测试。
- 500 条批量同步有上千次 SQL 网络往返：改为按实际 advisory lock 键排序加锁、集合读取、共享业务校验和集合写入，普通写入事务内固定 3 次查询；业务错误逐项返回，基础设施故障整批回滚。新轮次审计与写入同事务。
- postgres.js 对预序列化 JSON 再编码而 PGlite 不会：先绑定 text 再转 jsonb，实库检查该传输差异，避免仅单测绿而线上 500。

本次没有修改桌面管理端、学生小程序或班级客户端。服务端仓库自带管理后台的会话适配已随 API 变更修复。

## 业务流程覆盖与未闭合项

新增 tests/preintegration.test.ts 验证：首次改密强制执行、改密令牌失效、一次性刷新并发、单位创建到模板发布与激活、三次换机及超限审批、授权到期后续期、申请开始/截止时间、重复注册、版本回退、跨批次隔离、批次包装/keyId、历史 keyId、单位停用、单条/批量一致性及重审禁止重新导入。tests/admin-session.test.mjs 直接测试后台会话封装。

单元测试使用 PGlite；新增实库脚本覆盖 PostgreSQL 多进程锁竞争及真实驱动，但仍不能替代 Supavisor 断连、Vercel 冷启动、学校共用出口下的规模压测。

正式接入前还必须关闭以下问题：

| 项目 | 当前证据 | 所需结果 |
|---|---|---|
| 一级审核权限流程 | assertLevelOne 检查 unitLevel=1；签发授权接口只接受 level=2；测试通过直接插入一级授权和模板来验证重审 | 明确“单位层级”与“审核角色”的关系，提供可通过正式接口取得权限的流程，取消依赖手工插库的验收方式 |
| 班级端最小权限 | 单位令牌仅含 unitId/installId/licenseCode/unitLevel，无班级 scope；同单位凭证拥有整个单位写权限 | 明确班级端是否联网写入；若是，补齐班级授权、范围校验、撤销与越权测试，不能共享单位主令牌 |
| 真实环境与容量 | preview 已隔离；500 条实库同步 7.525 秒；共享限流 30 次/分钟/路由/IP 已证实会阻挡同出口并发 | Vercel 新部署验收、截止峰值/校园 NAT 压测及限流策略调整，不能把行为测试通过当成容量通过 |
| 历史数据升级 | 新列可空，历史 keyId 和模板绑定未必齐全 | 在 staging 统计缺失/错属记录，根据实际密钥映射修复；不能自动猜测 keyId |
| 请求重试语义 | 续期、换机、重审不能仅靠 HTTP 重试证明恰好执行一次 | 验证响应丢失后的对账流程，定义幂等键或期望版本/轮次；客户端不得盲目重试不可幂等操作 |
| 生产恢复 | 仅完成 PGlite 本地恢复；本机没有可用 pg_dump，Docker daemon 未运行 | 使用兼容 PostgreSQL 工具备份并恢复到隔离库，记录恢复时间、权限和关键行核对结果 |
| 运维访问 | 单一管理员基本会话已验证，未实现角色划分/MFA/SSO/自助找回 | 按实际运维人数与访问边界确定是否需要；多操作员不得共用超管账号 |

另外，列表分页、审计与业务写入的全面原子性、完整公钥强度校验、监控告警、统一机器错误码、限流入口防护和在线数据保留策略仍需按生产验收范围继续审查。本报告不是全量安全审计认证。

## 可复用命令

在 SCES-Server 执行：

~~~powershell
corepack pnpm@10.9.0 --filter @sces/contracts build
corepack pnpm@10.9.0 --filter @sces/contracts verify
~~~

在 SCES-Server-Vercel 执行：

~~~powershell
corepack pnpm@10.9.0 sync:contracts
corepack pnpm@10.9.0 verify
corepack pnpm@10.9.0 build:vercel
corepack pnpm@10.9.0 check:built-api
corepack pnpm@10.9.0 check:staging
corepack pnpm@10.9.0 audit --prod --audit-level high --registry=https://registry.npmjs.org/
node scripts/inspect-environment.mjs
~~~

check-built-api 强制连接关闭的回环端口验证故障行为，不会连生产库；构建产物扫描只检查本地已知密钥是否出现在公开文件，不替代完整 gitleaks 扫描。

## 剩余发布门禁

- 服务端 PR 的 CI、gitleaks 与实际 preview HTTP 验收。
- 使用兼容 PostgreSQL 工具取得生产备份并恢复到独立目标；再审核历史模板/keyId 映射与生产迁移。
- 完成一级审核、班级最小权限、重试语义与校园限流的需求/实现闭环后再放行客户端生产接入。
- release PR（develop → main）必须等待上述门禁；不能因本地或 staging 脚本通过而直接上线。

契约 PR：https://github.com/this-is-h/SCES-Server/pull/3（已合并 develop）。服务端 PR 与新 preview 结果将在执行后追加。
