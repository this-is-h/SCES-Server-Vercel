import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import { activateUnit, seedTestUnit, unitHeaders } from './helpers/fixtures.js'
import { readData, readError } from './helpers/http.js'

type LicenseStatusData = {
  code: string
  expiresAt: number
  status: string
  unit: { unitId: string; unitName: string; unitType: string; level: number; parentUnitId: string | null }
}

const statusUrl = 'http://internal/api/v1/license/status'

describe('GET /api/v1/license/status', () => {
  let ctx: TestDb

  beforeEach(async () => {
    ctx = await createTestDb()
  })

  afterEach(async () => {
    await ctx.close()
  })

  it('返回授权码、有效期、状态与单位摘要', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const app = createApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)

    const res = await app.request(statusUrl, { headers: unitHeaders(token, seeded.unitId) })
    expect(res.status).toBe(200)

    const data = await readData<LicenseStatusData>(res)
    expect(data.code).toBe(seeded.code)
    expect(data.expiresAt).toBe(seeded.expiresAt)
    expect(data.status).toBe('active')
    expect(data.unit).toEqual({
      unitId: 'testTest1',
      unitName: '测试1',
      unitType: 'college',
      level: 2,
      parentUnitId: 'test',
    })
  })

  it('授权过期后仍可拉取：200 且 status=expired（决策 #40，不强制重新激活）', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const app = createApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)

    await ctx.db.query(`UPDATE license SET expires_at = $1 WHERE code = $2`, [Date.now() - 1000, seeded.code])

    const res = await app.request(statusUrl, { headers: unitHeaders(token, seeded.unitId) })
    expect(res.status).toBe(200)
    expect((await readData<LicenseStatusData>(res)).status).toBe('expired')
  })

  it('无效令牌 → 401 未登录或登录已过期', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const res = await createApp({ db: ctx.db }).request(statusUrl, {
      headers: unitHeaders('not-a-real-token-not-a-real-token', seeded.unitId),
    })
    expect(res.status).toBe(401)
    expect(await readError(res)).toBe('未登录或登录已过期')
  })

  it('辅助标识头与令牌错配 → 403 授权校验未通过', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const app = createApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)

    const res = await app.request(statusUrl, { headers: unitHeaders(token, 'otherUnit') })
    expect(res.status).toBe(403)
    expect(await readError(res)).toBe('授权校验未通过，请重新激活')
  })

  it('单位停用 → 403 授权已失效', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const app = createApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)

    await ctx.db.query(`UPDATE unit SET status = 'disabled' WHERE id = $1`, [seeded.unitId])

    const res = await app.request(statusUrl, { headers: unitHeaders(token, seeded.unitId) })
    expect(res.status).toBe(403)
    expect(await readError(res)).toBe('授权已失效，请重新激活')
  })
})
