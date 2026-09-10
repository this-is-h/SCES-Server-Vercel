import { Hono } from 'hono'
import type { AppEnv } from '../http/env'
import { assertLevelOne, requireUnitToken, requireWritableUnit } from '../http/guards'
import { clientIp, readJsonObject, readOptionalJsonObject } from '../http/parse'
import { recordAudit } from '../lib/audit'
import { ApiError, badRequest, conflict, forbidden, notFound } from '../lib/errors'
import { APPLY_ID_PATTERN, UUID_PATTERN, sha256Hex } from '../lib/hash'
import {
  APPLY_STATUS_ORDER,
  advanceStatus,
  findLatestRound,
  findRound,
  insertRegistered,
  insertReviewRound,
  toApplyStatusRecord,
  updateLatestRevision,
  type ApplyStatus,
  type ApplyStatusRecord,
} from '../repos/apply-status'
import { applyStatusBodySchema, bulkApplyBodySchema, registerBodySchema, reviewRoundBodySchema } from '../schemas/apply'
import { findBatchById } from '../repos/batches'
import { findUnitById } from '../repos/units'
/** 批量（接口 7）逐条结果：记录字段 + ok/error 标记。 */
type BulkResultItem = ApplyStatusRecord & { ok: boolean; error: string | null }

/** 接口 7/8/9/12/13：申请状态同步、学生端注册与查询、新一轮审核。 */
export const appliesRouter = new Hono<AppEnv>()

/** 接口 12：学生端注册（公开，严格限流）。 */
appliesRouter.post('/applies/:applyId/register', async (c) => {
  const applyId = c.req.param('applyId')
  if (!APPLY_ID_PATTERN.test(applyId)) throw badRequest()

  const body = await readJsonObject(c)
  const parsed = registerBodySchema.safeParse(body)
  if (!parsed.success) throw badRequest()
  const { batchId, revision } = parsed.data

  const db = c.get('db')
  const batch = await findBatchById(db, batchId)
  if (batch === undefined) throw notFound('批次不存在')
  if (batch.status !== 'active') throw forbidden('批次未开放申请')
  if (batch.apply_end_at !== null && batch.apply_end_at < Date.now()) throw forbidden('申请已截止')

  const hash = sha256Hex(applyId)
  const existing = await findLatestRound(db, hash)
  if (existing !== undefined) {
    if (APPLY_STATUS_ORDER[existing.status] >= APPLY_STATUS_ORDER.imported) {
      throw conflict('该申请已被导入，不可再提交新版本')
    }
    if (revision < (existing.latest_revision ?? 0)) throw conflict('申请版本号不允许回退')
    if (revision === (existing.latest_revision ?? 0)) {
      return c.json({ ok: true as const, data: toApplyStatusRecord(applyId, existing) })
    }
    await updateLatestRevision(db, hash, existing.review_round, revision)
    const row = await findRound(db, hash, existing.review_round)
    if (row === undefined) throw new ApiError(500, '服务端异常，请稍后重试')
    return c.json({ ok: true as const, data: toApplyStatusRecord(applyId, row) })
  }

  await insertRegistered(db, { applyIdHash: hash, unitId: batch.unit_id, batchId, revision })
  const row = await findRound(db, hash, 1)
  if (row === undefined) throw new ApiError(500, '服务端异常，请稍后重试')
  return c.json({ ok: true as const, data: toApplyStatusRecord(applyId, row) })
})

