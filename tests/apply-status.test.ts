import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Hono } from 'hono'
import { createApp } from '../src/app.js'
import type { AppEnv } from '../src/http/env.js'
import { sha256Hex } from '../src/lib/hash.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import {
  activateUnit,
  jsonHeaders,
  nextApplyId,
  nextBatchId,
  seedLevelOneUnit,
  seedTestUnit,
  unitHeaders,
} from './helpers/fixtures.js'
import { readData, readError } from './helpers/http.js'

type App = Hono<AppEnv>

type Record = {
  applyId: string
  reviewRound: number
  status: string
  latestRevision: number | null
  importedRevision: number | null
  importedAt: number | null
  updatedAt: number
}

type BulkData = { succeeded: number; failed: number; results: Array<Record & { ok: boolean; error: string | null }> }

/** 造一个 active 批次并返回激活令牌（接口 5→6 链路复用）。 */
async function makeActiveBatch(db: TestDb): Promise<{ app: App; token: string; unitId: string; batchId: string }> {
  const seeded = await seedTestUnit(db.db)
  const app = createApp({ db: db.db })
  const token = await activateUnit(app, seeded.code)

  const batchId = nextBatchId()
  const created = await app.request('http://internal/api/v1/batches', {
    method: 'POST',
    headers: unitHeaders(token, seeded.unitId),
    body: JSON.stringify({
      batch: {
        batchId,
        year: 2026,
        semester: 1,
        isTest: false,
        applyEndAt: null,
        calcMode: 'weighted',
        calcConfig: { calcMode: 'weighted', dyfWeight: 0.3, courseWeight: 0.7 },
        publicKeyJwk: { kty: 'RSA', n: 'batch-modulus', e: 'AQAB' },
        configTemplateId: 'test-1',
        configTemplateVersion: 1,
        configTemplateRevision: 0,
      },
    }),
  })
  expect(created.status).toBe(200)
  await app.request(`http://internal/api/v1/batches/${batchId}/status`, {
    method: 'POST',
    headers: unitHeaders(token, seeded.unitId),
    body: JSON.stringify({ status: 'active' }),
  })
  return { app, token, unitId: seeded.unitId, batchId }
}

describe('POST /api/v1/applies/{applyId}/register（接口 12）', () => {
  let ctx: TestDb

  beforeEach(async () => {
    ctx = await createTestDb()
  })

  afterEach(async () => {
    await ctx.close()
  })

  it('首次注册：round=1、submitted、latestRevision=revision', async () => {
    const { app, batchId } = await makeActiveBatch(ctx)
    const applyId = nextApplyId()

    const res = await app.request(`http://internal/api/v1/applies/${applyId}/register`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ batchId, revision: 1 }),
    })
    expect(res.status).toBe(200)
    const data = await readData<Record>(res)
    expect(data).toMatchObject({ reviewRound: 1, status: 'submitted', latestRevision: 1, importedRevision: null })
  })

  it('相同 revision 幂等；更高 revision 更新 latestRevision', async () => {
    const { app, batchId } = await makeActiveBatch(ctx)
    const applyId = nextApplyId()

    await app.request(`http://internal/api/v1/applies/${applyId}/register`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ batchId, revision: 1 }),
    })
    const again = await app.request(`http://internal/api/v1/applies/${applyId}/register`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ batchId, revision: 1 }),
    })
    expect(again.status).toBe(200)
    expect((await readData<Record>(again)).latestRevision).toBe(1)

    const higher = await app.request(`http://internal/api/v1/applies/${applyId}/register`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ batchId, revision: 2 }),
    })
    expect((await readData<Record>(higher)).latestRevision).toBe(2)
  })

  it('draft 批次不可注册 → 403 批次未开放申请', async () => {
    const seeded = await seedTestUnit(ctx.db)
    const app = createApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)
    const batchId = nextBatchId()
    await app.request('http://internal/api/v1/batches', {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({
        batch: {
          batchId,
          year: 2026,
          semester: 1,
          isTest: false,
          calcMode: 'weighted',
          calcConfig: { calcMode: 'weighted', dyfWeight: 0.3, courseWeight: 0.7 },
          publicKeyJwk: { kty: 'RSA', n: 'n', e: 'AQAB' },
          configTemplateId: 'test-1',
          configTemplateVersion: 1,
          configTemplateRevision: 0,
        },
      }),
    })

    const res = await app.request(`http://internal/api/v1/applies/${nextApplyId()}/register`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ batchId, revision: 1 }),
    })
    expect(res.status).toBe(403)
    expect(await readError(res)).toBe('批次未开放申请')
  })

  it('未知批次 → 404 批次不存在；applyId 非 UUID → 400', async () => {
    const { app, batchId } = await makeActiveBatch(ctx)

    const missing = await app.request(`http://internal/api/v1/applies/${nextApplyId()}/register`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ batchId: nextBatchId(), revision: 1 }),
    })
    expect(missing.status).toBe(404)
    expect(await readError(missing)).toBe('批次不存在')

    const badId = await app.request('http://internal/api/v1/applies/not-a-uuid/register', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ batchId, revision: 1 }),
    })
    expect(badId.status).toBe(400)
  })
})

