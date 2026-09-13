# API 接口文档（详细版）

> **零改写装配**：接口详情逐字取自权威契约文档 SCES-Server/contracts/api-contract.md（由 openapi.yaml 生成，勿手改本文档；契约改动请改 openapi.yaml 后在 SCES-Server 执行 `pnpm --filter @sces/contracts build`，再本仓 `pnpm sync:contracts` 重新生成）。
> 双仓同改约定：Vercel 版为当前主力开发线；发现契约问题（如字段冗余 unit_type、枚举口径变化）时，直接修改 SCES-Server/contracts 并随同一批变更同步到本仓，两个服务端实现随之对齐。

## 本仓差异说明

| 项 | 权威契约描述 | Vercel 版实际 |
|----|--------------|---------------|
| 服务地址 | http://127.0.0.1:3100（server/web）/ 8787（cloudflare） | 本地 `http://localhost:3000`；生产 `https://sces.thisish.cn` |
| 架构标识 | `architecture` 返回 `web` / `cloudflare` | 健康检查固定返回 `web`（`server/utils/constants.ts`） |
| 限流实现 | 平台差异，契约不断言 | 内存固定窗口 60s/30 次，键 (path, IP)：`POST /authorize`、`POST /admin/auth/login`、`POST /applies/:id/register`、`GET /applies/:id`（`server/utils/app.ts`） |
| 令牌签发 | — | accessToken HS256 15 分钟（`ACCESS_TOKEN_TTL_MS`）；refreshToken 30 天仅存哈希 |

## 通用约定

- 路径版本化：`/api/v1/*`。
- 响应统一包裹：成功 `{ "ok": true, "data": ... }`，失败 `{ "ok": false, "error": "中文描述" }`。
- 错误文案一律为**简体中文**（管理端 `server-client.ts` 直接透传给用户）。
- 时间戳统一为 epoch 毫秒整数。
- 服务端**不存储**分数明细、证明材料与任何私钥（数据主权原则）。

## 鉴权

| 角色 | 方式 | 说明 |
|------|------|------|
| 管理端写接口 | `Authorization: Bearer <unitToken>` | 激活时下发，绑定 unitId + installId，随授权码作废/换机失效（决策 #29） |
| 管理端标识头 | `X-Unit-Id` / `X-Install-Id` | 辅助标识与审计，**不作为信任凭证** |
| 学生端 | 路径中的 `applyId` | 122 bit 随机 UUID，服务端只存 SHA-256 哈希 + 严格限流（决策 #40） |
| 管理后台 | `Authorization: Bearer <accessToken>` | 15 分钟短期 token，配可删除的刷新 token（决策 #40） |

## 状态机

- 批次：`draft → active → closed`，单向推进。
- 申请：单轮内 `draft → submitted → imported → reviewing → confirmed`，**不允许回退**；
  整班重审由一级发起新一轮（`review_round + 1`，从 `reviewing` 开始，决策 #30/#31）。

## 服务地址

| 地址 | 说明 |
|------|------|
| `http://127.0.0.1:3100` | 本地开发（server/web） |
| `http://127.0.0.1:8787` | 本地开发（server/cloudflare，wrangler dev） |
| `https://{host}` | 生产部署 |

## 接口索引

| 接口 | 方法 | 路径 | 鉴权 |
|------|------|------|------|
| 探活 | `GET` | `/api/v1/health` | 无（公开 / 凭证在路径参数） |
| 授权码核验（接口 1） | `POST` | `/api/v1/authorize` | 无（公开 / 凭证在路径参数） |
| 单位公钥上报（接口 2） | `POST` | `/api/v1/units/{unitId}/public-key` | `unitToken` |
| 更换授权设备（接口 3） | `POST` | `/api/v1/units/rebind` | `unitToken` |
| 授权状态拉取（接口 4） | `GET` | `/api/v1/license/status` | `unitToken` |
| 批次创建上报（接口 5） | `POST` | `/api/v1/batches` | `unitToken` |
| 批次状态同步（接口 6） | `POST` | `/api/v1/batches/{batchId}/status` | `unitToken` |
| 批量申请状态上报（接口 7） | `POST` | `/api/v1/batches/{batchId}/apply-statuses` | `unitToken` |
| 申请状态上报（接口 8） | `POST` | `/api/v1/applies/{applyId}/status` | `unitToken` |
| 发起新一轮审核（接口 9） | `POST` | `/api/v1/applies/{applyId}/review-rounds` | `unitToken` |
| 公开单位树（接口 10） | `GET` | `/api/v1/units/public` | 无（公开 / 凭证在路径参数） |
| 活跃批次下发（接口 11） | `GET` | `/api/v1/batches/active` | 无（公开 / 凭证在路径参数） |
| 学生端注册申请（接口 12） | `POST` | `/api/v1/applies/{applyId}/register` | 无（公开 / 凭证在路径参数） |
| 申请状态查询（接口 13） | `GET` | `/api/v1/applies/{applyId}` | 无（公开 / 凭证在路径参数） |
| 后台登录（接口 14） | `POST` | `/api/v1/admin/auth/login` | 无（公开 / 凭证在路径参数） |
| 刷新访问令牌（接口 15） | `POST` | `/api/v1/admin/auth/refresh` | 无（公开 / 凭证在路径参数） |
| 后台登出（接口 16） | `POST` | `/api/v1/admin/auth/logout` | `adminToken` |
| 修改后台密码（接口 17） | `POST` | `/api/v1/admin/auth/change-password` | `adminToken` |
| 单位列表（接口 18） | `GET` | `/api/v1/admin/units` | `adminToken` |
| 创建单位（接口 18） | `POST` | `/api/v1/admin/units` | `adminToken` |
| 单位详情（接口 18） | `GET` | `/api/v1/admin/units/{unitId}` | `adminToken` |
| 删除单位（接口 18） | `DELETE` | `/api/v1/admin/units/{unitId}` | `adminToken` |
| 签发授权码（接口 19） | `POST` | `/api/v1/admin/units/{unitId}/licenses` | `adminToken` |
| 作废授权码（接口 19） | `POST` | `/api/v1/admin/licenses/{code}/revoke` | `adminToken` |
| 续期授权码（接口 19） | `POST` | `/api/v1/admin/licenses/{code}/renew` | `adminToken` |
| 配置模板列表（接口 20） | `GET` | `/api/v1/admin/templates` | `adminToken` |
| 上传配置模板（接口 20） | `POST` | `/api/v1/admin/templates` | `adminToken` |
| 模板版本历史（接口 20） | `GET` | `/api/v1/admin/templates/{templateId}/versions` | `adminToken` |
| 查看模板配置内容（接口 20） | `GET` | `/api/v1/admin/templates/{templateId}/versions/{version}/{revision}/config` | `adminToken` |
| 发布模板版本（接口 20） | `POST` | `/api/v1/admin/templates/{templateId}/publish` | `adminToken` |
| 批次列表（接口 21） | `GET` | `/api/v1/admin/batches` | `adminToken` |
| 换机记录列表（接口 21） | `GET` | `/api/v1/admin/rebinds` | `adminToken` |
| 放行超频换机（接口 21） | `POST` | `/api/v1/admin/rebinds/{rebindId}/approve` | `adminToken` |
| 审计日志（接口 21） | `GET` | `/api/v1/admin/audit-logs` | `adminToken` |

## 接口详情

### 健康检查

运维探活

#### 探活

`GET /api/v1/health`

运维探活接口，不计入 21 个业务接口。返回服务标识与当前时间。

