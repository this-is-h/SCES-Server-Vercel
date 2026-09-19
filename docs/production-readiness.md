# 接入前检查记录

检查日期：2026-09-19。范围：SCES-Server 权威契约、SCES-Server-Vercel 代码和构建、独立 Supabase staging 实库写入验收、生产结构迁移、Vercel API 发布及正式域名只读探针。

**结论：加固版本已发布，staging 实库验收和正式域名基础探针通过；完整业务接入验收仍未通过。** preview 与 production 已隔离。本次生产备份经项目所有者明确豁免（系统尚未上线）；一级审核、班级权限和容量等问题仍未闭环，不能据此宣称“满足所有生产需求”。

## 本次生产发布结果

- 来源：已经 PR #9 / #10 合并的 develop 提交 `4ced1d4a614ebd9c01b5541bb1ebd34e5fe8ea04`。
- 生产库执行 `0003_production_hardening.sql` 成功；迁移前 batch / apply_status 均为 0，重复活跃设备令牌组为 0。迁移后全部表启用 RLS，anon/authenticated 表权限为 0。
- 按所有者确认跳过本次生产备份，没有向生产导入种子、测试账号、批次或申请数据。
- 通过 Vercel API 从 preview 创建 production 构建，使用 production 环境变量。部署 `dpl_BxBzbejvaDMzMLqJV17xk944EWkK` 为 READY，并已绑定 `sces.thisish.cn`；不是把 preview 的 staging 变量带入生产。
- 正式域名只读验收：`/api/v1/health` 200、`/api/v1/health/ready` 200、未登录 `/api/v1/admin/units` 401、不存在的接口 404、`/admin/login` 200。API 包络、no-store、X-Request-Id 和 nosniff 均验证通过。
- 旧 production 部署 `dpl_8tw6cN2g6E1qRUfLH4pFxNeRoLjF` 保留为回退点，没有删除。脱敏本地发布凭据记录在 `.vercel/production-release.json`，不入库。
- 本次是部署和基础可用性验证；写入、并发和种子验收仍只在 staging 执行，没有用生产域名做写入压力测试。

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
| 服务端 GitHub CI / preview 构建 | 通过并合并 develop | PR #9，合并 6a7ba63；类型、契约、测试、构建、产物探针、供应链、gitleaks 均通过；preview 构建 READY 不代表实库连通 |
| 外部验收工作流 CI | 通过并合并 develop | PR #10，合并 4ced1d4；补充 3 项外部探针安全测试；其完整 CI 门禁通过 |
| production 结构迁移与发布 | 通过 | 0003 已执行；API 发布指定 develop commit，READY 且为当前 production |
| 正式域名 HTTP 验收 | 通过 | 5 项只读探针，readiness 200 证明实际 Vercel 运行时可访问生产 schema |

本机运行 Node 24.19.0，Vercel 项目 Node 24.x；已修正 Nitro 自动探测上限导致产物错误声明 Node 22 的问题，显式产物和 CI 均使用 Node 24。构建存在上游弃用/注释告警，但退出码为 0；字体网络依赖已关闭。

## 发布前历史检查与 staging 验收

以下为发布前的历史状态，生产当前结果以上一节为准。2026-09-19 通过 scripts/inspect-environment.mjs 核对：

