import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../http/env.js'
import { readJsonObject, readOptionalJsonObject } from '../http/parse.js'
import { recordAudit } from '../lib/audit.js'
import { badRequest, conflict, notFound } from '../lib/errors.js'
import { isUniqueViolation } from '../db/errors.js'
import { UNIT_ID_PATTERN } from '../lib/hash.js'
import { isUnitConfig, firstConfigError } from '../schemas/unit-config.js'
import { requireAdminToken } from './admin-auth.js'
import {
  insertTemplateFromConfig,
  deleteUnit,
  insertUnit,
  listLatestTemplateVersions,
  listLicensesForUnit,
  listTemplateVersions,
  listUnits,
  publishTemplateVersion,
  findLatestTemplateForUnit,
  toTemplateVersion,
  toUnitSummaryRow,
} from '../repos/admin-units.js'
import { findTemplateVersion, type UnitConfig } from '../repos/config-templates.js'
import { effectiveLicenseStatus, findActiveLicenseForUnit, findLicenseByCode, issueLicense } from '../repos/licenses.js'
import { findUnitById } from '../repos/units.js'

const createUnitBodySchema = z.strictObject({
  unitId: z.string().regex(UNIT_ID_PATTERN),
  name: z.string().min(1).max(64),
  level: z.union([z.literal(1), z.literal(2)]),
  unitType: z.enum(['college', 'department', 'other']).optional(),
  parentId: z.string().regex(UNIT_ID_PATTERN).optional(),
  templateId: z.string().optional(),
  licenseMonths: z.number().int().min(1).max(120).optional(),
})

const issueLicenseBodySchema = z.strictObject({ months: z.number().int().min(1).max(120) })

const renewBodySchema = z.strictObject({ months: z.number().int().min(1).max(120) })

const uploadTemplateBodySchema = z.strictObject({ config: z.record(z.string(), z.unknown()) })

const publishBodySchema = z.strictObject({
  version: z.number().int().min(1),
  revision: z.number().int().min(0),
})

/** 一级单位无授权码；二级创建即签发首个授权码（契约接口 18）。 */
function monthsToExpiresAt(months: number, from = Date.now()): number {
  return from + months * 30 * 86_400_000
}

export const adminUnitsRouter = new Hono<AppEnv>()

/** 契约接口 18–21 全部要求 adminToken（在路由定义前以 use 生效）。 */
adminUnitsRouter.use('/admin/*', requireAdminToken)

/** 接口 18：单位列表（?level 过滤）。 */
adminUnitsRouter.get('/admin/units', async (c) => {
  const db = c.get('db')
  const levelParam = c.req.query('level')
  const level = levelParam === '1' || levelParam === '2' ? Number(levelParam) : undefined
  const units = await listUnits(db, level)
  return c.json({ ok: true as const, data: { units: units.map(toUnitSummaryRow) } })
})

/** 接口 18：创建单位（二级单位创建即签发首个授权码）。 */
adminUnitsRouter.post('/admin/units', async (c) => {
  const db = c.get('db')
  const auth = c.get('adminAuth')
  const parsed = createUnitBodySchema.safeParse(await readJsonObject(c))
  if (!parsed.success) throw badRequest()
  const body = parsed.data

  const unitType = body.unitType ?? 'other'
  if (body.level === 2 && (body.parentId === undefined || body.templateId === undefined)) throw badRequest()
  if (body.level === 1 && body.parentId !== undefined) throw badRequest()
  if (await findUnitById(db, body.unitId)) throw conflict('该单位标识已存在')
  if (body.parentId !== undefined && (await findUnitById(db, body.parentId)) === undefined) {
    throw notFound('父级单位不存在')
  }

  if (body.parentId !== undefined) {
    const parent = await findUnitById(db, body.parentId)
    if (parent !== undefined && body.level === 2 && parent.level !== 1) {
      throw badRequest('二级单位的父级单位必须为一级')
    }
  }
  const expiresAt = body.level === 2 ? monthsToExpiresAt(body.licenseMonths ?? 12) : null

  // 建单位与签首发个授权码同事务：授权码签发失败时不留无授权的孤儿单位
  let code: string | null
  try {
    ({ code } = await db.transaction<{ code: string | null }>(async (tx) => {
      await insertUnit(tx, {
        id: body.unitId,
        name: body.name,
        unitType,
        parentId: body.level === 2 ? (body.parentId as string) : null,
        level: body.level,
        configTemplateId: body.level === 2 ? body.templateId : null,
      })
      return { code: body.level === 2 ? await issueLicense(tx, body.unitId, expiresAt as number) : null }
    }))
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('该单位标识已存在')
    throw error
  }
  await recordAudit(db, { adminUserId: auth.adminUserId, action: 'unit-create', target: body.unitId, ip: c.req.header('x-forwarded-for') ?? null })

  return c.json({
    ok: true as const,
    data: {
      unit: { unitId: body.unitId, unitName: body.name, unitType, level: body.level, parentUnitId: body.parentId ?? null },
      code,
      expiresAt,
    },
  })
})