describe('POST /api/v1/applies/{applyId}/status（接口 8）', () => {
  let ctx: TestDb

  beforeEach(async () => {
    ctx = await createTestDb()
  })

  afterEach(async () => {
    await ctx.close()
  })

  it('submitted → imported → reviewing → confirmed 单向推进，imported 记版本与时间', async () => {
    const { app, token, unitId, batchId } = await makeActiveBatch(ctx)
    const applyId = nextApplyId()
    await app.request(`http://internal/api/v1/applies/${applyId}/register`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ batchId, revision: 1 }),
    })

    const imported = await app.request(`http://internal/api/v1/applies/${applyId}/status`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ batchId, status: 'imported', revision: 1 }),
    })
    expect(imported.status).toBe(200)
    const importedData = await readData<Record>(imported)
    expect(importedData.status).toBe('imported')
    expect(importedData.importedRevision).toBe(1)
    expect(importedData.importedAt).toBeGreaterThan(0)

    const reviewing = await app.request(`http://internal/api/v1/applies/${applyId}/status`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ batchId, status: 'reviewing' }),
    })
    expect((await readData<Record>(reviewing)).status).toBe('reviewing')

    const confirmed = await app.request(`http://internal/api/v1/applies/${applyId}/status`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ batchId, status: 'confirmed' }),
    })
    expect((await readData<Record>(confirmed)).status).toBe('confirmed')
  })

  it('同状态重复上报幂等 200；回退 → 409 申请状态不允许回退', async () => {
    const { app, token, unitId, batchId } = await makeActiveBatch(ctx)
    const applyId = nextApplyId()
    await app.request(`http://internal/api/v1/applies/${applyId}/register`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ batchId, revision: 1 }),
    })
    await app.request(`http://internal/api/v1/applies/${applyId}/status`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ batchId, status: 'imported', revision: 1 }),
    })

    const again = await app.request(`http://internal/api/v1/applies/${applyId}/status`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ batchId, status: 'imported', revision: 1 }),
    })
    expect(again.status).toBe(200)

    // 同状态下 revision 前进：仍属同状态推进，允许并更新 imported 版本
    const imported = await app.request(`http://internal/api/v1/applies/${applyId}/status`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ batchId, status: 'imported', revision: 2 }),
    })
    expect(imported.status).toBe(200)
    expect((await readData<Record>(imported)).importedRevision).toBe(2)

    // reviewing → imported 是回退：先推进到 reviewing，再尝试回退到 imported
    await app.request(`http://internal/api/v1/applies/${applyId}/status`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ batchId, status: 'reviewing' }),
    })
    const rollback = await app.request(`http://internal/api/v1/applies/${applyId}/status`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ batchId, status: 'imported' }),
    })
    expect(rollback.status).toBe(409)
    expect(await readError(rollback)).toBe('申请状态不允许回退')
  })

  it('未注册的 applyId → 404；错配批次 → 404', async () => {
    const { app, token, unitId, batchId } = await makeActiveBatch(ctx)

    const missing = await app.request(`http://internal/api/v1/applies/${nextApplyId()}/status`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ batchId, status: 'imported', revision: 1 }),
    })
    expect(missing.status).toBe(404)

    const applyId = nextApplyId()
    await app.request(`http://internal/api/v1/applies/${applyId}/register`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ batchId, revision: 1 }),
    })
    const mismatch = await app.request(`http://internal/api/v1/applies/${applyId}/status`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ batchId: nextBatchId(), status: 'imported', revision: 1 }),
    })
    expect(mismatch.status).toBe(404)
  })
})

