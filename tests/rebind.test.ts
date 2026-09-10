import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { LICENSE_CODE_PATTERN } from '../src/lib/hash.js'
import { monthKey } from '../src/lib/time.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import { activateUnit, seedTestUnit, unitHeaders } from './helpers/fixtures.js'
import { readData, readError } from './helpers/http.js'

const rebindUrl = 'http://internal/api/v1/units/rebind'
const statusUrl = 'http://internal/api/v1/license/status'

type RebindData = { ok: boolean; code: string; expiresAt: number; monthCount: number }

describe('POST /api/v1/units/rebind', () => {
  let ctx: TestDb

  beforeEach(async () => {
    ctx = await createTestDb()
  })

  afterEach(async () => {
    await ctx.close()
  })

  async function seedPastRebinds(unitId: string, count: number): Promise<void> {
    const key = monthKey(Date.now())
    for (let index = 0; index < count; index += 1) {
      await ctx.db.query(
        `INSERT INTO rebind_request
           (id, unit_id, install_id, reason, old_code, new_code, status, month_key, month_count, created_at, resolved_at)
         VALUES ($1, $2, 'install-old', NULL, 'AAAA-AAAA-AAAA-AAAA', 'BBBB-BBBB-BBBB-BBBB', 'self-served', $3, $4, $5, $5)`,
        [`rebind-${index}`, unitId, key, index + 1, Date.now()],
      )
    }
  }

  it('自助换机：签发新码、作废旧码与旧令牌、记 self-served', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const app = createApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)

    const res = await app.request(rebindUrl, {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({ reason: '原设备损坏' }),
    })
    expect(res.status).toBe(200)

    const data = await readData<RebindData>(res)
    expect(data.ok).toBe(true)
    expect(data.code).not.toBe(seeded.code)
    expect(LICENSE_CODE_PATTERN.test(data.code)).toBe(true)
    expect(data.expiresAt).toBe(seeded.expiresAt)
    expect(data.monthCount).toBe(1)

    const licenses = await ctx.db.query<{ code: string; status: string }>(
      `SELECT code, status FROM license ORDER BY created_at`,
    )
    expect(licenses.find((row) => row.code === seeded.code)?.status).toBe('revoked')
    expect(licenses.find((row) => row.code === data.code)?.status).toBe('active')

    const stale = await app.request(statusUrl, { headers: unitHeaders(token, seeded.unitId) })
    expect(stale.status).toBe(401)

    const records = await ctx.db.query<{ status: string; month_count: number; reason: string | null }>(
      `SELECT status, month_count, reason FROM rebind_request`,
    )
    expect(records).toEqual([{ status: 'self-served', month_count: 1, reason: '原设备损坏' }])
  })

  it('本月第 4 次换机 → 403 超限并留 pending 记录（不换机）', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const app = createApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)
    await seedPastRebinds(seeded.unitId, 3)

    const res = await app.request(rebindUrl, {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(403)
    expect(await readError(res)).toBe('本月更换设备次数已达上限，请联系服务商')

    const pending = await ctx.db.query<{ status: string; month_count: number; new_code: string | null }>(
      `SELECT status, month_count, new_code FROM rebind_request WHERE status = 'pending'`,
    )
    expect(pending).toEqual([{ status: 'pending', month_count: 4, new_code: null }])

    const license = await ctx.db.query<{ status: string }>(`SELECT status FROM license WHERE code = $1`, [seeded.code])
    expect(license[0]!.status).toBe('active')
  })
})
