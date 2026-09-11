import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHonoApp } from '../server/utils/app.js'
import { sha256Hex } from '../server/utils/lib/hash.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import { TEST_INSTALL_ID, activateUnit, jsonHeaders, seedTestUnit, unitHeaders } from './helpers/fixtures.js'
import { readData, readError } from './helpers/http.js'

type AuthorizeData = {
  unit: { unitId: string; unitName: string; unitType: string; level: number; parentUnitId: string | null }
  unitToken: string
  license: { expiresAt: number; status: string }
  configTemplate: {
    id: string
    name: string
    version: number
    revision: number
    status: string
    unit: unknown
    updatedAt: number
  }
}

describe('POST /api/v1/authorize', () => {
  let ctx: TestDb

  beforeEach(async () => {
    ctx = await createTestDb()
  })

  afterEach(async () => {
    await ctx.close()
  })

  const request = (headers: Record<string, string>, body: unknown) =>
    createHonoApp({ db: ctx.db }).request('http://internal/api/v1/authorize', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

  it('激活成功：下发单位摘要、令牌、授权信息与完整配置模板', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const res = await request(jsonHeaders({ 'X-Install-Id': TEST_INSTALL_ID }), { code: seeded.code })
    expect(res.status).toBe(200)

    const data = await readData<AuthorizeData>(res)
    expect(data.unit).toEqual({
      unitId: 'testTest1',
      unitName: '测试1',
      unitType: 'college',
      level: 2,
      parentUnitId: 'test',
    })
    expect(data.unitToken.length).toBeGreaterThanOrEqual(32)
    expect(data.license).toEqual({ expiresAt: seeded.expiresAt, status: 'active' })
    expect(data.configTemplate.id).toBe(seeded.seed.id)
    expect(data.configTemplate.name).toBe(seeded.seed.name)
    expect(data.configTemplate.status).toBe('published')
    expect(data.configTemplate.unit).toEqual(seeded.seed.unit)
    expect(data.configTemplate.updatedAt).toBeGreaterThan(0)
  })

  it('令牌只存 SHA-256 哈希，明文不落库', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const res = await request(jsonHeaders({ 'X-Install-Id': TEST_INSTALL_ID }), { code: seeded.code })
    const data = await readData<AuthorizeData>(res)

    const rows = await ctx.db.query<{ token_hash: string }>(`SELECT token_hash FROM unit_token`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.token_hash).toBe(sha256Hex(data.unitToken))
    expect(rows[0]!.token_hash).not.toBe(data.unitToken)
  })

  it('同一安装实例重复激活：旧令牌立即失效', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const app = createHonoApp({ db: ctx.db })

    const first = await activateUnit(app, seeded.code)
    const second = await activateUnit(app, seeded.code)
    expect(second).not.toBe(first)

    const stale = await app.request('http://internal/api/v1/license/status', {
      headers: unitHeaders(first, seeded.unitId),
    })
    expect(stale.status).toBe(401)

    const fresh = await app.request('http://internal/api/v1/license/status', {
      headers: unitHeaders(second, seeded.unitId),
    })
    expect(fresh.status).toBe(200)
  })

  it('未知授权码 → 403 授权码无效', async () => {
    await seedTestUnit(ctx.db)
    const res = await request(jsonHeaders({ 'X-Install-Id': TEST_INSTALL_ID }), { code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' })
    expect(res.status).toBe(403)
    expect(await readError(res)).toBe('授权码无效')
  })

  it('已作废授权码 → 403 授权码已作废', async () => {
    const seeded = await seedTestUnit(ctx.db, { licenseStatus: 'revoked' })
    const res = await request(jsonHeaders({ 'X-Install-Id': TEST_INSTALL_ID }), { code: seeded.code })
    expect(res.status).toBe(403)
    expect(await readError(res)).toBe('授权码已作废')
  })

  it('已过期授权码 → 403 授权已过期', async () => {
    const seeded = await seedTestUnit(ctx.db, { expiresAt: Date.now() - 1000 })
    const res = await request(jsonHeaders({ 'X-Install-Id': TEST_INSTALL_ID }), { code: seeded.code })
    expect(res.status).toBe(403)
    expect(await readError(res)).toBe('授权已过期，请联系服务商续期')
  })

  it('单位停用 → 403 授权已失效', async () => {
    const seeded = await seedTestUnit(ctx.db, { unitStatus: 'disabled' })
    const res = await request(jsonHeaders({ 'X-Install-Id': TEST_INSTALL_ID }), { code: seeded.code })
    expect(res.status).toBe(403)
    expect(await readError(res)).toBe('授权已失效，请重新激活')
  })

  it('缺 X-Install-Id → 400', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const res = await request(jsonHeaders(), { code: seeded.code })
    expect(res.status).toBe(400)
  })

  it('授权码格式非法 → 400', async () => {
    const res = await request(jsonHeaders({ 'X-Install-Id': TEST_INSTALL_ID }), { code: 'abc' })
    expect(res.status).toBe(400)
  })

  it('无已发布配置模板 → 500（服务端数据缺失）', async () => {
    const seeded = await seedTestUnit(ctx.db, { published: false })
    const res = await request(jsonHeaders({ 'X-Install-Id': TEST_INSTALL_ID }), { code: seeded.code })
    expect(res.status).toBe(500)
    expect(await readError(res)).toBe('服务端异常，请稍后重试')
  })
})
