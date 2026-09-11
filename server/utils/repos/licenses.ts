import type { Db } from '../db/types.js'
import { generateLicenseCode } from '../lib/hash.js'

export type LicenseRow = {
  code: string
  unit_id: string
  expires_at: number
  status: string
  renewed_at: number | null
  renew_count: number
  created_at: number
  updated_at: number
}

export type LicenseStatus = 'active' | 'expired' | 'revoked'

export async function findLicenseByCode(db: Db, code: string): Promise<LicenseRow | undefined> {
  const rows = await db.query<LicenseRow>(`SELECT * FROM license WHERE code = $1`, [code])
  return rows[0]
}

export async function createLicense(db: Db, input: { code: string; unitId: string; expiresAt: number }): Promise<void> {
  const at = Date.now()
  await db.query(
    `INSERT INTO license (code, unit_id, expires_at, status, renew_count, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', 0, $4, $4)`,
    [input.code, input.unitId, input.expiresAt, at],
  )
}

export async function revokeLicense(db: Db, code: string): Promise<void> {
  await db.query(`UPDATE license SET status = 'revoked', updated_at = $2 WHERE code = $1`, [code, Date.now()])
}

/** 生成不冲突的新授权码并落库（重试上限 5 次，冲突概率可忽略）。 */
export async function issueLicense(db: Db, unitId: string, expiresAt: number): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateLicenseCode()
    if ((await findLicenseByCode(db, code)) === undefined) {
      await createLicense(db, { code, unitId, expiresAt })
      return code
    }
  }
  throw new Error('授权码生成连续冲突，请重试')
}

/** 契约 LicenseStatus：库内状态与时间维度取更严者（续期后自动回到 active）。 */
export function effectiveLicenseStatus(license: Pick<LicenseRow, 'status' | 'expires_at'>): LicenseStatus {
  if (license.status === 'revoked') return 'revoked'
  if (license.status === 'expired' || license.expires_at <= Date.now()) return 'expired'
  return 'active'
}