/** 接口 8：单条申请状态上报（unitToken）。 */
appliesRouter.post('/applies/:applyId/status', requireUnitToken, async (c) => {
  const auth = await requireWritableUnit(c)
  const applyId = c.req.param('applyId')
  if (!APPLY_ID_PATTERN.test(applyId)) throw badRequest()

  const body = await readJsonObject(c)
  const parsed = applyStatusBodySchema.safeParse(body)
  if (!parsed.success) throw badRequest()
  const { batchId, status, revision } = parsed.data

  const db = c.get('db')
  const hash = sha256Hex(applyId)
  const existing = await findLatestRound(db, hash)
  if (existing === undefined) throw notFound()
  if (existing.unit_id !== auth.unitId || existing.batch_id !== batchId) throw notFound()

  if (APPLY_STATUS_ORDER[status] < APPLY_STATUS_ORDER[existing.status]) {
    throw conflict('申请状态不允许回退')
  }
  if (APPLY_STATUS_ORDER[status] === APPLY_STATUS_ORDER[existing.status]) {
    // 同状态重复上报幂等（决策 #39 网络重试安全）；revision 前进时刷新导入版本
    if (revision !== undefined && revision !== existing.imported_revision) {
      await advanceStatus(db, { applyIdHash: hash, reviewRound: existing.review_round, status, revision })
      const updated = await findRound(db, hash, existing.review_round)
      if (updated === undefined) throw new ApiError(500, '服务端异常，请稍后重试')
      return c.json({ ok: true as const, data: toApplyStatusRecord(applyId, updated) })
    }
    return c.json({ ok: true as const, data: toApplyStatusRecord(applyId, existing) })
  }

  await advanceStatus(db, { applyIdHash: hash, reviewRound: existing.review_round, status, revision })
  const row = await findRound(db, hash, existing.review_round)
  if (row === undefined) throw new ApiError(500, '服务端异常，请稍后重试')
  return c.json({ ok: true as const, data: toApplyStatusRecord(applyId, row) })
})

/** 接口 9：单条发起新一轮审核（仅一级单位令牌）。 */
appliesRouter.post('/applies/:applyId/review-rounds', requireUnitToken, async (c) => {
  const auth = await requireWritableUnit(c)
  assertLevelOne(auth)
  const applyId = c.req.param('applyId')
  if (!APPLY_ID_PATTERN.test(applyId)) throw badRequest()

  const body = await readOptionalJsonObject(c)
  const parsed = reviewRoundBodySchema.safeParse(body)
  if (!parsed.success) throw badRequest()

  const db = c.get('db')
  const hash = sha256Hex(applyId)
  const current = await findLatestRound(db, hash)
  if (current === undefined) throw notFound()

  // 一级单位令牌可对本级或其下属二级单位的申请发起新一轮（决策 #31）
  const batch = await findBatchById(db, current.batch_id)
  if (batch === undefined || batch.unit_id !== current.unit_id) throw notFound()
  const currentUnit = await findUnitById(db, current.unit_id)
  if (currentUnit === undefined) throw notFound()
  const owns = current.unit_id === auth.unitId || currentUnit.parent_id === auth.unitId
  if (!owns) throw notFound()
  if (current.status !== 'confirmed') throw conflict('当前轮次尚未确认，无法发起新一轮审核')

  const nextRound = current.review_round + 1
  await insertReviewRound(db, {
    applyIdHash: hash,
    unitId: current.unit_id,
    batchId: current.batch_id,
    reviewRound: nextRound,
    latestRevision: current.latest_revision,
    importedRevision: current.imported_revision,
    importedAt: current.imported_at,
  })
  await recordAudit(db, {
    action: 'apply-review-round',
    target: auth.unitId,
    detail: parsed.data.reason ?? null,
    ip: clientIp(c) ?? null,
  })

  const row = await findRound(db, hash, nextRound)
  if (row === undefined) throw new ApiError(500, '服务端异常，请稍后重试')
  return c.json({ ok: true as const, data: toApplyStatusRecord(applyId, row) })
})

/** 接口 13：申请状态查询（公开，严格限流；未知 applyId 返回 status=unknown 而非 404）。 */
appliesRouter.get('/applies/:applyId', async (c) => {
  const applyId = c.req.param('applyId')
  if (!APPLY_ID_PATTERN.test(applyId)) throw badRequest()

  const row = await findLatestRound(c.get('db'), sha256Hex(applyId))
  if (row === undefined) {
    return c.json({
      ok: true as const,
      data: {
        applyId,
        status: 'unknown',
        reviewRound: null,
        latestRevision: null,
        importedRevision: null,
        importedAt: null,
        updatedAt: null,
      },
    })
  }
  return c.json({ ok: true as const, data: toApplyStatusRecord(applyId, row) })
})

