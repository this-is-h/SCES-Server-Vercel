import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHonoApp } from '../server/utils/app.js'
import { createTestDb, type TestDb } from './helpers/db.js'

describe('shared rate limiting', () => {
  let ctx: TestDb

  beforeEach(async () => {
    ctx = await createTestDb()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await ctx.close()
  })

  it('shares a fixed window across app instances using the same database', async () => {
    // Keep the test from crossing a minute boundary on slower CI machines.
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_010_000)
    const first = createHonoApp({ db: ctx.db })
    const second = createHonoApp({ db: ctx.db })
    const request = (app: ReturnType<typeof createHonoApp>) => app.request('http://internal/api/v1/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Install-Id': 'rate-test-install' },
      body: JSON.stringify({ code: 'AAAA-AAAA-AAAA-AAAA' }),
    })

    for (let index = 0; index < 15; index += 1) {
      expect((await request(first)).status).toBe(403)
      expect((await request(second)).status).toBe(403)
    }
    const limited = await request(first)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
  })
})
