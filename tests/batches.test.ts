import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Hono } from 'hono'
import { createHonoApp } from '../server/utils/app.js'
import type { AppEnv } from '../server/utils/http/env.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import { activateUnit, jsonHeaders, seedTestUnit, unitHeaders } from './helpers/fixtures.js'
import { readData, readError } from './helpers/http.js'

type App = Hono<AppEnv>

let batchSeq = 0
/** 每个用例独立的 UUID 批次 id。 */
const nextBatchId = () => {
  batchSeq += 1
  return `b1c9d4e2-5a37-4f18-9d6b-${String(batchSeq).padStart(12, '0')}`
}

const createPayload = (overrides: Record<string, unknown> = {}) => ({
  batchId: nextBatchId(),
  year: 2026,
  semester: 1,
  isTest: false,
  applyStartAt: 1755500000000,
  applyEndAt: null,
  calcMode: 'weighted',
  calcConfig: { calcMode: 'weighted', dyfWeight: 0.3, courseWeight: 0.7 },
  publicKeyJwk: { kty: 'RSA', n: 'batch-modulus', e: 'AQAB' },
  keyId: 'testTest1-k1',
  configTemplateId: 'test-1',
  configTemplateVersion: 1,
  configTemplateRevision: 0,
  ...overrides,
})