describe('POST /api/v1/applies/{applyId}/review-rounds（接口 9）', () => {
  let ctx: TestDb

  beforeEach(async () => {
    ctx = await createTestDb()
  })

  afterEach(async () => {
    await ctx.close()
  })

  async function confirmedApply() {
    const seeded = await seedTestUnit(ctx.db)
    const app = createApp({ db: ctx.db })
    const token = await activateUnit(app, seeded.code)
    const batchId = nextBatchId()
    await app.request('http://internal/api/v1/batches', {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({
        batch: {
          batchId,
          year: 2026,
          semester: 1,
          isTest: false,
          calcMode: 'weighted',
          calcConfig: { calcMode: 'weighted', dyfWeight: 0.3, courseWeight: 0.7 },
          publicKeyJwk: { kty: 'RSA', n: 'n', e: 'AQAB' },
          configTemplateId: 'test-1',
          configTemplateVersion: 1,
          configTemplateRevision: 0,
        },
      }),
    })
    await app.request(`http://internal/api/v1/batches/${batchId}/status`, {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({ status: 'active' }),
    })
    const applyId = nextApplyId()
    await app.request(`http://internal/api/v1/applies/${applyId}/register`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ batchId, revision: 1 }),
    })
    await app.request(`http://internal/api/v1/applies/${applyId}/status`, {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({ batchId, status: 'imported', revision: 1 }),
    })
    await app.request(`http://internal/api/v1/applies/${applyId}/status`, {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({ batchId, status: 'reviewing' }),
    })
    await app.request(`http://internal/api/v1/applies/${applyId}/status`, {
      method: 'POST',
      headers: unitHeaders(token, seeded.unitId),
      body: JSON.stringify({ batchId, status: 'confirmed' }),
    })
    return { app, seeded, batchId, applyId }
  }

  it('一级单位令牌可发起：round+1、reviewing，沿用版本信息', async () => {
    const levelOne = await seedLevelOneUnit(ctx.db)
    const app = createApp({ db: ctx.db })
    const levelOneToken = await activateUnit(app, levelOne.code)
    const { batchId, applyId } = await confirmedApply()

    const res = await app.request(`http://internal/api/v1/applies/${applyId}/review-rounds`, {
      method: 'POST',
      headers: unitHeaders(levelOneToken, levelOne.unitId),
      body: JSON.stringify({ reason: '材料不齐' }),
    })
    expect(res.status).toBe(200)
    const data = await readData<Record>(res)
    expect(data.reviewRound).toBe(2)
    expect(data.status).toBe('reviewing')
    expect(data.latestRevision).toBe(1)
    expect(data.importedRevision).toBe(1)
  })

  it('二级单位令牌 → 403 仅一级单位可发起新一轮审核', async () => {
    const { app, seeded, batchId, applyId } = await confirmedApply()
    const token = await activateUnit(app, seeded.code)
    const unitId = seeded.unitId
    void batchId

    const res = await app.request(`http://internal/api/v1/applies/${applyId}/review-rounds`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(403)
    expect(await readError(res)).toBe('仅一级单位可发起新一轮审核')
  })

  it('未确认轮次 → 409 当前轮次尚未确认', async () => {
    const levelOne = await seedLevelOneUnit(ctx.db)
    const app = createApp({ db: ctx.db })
    const levelOneToken = await activateUnit(app, levelOne.code)
    const { batchId } = await makeActiveBatch(ctx)

    const applyIdNew = nextApplyId()
    await app.request(`http://internal/api/v1/applies/${applyIdNew}/register`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ batchId, revision: 1 }),
    })

    const res = await app.request(`http://internal/api/v1/applies/${applyIdNew}/review-rounds`, {
      method: 'POST',
      headers: unitHeaders(levelOneToken, levelOne.unitId),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(409)
    expect(await readError(res)).toBe('当前轮次尚未确认，无法发起新一轮审核')
  })
})

