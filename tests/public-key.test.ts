import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHonoApp } from '../server/utils/app.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import { TEST_JWK, activateUnit, seedTestUnit, unitHeaders } from './helpers/fixtures.js'
import { readData, readError } from './helpers/http.js'

const publicKeyUrl = (unitId: string) => `http://internal/api/v1/units/${unitId}/public-key`

describe('POST /api/v1/units/{unitId}/public-key', () => {
  let ctx: TestDb

  beforeEach(async () => {
    ctx = await createTestDb()
  })

  afterEach(async () => {
    await ctx.close()
  })

  async function auditCount(): Promise<number> {
    const rows = await ctx.db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM audit_log`)
    return rows[0]!.count
  }

  it('首次上报公钥：落库并记审计', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const app = createHonoApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)

    const res = await app.request(publicKeyUrl(seeded.unitId), {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({ publicKeyJwk: TEST_JWK }),
    })
    expect(res.status).toBe(200)
    expect(await readData<{ ok: boolean }>(res)).toEqual({ ok: true })

    const units = await ctx.db.query<{ public_key_jwk: string }>(`SELECT public_key_jwk FROM unit WHERE id = $1`, [
      seeded.unitId,
    ])
    expect(JSON.parse(units[0]!.public_key_jwk)).toEqual(TEST_JWK)
    expect(await auditCount()).toBe(1)
  })

  it('同一公钥重复上报幂等：不产生第二条审计', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const app = createHonoApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)
    const init = {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({ publicKeyJwk: { ...TEST_JWK } }),
    }

    expect((await app.request(publicKeyUrl(seeded.unitId), init)).status).toBe(200)
    expect((await app.request(publicKeyUrl(seeded.unitId), init)).status).toBe(200)
    expect(await auditCount()).toBe(1)
  })

  it('换公钥覆盖旧值并追加审计', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const app = createHonoApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)

    await app.request(publicKeyUrl(seeded.unitId), {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({ publicKeyJwk: TEST_JWK }),
    })
    await app.request(publicKeyUrl(seeded.unitId), {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({ publicKeyJwk: { ...TEST_JWK, n: 'rotated-modulus' } }),
    })

    const units = await ctx.db.query<{ public_key_jwk: string }>(`SELECT public_key_jwk FROM unit WHERE id = $1`, [
      seeded.unitId,
    ])
    const stored: unknown = JSON.parse(units[0]!.public_key_jwk)
    if (stored === null || typeof stored !== 'object' || !('n' in stored)) {
      throw new Error('公钥未以对象形式落库')
    }
    expect(stored.n).toBe('rotated-modulus')
    expect(await auditCount()).toBe(2)
  })

  it('路径单位与令牌不一致 → 403 授权校验未通过', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const app = createHonoApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)

    const res = await app.request(publicKeyUrl('otherUnit'), {
      method: 'POST',
      headers: unitHeaders(token, 'otherUnit'),
      body: JSON.stringify({ publicKeyJwk: TEST_JWK }),
    })
    expect(res.status).toBe(403)
    expect(await readError(res)).toBe('授权校验未通过，请重新激活')
  })

  it('缺令牌 → 401', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const res = await createHonoApp({ db: ctx.db }).request(publicKeyUrl(seeded.unitId), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Unit-Id': seeded.unitId, 'X-Install-Id': 'install-test-1' },
      body: JSON.stringify({ publicKeyJwk: TEST_JWK }),
    })
    expect(res.status).toBe(401)
  })

  it('JWK 缺字段 → 400', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const app = createHonoApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)

    const res = await app.request(publicKeyUrl(seeded.unitId), {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({ publicKeyJwk: { kty: 'RSA' } }),
    })
    expect(res.status).toBe(400)
  })

  it('JWK 包含私钥字段 → 400，服务端不接收私钥', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const app = createHonoApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)

    const res = await app.request(publicKeyUrl(seeded.unitId), {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({ publicKeyJwk: { ...TEST_JWK, d: 'private-material' } }),
    })
    expect(res.status).toBe(400)
  })

  it('授权码作废后上报 → 403 授权码已作废', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const app = createHonoApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)

    await ctx.db.query(`UPDATE license SET status = 'revoked' WHERE code = $1`, [seeded.code])

    const res = await app.request(publicKeyUrl(seeded.unitId), {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({ publicKeyJwk: TEST_JWK }),
    })
    expect(res.status).toBe(403)
    expect(await readError(res)).toBe('授权码已作废')
  })
})