/** 接口 18：单位详情（单位 + 公钥 + 模板版本 + 授权码列表）。 */
adminUnitsRouter.get('/admin/units/:unitId', async (c) => {
  const db = c.get('db')
  const unitId = c.req.param('unitId')
  const unit = await findUnitById(db, unitId)
  if (unit === undefined) throw notFound('单位不存在')

  const templateRow = await findLatestTemplateForUnit(db, unitId)
  const licenses = await listLicensesForUnit(db, unitId)

  return c.json({
    ok: true as const,
    data: {
      unit: toUnitSummaryRow(unit),
      publicKeyJwk: unit.public_key_jwk === null ? null : JSON.parse(unit.public_key_jwk),
      template: templateRow === undefined ? null : toTemplateVersion(templateRow),
      licenses: licenses.map((row) => ({
        code: row.code,
        expiresAt: row.expires_at,
        status: effectiveLicenseStatus(row),
        renewCount: row.renew_count,
        createdAt: row.created_at,
      })),
    },
  })
})


/** 接口 18：删除单位（有下级 409；级联删除授权码/令牌/批次/模板等）。 */
adminUnitsRouter.delete('/admin/units/:unitId', async (c) => {
  const db = c.get('db')
  const auth = c.get('adminAuth')
  const unitId = c.req.param('unitId')
  if ((await findUnitById(db, unitId)) === undefined) throw notFound('单位不存在')
  const deleted = await db.transaction((tx) => deleteUnit(tx, unitId))
  if (!deleted) throw conflict('该单位下仍有下级单位，请先删除下级单位')
  await recordAudit(db, {
    adminUserId: auth.adminUserId,
    action: 'unit-delete',
    target: unitId,
    ip: c.req.header('x-forwarded-for') ?? null,
  })
  return c.json({ ok: true as const, data: { ok: true as const } })
})
adminUnitsRouter.post('/admin/units/:unitId/licenses', async (c) => {
  const db = c.get('db')
  const auth = c.get('adminAuth')
  const unitId = c.req.param('unitId')
  const unit = await findUnitById(db, unitId)
  if (unit === undefined) throw notFound('单位不存在')
  if (unit.level !== 2) throw badRequest('仅二级单位可签发授权码')
  // 契约/DDL 约束：一个单位至多一条未作废授权码（换码路径走「先作废再签发」）
  if (await findActiveLicenseForUnit(db, unitId) !== undefined) {
    throw conflict('该单位已有未作废授权码')
  }

  const parsed = issueLicenseBodySchema.safeParse(await readJsonObject(c))
  if (!parsed.success) throw badRequest()

  const expiresAt = monthsToExpiresAt(parsed.data.months)
  let code: string
  try {
    code = await issueLicense(db, unitId, expiresAt)
  } catch (err) {
    // 并发双发：预检已过但另一请求抢先签发 → 部分唯一索引 23505，转契约冲突文案
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
      throw conflict('该单位已有未作废授权码')
    }
    throw err
  }
  await recordAudit(db, { adminUserId: auth.adminUserId, action: 'license-issue', target: code, ip: c.req.header('x-forwarded-for') ?? null })
  return c.json({ ok: true as const, data: { code, expiresAt } })
})

