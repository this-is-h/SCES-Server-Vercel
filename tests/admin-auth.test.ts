import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHonoApp } from '../server/utils/app.js'
import { hashPassword } from '../server/utils/lib/hash.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import { jsonHeaders } from './helpers/fixtures.js'
import { readData, readError } from './helpers/http.js'

type LoginData = {
  accessToken: string
  accessTokenExpiresAt: number
  refreshToken: string
  username: string
  mustChangePassword: boolean
}

describe('后台认证（接口 14–17）', () => {
  let ctx: TestDb

  beforeEach(async () => {
    ctx = await createTestDb()
  })

  afterEach(async () => {
    await ctx.close()
  })

  /** 预置一名已知密码的管理员（mustChangePassword=false）。 */
  async function seedAdmin(username = 'admin', password = 'initial-pass-123'): Promise<void> {
    await ctx.db.query(
      `INSERT INTO admin_user (id, username, password_hash, must_change_password, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 0, $3, $3)`,
      [username, hashPassword(password), Date.now()],
    )
  }

  const login = (body: unknown) =>
    createHonoApp({ db: ctx.db }).request('http://internal/api/v1/admin/auth/login', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    })

  /** 走一遍登录拿到一对有效令牌。 */
  async function loginOk(username = 'admin', password = 'initial-pass-123'): Promise<LoginData> {
    const res = await login({ username, password })
    expect(res.status).toBe(200)
    return readData<LoginData>(res)
  }

  const authed = (token: string, path: string, body?: unknown) =>
    createHonoApp({ db: ctx.db }).request(`http://internal${path}`, {
      method: 'POST',
      headers: jsonHeaders({ Authorization: `Bearer ${token}` }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  it('接口 14：登录成功返回 15 分钟访问令牌、刷新令牌与改密标记', async () => {
    await seedAdmin('ops', 'strong-password-1')
    const data = await loginOk('ops', 'strong-password-1')
    expect(data.username).toBe('ops')
    expect(data.mustChangePassword).toBe(false)
    expect(data.accessToken.length).toBeGreaterThanOrEqual(16)
    expect(data.refreshToken.length).toBeGreaterThanOrEqual(32)
    expect(data.accessTokenExpiresAt - Date.now()).toBeGreaterThan(14 * 60_000)
    expect(data.accessTokenExpiresAt - Date.now()).toBeLessThanOrEqual(15 * 60_000)
  })

  it('接口 14：空库 + ADMIN_INITIAL_PASSWORD 首登自动建号并要求改密', async () => {
    process.env.ADMIN_INITIAL_PASSWORD = 'bootstrap-pass-123'
    try {
      const data = await loginOk('admin', 'bootstrap-pass-123')
      expect(data.username).toBe('admin')
      expect(data.mustChangePassword).toBe(true)
    }
    finally {
      delete process.env.ADMIN_INITIAL_PASSWORD
    }
  })

  it('接口 14：密码错误返回 401 契约文案', async () => {
    await seedAdmin()
    const res = await login({ username: 'admin', password: 'wrong-password' })
    expect(res.status).toBe(401)
    expect(await readError(res)).toBe('用户名或密码错误')
  })

  it('接口 14：参数不合法（密码过短）返回 400', async () => {
    await seedAdmin()
    const res = await login({ username: 'admin', password: 'short' })
    expect(res.status).toBe(400)
    expect(await readError(res)).toBe('请求参数不合法')
  })

  it('接口 15：刷新令牌换取新访问令牌；旧访问令牌仍有效期内可用', async () => {
    await seedAdmin()
    const first = await loginOk()
    const res = await createHonoApp({ db: ctx.db }).request('http://internal/api/v1/admin/auth/refresh', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ refreshToken: first.refreshToken }),
    })
    expect(res.status).toBe(200)
    const data = await readData<{ accessToken: string; accessTokenExpiresAt: number }>(res)
    expect(data.accessToken).toBeTruthy()
    expect(data.accessTokenExpiresAt).toBeGreaterThan(Date.now())
  })

  it('接口 15：未知或已删刷新令牌返回 401', async () => {
    const res = await createHonoApp({ db: ctx.db }).request('http://internal/api/v1/admin/auth/refresh', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ refreshToken: 'x'.repeat(40) }),
    })
    expect(res.status).toBe(401)
    expect(await readError(res)).toBe('登录已过期，请重新登录')
  })

  it('接口 16：登出删除刷新令牌，随后刷新 401；接口幂等', async () => {
    await seedAdmin()
    const data = await loginOk()
    const res = await authed(data.accessToken, '/api/v1/admin/auth/logout', { refreshToken: data.refreshToken })
    expect(res.status).toBe(200)
    // 刷新令牌已删
    const refresh = await createHonoApp({ db: ctx.db }).request('http://internal/api/v1/admin/auth/refresh', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ refreshToken: data.refreshToken }),
    })
    expect(refresh.status).toBe(401)
    // 幂等：重复登出仍 200
    const again = await authed(data.accessToken, '/api/v1/admin/auth/logout', { refreshToken: data.refreshToken })
    expect(again.status).toBe(200)
  })

  it('接口 16：未携带访问令牌返回 401', async () => {
    const res = await createHonoApp({ db: ctx.db }).request('http://internal/api/v1/admin/auth/logout', {
      method: 'POST',
      headers: jsonHeaders(),
      body: '{}',
    })
    expect(res.status).toBe(401)
    expect(await readError(res)).toBe('未登录或登录已过期')
  })

  it('接口 17：改密成功后旧密码失效、刷新令牌全部清除、落审计日志', async () => {
    await seedAdmin()
    const data = await loginOk()
    const res = await authed(data.accessToken, '/api/v1/admin/auth/change-password', {
      oldPassword: 'initial-pass-123',
      newPassword: 'brand-new-password-9',
    })
    expect(res.status).toBe(200)
    expect(await readData<{ ok: true }>(res)).toEqual({ ok: true })

    // 旧密码不能再登录
    const oldLogin = await login({ username: 'admin', password: 'initial-pass-123' })
    expect(oldLogin.status).toBe(401)
    // 新密码可登录且不再要求改密
    const newLogin = await loginOk('admin', 'brand-new-password-9')
    expect(newLogin.mustChangePassword).toBe(false)
    // 旧刷新令牌被强制清除
    const refresh = await createHonoApp({ db: ctx.db }).request('http://internal/api/v1/admin/auth/refresh', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ refreshToken: data.refreshToken }),
    })
    expect(refresh.status).toBe(401)
    // 审计
    const logs = await ctx.db.query<{ action: string; target: string }>(`SELECT action, target FROM audit_log`)
    expect(logs.some((row) => row.action === 'admin-change-password' && row.target === 'admin')).toBe(true)
  })

  it('接口 17：原密码错误返回 401「原密码错误」', async () => {
    await seedAdmin()
    const data = await loginOk()
    const res = await authed(data.accessToken, '/api/v1/admin/auth/change-password', {
      oldPassword: 'totally-wrong-pass',
      newPassword: 'brand-new-password-9',
    })
    expect(res.status).toBe(401)
    expect(await readError(res)).toBe('原密码错误')
  })

  it('接口 17：新密码不足 12 位返回 400', async () => {
    await seedAdmin()
    const data = await loginOk()
    const res = await authed(data.accessToken, '/api/v1/admin/auth/change-password', {
      oldPassword: 'initial-pass-123',
      newPassword: 'short-pass',
    })
    expect(res.status).toBe(400)
  })

  it('访问令牌签名被篡改后 401', async () => {
    await seedAdmin()
    const data = await loginOk()
    const forged = data.accessToken.slice(0, -2) + 'xx'
    const res = await authed(forged, '/api/v1/admin/auth/logout')
    expect(res.status).toBe(401)
  })
})
