import type { Db } from '../db/types.js'

/** 令牌校验所需的联表行（unit_token ⋈ license ⋈ unit）。 */
export type TokenAuthRow = {
  token_id: string
  unit_id: string
  install_id: string
  license_code: string
  token_status: string
  token_expires_at: number
  license_status: string
  license_expires_at: number
  unit_status: string
  unit_level: number
}

export async function insertUnitToken(
  db: Db,
  input: { id: string; unitId: string; installId: string; licenseCode: string; tokenHash: string; expiresAt: number },
): Promise<void> {
  await db.query(
    `INSERT INTO unit_token (id, unit_id, install_id, license_code, token_hash, expires_at, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
    [input.id, input.unitId, input.installId, input.licenseCode, input.tokenHash, input.expiresAt, Date.now()],
  )
}

/** 同一安装实例重新激活时作废旧令牌（一个 install 只保留一条活跃令牌）。 */
export async function revokeActiveTokensForInstall(db: Db, unitId: string, installId: string): Promise<void> {
  await db.query(
    `UPDATE unit_token SET status = 'revoked'
     WHERE unit_id = $1 AND install_id = $2 AND status = 'active'`,
    [unitId, installId],
  )
}

/** 授权码作废/换机时级联失效其令牌。 */
export async function revokeActiveTokensForLicense(db: Db, licenseCode: string): Promise<void> {
  await db.query(`UPDATE unit_token SET status = 'revoked' WHERE license_code = $1 AND status = 'active'`, [licenseCode])
}

export async function findTokenAuthByHash(db: Db, tokenHash: string): Promise<TokenAuthRow | undefined> {
  const rows = await db.query<TokenAuthRow>(
    `SELECT t.id            AS token_id,
            t.unit_id       AS unit_id,
            t.install_id    AS install_id,
            t.license_code  AS license_code,
            t.status        AS token_status,
            t.expires_at    AS token_expires_at,
            l.status        AS license_status,
            l.expires_at    AS license_expires_at,
            u.status        AS unit_status,
            u.level         AS unit_level
     FROM unit_token t
     JOIN license l ON l.code = t.license_code
     JOIN unit u ON u.id = t.unit_id
     WHERE t.token_hash = $1`,
    [tokenHash],
  )
  return rows[0]
}