/** 接口 19：作废授权码（级联失效令牌，幂等）。 */
adminUnitsRouter.post('/admin/licenses/:code/revoke', async (c) => {
  const db = c.get('db')
  const auth = c.get('adminAuth')
  const code = c.req.param('code')
  const body = await readOptionalJsonObject(c)
  const reason = typeof body.reason === 'string' ? body.reason : undefined

  const license = await findLicenseByCode(db, code)
  if (license === undefined) throw notFound('授权码不存在')
  if (license.status !== 'revoked') {
    await db.transaction(async (tx) => {
      await tx.query(`UPDATE license SET status = 'revoked', updated_at = $2 WHERE code = $1`, [code, Date.now()])
      await tx.query(`UPDATE unit_token SET status = 'revoked' WHERE license_code = $1 AND status = 'active'`, [code])
    })
    await recordAudit(db, {
      adminUserId: auth.adminUserId,
      action: 'license-revoke',
      target: code,
      detail: reason ?? null,
      ip: c.req.header('x-forwarded-for') ?? null,
    })
  }
  return c.json({ ok: true as const, data: { code, status: 'revoked' as const } })
})

/** 接口 19：续期授权码（已作废不可续期）。 */
adminUnitsRouter.post('/admin/licenses/:code/renew', async (c) => {
  const db = c.get('db')
  const auth = c.get('adminAuth')
  const code = c.req.param('code')

  const license = await findLicenseByCode(db, code)
  if (license === undefined) throw notFound('授权码不存在')
  if (license.status === 'revoked') throw conflict('授权码已作废，不可续期')

  const parsed = renewBodySchema.safeParse(await readJsonObject(c))
  if (!parsed.success) throw badRequest()

  const at = Date.now()
  const extension = parsed.data.months * 30 * 86_400_000
  const updatedRows = await db.transaction((tx) => tx.query<{ expires_at: number; renew_count: number }>(
    `UPDATE license SET expires_at = GREATEST(expires_at, $2) + $3,
       renewed_at = $4, renew_count = renew_count + 1,
       status = 'active', updated_at = $4
     WHERE code = $1 AND status <> 'revoked'
     RETURNING expires_at, renew_count`,
    [code, at, extension, at],
  ).then(async (rows) => {
    const updated = rows[0]
    if (updated !== undefined) {
      await tx.query(`UPDATE unit_token SET expires_at = $2 WHERE license_code = $1 AND status = 'active'`, [
        code,
        updated.expires_at,
      ])
    }
    return rows
  }))
  const updatedLicense = updatedRows[0]
  if (updatedLicense === undefined) throw conflict('授权码已作废，不可续期')
  await recordAudit(db, {
    adminUserId: auth.adminUserId,
    action: 'license-renew',
    target: code,
    detail: `+${parsed.data.months} 个月`,
    ip: c.req.header('x-forwarded-for') ?? null,
  })

  const updated = (await findLicenseByCode(db, code)) as NonNullable<typeof license>
  return c.json({
    ok: true as const,
    data: { code, expiresAt: updated.expires_at, status: effectiveLicenseStatus(updated), renewCount: updated.renew_count },
  })
})

/** 接口 20：模板列表（每个 id 的最新版本行）。 */
adminUnitsRouter.get('/admin/templates', async (c) => {
  const db = c.get('db')
  const rows = await listLatestTemplateVersions(db)
  return c.json({ ok: true as const, data: { templates: rows.map(toTemplateVersion) } })
})