- 项目 sces-server-vercel 存在 READY 的 production 和 preview 部署。
- 初查 DATABASE_URL、TOKEN_SIGNING_SECRET、ADMIN_INITIAL_PASSWORD 共用 production/preview 记录；已拆分 target，preview 使用 staging 及随机生成的独立密钥、初始密码，回读确认生产原值未改变。
- 用户提供的 STAGING_DATABASE_URL 已连接成功；按 Supabase 项目身份（同时识别直连/池化地址）核实与本地 DATABASE_URL、Vercel production 不同。新库初始 public schema 为空。
- Vercel production Git branch 配置为 main，但所有者确认实际使用 develop PR → preview → Vercel API 提升的流程；不以合并 main 为本次发布条件。旧 preview 部署仍可能使用旧配置，不能作为隔离验收目标。
- https://sces.thisish.cn/api/v1/health 返回 200。
- https://sces.thisish.cn/api/v1/health/ready 返回 404。
- https://sces.thisish.cn/admin/login 返回 200。
- 线上响应尚未包含本次新增的 X-Request-Id、X-Content-Type-Options；加固版本未上线。
- 本地 DATABASE_URL 指向的远程数据库只登记 0001_init.sql 和 0002_enable_rls.sql，11 张表启用 RLS，没有 batch.key_id、unit.config_template_id、rate_limit_bucket。
- 本地 DATABASE_URL 与 Vercel production 按项目身份核实为同一项目；staging 是另一项目。当前配置为 Supabase 直连，仅有 IPv6 DNS，Vercel 运行时连通性尚须验收。

在这一历史检查阶段，生产数据库尚未迁移、生产部署尚未改变。后续已按上一节完成 0003 和 API 发布。staging 已执行迁移、种子及验收写入；随机测试账号、单位、模板、批次、申请、会话及对应审计/限流记录已清理，三份标准种子保留。没有删除用户业务数据。

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
| 真实环境与容量 | preview 已隔离；生产 readiness 200；500 条 staging 同步 7.525 秒；共享限流 30 次/分钟/路由/IP 会阻挡同出口并发 | 截止峰值/校园 NAT 压测及限流策略调整，不能把基础探针或行为测试通过当成容量通过 |
| 历史数据升级 | 生产迁移完成；当前无批次/申请记录、模板单位归属一致；模板绑定可空并由服务端回退查找 | 后续导入历史数据时核对真实 keyId 与模板绑定，不猜测或伪造密钥标识 |
| 请求重试语义 | 续期、换机、重审不能仅靠 HTTP 重试证明恰好执行一次 | 验证响应丢失后的对账流程，定义幂等键或期望版本/轮次；客户端不得盲目重试不可幂等操作 |
| 生产恢复 | 本次首次发布经所有者确认无需备份，未完成 PostgreSQL 生产恢复演练；不再阻塞本次发布 | 有真实业务数据后建立备份/恢复策略，不把本次豁免视为永久取消备份 |
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

## 剩余业务接入事项

- 正式域名基础验收已通过；preview 访问保护不做降低，需要受保护 preview 自动化时再配置对应凭据。
- 本次生产迁移和 API 发布已完成，备份按所有者对尚未上线系统的明确说明跳过。
- 完成一级审核、班级最小权限、重试语义与校园限流的需求/实现闭环后再放行客户端生产接入。
- 后续继续通过 PR 合并 develop、生成 preview、Vercel API 提升 production；代码发布成功不等于上述业务缺口已经解决。

契约 PR：https://github.com/this-is-h/SCES-Server/pull/3（已合并 develop）。

服务端 PR：https://github.com/this-is-h/SCES-Server-Vercel/pull/9（全绿后合并 develop，6a7ba63）。修复分支 preview 为 `sces-server-vercel-ko2qcy07a-this-is-hs-projects.vercel.app`，Node 24、hkg1、构建 READY。本机访问该域名连接超时，外部 HTTP 验收未通过，不能把部署成功等同于服务可用；补充 GitHub 只读部署探针以区分本机网络和部署故障。

历史外部探针 https://github.com/this-is-h/SCES-Server-Vercel/actions/runs/35441663947 返回 4 个 302；Vercel 保护配置为 `all_except_custom_domains`，未关闭保护。随后按所有者指定的 API 发布流程，在正式域名完成了本报告顶部的只读验收，不再将 preview 自动化密钥作为本次发布前置条件。若后续需要受保护 preview 的自动化验收，可配置 Actions secret `VERCEL_AUTOMATION_BYPASS_SECRET`；不得发到聊天、workflow 输入或日志。