鉴权：无（公开接口，或以路径中的 `applyId` 为凭证）

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 服务正常 | 对象（status / now / architecture） |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `status` | `"ok"` | 是 |  |
| `now` | `EpochMs` | 是 | epoch 毫秒时间戳。 |
| `architecture` | `"web"` \| `"cloudflare"` | 是 | 当前实现架构标识。 |

`200` 响应示例（default）：

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "now": 1755500000000,
    "architecture": "web"
  }
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

### 授权

管理端激活、公钥上报、换机、授权状态

#### 授权码核验（接口 1）

`POST /api/v1/authorize`

管理端激活入口。核验授权码，成功后下发：
- `unitToken`：写接口的 Bearer 凭证，绑定 unitId + installId（决策 #29）
- `license`：有效期与状态，与客户端本地激活信息对应
- `configTemplate`：该二级单位的完整配置（§4.2 结构）

同一授权码重复激活同一 `installId` 时幂等返回新 token；
换到新 `installId` 须走 `POST /api/v1/units/rebind`。

鉴权：无（公开接口，或以路径中的 `applyId` 为凭证）

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `X-Install-Id` | header | 是 | `string` | 管理端安装实例 id（换机识别与审计）。 |

请求体（必填）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `code` | `LicenseCode` | 是 | 授权码（大写字母数字分组）。 |

请求示例（default）：

```json
{
  "code": "A1B2-C3D4-E5F6-G7H8"
}
```

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 激活成功 | 对象（unit / unitToken / license / configTemplate） |
| `400` | 参数错误 | `{ ok: false, error }` |
| `403` | 授权码无效 / 已作废 / 已过期 | `{ ok: false, error }` |
| `429` | 限流（平台差异，不做契约测试断言，决策 §7.4） | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `unit` | `UnitSummary` | 是 | 单位摘要（激活响应与后台列表共用）。 |
| `unitToken` | `string` | 是 | 单位令牌明文，仅此一次返回；服务端只存哈希。 |
| `license` | `LicenseInfo` | 是 |  |
| `configTemplate` | `UnitConfig` | 是 | 单位配置（一个二级单位一份，含单位/班级/学生字段/德育分项目/计算/排名）。 结构由 `unit-config.schema.json` 单独定义，两套实现与两端共用同一份 schema。 |

`400` 响应示例（default）：

```json
{
  "ok": false,
  "error": "请求参数不合法"
}
```

`403` 响应示例（invalid）：

```json
{
  "ok": false,
  "error": "授权码无效"
}
```

`403` 响应示例（revoked）：

```json
{
  "ok": false,
  "error": "授权码已作废"
}
```

`403` 响应示例（expired）：

```json
{
  "ok": false,
  "error": "授权已过期，请联系服务商续期"
}
```

`429` 响应示例（default）：

```json
{
  "ok": false,
  "error": "操作过于频繁，请稍后再试"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 单位公钥上报（接口 2）

`POST /api/v1/units/{unitId}/public-key`

管理端激活/换机后上报本单位公钥（RSA-OAEP-256 JWK）。
私钥永不上报（§3.2 红线）。重复上报同一公钥幂等；上报不同公钥覆盖旧值并落审计。

鉴权：`unitToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `unitId` | path | 是 | `UnitId` | 单位 id。 |
| `X-Unit-Id` | header | 是 | `UnitId` | 当前激活的二级单位 id（辅助标识与审计）。 |
| `X-Install-Id` | header | 是 | `string` | 管理端安装实例 id（换机识别与审计）。 |