describe('GET /api/v1/applies/{applyId}（接口 13）', () => {
  let ctx: TestDb

  beforeEach(async () => {
    ctx = await createTestDb()
  })

  afterEach(async () => {
    await ctx.close()
  })

  it('已知申请返回记录；未知返回 status=unknown（200）', async () => {
    const { app, batchId } = await makeActiveBatch(ctx)
    const applyId = nextApplyId()
    await app.request(`http://internal/api/v1/applies/${applyId}/register`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ batchId, revision: 1 }),
    })

    const known = await app.request(`http://internal/api/v1/applies/${applyId}`)
    expect(known.status).toBe(200)
    expect((await readData<Record>(known)).status).toBe('submitted')

    const unknown = await app.request(`http://internal/api/v1/applies/${nextApplyId()}`)
    expect(unknown.status).toBe(200)
    const data = await readData<{ status: string; reviewRound: number | null }>(unknown)
    expect(data.status).toBe('unknown')
    expect(data.reviewRound).toBeNull()
  })

  it('applyId 非 UUID → 400', async () => {
    const app = createApp({ db: ctx.db })
    const res = await app.request('http://internal/api/v1/applies/not-a-uuid')
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/batches/{batchId}/apply-statuses（接口 7）', () => {
  let ctx: TestDb

  beforeEach(async () => {
    ctx = await createTestDb()
  })

  afterEach(async () => {
    await ctx.close()
  })

  it('整班导入：逐条成功，succeeded/failed 与 results 对应', async () => {
    const { app, token, unitId, batchId } = await makeActiveBatch(ctx)
    const ids = [nextApplyId(), nextApplyId(), nextApplyId()]
    for (const applyId of ids) {
      await app.request(`http://internal/api/v1/applies/${applyId}/register`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ batchId, revision: 1 }),
      })
    }

    const res = await app.request(`http://internal/api/v1/batches/${batchId}/apply-statuses`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ status: 'imported', applyIds: ids, revision: 1 }),
    })
    expect(res.status).toBe(200)
    const data = await readData<BulkData>(res)
    expect(data.succeeded).toBe(3)
    expect(data.failed).toBe(0)
    expect(data.results.every((item) => item.ok && item.status === 'imported')).toBe(true)
  })

  it('部分失败不回滚：未知 applyId 记 failed 并带中文原因', async () => {
    const { app, token, unitId, batchId } = await makeActiveBatch(ctx)
    const known = nextApplyId()
    await app.request(`http://internal/api/v1/applies/${known}/register`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ batchId, revision: 1 }),
    })

    const res = await app.request(`http://internal/api/v1/batches/${batchId}/apply-statuses`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ status: 'imported', applyIds: [known, nextApplyId()], revision: 1 }),
    })
    const data = await readData<BulkData>(res)
    expect(data.succeeded).toBe(1)
    expect(data.failed).toBe(1)
    const failedItem = data.results.find((item) => !item.ok)
    expect(failedItem?.error).toBe('资源不存在')
  })

  it('startNewRound：confirmed 记录跨轮进入 reviewing；未确认项失败不回滚', async () => {
    const levelOne = await seedLevelOneUnit(ctx.db)
    const app = createApp({ db: ctx.db })
    const levelOneToken = await activateUnit(app, levelOne.code)
    const seeded = await seedTestUnit(ctx.db)
    const token = await activateUnit(app, seeded.code)
    const unitId = seeded.unitId

    const batchId = nextBatchId()
    await app.request('http://internal/api/v1/batches', {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({
        batch: {
          batchId,
          year: 2026,
          semester: 1,
          isTest: false,
          calcMode: 'weighted',
          calcConfig: { calcMode: 'weighted', dyfWeight: 0.3, courseWeight: 0.7 },
          publicKeyJwk: { kty: 'RSA', n: 'n', e: 'AQAB' },
          configTemplateId: 'test-1',
          configTemplateVersion: 1,
          configTemplateRevision: 0,
        },
      }),
    })
    await app.request(`http://internal/api/v1/batches/${batchId}/status`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ status: 'active' }),
    })

    const confirmedId = nextApplyId()
    const submittedId = nextApplyId()
    for (const applyId of [confirmedId, submittedId]) {
      await app.request(`http://internal/api/v1/applies/${applyId}/register`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ batchId, revision: 1 }),
      })
    }
    for (const status of ['imported', 'reviewing', 'confirmed'] as const) {
      await app.request(`http://internal/api/v1/applies/${confirmedId}/status`, {
        method: 'POST',
        headers: unitHeaders(token, unitId),
        body: JSON.stringify({ batchId, status, revision: 1 }),
      })
    }

    // 二级单位令牌不能跨轮
    const denied = await app.request(`http://internal/api/v1/batches/${batchId}/apply-statuses`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ status: 'reviewing', applyIds: [confirmedId], startNewRound: true }),
    })
    expect(denied.status).toBe(403)
    expect(await readError(denied)).toBe('仅一级单位可发起新一轮审核')

    // 一级令牌跨轮：confirmed 成功、submitted 失败
    const res = await app.request(`http://internal/api/v1/batches/${batchId}/apply-statuses`, {
      method: 'POST',
      headers: unitHeaders(levelOneToken, levelOne.unitId),
      body: JSON.stringify({ status: 'reviewing', applyIds: [confirmedId, submittedId], startNewRound: true }),
    })
    expect(res.status).toBe(200)
    const data = await readData<BulkData>(res)
    expect(data.succeeded).toBe(1)
    expect(data.failed).toBe(1)
    const okItem = data.results.find((item) => item.applyId === confirmedId)
    expect(okItem).toMatchObject({ ok: true, reviewRound: 2, status: 'reviewing' })
    const failedItem = data.results.find((item) => item.applyId === submittedId)
    expect(failedItem?.error).toBe('当前轮次尚未确认，无法发起新一轮审核')
  })

  it('applyIds 超过 500 → 400', async () => {
    const { app, token, unitId, batchId } = await makeActiveBatch(ctx)
    const ids = Array.from({ length: 501 }, () => nextApplyId())
    const res = await app.request(`http://internal/api/v1/batches/${batchId}/apply-statuses`, {
      method: 'POST',
      headers: unitHeaders(token, unitId),
      body: JSON.stringify({ status: 'imported', applyIds: ids }),
    })
    expect(res.status).toBe(400)
  })
})