/** 接口 20：上传配置模板（须过 unit-config schema；published 三元组不可覆盖）。 */
adminUnitsRouter.post('/admin/templates', async (c) => {
  const db = c.get('db')
  const auth = c.get('adminAuth')
  const parsed = uploadTemplateBodySchema.safeParse(await readJsonObject(c))
  if (!parsed.success || !isUnitConfig(parsed.data.config)) {
    throw badRequest(`配置格式不合法：${parsed.success ? (firstConfigError(parsed.data.config) ?? '结构不符') : '请求体不合法'}`)
  }
  const config = parsed.data.config as unknown as UnitConfig

  // 模板属于配置中的二级单位，不能错误地绑定到展示分组。
  const unitInfo = config.unit as { unitId?: string; parentUnit?: { unitId?: string } }
  const unitId = unitInfo.unitId
  if (unitId === undefined || (await findUnitById(db, unitId)) === undefined) throw notFound('单位不存在')

  const versionsForTemplate = await listTemplateVersions(db, config.id)
  if (versionsForTemplate.some((version) => version.unit_id !== unitId)) {
    throw conflict('模板 ID 已归属于其他单位')
  }
  if (await findTemplateVersion(db, config.id, config.version, config.revision)) {
    const existing = (await findTemplateVersion(db, config.id, config.version, config.revision)) as { status: string }
    if (existing.status !== 'draft') throw conflict('该版本已发布，请升修订号后再上传')
  }
  await insertTemplateFromConfig(db, config, unitId)
  await recordAudit(db, {
    adminUserId: auth.adminUserId,
    action: 'template-upload',
    target: `${config.id}@${config.version}.${config.revision}`,
    ip: c.req.header('x-forwarded-for') ?? null,
  })

  const row = await findTemplateVersion(db, config.id, config.version, config.revision)
  if (row === undefined) throw new Error('上传后读取模板版本失败')
  return c.json({ ok: true as const, data: toTemplateVersion(row) })
})

/** 接口 20：模板版本历史。 */
adminUnitsRouter.get('/admin/templates/:templateId/versions', async (c) => {
  const db = c.get('db')
  const templateId = c.req.param('templateId')
  const versions = await listTemplateVersions(db, templateId)
  if (versions.length === 0) throw notFound('模板不存在')
  return c.json({ ok: true as const, data: { versions: versions.map(toTemplateVersion) } })
})

/** 接口 20：查看模板配置内容（后台只读，返回完整 UnitConfig）。 */
adminUnitsRouter.get('/admin/templates/:templateId/versions/:version/:revision/config', async (c) => {
  const db = c.get('db')
  const templateId = c.req.param('templateId')
  const version = Number(c.req.param('version'))
  const revision = Number(c.req.param('revision'))
  if (!Number.isInteger(version) || version < 1 || !Number.isInteger(revision) || revision < 0) {
    throw badRequest('版本参数不合法')
  }
  const row = await findTemplateVersion(db, templateId, version, revision)
  if (row === undefined) throw notFound('模板版本不存在')

  const config: UnitConfig = {
    schemaVersion: row.schema_version,
    id: row.id,
    name: row.name,
    version: row.version,
    revision: row.revision,
    status: row.status,
    unit: JSON.parse(row.unit_json),
    class: JSON.parse(row.class_json),
    student: JSON.parse(row.student_json),
    dyf: JSON.parse(row.dyf_json),
    calc: JSON.parse(row.calc_json),
    rank: JSON.parse(row.rank_json),
    updatedAt: row.updated_at,
  }
  return c.json({ ok: true as const, data: { config } })
})

/** 接口 20：发布模板版本（同 id 其他 published 转 archived）。 */
adminUnitsRouter.post('/admin/templates/:templateId/publish', async (c) => {
  const db = c.get('db')
  const auth = c.get('adminAuth')
  const templateId = c.req.param('templateId')

  const parsed = publishBodySchema.safeParse(await readJsonObject(c))
  if (!parsed.success) throw badRequest()
  const { version, revision } = parsed.data

  const row = await findTemplateVersion(db, templateId, version, revision)
  if (row === undefined) throw notFound('模板版本不存在')
  if (row.status === 'archived') throw conflict('已归档的版本不可发布')
  if (row.status === 'published') throw conflict('该版本已是发布状态')

  await publishTemplateVersion(db, templateId, version, revision)
  await recordAudit(db, {
    adminUserId: auth.adminUserId,
    action: 'template-publish',
    target: `${templateId}@${version}.${revision}`,
    ip: c.req.header('x-forwarded-for') ?? null,
  })
  const published = await findTemplateVersion(db, templateId, version, revision)
  if (published === undefined) throw new Error('发布后读取模板版本失败')
  return c.json({ ok: true as const, data: toTemplateVersion(published) })
})
