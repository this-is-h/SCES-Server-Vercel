import type { Db } from '../db/types.js'

/**
 * 清除已过期的后台刷新令牌（登出/改密不会覆盖的行）。
 * 每次后台登录顺手执行（走 idx_refresh_token_expires_at）；
 * 未登出的失效会话会长期留死行，故需独立清扫。
 */
export async function purgeExpiredRefreshTokens(db: Db, now = Date.now()): Promise<number> {
  const rows = await db.query(`DELETE FROM refresh_token WHERE expires_at <= $1 RETURNING id`, [now])
  return rows.length
}