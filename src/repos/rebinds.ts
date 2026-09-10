import type { Db } from '../db/types'

export type RebindStatus = 'self-served' | 'pending' | 'approved' | 'rejected'

export type RebindRow = {
  id: string
  unit_id: string
  install_id: string
  reason: string | null
  old_code: string | null
  new_code: string | null
  status: RebindStatus
  month_key: string
  month_count: number
  created_at: number
  resolved_at: number | null
}

export async function countRebindsInMonth(db: Db, unitId: string, monthKey: string): Promise<number> {
  const rows = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM rebind_request WHERE unit_id = $1 AND month_key = $2`,
    [unitId, monthKey],
  )
  return rows[0]?.count ?? 0
}

export async function insertRebind(
  db: Db,
  input: {
    id: string
    unitId: string
    installId: string
    reason: string | null
    oldCode: string
    newCode: string | null
    status: RebindStatus
    monthKey: string
    monthCount: number
    resolvedAt: number | null
  },
): Promise<void> {
  await db.query(
    `INSERT INTO rebind_request
       (id, unit_id, install_id, reason, old_code, new_code, status, month_key, month_count, created_at, resolved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.id,
      input.unitId,
      input.installId,
      input.reason,
      input.oldCode,
      input.newCode,
      input.status,
      input.monthKey,
      input.monthCount,
      Date.now(),
      input.resolvedAt,
    ],
  )
}
