import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { createMiddleware } from 'hono/factory'
import { clientIp, readJsonObject, readOptionalJsonObject } from '../http/parse.js'
import type { AdminAuthContext, AppEnv } from '../http/env.js'
import { recordAudit } from '../lib/audit.js'
import { ApiError, badRequest, forbidden, unauthorized } from '../lib/errors.js'
import { isUniqueViolation } from '../db/errors.js'
import { hashPassword, randomToken, sha256Hex, verifyPassword } from '../lib/hash.js'
import { ACCESS_TOKEN_TTL_MS, signAccessToken, verifyAccessToken } from '../lib/admin-token.js'
import {
  countAdmins,
  createAdmin,
  deleteRefreshToken,
  deleteRefreshTokensForAdmin,
  findAdminByUsername,
  findAdminById,
  findRefreshTokenByHash,
  insertRefreshToken,
  updateAdminPassword,
} from '../repos/admin-users.js'
import { purgeExpiredRefreshTokens } from '../repos/cleanup.js'

/** 后台写接口鉴权：`Authorization: Bearer <accessToken>`（HMAC JWT，无状态）。 */
export const requireAdminToken = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization')
  if (header === undefined || !header.startsWith('Bearer ')) throw unauthorized()
  const claims = verifyAccessToken(header.slice('Bearer '.length).trim())
  if (claims === undefined) throw unauthorized()
  const admin = await findAdminById(c.get('db'), claims.sub)
  if (admin === undefined) throw unauthorized()
  if (
    admin.must_change_password === 1 &&
    !c.req.path.endsWith('/admin/auth/change-password') &&
    !c.req.path.endsWith('/admin/auth/logout')
  ) {
    throw forbidden('请先修改初始密码')
  }
  if (claims.ver !== admin.updated_at) throw unauthorized()
  c.set('adminAuth', { adminUserId: admin.id, username: admin.username } satisfies AdminAuthContext)
  await next()
})

const loginBodySchema = z.strictObject({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(128),
})

const refreshBodySchema = z.strictObject({ refreshToken: z.string().min(32) })

const changePasswordBodySchema = z.strictObject({
  oldPassword: z.string().min(8).max(128),
  newPassword: z.string().min(12).max(128),
})

const REFRESH_TOKEN_TTL_MS = 30 * 86_400_000
const DUMMY_PASSWORD_HASH = hashPassword('dummy-password-for-timing-equalization')

/** 契约接口 14：首次启动且配置 ADMIN_INITIAL_PASSWORD 时自动创建初始管理员（强制改密）。 */
async function ensureInitialAdmin(db: AppEnv['Variables']['db']): Promise<void> {
  if ((await countAdmins(db)) > 0) return
  const password = process.env.ADMIN_INITIAL_PASSWORD
  if (password === undefined || password.length < 8) return
  try {
    await createAdmin(db, { id: randomUUID(), username: 'admin', passwordHash: hashPassword(password), mustChangePassword: true })
  } catch (error) {
    // Another cold-start may have bootstrapped the account at the same time.
    if (!isUniqueViolation(error)) throw error
  }
}

/** 接口 14：后台登录（严格限流，见 app.ts 挂载）。 */
export const adminAuthRouter = new Hono<AppEnv>()

adminAuthRouter.post('/admin/auth/login', async (c) => {
  const db = c.get('db')
  const parsed = loginBodySchema.safeParse(await readJsonObject(c))
  if (!parsed.success) throw badRequest()
  await ensureInitialAdmin(db)

  const body = parsed.data
  const { admin, accessToken, accessTokenExpiresAt, refreshToken } = await db.transaction(async (tx) => {
    const row = await findAdminByUsername(tx, body.username)
    if (row) await tx.query('SELECT id FROM admin_user WHERE id = $1 FOR UPDATE', [row.id])
    const admin = row ? await findAdminById(tx, row.id) : undefined
    const passwordValid = verifyPassword(body.password, admin?.password_hash ?? DUMMY_PASSWORD_HASH)
    if (admin === undefined || !passwordValid) throw unauthorized('用户名或密码错误')
    const now = Date.now()
    const accessToken = signAccessToken({ sub: admin.id, username: admin.username, ver: admin.updated_at }, now)
    const refreshToken = randomToken()
    await insertRefreshToken(tx, {
      id: randomUUID(), adminUserId: admin.id, tokenHash: sha256Hex(refreshToken),
      expiresAt: now + REFRESH_TOKEN_TTL_MS,
    })
    return { admin, accessToken, accessTokenExpiresAt: Math.floor((now + ACCESS_TOKEN_TTL_MS) / 1000) * 1000, refreshToken }
  })
  // 过期刷新令牌仅登出/改密时删除；长期不登出的失效会话会留死行，登录顺手清扫。
  await purgeExpiredRefreshTokens(db)

  return c.json({
    ok: true as const,
    data: {
      accessToken,
      accessTokenExpiresAt,
      refreshToken,
      username: admin.username,
      mustChangePassword: admin.must_change_password === 1,
    },
  })
})

