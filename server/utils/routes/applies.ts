import { Hono } from 'hono'
import type { Db } from '../db/types.js'
import type { AppEnv } from '../http/env.js'
import { assertLevelOne, requireUnitToken, requireWritableUnit } from '../http/guards.js'
import { clientIp, readJsonObject, readOptionalJsonObject } from '../http/parse.js'
import { recordAudit } from '../lib/audit.js'
import { ApiError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js'
import { APPLY_ID_PATTERN, UUID_PATTERN, sha256Hex } from '../lib/hash.js'
import {
  APPLY_STATUS_ORDER, advanceStatus, findLatestRound, findRound,
  insertRegistered, insertReviewRound, toApplyStatusRecord, updateLatestRevision,
  type ApplyStatus, type ApplyStatusRow,
} from '../repos/apply-status.js'
import { applyStatusBodySchema, bulkApplyBodySchema, registerBodySchema, reviewRoundBodySchema } from '../schemas/apply.js'
import { findBatchById, type BatchRow } from '../repos/batches.js'
import { findUnitById } from '../repos/units.js'

export const appliesRouter = new Hono<AppEnv>()

// Serialize all writes for an applyId, including its first registration and
// new rounds. Locking only the latest row does not protect a not-yet-existing row.
async function lockApply(tx: Db, hash: string): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`apply:${hash}`])
}

async function updatedRound(tx: Db, hash: string, round: number): Promise<ApplyStatusRow> {
  const row = await findRound(tx, hash, round)
  if (row === undefined) throw new ApiError(500, '服务端异常，请稍后重试')
  return row
}

function validateAdvance(current: ApplyStatusRow, status: ApplyStatus, revision?: number): void {
  if (APPLY_STATUS_ORDER[status] < APPLY_STATUS_ORDER[current.status]) throw conflict('申请状态不允许回退')
  if (revision !== undefined && revision < (current.imported_revision ?? 0)) throw conflict('导入版本号不允许回退')
  if (current.review_round > 1 && revision !== undefined && revision !== current.imported_revision) {
    throw conflict('新一轮审核不允许重新导入')
  }
}

async function advance(tx: Db, current: ApplyStatusRow, status: ApplyStatus, revision?: number): Promise<ApplyStatusRow> {
  validateAdvance(current, status, revision)
  if (status === current.status && (revision === undefined || revision === current.imported_revision)) return current
  await advanceStatus(tx, { applyIdHash: current.apply_id_hash, reviewRound: current.review_round, status, revision })
  return updatedRound(tx, current.apply_id_hash, current.review_round)
}

function validateOpenRound(current: ApplyStatusRow): void {
  if (current.status !== 'confirmed') throw conflict('当前轮次尚未确认，无法发起新一轮审核')
  if (current.review_round >= 32767) throw conflict('审核轮次已达上限')
}

async function openRound(tx: Db, current: ApplyStatusRow): Promise<ApplyStatusRow> {
  validateOpenRound(current)
  await insertReviewRound(tx, {
    applyIdHash: current.apply_id_hash, unitId: current.unit_id, batchId: current.batch_id,
    reviewRound: current.review_round + 1, latestRevision: current.latest_revision,
    importedRevision: current.imported_revision, importedAt: current.imported_at,
  })
  return updatedRound(tx, current.apply_id_hash, current.review_round + 1)
}

/** 学生端注册。只在受信任的批次申请窗口中更新，同 applyId 不可换批次。 */
appliesRouter.post('/applies/:applyId/register', async (c) => {
  const applyId = c.req.param('applyId')
  if (!APPLY_ID_PATTERN.test(applyId)) throw badRequest()
  const parsed = registerBodySchema.safeParse(await readJsonObject(c))
  if (!parsed.success) throw badRequest()
  const { batchId, revision } = parsed.data
  const hash = sha256Hex(applyId)
  const row = await c.get('db').transaction(async (tx) => {
    await lockApply(tx, hash)
    const batch = (await tx.query<BatchRow>('SELECT * FROM batch WHERE id = $1 FOR SHARE', [batchId]))[0]
    if (batch === undefined) throw notFound('批次不存在')
    if (batch.status !== 'active') throw forbidden('批次未开放申请')
    const now = Date.now()
    if (batch.apply_start_at !== null && batch.apply_start_at > now) throw forbidden('申请尚未开始')
    if (batch.apply_end_at !== null && batch.apply_end_at < now) throw forbidden('申请已截止')
    const unit = await findUnitById(tx, batch.unit_id)
    if (unit === undefined) throw notFound('单位不存在')
    const parent = unit.parent_id === null ? undefined : await findUnitById(tx, unit.parent_id)
    if (unit.status !== 'active' || parent?.status === 'disabled') throw forbidden('单位已停用，无法提交申请')
    const existing = await findLatestRound(tx, hash)
    if (existing !== undefined) {
      if (existing.batch_id !== batchId) throw conflict('该申请已关联其他批次')
      if (APPLY_STATUS_ORDER[existing.status] >= APPLY_STATUS_ORDER.imported) throw conflict('该申请已被导入，不可再提交新版本')
      if (revision < (existing.latest_revision ?? 0)) throw conflict('申请版本号不允许回退')
      if (revision === existing.latest_revision) return existing
      await updateLatestRevision(tx, hash, existing.review_round, revision)
      return updatedRound(tx, hash, existing.review_round)
    }
    await insertRegistered(tx, { applyIdHash: hash, unitId: batch.unit_id, batchId, revision })
    return updatedRound(tx, hash, 1)
  })
  return c.json({ ok: true as const, data: toApplyStatusRecord(applyId, row) })
})

