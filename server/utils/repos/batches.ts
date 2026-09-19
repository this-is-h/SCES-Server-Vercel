import type { Db } from '../db/types.js'

export type BatchRow = {
  id: string
  unit_id: string
  year: number
  semester: number
  is_test: number
  status: string
  apply_start_at: number | null
  apply_end_at: number | null
  key_id: string | null
  calc_mode: string
  calc_config: string
  public_key_jwk: string
  config_template_id: string
  config_template_version: number
  config_template_revision: number
  created_at: number
  updated_at: number
}

export type BatchStatus = 'draft' | 'active' | 'closed'

export const BATCH_STATUS_ORDER: Record<BatchStatus, number> = { draft: 0, active: 1, closed: 2 }

export async function findBatchById(db: Db, batchId: string): Promise<BatchRow | undefined> {
  const rows = await db.query<BatchRow>(`SELECT * FROM batch WHERE id = $1`, [batchId])
  return rows[0]
}

/** 正式批次在同一单位的同一 (year, semester) 唯一（DDL 唯一部分索引的先行判定）。 */
export async function findOfficialBatch(
  db: Db,
  unitId: string,
  year: number,
  semester: number,
): Promise<BatchRow | undefined> {
  const rows = await db.query<BatchRow>(
    `SELECT * FROM batch WHERE unit_id = $1 AND year = $2 AND semester = $3 AND is_test = 0`,
    [unitId, year, semester],
  )
  return rows[0]
}

export async function insertBatch(
  db: Db,
  input: {
    id: string
    unitId: string
    year: number
    semester: number
    isTest: boolean
    applyStartAt: number | null
    applyEndAt: number | null
    calcMode: string
    calcConfig: string
    publicKeyJwk: string
    keyId: string
    configTemplateId: string
    configTemplateVersion: number
    configTemplateRevision: number
  },
): Promise<number> {
  const at = Date.now()
  await db.query(
    `INSERT INTO batch
       (id, unit_id, year, semester, is_test, status, apply_start_at, apply_end_at, key_id, calc_mode, calc_config,
        public_key_jwk, config_template_id, config_template_version, config_template_revision, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
    [
      input.id,
      input.unitId,
      input.year,
      input.semester,
      input.isTest ? 1 : 0,
      input.applyStartAt,
      input.applyEndAt,
      input.keyId,
      input.calcMode,
      input.calcConfig,
      input.publicKeyJwk,
      input.configTemplateId,
      input.configTemplateVersion,
      input.configTemplateRevision,
      at,
    ],
  )
  return at
}

export async function updateBatchStatus(db: Db, batchId: string, status: BatchStatus, expectedStatus?: BatchStatus): Promise<number | undefined> {
  const at = Date.now()
  const rows = await db.query<{ id: string }>(
    `UPDATE batch SET status = $2, updated_at = $3 WHERE id = $1 AND ($4::text IS NULL OR status = $4) RETURNING id`,
    [batchId, status, at, expectedStatus ?? null],
  )
  return rows.length > 0 ? at : undefined
}

/** 活跃批次下发（接口 11）：status = 'active' 且未过申请截止；
 * 并存时正式批次优先，其次 createdAt 最新（对应 DDL 索引 idx_batch_active_lookup）。
 */
export async function findActiveBatch(db: Db, unitId: string): Promise<BatchRow | undefined> {
  const rows = await db.query<BatchRow>(
    `SELECT * FROM batch
     WHERE unit_id = $1 AND status = 'active' AND (apply_end_at IS NULL OR apply_end_at >= $2)
     ORDER BY is_test ASC, created_at DESC
     LIMIT 1`,
    [unitId, Date.now()],
  )
  return rows[0]
}

/** 契约 BatchPublic：批次公开字段（不含私钥）。 */
export type BatchPublic = {
  batchId: string
  unitId: string
  year: number
  semester: number
  isTest: boolean
  status: string
  applyStartAt: number | null
  applyEndAt: number | null
  keyId: string | null
  calcMode: string
  calcConfig: unknown
  publicKeyJwk: unknown
  configTemplateId: string
  configTemplateVersion: number
  configTemplateRevision: number
  createdAt: number
  updatedAt: number
}

export function toBatchPublic(row: BatchRow): BatchPublic {
  return {
    batchId: row.id,
    unitId: row.unit_id,
    year: row.year,
    semester: row.semester,
    isTest: row.is_test === 1,
    status: row.status,
    applyStartAt: row.apply_start_at,
    applyEndAt: row.apply_end_at,
    keyId: row.key_id,
    calcMode: row.calc_mode,
    calcConfig: JSON.parse(row.calc_config),
    publicKeyJwk: JSON.parse(row.public_key_jwk),
    configTemplateId: row.config_template_id,
    configTemplateVersion: row.config_template_version,
    configTemplateRevision: row.config_template_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
