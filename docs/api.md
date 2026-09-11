# API 接口文档

> 结构唯一权威：SCES-Server `contracts/openapi.yaml`（OpenAPI 3.1）。本文是**人读摘要**，字段级细节（枚举、约束、示例）以契约为准；两者不一致时以契约为准并在此提 issue。
>
> 契约编号 1–21 对应 server-plan §6.2 的业务接口清单。本实现共 34 个 HTTP 操作（21 业务接口展开为多路径 + 1 探活 + 后台多路径）。

## 目录

- [通用约定](#通用约定)
- [公开接口（无需认证）](#公开接口无需认证)
- [单位令牌接口（管理端）](#单位令牌接口管理端)
- [后台认证（接口 14–17）](#后台认证接口-1417)
- [后台管理（接口 18–20）](#后台管理接口-1820)
- [后台运维（接口 21）](#后台运维接口-21)
- [探活](#探活)

---

## 通用约定

### Base URL

```
生产：https://sces.thisish.cn/api/v1
本地：http://localhost:3000/api/v1
```

### 响应包络

所有接口返回统一包络，`ok` 判定成败：

```jsonc
// 成功
{ "ok": true, "data": { /* 接口特定结构 */ } }
// 失败（HTTP 状态码同步表达错误类别）
{ "ok": false, "error": "面向用户的中文错误描述" }
```

### 时间戳

全部为 **epoch 毫秒数**（`EpochMs`，JSON number）。契约要求驱动返回 `number`；本仓在 postgres.js 客户端配置了 `bigint → number` 解析（见 `server/utils/db/client.ts`），PGlite（测试）与生产行为一致。

### 错误码

| 状态码 | 场景 | 示例文案 |
|--------|------|----------|
| 400 | 参数不合法（zod strict 校验失败） | `请求参数不合法` / `配置格式不合法：<位置> <原因>` |
| 401 | 缺少/无效令牌 | `用户名或密码错误` / `登录已过期，请重新登录` |
| 403 | 授权不可用（如授权码过期） | `授权已过期，请联系服务商续期` |
| 404 | 资源不存在 | `单位不存在` / `模板版本不存在` |
| 409 | 业务冲突 | `该单位标识已存在` / `该版本已发布，请升修订号后再上传` |
| 429 | 限流（见下） | `操作过于频繁，请稍后再试` |
| 500 | 服务器内部错误 | `服务器内部错误` |

### 限流

实例内固定窗口（60 秒 30 次），键为 `(路径, 客户端 IP)`，挂载于隐私/授权关键端点：

| 端点 | 说明 |
|------|------|
| `POST /authorize` | 授权码核验入口 |
| `POST /admin/auth/login` | 后台登录（防爆破） |
| `POST /applies/:applyId/register` | applyId 隐私保护（防枚举探测） |
| `GET /applies/:applyId` | 同上 |

> ⚠️ Vercel 免费层无共享存储，限流计数为**实例内内存**，多实例各自独立——这是已知并接受的语义（决策 #40）。

### 认证方式

| 方式 | 头 | 载体 | 用途 |
|------|----|------|------|
| 单位令牌 | `Authorization: Bearer <unitToken>` | 明文 64 hex；服务端只存 SHA-256 | 管理端全部业务接口 |
| 辅助标识 | `X-Unit-Id` + `X-Install-Id` | 必须与令牌上下文一致 | 同上（不一致 401） |
| 后台访问令牌 | `Authorization: Bearer <accessToken>` | HS256 JWT，15 分钟 | 后台全部接口 |

---

## 公开接口（无需认证）

### 接口 1：授权码核验 `POST /authorize`

书院首次激活：核验授权码 → 签发单位令牌 + 下发单位信息。严格限流。

```jsonc
// 请求
{ "licenseCode": "A1B2-C3D4-E5F6-G7H8", "installId": "install-uuid" }
// 200 响应
{
  "ok": true,
  "data": {
    "unitToken": "<64hex>",            // 明文仅此一次下发
    "unit": { "unitId": "nxuLx", "unitName": "励行书院", "unitType": "college", "level": 2, "parentUnitId": "nxu" },
    "license": { "expiresAt": 1820196238291, "status": "active" },
    "configTemplate": { "id": "lixing-shuyuan", "name": "励行书院配置", "version": 1, "revision": 0, "status": "published", "unit": { /*...*/ }, "updatedAt": 1789092238618 }
  }
}
```

副作用：作废旧 `installId` 的令牌（换机即换令牌）；新令牌只存 SHA-256。

### 接口 10：公开单位树 `GET /units/public`

学生端单位选择器数据源。返回一级分组 + 二级单位的树形结构。

### 接口 11：活跃批次下发 `GET /batches/active?unitId=<二级单位>`

学生端拉取当前可申请批次。正式批次优先、创建时间倒序；同一单位同学年学期唯一正式批次（DDL 部分唯一索引保证）。

### 接口 12：学生端注册 `POST /applies/:applyId/register`

学生端提交申请时上报状态与版本。严格限流；`applyId` 服务端只存 SHA-256（`apply_id_hash`）。同状态幂等（重复上报 200），回退返回 409。

### 接口 13：申请状态查询 `GET /applies/:applyId`

严格限流；隐私设计：**未知 applyId 不返回 404**，而是 `data.status = "unknown"`，防枚举探测。

---

## 单位令牌接口（管理端）

以下接口全部要求 `Authorization: Bearer <unitToken>` + `X-Unit-Id` + `X-Install-Id` 三个头。

### 接口 2：公钥上报 `POST /units/{unitId}/public-key`

书院创建批次时上报 RSA 公钥 JWK（`.dyf` 混合加密用）。服务端只存公钥，**永不存在私钥**。

### 接口 3：自助换机 `POST /units/rebind`

书院换机自助换绑：作废旧码 → 签发新码。每月上限 3 次（`REBIND_MONTHLY_LIMIT`），超频返回 403 并登记 `pending` 换机申请，转后台人工放行（接口 21）。

### 接口 4：授权状态拉取 `GET /license/status`

返回 `{ expiresAt, status }`；**过期不报错**（`status: "expired"`），供管理端提醒续期。

### 接口 5：批次登记 `POST /batches`

创建批次：学年学期 + 计算配置（weighted/formula）+ 公钥 + 模板快照三元组 `(templateId, version, revision)`。正式批次同单位同学期唯一（409）。

### 接口 6：批次状态同步 `POST /batches/{batchId}/status`

`draft → active → closed` 单向流转；非法流转 409。

### 接口 7：批量申请状态上报 `POST /batches/{batchId}/apply-statuses`

管理端导入 .dyf 后批量上报。**逐条返回结果**，个别失败不回滚整批。

### 接口 8：单条申请状态上报 `POST /applies/{applyId}/status`

单条版本；同状态幂等，回退 409。

### 接口 9：发起新一轮审核 `POST /applies/{applyId}/review-rounds`

**仅一级单位令牌**（二级 403）。轮次制：单轮内单向推进，跨轮由一级发起、从 `reviewing` 开始。

---

## 后台认证（接口 14–17）

### 接口 14：登录 `POST /admin/auth/login`

严格限流。首次部署且配置 `ADMIN_INITIAL_PASSWORD` 时自动创建 `admin` 账号（`mustChangePassword: true`）。

```jsonc
// 请求
{ "username": "admin", "password": "******" }
// 200 响应
{
  "ok": true,
  "data": {
    "accessToken": "<HS256 JWT>",       // 15 分钟
    "accessTokenExpiresAt": 1789093138618,
    "refreshToken": "<64hex>",          // 30 天；服务端只存 SHA-256
    "username": "admin",
    "mustChangePassword": false
  }
}
```

### 接口 15：刷新令牌 `POST /admin/auth/refresh`

```jsonc
{ "refreshToken": "<64hex>" }
// 200 → { "ok": true, "data": { "accessToken": "...", "accessTokenExpiresAt": ... } }
```

### 接口 16：登出 `POST /admin/auth/logout`（需 accessToken）

删除该管理员的全部刷新令牌（登出即全端失效）。

### 接口 17：修改密码 `POST /admin/auth/change-password`（需 accessToken）

```jsonc
{ "oldPassword": "...", "newPassword": "..." }   // newPassword ≥ 12 位，不得与原密码相同
```

副作用：删除该管理员全部刷新令牌（改密即全端下线）+ 审计。

---

## 后台管理（接口 18–20）

以下接口全部要求 `Authorization: Bearer <accessToken>`。

### 接口 18：单位管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/admin/units?level=` | 单位列表（含层级关系） |
| `POST` | `/admin/units` | 创建单位；**二级单位必须 `parentId` + `templateId`，创建即签发首个授权码** |
| `GET` | `/admin/units/{unitId}` | 详情（单位 + 绑定模板 + 授权码列表） |
| `DELETE` | `/admin/units/{unitId}` | 删除；一级有下级返回 409；级联删除授权码/令牌/批次/模板 |

```jsonc
// POST /admin/units 请求（创建二级）
{
  "unitId": "nxuLx",          // camelCase，全局唯一
  "name": "励行书院",
  "level": 2,
  "parentId": "nxu",
  "templateId": "lixing-shuyuan",
  "licenseMonths": 12          // 可选，1–120，缺省 12
}
// 200 → { "ok": true, "data": { "unit": {...}, "code": "U9PK-NVZM-V5BG-HSPY", "expiresAt": 1820196238291 } }
```

### 接口 19：授权码管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/admin/units/{unitId}/licenses` | 签发 `{ "months": 1–120 }` |
| `POST` | `/admin/licenses/{code}/revoke` | 作废；**级联失效该码全部 unitToken** |
| `POST` | `/admin/licenses/{code}/renew` | 续期 `{ "months": n }`；`renewCount` 递增 |

授权码格式 `^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$`（去易混淆字符集）。

### 接口 20：配置模板

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/admin/templates` | 每个模板 id 的最新版本行（含 draft） |
| `POST` | `/admin/templates` | 上传 `{ "config": UnitConfig }`；须过 `unit-config.schema.json`（Ajv2020，与契约侧同编译）；published 三元组不可覆盖（409） |
| `GET` | `/admin/templates/{id}/versions` | 版本历史，`(version, revision)` 倒序 |
| `GET` | `/admin/templates/{id}/versions/{version}/{revision}/config` | 查看指定版本完整配置（只读） |
| `POST` | `/admin/templates/{id}/publish` | 发布；同 id 其他 published 转 archived |

生命周期：`draft`（可重复上传覆盖）→ `published`（唯一，不可编辑）→ `archived`（仅归档）。批次以三元组快照引用，不受后续归档影响。

---

## 后台运维（接口 21）

### 批次列表 `GET /admin/batches?unitId=&status=`

全部批次公开信息（运维排障），不含私钥与分数明细。

### 换机记录 `GET /admin/rebinds?status=`

`self-served`（自助完成，仅审计）/ `pending`（超频待放行）/ `approved` / `rejected`。

### 放行超频换机 `POST /admin/rebinds/{rebindId}/approve`

```jsonc
{ "approve": true }   // 或 { "approve": false, "reason": "..." }
// approve=true → 作废旧码 + 按剩余期签发新码
// 非 pending 状态返回 409
```

### 审计日志 `GET /admin/audit-logs?action=&target=&limit=&cursor=`

游标分页（`limit` 1–200，缺省 50；响应含 `nextCursor`）。记录后台全部写操作与授权生命周期事件（license-issue/renew/revoke、unit-create/delete、admin-change-password、template-upload/publish、rebind-approve 等）。

---

## 探活 `GET /api/v1/health`

```jsonc
{ "ok": true, "data": { "status": "ok", "now": 1789092238618, "architecture": "web" } }
```