appliesRouter.post('/applies/:applyId/status', requireUnitToken, async (c) => {
  const auth = await requireWritableUnit(c)
  const applyId = c.req.param('applyId')
  if (!APPLY_ID_PATTERN.test(applyId)) throw badRequest()
  const parsed = applyStatusBodySchema.safeParse(await readJsonObject(c))
  if (!parsed.success) throw badRequest()
  const { batchId, status, revision } = parsed.data
  const hash = sha256Hex(applyId)
  const row = await c.get('db').transaction(async (tx) => {
    await lockApply(tx, hash)
    const current = await findLatestRound(tx, hash)
    if (current === undefined || current.unit_id !== auth.unitId || current.batch_id !== batchId) throw notFound()
    return advance(tx, current, status, revision)
  })
  return c.json({ ok: true as const, data: toApplyStatusRecord(applyId, row) })
})

appliesRouter.post('/applies/:applyId/review-rounds', requireUnitToken, async (c) => {
  const auth = await requireWritableUnit(c)
  assertLevelOne(auth)
  const applyId = c.req.param('applyId')
  if (!APPLY_ID_PATTERN.test(applyId)) throw badRequest()
  const parsed = reviewRoundBodySchema.safeParse(await readOptionalJsonObject(c))
  if (!parsed.success) throw badRequest()
  const hash = sha256Hex(applyId)
  const row = await c.get('db').transaction(async (tx) => {
    await lockApply(tx, hash)
    const current = await findLatestRound(tx, hash)
    if (current === undefined) throw notFound()
    const unit = await findUnitById(tx, current.unit_id)
    if (!unit || (unit.id !== auth.unitId && unit.parent_id !== auth.unitId)) throw notFound()
    const next = await openRound(tx, current)
    await recordAudit(tx, { action: 'apply-review-round', target: auth.unitId, detail: parsed.data.reason ?? null, ip: clientIp(c) ?? null })
    return next
  })
  return c.json({ ok: true as const, data: toApplyStatusRecord(applyId, row) })
})

appliesRouter.get('/applies/:applyId', async (c) => {
  const applyId = c.req.param('applyId')
  if (!APPLY_ID_PATTERN.test(applyId)) throw badRequest()
  const row = await findLatestRound(c.get('db'), sha256Hex(applyId))
  return c.json({ ok: true as const, data: row === undefined ? {
    applyId, status: 'unknown' as const, reviewRound: null, latestRevision: null,
    importedRevision: null, importedAt: null, updatedAt: null,
  } : toApplyStatusRecord(applyId, row) })
})

/** Bounded set-based transaction: partial business failures are reported per item;
 * infrastructure failures roll back all writes. No per-item network round trips. */
