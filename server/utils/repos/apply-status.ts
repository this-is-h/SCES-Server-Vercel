import type { Db } from '../db/types.js'

export type ApplyStatus = 'draft' | 'submitted' | 'imported' | 'reviewing' | 'confirmed'

export const APPLY_STATUS_ORDER: Record<ApplyStatus, number> = {
  draft: 0,
  submitted: 1,
  imported: 2,
  reviewing: 3,
  confirmed: 4,
}

const APPLY_STATUS_SQL_RANK: Record<ApplyStatus, number> = APPLY_STATUS_ORDER

export type ApplyStatusRow = {
  apply_id_hash: string
  unit_id: string
  batch_id: string
  review_round: number
  status: ApplyStatus
  latest_revision: number | null
  imported_revision: number | null
  imported_at: number | null
  created_at: number
  updated_at: number
}

/** 契约 ApplyStatusRecord：applyId 明文仅由调用方持有，落库只存哈希。 */
export type ApplyStatusRecord = {
  applyId: string
  reviewRound: number
  status: ApplyStatus
  latestRevision: number | null
  importedRevision: number | null
  importedAt: number | null
  updatedAt: number
}

/** 当前（最大轮次）状态行。 */
export async function findLatestRound(db: Db, applyIdHash: string, lock = false): Promise<ApplyStatusRow | undefined> {
  const rows = await db.query<ApplyStatusRow>(
    `SELECT * FROM apply_status WHERE apply_id_hash = $1 ORDER BY review_round DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [applyIdHash],
  )
  return rows[0]
}

export async function findRound(
  db: Db,
  applyIdHash: string,
  reviewRound: number,
): Promise<ApplyStatusRow | undefined> {
  const rows = await db.query<ApplyStatusRow>(
    `SELECT * FROM apply_status WHERE apply_id_hash = $1 AND review_round = $2`,
    [applyIdHash, reviewRound],
  )
  return rows[0]
}

/** 学生端注册（接口 12）：首次注册落 reviewRound=1、status=submitted。 */
export async function insertRegistered(
  db: Db,
  input: { applyIdHash: string; unitId: string; batchId: string; revision: number },
): Promise<number> {
  const at = Date.now()
  await db.query(
    `INSERT INTO apply_status (apply_id_hash, unit_id, batch_id, review_round, status, latest_revision, created_at, updated_at)
     VALUES ($1, $2, $3, 1, 'submitted', $4, $5, $5)
     ON CONFLICT (apply_id_hash, review_round) DO NOTHING`,
    [input.applyIdHash, input.unitId, input.batchId, input.revision, at],
  )
  return at
}

/** 注册更高版本（接口 12）：更新 latest_revision 并重置为 submitted。 */
export async function updateLatestRevision(
  db: Db,
  applyIdHash: string,
  reviewRound: number,
  revision: number,
): Promise<number> {
  const at = Date.now()
  await db.query(
    `UPDATE apply_status SET latest_revision = $3, status = 'submitted', updated_at = $4
     WHERE apply_id_hash = $1 AND review_round = $2`,
    [applyIdHash, reviewRound, revision, at],
  )
  return at
}

/** 单轮内单向推进（接口 8/7）；revision 命中时一并记 imported 版本与时间。 */
export async function advanceStatus(
  db: Db,
  input: {
    applyIdHash: string
    reviewRound: number
    status: ApplyStatus
    revision?: number
  },
): Promise<number> {
  const at = Date.now()
  if (input.revision !== undefined) {
    await db.query(
      `UPDATE apply_status SET status = $3, imported_revision = $4, imported_at = $5, updated_at = $5
       WHERE apply_id_hash = $1 AND review_round = $2
         AND CASE status WHEN 'draft' THEN 0 WHEN 'submitted' THEN 1 WHEN 'imported' THEN 2 WHEN 'reviewing' THEN 3 WHEN 'confirmed' THEN 4 END <= $6`,
      [input.applyIdHash, input.reviewRound, input.status, input.revision, at, APPLY_STATUS_SQL_RANK[input.status]],
    )
  } else {
    await db.query(
      `UPDATE apply_status SET status = $3, updated_at = $4
       WHERE apply_id_hash = $1 AND review_round = $2
         AND CASE status WHEN 'draft' THEN 0 WHEN 'submitted' THEN 1 WHEN 'imported' THEN 2 WHEN 'reviewing' THEN 3 WHEN 'confirmed' THEN 4 END <= $5`,
      [input.applyIdHash, input.reviewRound, input.status, at, APPLY_STATUS_SQL_RANK[input.status]],
    )
  }
  return at
}

/** 新一轮审核（接口 9/7 批量）：reviewRound=N+1、status=reviewing，沿用上一轮的版本与导入时间。 */
export async function insertReviewRound(
  db: Db,
  input: {
    applyIdHash: string
    unitId: string
    batchId: string
    reviewRound: number
    latestRevision: number | null
    importedRevision: number | null
    importedAt: number | null
  },
): Promise<number> {
  const at = Date.now()
  await db.query(
    `INSERT INTO apply_status
       (apply_id_hash, unit_id, batch_id, review_round, status, latest_revision, imported_revision, imported_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'reviewing', $5, $6, $7, $8, $8)
     ON CONFLICT (apply_id_hash, review_round) DO NOTHING`,
    [
      input.applyIdHash,
      input.unitId,
      input.batchId,
      input.reviewRound,
      input.latestRevision,
      input.importedRevision,
      input.importedAt,
      at,
    ],
  )
  return at
}

export function toApplyStatusRecord(applyId: string, row: ApplyStatusRow): ApplyStatusRecord {
  return {
    applyId,
    reviewRound: row.review_round,
    status: row.status,
    latestRevision: row.latest_revision,
    importedRevision: row.imported_revision,
    importedAt: row.imported_at,
    updatedAt: row.updated_at,
  }
}
