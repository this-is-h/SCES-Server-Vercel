import type { Db } from '../db/types'

export interface AuditEntry {
  adminUserId?: string | null
  /** kebab-case 操作类型，如 unit-public-key-update / rebind-self-served。 */
  action: string
  /** 操作对象标识（单位 id / 授权码 / 模板 id 等）。 */
  target: string
  detail?: string | null
  ip?: string | null
}

export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (admin_user_id, action, target, detail, ip, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entry.adminUserId ?? null, entry.action, entry.target, entry.detail ?? null, entry.ip ?? null, Date.now()],
  )
}