appliesRouter.post('/batches/:batchId/apply-statuses', requireUnitToken, async (c) => {
  const auth = await requireWritableUnit(c)
  const batchId = c.req.param('batchId')
  if (!UUID_PATTERN.test(batchId)) throw badRequest()
  const parsed = bulkApplyBodySchema.safeParse(await readJsonObject(c))
  if (!parsed.success) throw badRequest()
  const { status, applyIds, revision, startNewRound } = parsed.data
  if (startNewRound) {
    if (status !== 'reviewing') throw badRequest()
    assertLevelOne(auth)
  }
  const db = c.get('db')
  const batch = await findBatchById(db, batchId)
  if (batch === undefined) throw notFound()
  if (batch.unit_id !== auth.unitId) {
    if (!startNewRound || auth.unitLevel !== 1) throw notFound()
    const unit = await findUnitById(db, batch.unit_id)
    if (unit?.parent_id !== auth.unitId) throw notFound()
  }
  const results = await db.transaction(async (tx) => {
    const hashes = [...new Set(applyIds.map(sha256Hex))]
    // Serialized JSON is bound as text first: postgres.js otherwise encodes
    // an already-stringified value again when PostgreSQL infers a JSON OID.
    // Sort the actual lock keys (not input UUIDs) to avoid deadlocks between
    // overlapping batches, including the unlikely hashtext collision case.
    await tx.query(`SELECT pg_advisory_xact_lock(lock_id) FROM (
      SELECT DISTINCT hashtext('apply:' || value)::bigint AS lock_id
      FROM jsonb_array_elements_text($1::text::jsonb) ORDER BY lock_id
    ) AS locks ORDER BY lock_id`, [JSON.stringify(hashes)])
    // This statement gets a fresh READ COMMITTED snapshot after all locks.
    const rows = await tx.query<ApplyStatusRow>(`SELECT DISTINCT ON (apply_id_hash) *
      FROM apply_status WHERE apply_id_hash IN (SELECT jsonb_array_elements_text($1::text::jsonb))
      AND batch_id = $2 AND unit_id = $3 ORDER BY apply_id_hash, review_round DESC`,
    [JSON.stringify(hashes), batchId, batch.unit_id])
    const currentByHash = new Map(rows.map((row) => [row.apply_id_hash, row]))
    const changed = new Map<string, ApplyStatusRow>()
    const results = []
    const now = Date.now()
    for (const applyId of applyIds) {
      const hash = sha256Hex(applyId)
      const current = currentByHash.get(hash)
      try {
        if (!current) throw notFound()
        let next = current
        if (startNewRound) {
          validateOpenRound(current)
          next = { ...current, review_round: current.review_round + 1, status: 'reviewing', created_at: now, updated_at: now }
        } else {
          validateAdvance(current, status, revision)
          if (status !== current.status || (revision !== undefined && revision !== current.imported_revision)) {
            next = { ...current, status, updated_at: now,
              imported_revision: revision ?? current.imported_revision,
              imported_at: revision === undefined ? current.imported_at : now }
          }
        }
        if (next !== current) changed.set(hash, next)
        // Preserve input order and duplicate-ID semantics of single operations.
        currentByHash.set(hash, next)
        results.push({ ...toApplyStatusRecord(applyId, next), ok: true, error: null })
      } catch (error) {
        if (!(error instanceof ApiError)) throw error
        results.push({
          applyId, ok: false, error: error.message, reviewRound: current?.review_round ?? 0,
          status: current?.status ?? 'draft', latestRevision: current?.latest_revision ?? null,
          importedRevision: current?.imported_revision ?? null, importedAt: current?.imported_at ?? null,
          updatedAt: current?.updated_at ?? 0,
        })
      }
    }
    if (changed.size) {
      const changes = JSON.stringify([...changed.values()])
      if (startNewRound) {
        await tx.query(`INSERT INTO apply_status
          (apply_id_hash, unit_id, batch_id, review_round, status, latest_revision, imported_revision, imported_at, created_at, updated_at)
          SELECT apply_id_hash, unit_id, batch_id, review_round, status, latest_revision, imported_revision, imported_at, created_at, updated_at
          FROM jsonb_populate_recordset(NULL::apply_status, $1::text::jsonb)`, [changes])
        await tx.query(`INSERT INTO audit_log (action, target, ip, created_at)
          SELECT 'apply-review-round', $2, $3, $4 FROM jsonb_array_elements($1::text::jsonb)`,
        [changes, auth.unitId, clientIp(c) ?? null, now])
      } else {
        await tx.query(`UPDATE apply_status AS target SET status = changes.status,
          imported_revision = changes.imported_revision, imported_at = changes.imported_at, updated_at = changes.updated_at
          FROM jsonb_populate_recordset(NULL::apply_status, $1::text::jsonb) AS changes
          WHERE target.apply_id_hash = changes.apply_id_hash AND target.review_round = changes.review_round
          AND target.batch_id = $2 AND target.unit_id = $3`, [changes, batchId, batch.unit_id])
      }
    }
    return results
  })
  const succeeded = results.filter((row) => row.ok).length
  return c.json({ ok: true as const, data: { succeeded, failed: results.length - succeeded, results } })
})
