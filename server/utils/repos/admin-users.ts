import type { Db } from '../db/types.js'

export type AdminUserRow = {
  id: string
  username: string
  password_hash: string
  must_change_password: number
  created_at: number
  updated_at: number
}

export type RefreshTokenRow = {
  id: string
  admin_user_id: string
  token_hash: string
  expires_at: number
  created_at: number
}

export async function findAdminByUsername(db: Db, username: string): Promise<AdminUserRow | undefined> {
  const rows = await db.query<AdminUserRow>(`SELECT * FROM admin_user WHERE username = $1`, [username])
  return rows[0]
}

export async function countAdmins(db: Db): Promise<number> {
  const rows = await db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM admin_user`)
  return rows[0]?.count ?? 0
}

export async function createAdmin(
  db: Db,
  input: { id: string; username: string; passwordHash: string; mustChangePassword: boolean },
): Promise<void> {
  const at = Date.now()
  await db.query(
    `INSERT INTO admin_user (id, username, password_hash, must_change_password, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [input.id, input.username, input.passwordHash, input.mustChangePassword ? 1 : 0, at],
  )
}

export async function updateAdminPassword(
  db: Db,
  adminUserId: string,
  passwordHash: string,
  mustChangePassword: boolean,
): Promise<void> {
  await db.query(
    `UPDATE admin_user SET password_hash = $2, must_change_password = $3, updated_at = $4 WHERE id = $1`,
    [adminUserId, passwordHash, mustChangePassword ? 1 : 0, Date.now()],
  )
}

export async function insertRefreshToken(
  db: Db,
  input: { id: string; adminUserId: string; tokenHash: string; expiresAt: number },
): Promise<void> {
  await db.query(
    `INSERT INTO refresh_token (id, admin_user_id, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.id, input.adminUserId, input.tokenHash, input.expiresAt, Date.now()],
  )
}

export async function findRefreshTokenByHash(db: Db, tokenHash: string): Promise<RefreshTokenRow | undefined> {
  const rows = await db.query<RefreshTokenRow>(`SELECT * FROM refresh_token WHERE token_hash = $1`, [tokenHash])
  return rows[0]
}

export async function deleteRefreshToken(db: Db, tokenId: string): Promise<void> {
  await db.query(`DELETE FROM refresh_token WHERE id = $1`, [tokenId])
}

/** 改密后强制重新登录（契约：删除该管理员全部刷新 token）。 */
export async function deleteRefreshTokensForAdmin(db: Db, adminUserId: string): Promise<void> {
  await db.query(`DELETE FROM refresh_token WHERE admin_user_id = $1`, [adminUserId])
}
