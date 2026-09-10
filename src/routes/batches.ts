import { Hono } from 'hono'
import type { AppEnv } from '../http/env'
import { assertLicenseUsable, assertUnitIdentity, requireUnitToken } from '../http/guards'
import { readJsonObject } from '../http/parse'
import { isUniqueViolation } from '../db/errors'
import { ApiError, badRequest, conflict, notFound, unauthorized } from '../lib/errors'
import { UNIT_ID_PATTERN, UUID_PATTERN } from '../lib/hash'
import {
  BATCH_STATUS_ORDER,
  findActiveBatch,
  findBatchById,
  findOfficialBatch,
  insertBatch,
  toBatchPublic,
  updateBatchStatus,
  type BatchStatus,
} from '../repos/batches'
import { findTemplateVersion, toUnitConfig } from '../repos/config-templates'
import { findLicenseByCode } from '../repos/licenses'
import { findUnitById } from '../repos/units'
import { batchPayloadSchema, batchStatusSchema } from '../schemas/batch'

/** 接口 5/6/11：批次登记、状态同步、活跃批次下发。 */
export const batchesRouter = new Hono<AppEnv>()

/** 写接口公共前置：令牌上下文一致性 + 授权处于有效期内。 */
async function requireWritableUnit(c: Parameters<typeof assertUnitIdentity>[0]) {
  const auth = c.get('unitAuth')
  assertUnitIdentity(c, auth)
  const license = await findLicenseByCode(c.get('db'), auth.licenseCode)
  if (license === undefined) throw unauthorized()
  assertLicenseUsable(license)
  return auth
}

batchesRouter.post('/batches', requireUnitToken, async (c) => {
  const auth = await requireWritableUnit(c)
  const db = c.get('db')

  const body = await readJsonObject(c)
  const parsed = batchPayloadSchema.safeParse(body.batch)
  if (!parsed.success) throw badRequest()
  const payload = parsed.data

  // 同 batchId 重复上报幂等返回现有记录（决策 #33）
  const existing = await findBatchById(db, payload.batchId)
  if (existing !== undefined) {
    if (existing.unit_id !== auth.unitId) throw conflict('批次标识已被占用')
    return c.json({
      ok: true as const,
      data: { batchId: existing.id, status: existing.status, createdAt: existing.created_at },
    })
  }

  // 正式批次在同一单位的同一学年学期唯一（DDL 唯一部分索引）
  if (!payload.isTest) {
    const official = await findOfficialBatch(db, auth.unitId, payload.year, payload.semester)
    if (official !== undefined) throw conflict('该学年学期已存在正式批次')
  }

  // 批次以 (id, version, revision) 三元组快照引用配置模板
  const template = await findTemplateVersion(
    db,
    payload.configTemplateId,
    payload.configTemplateVersion,
    payload.configTemplateRevision,
  )
  if (template === undefined) throw badRequest()

  let createdAt: number
  try {
    createdAt = await insertBatch(db, {
      id: payload.batchId,
      unitId: auth.unitId,
      year: payload.year,
      semester: payload.semester,
      isTest: payload.isTest,
      applyStartAt: payload.applyStartAt ?? null,
      applyEndAt: payload.applyEndAt ?? null,
      calcMode: payload.calcMode,
      calcConfig: JSON.stringify(payload.calcConfig),
      publicKeyJwk: JSON.stringify(payload.publicKeyJwk),
      configTemplateId: payload.configTemplateId,
      configTemplateVersion: payload.configTemplateVersion,
      configTemplateRevision: payload.configTemplateRevision,
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('该学年学期已存在正式批次')
    throw err
  }

  return c.json({
    ok: true as const,
    data: { batchId: payload.batchId, status: 'draft' as const, createdAt },
  })
})

batchesRouter.post('/batches/:batchId/status', requireUnitToken, async (c) => {
  const auth = await requireWritableUnit(c)
  const batchId = c.req.param('batchId')
  if (!UUID_PATTERN.test(batchId)) throw badRequest()

  const body = await readJsonObject(c)
  const parsed = batchStatusSchema.safeParse(body.status)
  if (!parsed.success) throw badRequest()
  const next = parsed.data

  const db = c.get('db')
  const batch = await findBatchById(db, batchId)
  if (batch === undefined || batch.unit_id !== auth.unitId) throw notFound()

  const current = batch.status as BatchStatus
  if (BATCH_STATUS_ORDER[next] < BATCH_STATUS_ORDER[current]) throw conflict('批次状态不允许回退')
  if (BATCH_STATUS_ORDER[next] === BATCH_STATUS_ORDER[current]) {
    // 同状态重复上报幂等
    return c.json({
      ok: true as const,
      data: { batchId: batch.id, status: current, updatedAt: batch.updated_at },
    })
  }

  const updatedAt = await updateBatchStatus(db, batchId, next)
  return c.json({ ok: true as const, data: { batchId, status: next, updatedAt } })
})

/** 接口 11：活跃批次下发（公开，学生端按二级单位拉取）。 */
batchesRouter.get('/batches/active', async (c) => {
  const unitId = c.req.query('unitId')
  if (unitId === undefined || !UNIT_ID_PATTERN.test(unitId)) throw badRequest()

  const db = c.get('db')
  const unit = await findUnitById(db, unitId)
  if (unit === undefined) throw notFound('单位不存在')

  const batch = await findActiveBatch(db, unitId)
  if (batch === undefined) return c.json({ ok: true as const, data: { batch: null } })

  const template = await findTemplateVersion(
    db,
    batch.config_template_id,
    batch.config_template_version,
    batch.config_template_revision,
  )
  if (template === undefined) {
    console.error(`批次 ${batch.id} 引用的配置模板版本缺失`)
    throw new ApiError(500, '服务端异常，请稍后重试')
  }

  return c.json({
    ok: true as const,
    data: { batch: toBatchPublic(batch), configTemplate: toUnitConfig(template) },
  })
})