/** 接口 15：刷新访问令牌。 */
adminAuthRouter.post('/admin/auth/refresh', async (c) => {
  const parsed = refreshBodySchema.safeParse(await readJsonObject(c))
  if (!parsed.success) throw badRequest()
  const body = parsed.data
  const db = c.get('db')
  const owner = await findRefreshTokenByHash(db, sha256Hex(body.refreshToken))
  if (owner === undefined) throw unauthorized('登录已过期，请重新登录')
  const rotated = await db.transaction(async (tx) => {
    // Same lock order as password change: account first, then session.
    await tx.query('SELECT id FROM admin_user WHERE id = $1 FOR UPDATE', [owner.admin_user_id])
    const row = (await tx.query<{ id: string; admin_user_id: string; expires_at: number }>(
      `SELECT id, admin_user_id, expires_at FROM refresh_token WHERE token_hash = $1 FOR UPDATE`,
      [sha256Hex(body.refreshToken)],
    )).at(0)
    if (row === undefined || row.expires_at <= Date.now()) throw unauthorized('登录已过期，请重新登录')
    const admin = (await tx.query<{ id: string; username: string; must_change_password: number; updated_at: number }>(
      `SELECT id, username, must_change_password, updated_at FROM admin_user WHERE id = $1`,
      [row.admin_user_id],
    )).at(0)
    if (admin === undefined) throw unauthorized('登录已过期，请重新登录')
    await tx.query(`DELETE FROM refresh_token WHERE id = $1`, [row.id])
    const refreshToken = randomToken()
    await insertRefreshToken(tx, {
      id: randomUUID(),
      adminUserId: admin.id,
      tokenHash: sha256Hex(refreshToken),
      expiresAt: row.expires_at,
    })
    const now = Date.now()
    const accessToken = signAccessToken({ sub: admin.id, username: admin.username, ver: admin.updated_at }, now)
    return { accessToken, accessTokenExpiresAt: Math.floor((now + ACCESS_TOKEN_TTL_MS) / 1000) * 1000, refreshToken }
  })
  return c.json({
    ok: true as const,
    data: rotated,
  })
})

/** 接口 16：后台登出（幂等；删除刷新 token，访问 token 自然过期）。契约要求 adminToken。 */
adminAuthRouter.post('/admin/auth/logout', requireAdminToken, async (c) => {
  const db = c.get('db')
  const body = await readOptionalJsonObject(c)
  const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : undefined
  if (refreshToken !== undefined && refreshToken.length >= 32) {
    const row = await findRefreshTokenByHash(db, sha256Hex(refreshToken))
    if (row !== undefined && row.admin_user_id === c.get('adminAuth').adminUserId) await deleteRefreshToken(db, row.id)
  }
  return c.json({ ok: true as const, data: { ok: true as const } })
})

/** 接口 17：修改后台密码（成功后清除强制改密标记并吊销全部会话）。 */
adminAuthRouter.post('/admin/auth/change-password', requireAdminToken, async (c) => {
  const db = c.get('db')
  const auth = c.get('adminAuth')
  const parsed = changePasswordBodySchema.safeParse(await readJsonObject(c))
  if (!parsed.success) throw badRequest()
  const body = parsed.data

  await db.transaction(async (tx) => {
    const admin = (await tx.query<{ password_hash: string }>(`SELECT password_hash FROM admin_user WHERE id = $1 FOR UPDATE`, [
      auth.adminUserId,
    ])).at(0)
    if (admin === undefined || !verifyPassword(body.oldPassword, admin.password_hash)) throw unauthorized('原密码错误')
    if (verifyPassword(body.newPassword, admin.password_hash)) throw badRequest('新密码不能与原密码相同')
    await updateAdminPassword(tx, auth.adminUserId, hashPassword(body.newPassword), false)
    await deleteRefreshTokensForAdmin(tx, auth.adminUserId)
    await recordAudit(tx, {
      adminUserId: auth.adminUserId, action: 'admin-change-password',
      target: auth.username, ip: clientIp(c) ?? null,
    })
  })
  return c.json({ ok: true as const, data: { ok: true as const } })
})