describe('POST /api/v1/batches（接口 5）', () => {
  let ctx: TestDb

  beforeEach(async () => {
    ctx = await createTestDb()
  })

  afterEach(async () => {
    await ctx.close()
  })

  async function createBatch(token: string, unitId: string, overrides: Record<string, unknown> = {}) {
    const app = createHonoApp({ db: ctx.db })
    const body = createPayload(overrides)
    const res = await app.request('http://internal/api/v1/batches', {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ batch: body }),
    })
    return { res, body, app }
  }

  it('登记成功：返回 batchId/status/createdAt 并落库为 draft', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const app = createHonoApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)
    const batchId = nextBatchId()

    const res = await app.request('http://internal/api/v1/batches', {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({ batch: createPayload({ batchId }) }),
    })
    expect(res.status).toBe(200)
    const data = await readData<{ batchId: string; status: string; createdAt: number }>(res)
    expect(data.batchId).toBe(batchId)
    expect(data.status).toBe('draft')

    const rows = await ctx.db.query<{ status: string; unit_id: string }>(`SELECT status, unit_id FROM batch`)
    expect(rows).toEqual([{ status: 'draft', unit_id: seeded.unitId }])
  })

  it('同 batchId 重复上报幂等：返回现有记录不重复插入', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const token = await activateUnit(createHonoApp({ db: ctx.db }), seeded.code)
    const batchId = nextBatchId()
    const init = createPayload({ batchId })

    const { res: first } = await createBatch(token, seeded.unitId, init)
    const { res: second } = await createBatch(token, seeded.unitId, init)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await readData<{ batchId: string }>(second)).toEqual(await readData<{ batchId: string }>(first))

    const count = await ctx.db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM batch`)
    expect(count[0]!.count).toBe(1)
  })

  it('正式批次同单位同学年学期重复 → 409', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const token = await activateUnit(createHonoApp({ db: ctx.db }), seeded.code)

    await createBatch(token, seeded.unitId)
    const { res } = await createBatch(token, seeded.unitId, { batchId: nextBatchId() })
    expect(res.status).toBe(409)
    expect(await readError(res)).toBe('该学年学期已存在正式批次')
  })

  it('测试批次不受正式批次唯一约束', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const token = await activateUnit(createHonoApp({ db: ctx.db }), seeded.code)

    await createBatch(token, seeded.unitId, { isTest: true })
    const { res } = await createBatch(token, seeded.unitId, { isTest: true, batchId: nextBatchId() })
    expect(res.status).toBe(200)
  })

  it('引用不存在的配置模板版本 → 400', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const token = await activateUnit(createHonoApp({ db: ctx.db }), seeded.code)
    const { res } = await createBatch(token, seeded.unitId, { configTemplateVersion: 99 })
    expect(res.status).toBe(400)
  })

  it('参数非法（calcMode 与 calcConfig 判别不一致）→ 400', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const token = await activateUnit(createHonoApp({ db: ctx.db }), seeded.code)
    const { res } = await createBatch(token, seeded.unitId, {
      calcMode: 'formula',
      calcConfig: { calcMode: 'weighted', dyfWeight: 0.3, courseWeight: 0.7 },
    })
    expect(res.status).toBe(400)
  })

  it('缺令牌 → 401', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const res = await createHonoApp({ db: ctx.db }).request('http://internal/api/v1/batches', {
      method: 'POST',
      headers: unitHeaders('bad-token-bad-token-bad-token', seeded.unitId),
      body: JSON.stringify({ batch: createPayload() }),
    })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/v1/batches/{batchId}/status（接口 6）', () => {
  let ctx: TestDb

  beforeEach(async () => {
    ctx = await createTestDb()
  })

  afterEach(async () => {
    await ctx.close()
  })

  async function makeActiveBatch() {
    const seeded = await seedTestUnit(ctx.db)
    const app = createHonoApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)
    const batchId = nextBatchId()
    await app.request('http://internal/api/v1/batches', {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({ batch: createPayload({ batchId }) }),
    })
    return { app, token, unitId: seeded.unitId, batchId }
  }

  const setStatus = (app: App, token: string, unitId: string, batchId: string, status: string) =>
    app.request(`http://internal/api/v1/batches/${batchId}/status`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ status }),
    })

  it('draft → active → closed 单向推进', async () => {
    const { app, token, unitId, batchId } = await makeActiveBatch()

    const active = await setStatus(app, token, unitId, batchId, 'active')
    expect(active.status).toBe(200)
    expect((await readData<{ status: string }>(active)).status).toBe('active')

    const closed = await setStatus(app, token, unitId, batchId, 'closed')
    expect(closed.status).toBe(200)
    expect((await readData<{ status: string }>(closed)).status).toBe('closed')
  })

  it('同状态重复上报幂等 → 200', async () => {
    const { app, token, unitId, batchId } = await makeActiveBatch()
    await setStatus(app, token, unitId, batchId, 'active')
    const again = await setStatus(app, token, unitId, batchId, 'active')
    expect(again.status).toBe(200)
  })

  it('状态回退 → 409', async () => {
    const { app, token, unitId, batchId } = await makeActiveBatch()
    await setStatus(app, token, unitId, batchId, 'active')
    const rollback = await setStatus(app, token, unitId, batchId, 'draft')
    expect(rollback.status).toBe(409)
    expect(await readError(rollback)).toBe('批次状态不允许回退')
  })

  it('未知或非本单位批次 → 404', async () => {
    const { app, token, unitId } = await makeActiveBatch()
    const res = await setStatus(app, token, unitId, nextBatchId(), 'active')
    expect(res.status).toBe(404)
  })

  it('非法状态值 → 400', async () => {
    const { app, token, unitId, batchId } = await makeActiveBatch()
    const res = await setStatus(app, token, unitId, batchId, 'archived')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/batches/active（接口 11）', () => {
  let ctx: TestDb

  beforeEach(async () => {
    ctx = await createTestDb()
  })

  afterEach(async () => {
    await ctx.close()
  })

  async function makeBatch(status: string, overrides: Record<string, unknown> = {}) {
    const seeded = await seedTestUnit(ctx.db)
    const app = createHonoApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)
    const batchId = nextBatchId()
    await app.request('http://internal/api/v1/batches', {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({ batch: createPayload({ batchId, ...overrides }) }),
    })
    if (status !== 'draft') {
      await setBatchStatus(app, token, seeded.unitId, batchId, status)
    }
    return { app, seeded, batchId }
  }

  const setBatchStatus = (
    app: App,
    token: string,
    unitId: string,
    batchId: string,
    status: string,
  ) =>
    app.request(`http://internal/api/v1/batches/${batchId}/status`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ status }),
    })

  it('返回活跃批次及其配置模板快照', async () => {
    const { seeded, batchId } = await makeBatch('active')
    const res = await createHonoApp({ db: ctx.db }).request(
      `http://internal/api/v1/batches/active?unitId=${seeded.unitId}`,
    )
    expect(res.status).toBe(200)
    const data = await readData<{ batch: { batchId: string; status: string }; configTemplate: { id: string } }>(res)
    expect(data.batch.batchId).toBe(batchId)
    expect(data.batch.status).toBe('active')
    expect(data.configTemplate.id).toBe('test-1')
  })

  it('无活跃批次 → batch: null 且不含 configTemplate', async () => {
    const { seeded } = await makeBatch('draft')
    const res = await createHonoApp({ db: ctx.db }).request(
      `http://internal/api/v1/batches/active?unitId=${seeded.unitId}`,
    )
    expect(res.status).toBe(200)
    expect(await readData<{ batch: null }>(res)).toEqual({ batch: null })
  })

  it('已过申请截止的活跃批次不下发', async () => {
    const { seeded } = await makeBatch('active', { applyEndAt: Date.now() - 1000 })
    const res = await createHonoApp({ db: ctx.db }).request(
      `http://internal/api/v1/batches/active?unitId=${seeded.unitId}`,
    )
    expect((await readData<{ batch: null }>(res)).batch).toBeNull()
  })

  it('正式批次优先于测试批次', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const app = createHonoApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)

    const testId = nextBatchId()
    await app.request('http://internal/api/v1/batches', {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({ batch: createPayload({ batchId: testId, isTest: true, year: 2025, semester: 2 }) }),
    })
    await setBatchStatus(app, token, seeded.unitId, testId, 'active')

    const officialId = nextBatchId()
    await app.request('http://internal/api/v1/batches', {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({ batch: createPayload({ batchId: officialId }) }),
    })
    await setBatchStatus(app, token, seeded.unitId, officialId, 'active')

    const res = await app.request(`http://internal/api/v1/batches/active?unitId=${seeded.unitId}`)
    const data = await readData<{ batch: { batchId: string; isTest: boolean } }>(res)
    expect(data.batch.batchId).toBe(officialId)
    expect(data.batch.isTest).toBe(false)
  })

  it('单位不存在 → 404 单位不存在', async () => {
    const res = await createHonoApp({ db: ctx.db }).request(
      'http://internal/api/v1/batches/active?unitId=noSuchUnit',
    )
    expect(res.status).toBe(404)
    expect(await readError(res)).toBe('单位不存在')
  })
})