/** 接口 7：批量申请状态上报（unitToken；逐条结果，整批不因个别失败回滚）。 */
appliesRouter.post('/batches/:batchId/apply-statuses', requireUnitToken, async (c) => {
  const auth = await requireWritableUnit(c)
  const batchId = c.req.param('batchId')
  if (!UUID_PATTERN.test(batchId)) throw badRequest()

  const body = await readJsonObject(c)
  const parsed = bulkApplyBodySchema.safeParse(body)
  if (!parsed.success) throw badRequest()
  const { status, applyIds, revision, startNewRound } = parsed.data

  if (startNewRound) {
    if (status !== 'reviewing') throw badRequest()
    assertLevelOne(auth)
  }

  const db = c.get('db')
  const batch = await findBatchById(db, batchId)
  if (batch === undefined) throw notFound()

  // 批次归属本单位，或本单位是一级且批次属于其下属二级单位（决策 #31 整班重审）
  if (batch.unit_id !== auth.unitId) {
    if (!startNewRound || auth.unitLevel !== 1) throw notFound()
    const batchUnit = await findUnitById(db, batch.unit_id)
    if (batchUnit === undefined || batchUnit.parent_id !== auth.unitId) throw notFound()
  }

  const results: BulkResultItem[] = []
  let succeeded = 0
  let failed = 0

  for (const applyId of applyIds) {
    const hash = sha256Hex(applyId)
    const current = await findLatestRound(db, hash)
    const fail = (error: string): void => {
      failed += 1
      results.push({
        applyId,
        ok: false,
        error,
        reviewRound: 0,
        status: (current?.status ?? 'draft') as ApplyStatus,
        latestRevision: current?.latest_revision ?? null,
        importedRevision: current?.imported_revision ?? null,
        importedAt: current?.imported_at ?? null,
        updatedAt: (current?.updated_at ?? 0),
      })
    }

    if (current === undefined || current.batch_id !== batchId) {
      fail('资源不存在')
      continue
    }

    if (startNewRound) {
      if (current.status !== 'confirmed') {
        fail('当前轮次尚未确认，无法发起新一轮审核')
        continue
      }
      await insertReviewRound(db, {
        applyIdHash: hash,
        unitId: current.unit_id,
        batchId: current.batch_id,
        reviewRound: current.review_round + 1,
        latestRevision: current.latest_revision,
        importedRevision: current.imported_revision,
        importedAt: current.imported_at,
      })
      const row = await findRound(db, hash, current.review_round + 1)
      if (row === undefined) {
        fail('服务端异常，请稍后重试')
        continue
      }
      succeeded += 1
      results.push({ ...toApplyStatusRecord(applyId, row), ok: true, error: null })
      continue
    }

    if (APPLY_STATUS_ORDER[status] < APPLY_STATUS_ORDER[current.status]) {
      fail('申请状态不允许回退')
      continue
    }
    if (APPLY_STATUS_ORDER[status] === APPLY_STATUS_ORDER[current.status]) {
      succeeded += 1
      results.push({ ...toApplyStatusRecord(applyId, current), ok: true, error: null })
      continue
    }

    await advanceStatus(db, {
      applyIdHash: hash,
      reviewRound: current.review_round,
      status,
      revision,
    })
    const row = await findRound(db, hash, current.review_round)
    if (row === undefined) {
      fail('服务端异常，请稍后重试')
      continue
    }
    succeeded += 1
    results.push({ ...toApplyStatusRecord(applyId, row), ok: true, error: null })
  }

  return c.json({ ok: true as const, data: { succeeded, failed, results } })
})