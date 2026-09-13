import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { createMiddleware } from 'hono/factory'
import { clientIp, readJsonObject, readOptionalJsonObject } from '../http/parse.js'
import type { AdminAuthContext, AppEnv } from '../http/env.js'
import { recordAudit } from '../lib/audit.js'
import { ApiError, badRequest, unauthorized } from '../lib/errors.js'
import { hashPassword, randomToken, sha256Hex, verifyPassword } from '../lib/hash.js'
import { ACCESS_TOKEN_TTL_MS, signAccessToken, verifyAccessToken } from '../lib/admin-token.js'
import {
  countAdmins,
  createAdmin,
  deleteRefreshToken,
  deleteRefreshTokensForAdmin,
  findAdminByUsername,
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
  c.set('adminAuth', { adminUserId: claims.sub, username: claims.username } satisfies AdminAuthContext)
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

/** 契约接口 14：首次启动且配置 ADMIN_INITIAL_PASSWORD 时自动创建初始管理员（强制改密）。 */
async function ensureInitialAdmin(db: AppEnv['Variables']['db']): Promise<void> {
  if ((await countAdmins(db)) > 0) return
  const password = process.env.ADMIN_INITIAL_PASSWORD
  if (password === undefined || password.length < 8) return
  await createAdmin(db, { id: randomUUID(), username: 'admin', passwordHash: hashPassword(password), mustChangePassword: true })
}

/** 接口 14：后台登录（严格限流，见 app.ts 挂载）。 */
export const adminAuthRouter = new Hono<AppEnv>()

adminAuthRouter.post('/admin/auth/login', async (c) => {
  const db = c.get('db')
  const parsed = loginBodySchema.safeParse(await readJsonObject(c))
  if (!parsed.success) throw badRequest()
  await ensureInitialAdmin(db)

  const body = parsed.data
  const admin = await findAdminByUsername(db, body.username)
  if (admin === undefined || !verifyPassword(body.password, admin.password_hash)) {
    throw unauthorized('用户名或密码错误')
  }

  const accessToken = signAccessToken({ sub: admin.id, username: admin.username })
  const refreshToken = randomToken()
  await insertRefreshToken(db, {
    id: randomUUID(),
    adminUserId: admin.id,
    tokenHash: sha256Hex(refreshToken),
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
  })
  // 过期刷新令牌仅登出/改密时删除；长期不登出的失效会话会留死行，登录顺手清扫。
  await purgeExpiredRefreshTokens(db)

  return c.json({
    ok: true as const,
    data: {
      accessToken,
      accessTokenExpiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
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
  const row = await findRefreshTokenByHash(db, sha256Hex(body.refreshToken))
  if (row === undefined || row.expires_at <= Date.now()) {
    throw unauthorized('登录已过期，请重新登录')
  }

  const admin = await c.get('db').query<{ id: string; username: string }>(
    `SELECT id, username FROM admin_user WHERE id = $1`,
    [row.admin_user_id],
  ).then((rows) => rows[0])
  if (admin === undefined) throw unauthorized('登录已过期，请重新登录')

  const accessToken = signAccessToken({ sub: admin.id, username: admin.username })
  return c.json({
    ok: true as const,
    data: { accessToken, accessTokenExpiresAt: Date.now() + ACCESS_TOKEN_TTL_MS },
  })
})

/** 接口 16：后台登出（幂等；删除刷新 token，访问 token 自然过期）。契约要求 adminToken。 */
adminAuthRouter.post('/admin/auth/logout', requireAdminToken, async (c) => {
  const db = c.get('db')
  const body = await readOptionalJsonObject(c)
  const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : undefined
  if (refreshToken !== undefined && refreshToken.length >= 32) {
    const row = await findRefreshTokenByHash(db, sha256Hex(refreshToken))
    if (row !== undefined) await deleteRefreshToken(db, row.id)
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

  const admin = (await db.query<{ password_hash: string }>(`SELECT password_hash FROM admin_user WHERE id = $1`, [
    auth.adminUserId,
  ])).at(0)
  if (admin === undefined || !verifyPassword(body.oldPassword, admin.password_hash)) {
    throw unauthorized('原密码错误')
  }
  if (verifyPassword(body.newPassword, admin.password_hash)) throw badRequest('新密码不能与原密码相同')

  await updateAdminPassword(db, auth.adminUserId, hashPassword(body.newPassword), false)
  await deleteRefreshTokensForAdmin(db, auth.adminUserId)
  await recordAudit(db, {
    adminUserId: auth.adminUserId,
    action: 'admin-change-password',
    target: auth.username,
    ip: clientIp(c) ?? null,
  })
  return c.json({ ok: true as const, data: { ok: true as const } })
})