请求体（必填）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `publicKeyJwk` | `Jwk` | 是 | 公钥 JWK（RSA-OAEP-256）。私钥永不进入服务端。 |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 上报成功 | 对象（ok） |
| `400` | 参数错误 | `{ ok: false, error }` |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `403` | 令牌与路径单位不匹配，或授权已失效 | `{ ok: false, error }` |
| `404` | 资源不存在 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ok` | `true` | 是 |  |

`200` 响应示例（default）：

```json
{
  "ok": true,
  "data": {
    "ok": true
  }
}
```

`400` 响应示例（default）：

```json
{
  "ok": false,
  "error": "请求参数不合法"
}
```

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`403` 响应示例（mismatch）：

```json
{
  "ok": false,
  "error": "授权校验未通过，请重新激活"
}
```

`404` 响应示例（default）：

```json
{
  "ok": false,
  "error": "资源不存在"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 更换授权设备（接口 3）

`POST /api/v1/units/rebind`

自助换机（决策 #40）：服务端当场作废旧授权码、签发新码并返回，管理端随后注销本机。
每单位每月上限 3 次；超频返回 403 并生成 `pending` 换机记录，需后台手动放行。

鉴权：`unitToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `X-Unit-Id` | header | 是 | `UnitId` | 当前激活的二级单位 id（辅助标识与审计）。 |
| `X-Install-Id` | header | 是 | `string` | 管理端安装实例 id（换机识别与审计）。 |

请求体（可选）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `reason` | `string` | 否 | 换机原因（审计用）。 |

请求示例（default）：

```json
{
  "reason": "原设备损坏"
}
```

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 换机成功，返回新授权码 | 对象（ok / code / expiresAt / monthCount） |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `403` | 授权已失效，或本月换机次数超限 | `{ ok: false, error }` |
| `429` | 限流（平台差异，不做契约测试断言，决策 §7.4） | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ok` | `true` | 是 |  |
| `code` | `LicenseCode` | 是 | 新签发的授权码。 |
| `expiresAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |
| `monthCount` | `integer` | 是 | 本月已用换机次数（含本次）。 |

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`403` 响应示例（超出月限）：

```json
{
  "ok": false,
  "error": "本月更换设备次数已达上限，请联系服务商"
}
```

`429` 响应示例（default）：

```json
{
  "ok": false,
  "error": "操作过于频繁，请稍后再试"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 授权状态拉取（接口 4）

`GET /api/v1/license/status`

管理端定期拉取当前授权有效期与状态，用于过期提醒与续期后刷新（决策

鉴权：`unitToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `X-Unit-Id` | header | 是 | `UnitId` | 当前激活的二级单位 id（辅助标识与审计）。 |
| `X-Install-Id` | header | 是 | `string` | 管理端安装实例 id（换机识别与审计）。 |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 当前授权状态 | 对象（code / expiresAt / status / unit） |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `403` | 无权限 / 已失效 / 已过期 / 已截止 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `code` | `LicenseCode` | 是 | 授权码（大写字母数字分组）。 |
| `expiresAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |
| `status` | `LicenseStatus` | 是 | 授权状态。 |
| `unit` | `UnitSummary` | 是 | 单位摘要（激活响应与后台列表共用）。 |

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`403` 响应示例（授权已过期）：

```json
{
  "ok": false,
  "error": "授权已过期，请联系服务商续期"
}
```

`403` 响应示例（申请已截止）：

```json
{
  "ok": false,
  "error": "申请已截止"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

### 批次

批次登记、状态同步、活跃批次下发

#### 批次创建上报（接口 5）

`POST /api/v1/batches`

管理端创建批次后上报公开字段（不含私钥）。同 `batchId` 重复上报幂等返回现有记录。
正式批次（`isTest: false`）在同一单位的同一 `(year, semester)` 唯一，重复创建返回 409。
配置模板以 (id, version, revision) 三元组快照引用（决策 #37）。

鉴权：`unitToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `X-Unit-Id` | header | 是 | `UnitId` | 当前激活的二级单位 id（辅助标识与审计）。 |
| `X-Install-Id` | header | 是 | `string` | 管理端安装实例 id（换机识别与审计）。 |

请求体（必填）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `batch` | 对象（batchId / year / semester / isTest / applyStartAt / applyEndAt / calcMode / calcConfig / publicKeyJwk / configTemplateId / configTemplateVersion / configTemplateRevision） | 是 |  |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 登记成功（或幂等返回现有批次） | 对象（batchId / status / createdAt） |
| `400` | 参数错误 | `{ ok: false, error }` |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `403` | 无权限 / 已失效 / 已过期 / 已截止 | `{ ok: false, error }` |
| `409` | 同单位同学年学期已有正式批次 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `batchId` | `BatchId` | 是 | 批次 id（UUID v4）。 |
| `status` | `BatchStatus` | 是 | 批次状态（单向推进）。 |
| `createdAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |

`400` 响应示例（default）：

```json
{
  "ok": false,
  "error": "请求参数不合法"
}
```

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`403` 响应示例（授权已过期）：

```json
{
  "ok": false,
  "error": "授权已过期，请联系服务商续期"
}
```

`403` 响应示例（申请已截止）：

```json
{
  "ok": false,
  "error": "申请已截止"
}
```

`409` 响应示例（duplicate）：

```json
{
  "ok": false,
  "error": "该学年学期已存在正式批次"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 批次状态同步（接口 6）

`POST /api/v1/batches/{batchId}/status`

管理端激活/关闭批次后同步状态（决策 #33）。`draft → active → closed` 单向推进；
同状态重复上报幂等返回 200，回退返回 409。
**本接口是学生端能拉到活跃批次的前提**。

鉴权：`unitToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `batchId` | path | 是 | `BatchId` | 批次 id（UUID v4，管理端生成）。 |
| `X-Unit-Id` | header | 是 | `UnitId` | 当前激活的二级单位 id（辅助标识与审计）。 |
| `X-Install-Id` | header | 是 | `string` | 管理端安装实例 id（换机识别与审计）。 |

请求体（必填）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `status` | `BatchStatus` | 是 | 批次状态（单向推进）。 |

请求示例（activate）：

```json
{
  "status": "active"
}
```

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 状态已更新（或幂等） | 对象（batchId / status / updatedAt） |
| `400` | 参数错误 | `{ ok: false, error }` |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `403` | 无权限 / 已失效 / 已过期 / 已截止 | `{ ok: false, error }` |
| `404` | 资源不存在 | `{ ok: false, error }` |
| `409` | 状态回退被拒 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `batchId` | `BatchId` | 是 | 批次 id（UUID v4）。 |
| `status` | `BatchStatus` | 是 | 批次状态（单向推进）。 |
| `updatedAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |

`400` 响应示例（default）：

```json
{
  "ok": false,
  "error": "请求参数不合法"
}
```

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`403` 响应示例（授权已过期）：

```json
{
  "ok": false,
  "error": "授权已过期，请联系服务商续期"
}
```

`403` 响应示例（申请已截止）：

```json
{
  "ok": false,
  "error": "申请已截止"
}
```

`404` 响应示例（default）：

```json
{
  "ok": false,
  "error": "资源不存在"
}
```

`409` 响应示例（rollback）：

```json
{
  "ok": false,
  "error": "批次状态不允许回退"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 活跃批次下发（接口 11）

`GET /api/v1/batches/active`

学生端启动时按**二级单位**拉取当前活跃批次与完整配置（决策 #34）。
活跃批次 = `status = 'active'` 且（`applyEndAt` 为空或 `applyEndAt >= now`）。
同单位存在多个活跃批次时：**正式批次优先**，其次取 `createdAt` 最新。
无活跃批次时返回 `batch: null`（不是 404）。

鉴权：无（公开接口，或以路径中的 `applyId` 为凭证）

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `unitId` | query | 是 | `UnitId` | 二级单位 id。 |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 活跃批次（可能为空） | 对象（batch / configTemplate） |
| `400` | 参数错误 | `{ ok: false, error }` |
| `404` | 单位不存在 | `{ ok: false, error }` |
| `429` | 限流（平台差异，不做契约测试断言，决策 §7.4） | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `batch` | `BatchPublic` \| `null` | 是 |  |
| `configTemplate` | `UnitConfig` \| `null` | 否 | 批次快照对应的配置版本；`batch` 为 null 时省略。 |

`200` 响应示例（无活跃批次）：

```json
{
  "ok": true,
  "data": {
    "batch": null
  }
}
```

`400` 响应示例（default）：

```json
{
  "ok": false,
  "error": "请求参数不合法"
}
```

`404` 响应示例（default）：

```json
{
  "ok": false,
  "error": "单位不存在"
}
```

`429` 响应示例（default）：

```json
{
  "ok": false,
  "error": "操作过于频繁，请稍后再试"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

### 申请状态

申请状态同步、学生端注册与查询、新一轮审核

#### 批量申请状态上报（接口 7）

`POST /api/v1/batches/{batchId}/apply-statuses`

供整班导出（`confirmed`）与整班新一轮审核批量使用（决策 #32）。
逐条返回结果，整批不因个别失败而回滚，失败项由客户端重试。

两种语义由 `startNewRound` 区分：
- **省略或 false（同轮推进）**：单条语义与 `POST /api/v1/applies/{applyId}/status`
  一致，单轮内单向推进，真正回退的条目返回 `ok:false`（不影响其余）。
- **true（跨轮开启新一轮）**：等价于对每个 `applyId` 调用接口 9，
  `reviewRound = N + 1`、状态置 `reviewing`（决策 #30/#31，取代管理端 revokeBatchExport）。
  此时 `status` 必须为 `reviewing`。仅单位主令牌（激活端 / 一级）可调用。

`applyIds` 单批上限 500；上千人整班需分片调用，各片幂等可重试。

鉴权：`unitToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `batchId` | path | 是 | `BatchId` | 批次 id（UUID v4，管理端生成）。 |
| `X-Unit-Id` | header | 是 | `UnitId` | 当前激活的二级单位 id（辅助标识与审计）。 |
| `X-Install-Id` | header | 是 | `string` | 管理端安装实例 id（换机识别与审计）。 |

请求体（必填）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `status` | `ApplyStatus` | 是 | 目标状态，整批统一。startNewRound 为 true 时必须为 reviewing。 |
| `applyIds` | `ApplyId`[] | 是 |  |
| `revision` | `Revision` | 否 | 可选，整批统一的导入版本号（决策 |
| `startNewRound` | `boolean` | 否 | true 表示整班发起新一轮审核（reviewRound + 1，从 reviewing 开始）； 省略或 false 为同轮单向推进。默认 false。 |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 逐条结果 | 对象（succeeded / failed / results） |
| `400` | 参数错误 | `{ ok: false, error }` |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `403` | 无权限 / 已失效 / 已过期 / 已截止 | `{ ok: false, error }` |
| `404` | 资源不存在 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `succeeded` | `integer` | 是 |  |
| `failed` | `integer` | 是 |  |
| `results` | `ApplyStatusRecord` + 对象[] | 是 |  |

`400` 响应示例（default）：

```json
{
  "ok": false,
  "error": "请求参数不合法"
}
```

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`403` 响应示例（授权已过期）：

```json
{
  "ok": false,
  "error": "授权已过期，请联系服务商续期"
}
```

`403` 响应示例（申请已截止）：

```json
{
  "ok": false,
  "error": "申请已截止"
}
```

`404` 响应示例（default）：

```json
{
  "ok": false,
  "error": "资源不存在"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 申请状态上报（接口 8）

`POST /api/v1/applies/{applyId}/status`

管理端导入/审核/确认后上报单条申请状态。单轮内单向推进；
**同状态重复上报幂等返回 200**（网络重试安全），真正回退返回 409。
`revision` 可选：管理端导入时上报 `importedRevision`，与学生端 `latestRevision` 比对（决策 #39）。

鉴权：`unitToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `applyId` | path | 是 | `ApplyId` | 申请 id（UUID v4，学生端生成）。 |
| `X-Unit-Id` | header | 是 | `UnitId` | 当前激活的二级单位 id（辅助标识与审计）。 |
| `X-Install-Id` | header | 是 | `string` | 管理端安装实例 id（换机识别与审计）。 |

请求体（必填）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `batchId` | `BatchId` | 是 | 批次 id（UUID v4）。 |
| `status` | `ApplyStatus` | 是 | 目标状态（管理端仅上报 imported / reviewing / confirmed）。 |
| `revision` | `Revision` | 否 | 申请版本号，学生端每次导出 +1。 |

请求示例（imported）：

```json
{
  "batchId": "b1c9d4e2-5a37-4f18-9d6b-2e7c8a4f1b03",
  "status": "imported",
  "revision": 3
}
```

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 状态已更新（或幂等） | `ApplyStatusRecord` |
| `400` | 参数错误 | `{ ok: false, error }` |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `403` | 无权限 / 已失效 / 已过期 / 已截止 | `{ ok: false, error }` |
| `404` | 资源不存在 | `{ ok: false, error }` |
| `409` | 状态回退被拒 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `applyId` | `ApplyId` | 是 | 申请 id（UUID v4）。服务端只存 SHA-256 哈希（决策 |
| `reviewRound` | `ReviewRound` | 是 | 审核轮次，从 1 起递增（决策 |
| `status` | `ApplyStatus` | 是 | 申请状态（单轮内单向推进）。 |
| `latestRevision` | `Revision` \| `null` | 否 | 学生端注册的最新版本号（决策 |
| `importedRevision` | `Revision` \| `null` | 否 | 管理端导入时上报的版本号（决策 |
| `importedAt` | `EpochMs` \| `null` | 否 |  |
| `updatedAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |

`400` 响应示例（default）：

```json
{
  "ok": false,
  "error": "请求参数不合法"
}
```

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`403` 响应示例（授权已过期）：

```json
{
  "ok": false,
  "error": "授权已过期，请联系服务商续期"
}
```

`403` 响应示例（申请已截止）：

```json
{
  "ok": false,
  "error": "申请已截止"
}
```

`404` 响应示例（default）：

```json
{
  "ok": false,
  "error": "资源不存在"
}
```

`409` 响应示例（rollback）：

```json
{
  "ok": false,
  "error": "申请状态不允许回退"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 发起新一轮审核（接口 9）

`POST /api/v1/applies/{applyId}/review-rounds`

整班导出确认后不可撤销；有问题的班级由一级发起**新一轮审核**（决策 #30/#31）。
新一轮 `reviewRound = N + 1`，状态从 `reviewing` 开始（**不允许重新导入**），
确认后进入该轮 `confirmed`。仅一级单位令牌可调用；**整班发起走接口 7
批量（`startNewRound: true`）**，本接口用于单条发起。

鉴权：`unitToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `applyId` | path | 是 | `ApplyId` | 申请 id（UUID v4，学生端生成）。 |
| `X-Unit-Id` | header | 是 | `UnitId` | 当前激活的二级单位 id（辅助标识与审计）。 |
| `X-Install-Id` | header | 是 | `string` | 管理端安装实例 id（换机识别与审计）。 |

请求体（可选）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `reason` | `string` | 否 | 重审原因（审计用）。 |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 新一轮已开启 | `ApplyStatusRecord` |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `403` | 非一级单位令牌，或授权已失效 | `{ ok: false, error }` |
| `404` | 资源不存在 | `{ ok: false, error }` |
| `409` | 当前轮次尚未确认，无法开启新一轮 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `applyId` | `ApplyId` | 是 | 申请 id（UUID v4）。服务端只存 SHA-256 哈希（决策 |
| `reviewRound` | `ReviewRound` | 是 | 审核轮次，从 1 起递增（决策 |
| `status` | `ApplyStatus` | 是 | 申请状态（单轮内单向推进）。 |
| `latestRevision` | `Revision` \| `null` | 否 | 学生端注册的最新版本号（决策 |
| `importedRevision` | `Revision` \| `null` | 否 | 管理端导入时上报的版本号（决策 |
| `importedAt` | `EpochMs` \| `null` | 否 |  |
| `updatedAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |

`200` 响应示例（default）：

```json
{
  "ok": true,
  "data": {
    "applyId": "3f2a6c58-7b41-4d2e-9c05-8ab1f0e6d731",
    "reviewRound": 2,
    "status": "reviewing",
    "latestRevision": 3,
    "importedRevision": 3,
    "importedAt": 1755500000000,
    "updatedAt": 1755600000000
  }
}
```

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`403` 响应示例（notLevel1）：

```json
{
  "ok": false,
  "error": "仅一级单位可发起新一轮审核"
}
```

`404` 响应示例（default）：

```json
{
  "ok": false,
  "error": "资源不存在"
}
```

`409` 响应示例（notConfirmed）：

```json
{
  "ok": false,
  "error": "当前轮次尚未确认，无法发起新一轮审核"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 学生端注册申请（接口 12）

`POST /api/v1/applies/{applyId}/register`

学生端导出 `.dyf` 时注册（决策 #39）。请求体只含 `batchId` 与 `revision`，
**不含任何个人信息**；服务端记录 `latestRevision` 并置状态 `submitted`（`reviewRound = 1`）。

服务端校验 `batch.status = 'active'` 且未过 `applyEndAt`（**服务端时间为准**，学生端仅前置提示）。
重复注册更高 `revision` 时更新；相同 `revision` 幂等；已 `imported` 后再注册返回 409。
走严格限流（决策 #40）。

鉴权：无（公开接口，或以路径中的 `applyId` 为凭证）

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `applyId` | path | 是 | `ApplyId` | 申请 id（UUID v4，学生端生成）。 |

请求体（必填）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `batchId` | `BatchId` | 是 | 批次 id（UUID v4）。 |
| `revision` | `Revision` | 是 | 申请版本号，学生端每次导出 +1。 |

请求示例（default）：

```json
{
  "batchId": "b1c9d4e2-5a37-4f18-9d6b-2e7c8a4f1b03",
  "revision": 1
}
```

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 注册成功（或幂等） | `ApplyStatusRecord` |
| `400` | 参数错误 | `{ ok: false, error }` |
| `403` | 批次未开放或申请已截止 | `{ ok: false, error }` |
| `404` | 批次不存在 | `{ ok: false, error }` |
| `409` | 已被管理端导入，不可再注册新版本 | `{ ok: false, error }` |
| `429` | 限流（平台差异，不做契约测试断言，决策 §7.4） | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `applyId` | `ApplyId` | 是 | 申请 id（UUID v4）。服务端只存 SHA-256 哈希（决策 |
| `reviewRound` | `ReviewRound` | 是 | 审核轮次，从 1 起递增（决策 |
| `status` | `ApplyStatus` | 是 | 申请状态（单轮内单向推进）。 |
| `latestRevision` | `Revision` \| `null` | 否 | 学生端注册的最新版本号（决策 |
| `importedRevision` | `Revision` \| `null` | 否 | 管理端导入时上报的版本号（决策 |
| `importedAt` | `EpochMs` \| `null` | 否 |  |
| `updatedAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |

`200` 响应示例（default）：

```json
{
  "ok": true,
  "data": {
    "applyId": "3f2a6c58-7b41-4d2e-9c05-8ab1f0e6d731",
    "reviewRound": 1,
    "status": "submitted",
    "latestRevision": 1,
    "importedRevision": null,
    "importedAt": null,
    "updatedAt": 1755500000000
  }
}
```

`400` 响应示例（default）：

```json
{
  "ok": false,
  "error": "请求参数不合法"
}
```

`403` 响应示例（deadline）：

```json
{
  "ok": false,
  "error": "申请已截止"
}
```

`403` 响应示例（inactive）：

```json
{
  "ok": false,
  "error": "批次未开放申请"
}
```

`404` 响应示例（default）：

```json
{
  "ok": false,
  "error": "批次不存在"
}
```

`409` 响应示例（imported）：

```json
{
  "ok": false,
  "error": "该申请已被导入，不可再提交新版本"
}
```

`429` 响应示例（default）：

```json
{
  "ok": false,
  "error": "操作过于频繁，请稍后再试"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 申请状态查询（接口 13）

`GET /api/v1/applies/{applyId}`

学生端查询本人申请状态。服务端以 `SHA-256(applyId)` 查询（决策 #40），
不返回任何个人信息与分数明细。未知 `applyId` 返回 `status: "unknown"`（200，非 404），
以避免通过状态码区分存在性。走严格限流。

鉴权：无（公开接口，或以路径中的 `applyId` 为凭证）

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `applyId` | path | 是 | `ApplyId` | 申请 id（UUID v4，学生端生成）。 |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 申请状态（含未知） | `ApplyStatusRecord` \| 对象 |
| `400` | 参数错误 | `{ ok: false, error }` |
| `429` | 限流（平台差异，不做契约测试断言，决策 §7.4） | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

`200` 响应示例（已导入待审核）：

```json
{
  "ok": true,
  "data": {
    "applyId": "3f2a6c58-7b41-4d2e-9c05-8ab1f0e6d731",
    "reviewRound": 1,
    "status": "reviewing",
    "latestRevision": 3,
    "importedRevision": 3,
    "importedAt": 1755500000000,
    "updatedAt": 1755600000000
  }
}
```

`200` 响应示例（未知申请）：

```json
{
  "ok": true,
  "data": {
    "applyId": "00000000-0000-4000-8000-000000000000",
    "status": "unknown",
    "reviewRound": null,
    "latestRevision": null,
    "importedRevision": null,
    "importedAt": null,
    "updatedAt": null
  }
}
```

`400` 响应示例（default）：

```json
{
  "ok": false,
  "error": "请求参数不合法"
}
```

`429` 响应示例（default）：

```json
{
  "ok": false,
  "error": "操作过于频繁，请稍后再试"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

### 公开信息

学生端无鉴权可读的公开数据

#### 公开单位树（接口 10）

`GET /api/v1/units/public`

学生端单位选择使用，无鉴权。只返回 `status = 'active'` 的单位，
一级单位作为分组节点，二级单位为叶子（决策 #34）。不含任何配置或授权信息。

鉴权：无（公开接口，或以路径中的 `applyId` 为凭证）

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 单位树 | 对象（units） |
| `429` | 限流（平台差异，不做契约测试断言，决策 §7.4） | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `units` | `UnitTreeNode`[] | 是 |  |

`200` 响应示例（default）：

```json
{
  "ok": true,
  "data": {
    "units": [
      {
        "text": "宁夏大学",
        "value": "nxu",
        "children": [
          {
            "text": "励行书院",
            "value": "nxuLx"
          }
        ]
      },
      {
        "text": "测试学校",
        "value": "test",
        "children": [
          {
            "text": "测试1",
            "value": "testTest1"
          },
          {
            "text": "测试2",
            "value": "testTest2"
          }
        ]
      }
    ]
  }
}
```

`429` 响应示例（default）：

```json
{
  "ok": false,
  "error": "操作过于频繁，请稍后再试"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

### 后台认证

管理后台登录与会话

#### 后台登录（接口 14）

`POST /api/v1/admin/auth/login`

服务商运维登录。返回 15 分钟访问 token 与可删除的刷新 token（决策 #40）。
首次启动时若 `admin_user` 为空且配置了 `ADMIN_INITIAL_PASSWORD`，自动创建初始管理员，
`mustChangePassword` 为 true 时前端强制跳转改密。登录走严格限流。

鉴权：无（公开接口，或以路径中的 `applyId` 为凭证）

请求体（必填）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | `string` | 是 |  |
| `password` | `string` | 是 |  |

请求示例（default）：

```json
{
  "username": "admin",
  "password": "change-me-please"
}
```

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 登录成功 | 对象（accessToken / accessTokenExpiresAt / refreshToken / username / mustChangePassword） |
| `400` | 参数错误 | `{ ok: false, error }` |
| `401` | 用户名或密码错误 | `{ ok: false, error }` |
| `429` | 限流（平台差异，不做契约测试断言，决策 §7.4） | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `accessToken` | `string` | 是 |  |
| `accessTokenExpiresAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |
| `refreshToken` | `string` | 是 |  |
| `username` | `string` | 是 |  |
| `mustChangePassword` | `boolean` | 是 |  |

`400` 响应示例（default）：

```json
{
  "ok": false,
  "error": "请求参数不合法"
}
```

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "用户名或密码错误"
}
```

`429` 响应示例（default）：

```json
{
  "ok": false,
  "error": "操作过于频繁，请稍后再试"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 刷新访问令牌（接口 15）

`POST /api/v1/admin/auth/refresh`

用刷新 token 换取新的访问 token（决策 #40）。刷新 token 存库，登出即删除；
已删除或已过期的刷新 token 返回 401。

鉴权：无（公开接口，或以路径中的 `applyId` 为凭证）

请求体（必填）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `refreshToken` | `string` | 是 |  |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 刷新成功 | 对象（accessToken / accessTokenExpiresAt） |
| `400` | 参数错误 | `{ ok: false, error }` |
| `401` | 刷新令牌无效或已过期 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `accessToken` | `string` | 是 |  |
| `accessTokenExpiresAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |

`400` 响应示例（default）：

```json
{
  "ok": false,
  "error": "请求参数不合法"
}
```

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "登录已过期，请重新登录"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 后台登出（接口 16）

`POST /api/v1/admin/auth/logout`

删除刷新 token（访问 token 自然过期，无需吊销名单，决策

鉴权：`adminToken`

请求体（可选）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `refreshToken` | `string` | 否 |  |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 已登出 | 对象（ok） |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ok` | `true` | 是 |  |

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 修改后台密码（接口 17）

`POST /api/v1/admin/auth/change-password`

修改当前管理员密码。成功后清除 `mustChangePassword` 标记，
并删除该管理员的全部刷新 token（强制其他会话重新登录）。落审计日志。

鉴权：`adminToken`

请求体（必填）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `oldPassword` | `string` | 是 |  |
| `newPassword` | `string` | 是 |  |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 修改成功 | 对象（ok） |
| `400` | 新密码不符合强度要求 | `{ ok: false, error }` |
| `401` | 原密码错误或未登录 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ok` | `true` | 是 |  |

`400` 响应示例（weak）：

```json
{
  "ok": false,
  "error": "新密码长度至少 12 位"
}
```

`401` 响应示例（wrongOld）：

```json
{
  "ok": false,
  "error": "原密码错误"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

### 后台单位与授权

单位层级、授权码签发/作废/续期、换机审批

#### 单位列表（接口 18）

`GET /api/v1/admin/units`

返回全部单位（含一二级层级关系）。

鉴权：`adminToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `level` | query | 否 | `1` \| `2` | 按层级过滤。 |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 单位列表 | 对象（units） |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `units` | `UnitSummary`[] | 是 |  |

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 创建单位（接口 18）

`POST /api/v1/admin/units`

创建单位。二级单位必须指定 `parentId` 与 `templateId`（绑定配置模板），
**创建即签发首个授权码**并返回。落审计日志。

鉴权：`adminToken`

请求体（必填）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `unitId` | `UnitId` | 是 | 单位 id（camelCase，与学生端单位树 value 一致）。 |
| `name` | `string` | 是 |  |
| `level` | `1` \| `2` | 是 |  |
| `unitType` | `"college"` \| `"department"` \| `"other"` | 否 |  |
| `parentId` | `UnitId` | 否 | 二级单位必填。 |
| `templateId` | `string` | 否 | 二级单位必填，绑定的配置模板 id。 |
| `licenseMonths` | `integer` | 否 | 首个授权码有效月数，缺省 12。 |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 创建成功（含首个授权码） | 对象（unit / code / expiresAt） |
| `400` | 参数错误 | `{ ok: false, error }` |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `409` | unitId 已存在 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `unit` | `UnitSummary` | 是 | 单位摘要（激活响应与后台列表共用）。 |
| `code` | `LicenseCode` \| `null` | 否 | 一级单位无授权码时为 null。 |
| `expiresAt` | `EpochMs` \| `null` | 否 |  |

`400` 响应示例（default）：

```json
{
  "ok": false,
  "error": "请求参数不合法"
}
```

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`409` 响应示例（duplicate）：

```json
{
  "ok": false,
  "error": "该单位标识已存在"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 单位详情（接口 18）

`GET /api/v1/admin/units/{unitId}`

返回单位、绑定的配置模板版本与授权码列表。

鉴权：`adminToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `unitId` | path | 是 | `UnitId` | 单位 id。 |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 单位详情 | 对象（unit / publicKeyJwk / template / licenses） |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `404` | 资源不存在 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `unit` | `UnitSummary` | 是 | 单位摘要（激活响应与后台列表共用）。 |
| `publicKeyJwk` | `Jwk` \| `null` | 否 |  |
| `template` | `TemplateVersion` \| `null` | 否 |  |
| `licenses` | 对象[] | 是 |  |

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`404` 响应示例（default）：

```json
{
  "ok": false,
  "error": "资源不存在"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 删除单位（接口 18）

`DELETE /api/v1/admin/units/{unitId}`

删除指定单位及其全部关联数据（授权码、单位令牌、换机记录、批次、申请状态、
配置模板，均 `ON DELETE CASCADE`）。一级单位存在下级单位时拒绝删除（409）。
落审计日志。

鉴权：`adminToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `unitId` | path | 是 | `UnitId` | 单位 id。 |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 删除成功 | 对象（ok） |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `404` | 资源不存在 | `{ ok: false, error }` |
| `409` | 一级单位下仍有下级单位 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ok` | `true` | 是 |  |

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`404` 响应示例（default）：

```json
{
  "ok": false,
  "error": "资源不存在"
}
```

`409` 响应示例（hasChildren）：

```json
{
  "ok": false,
  "error": "该单位下仍有下级单位，请先删除下级单位"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 签发授权码（接口 19）

`POST /api/v1/admin/units/{unitId}/licenses`

为指定二级单位签发新授权码。落审计日志。

契约约束：**一个单位至多一条未作废授权码**（DDL 部分唯一索引
`uq_license_active_unit ON license (unit_id) WHERE status <> 'revoked'`）。
已有未作废授权码时返回 409；换码统一走「先作废旧码、再签发新码」
（自助换机 `POST /api/v1/units/rebind` 与后台放行均为同事务）。

鉴权：`adminToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `unitId` | path | 是 | `UnitId` | 单位 id。 |

请求体（必填）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `months` | `integer` | 是 |  |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 签发成功 | 对象（code / expiresAt） |
| `400` | 参数错误 | `{ ok: false, error }` |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `404` | 资源不存在 | `{ ok: false, error }` |
| `409` | 该单位已有未作废授权码 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `code` | `LicenseCode` | 是 | 授权码（大写字母数字分组）。 |
| `expiresAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |

`400` 响应示例（default）：

```json
{
  "ok": false,
  "error": "请求参数不合法"
}
```

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`404` 响应示例（default）：

```json
{
  "ok": false,
  "error": "资源不存在"
}
```

`409` 响应示例（alreadyLicensed）：

```json
{
  "ok": false,
  "error": "该单位已有未作废授权码"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 作废授权码（接口 19）

`POST /api/v1/admin/licenses/{code}/revoke`

作废授权码。同时使该授权码派生的全部 `unitToken` 失效（决策 #29）。
已作废的授权码重复作废幂等。落审计日志。

鉴权：`adminToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `code` | path | 是 | `LicenseCode` | 授权码。 |

请求体（可选）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `reason` | `string` | 否 |  |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 已作废 | 对象（code / status） |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `404` | 资源不存在 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `code` | `LicenseCode` | 是 | 授权码（大写字母数字分组）。 |
| `status` | `"revoked"` | 是 |  |

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`404` 响应示例（default）：

```json
{
  "ok": false,
  "error": "资源不存在"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 续期授权码（接口 19）

`POST /api/v1/admin/licenses/{code}/renew`

续期授权码（决策 #40）：过期不再强制重新激活，管理端经
`GET /api/v1/license/status` 即可刷新本地有效期。已作废的授权码不可续期（409）。
落审计日志。

鉴权：`adminToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `code` | path | 是 | `LicenseCode` | 授权码。 |

请求体（必填）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `months` | `integer` | 是 |  |

请求示例（default）：

```json
{
  "months": 12
}
```

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 续期成功 | 对象（code / expiresAt / status / renewCount） |
| `400` | 参数错误 | `{ ok: false, error }` |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `404` | 资源不存在 | `{ ok: false, error }` |
| `409` | 已作废的授权码不可续期 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `code` | `LicenseCode` | 是 | 授权码（大写字母数字分组）。 |
| `expiresAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |
| `status` | `LicenseStatus` | 是 | 授权状态。 |
| `renewCount` | `integer` | 是 |  |

`400` 响应示例（default）：

```json
{
  "ok": false,
  "error": "请求参数不合法"
}
```

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`404` 响应示例（default）：

```json
{
  "ok": false,
  "error": "资源不存在"
}
```

`409` 响应示例（revoked）：

```json
{
  "ok": false,
  "error": "授权码已作废，不可续期"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

### 后台配置模板

配置模板上传、版本历史、发布

#### 配置模板列表（接口 20）

`GET /api/v1/admin/templates`

返回每个模板 id 的最新版本行（含 draft）。

鉴权：`adminToken`

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 模板列表 | 对象（templates） |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `templates` | `TemplateVersion`[] | 是 |  |

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 上传配置模板（接口 20）

`POST /api/v1/admin/templates`

上传单位配置 JSON（须通过 `unit-config.schema.json` 校验）。
以 `draft` 状态写入 (id, version, revision)；同三元组已存在 `published` 版本时返回 409
（已发布不可修改，决策 #37）。落审计日志。

鉴权：`adminToken`

请求体（必填）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `config` | `UnitConfig` | 是 | 单位配置（一个二级单位一份，含单位/班级/学生字段/德育分项目/计算/排名）。 结构由 `unit-config.schema.json` 单独定义，两套实现与两端共用同一份 schema。 |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 上传成功（draft） | `TemplateVersion` |
| `400` | 配置未通过 schema 校验 | `{ ok: false, error }` |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `409` | 该版本已发布，不可覆盖 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `string` | 是 |  |
| `unitId` | `UnitId` | 是 | 单位 id（camelCase，与学生端单位树 value 一致）。 |
| `name` | `string` | 是 |  |
| `version` | `integer` | 是 |  |
| `revision` | `integer` | 是 |  |
| `status` | `"draft"` \| `"published"` \| `"archived"` | 是 |  |
| `createdAt` | `EpochMs` | 否 | epoch 毫秒时间戳。 |
| `updatedAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |

`400` 响应示例（invalid）：

```json
{
  "ok": false,
  "error": "配置格式不合法：dyf.categories 不能为空"
}
```

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`409` 响应示例（published）：

```json
{
  "ok": false,
  "error": "该版本已发布，请升修订号后再上传"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 模板版本历史（接口 20）

`GET /api/v1/admin/templates/{templateId}/versions`

按 (version, revision) 倒序返回该模板的全部历史版本（决策

鉴权：`adminToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `templateId` | path | 是 | `string` | 配置模板 id。 |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 版本历史 | 对象（versions） |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `404` | 资源不存在 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `versions` | `TemplateVersion`[] | 是 |  |

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`404` 响应示例（default）：

```json
{
  "ok": false,
  "error": "资源不存在"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 查看模板配置内容（接口 20）

`GET /api/v1/admin/templates/{templateId}/versions/{version}/{revision}/config`

返回指定版本的完整单位配置 JSON（后台只读查看）。
结构与上传时的 `UnitConfig` 完全一致。

鉴权：`adminToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `templateId` | path | 是 | `string` | 配置模板 id。 |
| `version` | path | 是 | `integer` |  |
| `revision` | path | 是 | `integer` |  |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 配置内容 | 对象（config） |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `404` | 资源不存在 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `config` | `UnitConfig` | 是 | 单位配置（一个二级单位一份，含单位/班级/学生字段/德育分项目/计算/排名）。 结构由 `unit-config.schema.json` 单独定义，两套实现与两端共用同一份 schema。 |

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`404` 响应示例（default）：

```json
{
  "ok": false,
  "error": "资源不存在"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 发布模板版本（接口 20）

`POST /api/v1/admin/templates/{templateId}/publish`

将指定 (version, revision) 置为 `published`，此后不可编辑；
同 id 的其他 `published` 版本转为 `archived`。已创建的批次按快照三元组引用，不受影响。
落审计日志。

鉴权：`adminToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `templateId` | path | 是 | `string` | 配置模板 id。 |

请求体（必填）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `version` | `integer` | 是 |  |
| `revision` | `integer` | 是 |  |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 已发布 | `TemplateVersion` |
| `400` | 参数错误 | `{ ok: false, error }` |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `404` | 资源不存在 | `{ ok: false, error }` |
| `409` | 该版本已是 published 或已 archived | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `string` | 是 |  |
| `unitId` | `UnitId` | 是 | 单位 id（camelCase，与学生端单位树 value 一致）。 |
| `name` | `string` | 是 |  |
| `version` | `integer` | 是 |  |
| `revision` | `integer` | 是 |  |
| `status` | `"draft"` \| `"published"` \| `"archived"` | 是 |  |
| `createdAt` | `EpochMs` | 否 | epoch 毫秒时间戳。 |
| `updatedAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |

`400` 响应示例（default）：

```json
{
  "ok": false,
  "error": "请求参数不合法"
}
```

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`404` 响应示例（default）：

```json
{
  "ok": false,
  "error": "资源不存在"
}
```

`409` 响应示例（archived）：

```json
{
  "ok": false,
  "error": "已归档的版本不可发布"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

### 后台运维

批次查看、审计日志

#### 批次列表（接口 21）

`GET /api/v1/admin/batches`

查看批次公开信息（运维排障用），不含私钥与分数明细。

鉴权：`adminToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `unitId` | query | 否 | `UnitId` | 按二级单位过滤。 |
| `status` | query | 否 | `BatchStatus` |  |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 批次列表 | 对象（batches） |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `batches` | `BatchPublic`[] | 是 |  |

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 换机记录列表（接口 21）

`GET /api/v1/admin/rebinds`

查看换机记录（自助完成的记录仅审计，`pending` 为超频待放行，决策

鉴权：`adminToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `status` | query | 否 | `"self-served"` \| `"pending"` \| `"approved"` \| `"rejected"` |  |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 换机记录 | 对象（rebinds） |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `rebinds` | `RebindRequest`[] | 是 |  |

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 放行超频换机（接口 21）

`POST /api/v1/admin/rebinds/{rebindId}/approve`

手动放行 `pending` 换机申请（超出月限 3 次的情形）：作废旧码、签发新码。
非 `pending` 状态返回 409。落审计日志。

鉴权：`adminToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `rebindId` | path | 是 | `string` |  |

请求体（可选）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `approve` | `boolean` | 否 | true 放行 / false 拒绝，缺省 true。 |
| `reason` | `string` | 否 |  |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 处理完成 | 对象（id / status / code / expiresAt） |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `404` | 资源不存在 | `{ ok: false, error }` |
| `409` | 该申请不处于待放行状态 | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `string` | 是 |  |
| `status` | `"approved"` \| `"rejected"` | 是 |  |
| `code` | `LicenseCode` \| `null` | 否 | 放行时签发的新授权码。 |
| `expiresAt` | `EpochMs` \| `null` | 否 |  |

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`404` 响应示例（default）：

```json
{
  "ok": false,
  "error": "资源不存在"
}
```

`409` 响应示例（notPending）：

```json
{
  "ok": false,
  "error": "该换机申请无需放行"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

#### 审计日志（接口 21）

`GET /api/v1/admin/audit-logs`

按时间倒序分页查询后台写操作与授权生命周期事件。

鉴权：`adminToken`

参数：

| 名称 | 位置 | 必填 | 类型 | 说明 |
|------|------|------|------|------|
| `action` | query | 否 | `string` | 按操作类型过滤。 |
| `target` | query | 否 | `string` | 按操作对象过滤。 |
| `limit` | query | 否 | `integer` |  |
| `cursor` | query | 否 | `integer` | 上一页最后一条的 id（游标分页）。 |

响应：

| 状态码 | 说明 | 数据 |
|--------|------|------|
| `200` | 审计日志 | 对象（logs / nextCursor） |
| `401` | 未认证（缺少或无效令牌） | `{ ok: false, error }` |
| `500` | 服务端异常 | `{ ok: false, error }` |

成功响应 `data` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `logs` | `AuditLog`[] | 是 |  |
| `nextCursor` | `integer` \| `null` | 否 |  |

`401` 响应示例（default）：

```json
{
  "ok": false,
  "error": "未登录或登录已过期"
}
```

`500` 响应示例（default）：

```json
{
  "ok": false,
  "error": "服务端异常，请稍后重试"
}
```

## 公共数据结构

### EpochMs

epoch 毫秒时间戳。

类型：`integer`

### UnitId

单位 id（camelCase，与学生端单位树 value 一致）。

类型：`string`

### ApplyId

申请 id（UUID v4）。服务端只存 SHA-256 哈希（决策

类型：`string`

### BatchId

批次 id（UUID v4）。

类型：`string`

### LicenseCode

授权码（大写字母数字分组）。

类型：`string`

### Jwk

公钥 JWK（RSA-OAEP-256）。私钥永不进入服务端。

字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `kty` | `string` | 是 |  |
| `n` | `string` | 是 |  |
| `e` | `string` | 是 |  |
| `alg` | `string` | 否 |  |
| `ext` | `boolean` | 否 |  |
| `key_ops` | `string`[] | 否 |  |

### BatchStatus

批次状态（单向推进）。

类型：`"draft"` \| `"active"` \| `"closed"`

### ApplyStatus

申请状态（单轮内单向推进）。

类型：`"draft"` \| `"submitted"` \| `"imported"` \| `"reviewing"` \| `"confirmed"`

### ReviewRound

审核轮次，从 1 起递增（决策

类型：`integer`

### Revision

申请版本号，学生端每次导出 +1。

类型：`integer`

### UnitConfig

单位配置（一个二级单位一份，含单位/班级/学生字段/德育分项目/计算/排名）。 结构由 `unit-config.schema.json` 单独定义，两套实现与两端共用同一份 schema。

类型：`UnitConfig`

### UnitSummary

单位摘要（激活响应与后台列表共用）。

字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `unitId` | `UnitId` | 是 | 单位 id（camelCase，与学生端单位树 value 一致）。 |
| `unitName` | `string` | 是 |  |
| `unitType` | `"college"` \| `"department"` \| `"other"` | 是 |  |
| `level` | `1` \| `2` | 否 | 单位层级：1 一级（学校）/ 2 二级（书院）。 |
| `parentUnitId` | `UnitId` \| `null` | 否 | 一级单位 id（二级单位必有）。 |

### LicenseStatus

授权状态。

类型：`"active"` \| `"expired"` \| `"revoked"`

### LicenseInfo

字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `expiresAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |
| `status` | `LicenseStatus` | 是 | 授权状态。 |

### CalcConfig

计算配置（批次快照，与配置模板 calc 同构）。判别字段 `calcMode`： weighted 仅权重；formula 额外必填 `formula`。与 `unit-config.schema.json#/$defs/calc` 校验强度一致（决策 #35）。

类型：对象 \| 对象

### BatchPublic

批次公开字段（不含私钥，决策 §3.2）。

字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `batchId` | `BatchId` | 是 | 批次 id（UUID v4）。 |
| `unitId` | `UnitId` | 是 | 单位 id（camelCase，与学生端单位树 value 一致）。 |
| `year` | `integer` | 是 |  |
| `semester` | `1` \| `2` | 是 |  |
| `isTest` | `boolean` | 是 | 是否测试批次（与正式批次并存，正式优先下发）。 |
| `status` | `BatchStatus` | 是 | 批次状态（单向推进）。 |
| `applyStartAt` | `EpochMs` \| `null` | 否 |  |
| `applyEndAt` | `EpochMs` \| `null` | 否 |  |
| `calcMode` | `"weighted"` \| `"formula"` | 是 |  |
| `calcConfig` | `CalcConfig` | 是 | 计算配置（批次快照，与配置模板 calc 同构）。判别字段 `calcMode`： weighted 仅权重；formula 额外必填 `formula`。与 `unit-config.schema.json#/$defs/calc` 校验强度一致（决策 #35）。 |
| `publicKeyJwk` | `Jwk` | 是 | 公钥 JWK（RSA-OAEP-256）。私钥永不进入服务端。 |
| `configTemplateId` | `string` | 否 |  |
| `configTemplateVersion` | `integer` | 否 |  |
| `configTemplateRevision` | `integer` | 否 |  |
| `createdAt` | `EpochMs` | 否 | epoch 毫秒时间戳。 |
| `updatedAt` | `EpochMs` | 否 | epoch 毫秒时间戳。 |

### ApplyStatusRecord

申请状态记录（数据最小化：无学号、无姓名、无分数）。

字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `applyId` | `ApplyId` | 是 | 申请 id（UUID v4）。服务端只存 SHA-256 哈希（决策 |
| `reviewRound` | `ReviewRound` | 是 | 审核轮次，从 1 起递增（决策 |
| `status` | `ApplyStatus` | 是 | 申请状态（单轮内单向推进）。 |
| `latestRevision` | `Revision` \| `null` | 否 | 学生端注册的最新版本号（决策 |
| `importedRevision` | `Revision` \| `null` | 否 | 管理端导入时上报的版本号（决策 |
| `importedAt` | `EpochMs` \| `null` | 否 |  |
| `updatedAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |

### UnitTreeNode

公开单位树节点（学生端单位选择）。

字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `text` | `string` | 是 |  |
| `value` | `UnitId` | 是 | 单位 id（camelCase，与学生端单位树 value 一致）。 |
| `children` | `UnitTreeNode`[] | 否 |  |

### RebindRequest

换机记录（自助换机 + 月限 3 次，决策

字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `string` | 是 |  |
| `unitId` | `UnitId` | 是 | 单位 id（camelCase，与学生端单位树 value 一致）。 |
| `installId` | `string` | 是 |  |
| `reason` | `string` \| `null` | 否 |  |
| `oldCode` | `LicenseCode` \| `null` | 否 |  |
| `newCode` | `LicenseCode` \| `null` | 否 |  |
| `status` | `"self-served"` \| `"pending"` \| `"approved"` \| `"rejected"` | 是 | self-served 自助完成 / pending 超频待放行 / approved 已放行 / rejected 已拒绝。 |
| `monthKey` | `string` | 否 | 频次计数月份（YYYY-MM）。 |
| `monthCount` | `integer` | 否 |  |
| `createdAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |

### TemplateVersion

配置模板版本行（按 (id, version, revision) 保留历史，决策

字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `string` | 是 |  |
| `unitId` | `UnitId` | 是 | 单位 id（camelCase，与学生端单位树 value 一致）。 |
| `name` | `string` | 是 |  |
| `version` | `integer` | 是 |  |
| `revision` | `integer` | 是 |  |
| `status` | `"draft"` \| `"published"` \| `"archived"` | 是 |  |
| `createdAt` | `EpochMs` | 否 | epoch 毫秒时间戳。 |
| `updatedAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |

### AuditLog

字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `integer` | 是 |  |
| `adminUserId` | `string` \| `null` | 否 |  |
| `action` | `string` | 是 | 操作类型（kebab-case，如 license-revoke / unit-create）。 |
| `target` | `string` | 是 | 操作对象标识（单位 id / 授权码 / 模板 id 等）。 |
| `detail` | `string` \| `null` | 否 |  |
| `ip` | `string` \| `null` | 否 |  |
| `createdAt` | `EpochMs` | 是 | epoch 毫秒时间戳。 |

### ErrorBody

统一失败响应。

字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ok` | `false` | 是 |  |
| `error` | `string` | 是 | 面向用户的中文错误描述（管理端直接透传）。 |

## 错误码约定

| 状态码 | 含义 |
|--------|------|
| `400` | 参数不合法 |
| `401` | 未认证（缺少或无效令牌） |
| `403` | 无权限 / 授权已失效 / 已过期 / 申请已截止 |
| `404` | 资源不存在 |
| `409` | 状态冲突（回退、重复注册、重复批次） |
| `429` | 限流（平台差异，不做契约测试断言） |
| `500` | 服务端异常 |

失败响应统一为 `{ "ok": false, "error": "中文描述" }`，`error` 直接面向最终用户。
