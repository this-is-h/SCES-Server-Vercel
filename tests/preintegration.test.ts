import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHonoApp } from '../server/utils/app.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import { seedTestUnit, seedLevelOneUnit, activateUnit, unitHeaders, loadTestSeed, TEST_JWK, jsonHeaders } from './helpers/fixtures.js'
import { readData, readError } from './helpers/http.js'
import { hashPassword, sha256Hex } from '../server/utils/lib/hash.js'
import { unusedDb } from './helpers/stub-db.js'

type Session = { accessToken: string; refreshToken: string; mustChangePassword: boolean }
describe('接入前业务验收（隔离数据库）', () => {
  let ctx: TestDb
  let app: ReturnType<typeof createHonoApp>
  beforeEach(async () => { ctx = await createTestDb(); app = createHonoApp({ db: ctx.db }) })
  afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await ctx.close() })
  const request = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(`http://internal/api/v1${path}`, { method, headers: jsonHeaders(headers), body: body === undefined ? undefined : JSON.stringify(body) })
  async function login(password = 'local-test-password', user = 'admin') {
    return readData<Session>(await request('POST', '/admin/auth/login', { username: user, password }))
  }
  async function admin() {
    await ctx.db.query(`INSERT INTO admin_user VALUES ('admin', 'admin', $1, 0, 1, 1)`, [hashPassword('local-test-password')])
    return { Authorization: `Bearer ${(await login()).accessToken}` }
  }
  async function batch(overrides: Record<string, unknown> = {}) {
    const unit = await seedTestUnit(ctx.db)
    const token = await activateUnit(app, unit.code)
    const headers = unitHeaders(token, unit.unitId)
    const payload = { batchId: randomUUID(), year: 2026, semester: 1, isTest: true, calcMode: 'weighted',
      calcConfig: { calcMode: 'weighted', dyfWeight: 0.3, courseWeight: 0.7 }, publicKeyJwk: TEST_JWK, keyId: 'test-key',
      configTemplateId: unit.seed.id, configTemplateVersion: 1, configTemplateRevision: 0, ...overrides }
    expect((await request('POST', '/batches', { batch: payload }, headers)).status).toBe(200)
    expect((await request('POST', `/batches/${payload.batchId}/status`, { status: 'active' }, headers)).status).toBe(200)
    return { ...unit, headers, payload }
  }

  it('首次改密强制执行；旧访问令牌和刷新令牌失效；JWT exp 使用秒', async () => {
    vi.stubEnv('ADMIN_INITIAL_PASSWORD', 'bootstrap-test-password')
    const session = await login('bootstrap-test-password')
    expect(session.mustChangePassword).toBe(true)
    const headers = { Authorization: `Bearer ${session.accessToken}` }
    expect((await request('GET', '/admin/units', undefined, headers)).status).toBe(403)
    const claims = JSON.parse(Buffer.from(session.accessToken.split('.')[1]!, 'base64url').toString())
    expect(claims.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(900)
    expect((await request('POST', '/admin/auth/change-password', { oldPassword: 'bootstrap-test-password', newPassword: 'updated-test-password' }, headers)).status).toBe(200)
    expect((await request('GET', '/admin/units', undefined, headers)).status).toBe(401)
    expect((await request('POST', '/admin/auth/refresh', { refreshToken: session.refreshToken })).status).toBe(401)
    expect((await login('updated-test-password')).mustChangePassword).toBe(false)
  })

  it('同一刷新凭证并发使用仅成功一次，轮换后可再次刷新并登出', async () => {
    await admin()
    const session = await login()
    const responses = await Promise.all([request('POST', '/admin/auth/refresh', { refreshToken: session.refreshToken }), request('POST', '/admin/auth/refresh', { refreshToken: session.refreshToken })])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 401])
    const rotated = await readData<Session>(responses.find((r) => r.status === 200)!)
    expect(rotated.refreshToken).not.toBe(session.refreshToken)
    const again = await readData<Session>(await request('POST', '/admin/auth/refresh', { refreshToken: rotated.refreshToken }))
    expect((await request('POST', '/admin/auth/logout', { refreshToken: again.refreshToken }, { Authorization: `Bearer ${again.accessToken}` })).status).toBe(200)
    expect((await request('POST', '/admin/auth/refresh', { refreshToken: again.refreshToken })).status).toBe(401)
  })

  it('新建单位→上传及编辑草稿→发布→激活取得正确单位模板', async () => {
    const headers = await admin()
    const seed = structuredClone(loadTestSeed())
    expect((await request('POST', '/admin/units', { unitId: seed.unit.parentUnit.unitId, name: seed.unit.parentUnit.name, level: 1 }, headers)).status).toBe(200)
    const unit = await readData<{ code: string }>(await request('POST', '/admin/units', { unitId: seed.unit.unitId, name: seed.unit.name, level: 2, parentId: seed.unit.parentUnit.unitId, templateId: seed.id }, headers))
    expect((await request('POST', '/admin/templates', { config: seed }, headers)).status).toBe(200)
    seed.name = 'Updated draft'
    expect((await request('POST', '/admin/templates', { config: seed }, headers)).status).toBe(200)
    expect((await request('POST', `/admin/templates/${seed.id}/publish`, { version: 1, revision: 0 }, headers)).status).toBe(200)
    const activated = await readData<{ configTemplate: { name: string; unit: { unitId: string } } }>(await request('POST', '/authorize', { code: unit.code }, { 'X-Install-Id': 'local-test-device' }))
    expect(activated.configTemplate.unit.unitId).toBe(seed.unit.unitId)
    expect(activated.configTemplate.name).toBe('Updated draft')
    expect((await request('POST', '/admin/templates', { config: seed }, headers)).status).toBe(409)
  })

  it('跨设备激活被拒绝，三次换机后进入 pending，审批并发不会重复签发', async () => {
    const headers = await admin()
    const unit = await seedTestUnit(ctx.db)
    let code = unit.code
    let token = await activateUnit(app, code, 'device0')
    expect((await request('POST', '/authorize', { code }, { 'X-Install-Id': 'other-device' })).status).toBe(403)
    for (let i = 0; i < 3; i++) {
      const next = await readData<{ code: string; monthCount: number }>(await request('POST', '/units/rebind', {}, unitHeaders(token, unit.unitId, `device${i}`)))
      expect(next.monthCount).toBe(i + 1)
      code = next.code
      token = await activateUnit(app, code, `device${i + 1}`)
    }
    expect((await request('POST', '/units/rebind', {}, unitHeaders(token, unit.unitId, 'device3'))).status).toBe(403)
    const pending = (await ctx.db.query<{ id: string }>("SELECT id FROM rebind_request WHERE status = 'pending'"))[0]!
    const results = await Promise.all([request('POST', `/admin/rebinds/${pending.id}/approve`, {}, headers), request('POST', `/admin/rebinds/${pending.id}/approve`, {}, headers)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect((await ctx.db.query("SELECT code FROM license WHERE status <> 'revoked'"))).toHaveLength(1)
  })

  it('授权和令牌均过期仍可读授权状态，续期后原令牌恢复写权限', async () => {
    const headers = await admin()
    const unit = await seedTestUnit(ctx.db)
    const token = await activateUnit(app, unit.code)
    await ctx.db.query('UPDATE license SET expires_at = 1')
    await ctx.db.query('UPDATE unit_token SET expires_at = 1')
    const identity = unitHeaders(token, unit.unitId)
    expect((await readData<{ status: string }>(await request('GET', '/license/status', undefined, identity))).status).toBe('expired')
    expect((await request('POST', `/units/${unit.unitId}/public-key`, { publicKeyJwk: TEST_JWK }, identity)).status).toBe(401)
    expect((await request('POST', `/admin/licenses/${unit.code}/renew`, { months: 1 }, headers)).status).toBe(200)
    expect((await request('POST', `/units/${unit.unitId}/public-key`, { publicKeyJwk: TEST_JWK }, identity)).status).toBe(200)
  })

  it('开始/截止时间、版本回退和并发首次注册正确处理', async () => {
    const { payload, headers } = await batch({ applyStartAt: Date.now() + 60000 })
    const id = randomUUID()
    expect(await readError(await request('POST', `/applies/${id}/register`, { batchId: payload.batchId, revision: 1 }))).toBe('申请尚未开始')
    await ctx.db.query('UPDATE batch SET apply_start_at = 1 WHERE id = $1', [payload.batchId])
    const requests = await Promise.all([request('POST', `/applies/${id}/register`, { batchId: payload.batchId, revision: 1 }), request('POST', `/applies/${id}/register`, { batchId: payload.batchId, revision: 1 })])
    expect(requests.map((r) => r.status)).toEqual([200, 200])
    expect(await ctx.db.query('SELECT * FROM apply_status')).toHaveLength(1)
    expect((await request('POST', `/applies/${id}/register`, { batchId: payload.batchId, revision: 2 })).status).toBe(200)
    expect((await request('POST', `/applies/${id}/register`, { batchId: payload.batchId, revision: 1 })).status).toBe(409)
    expect((await request('POST', `/applies/${id}/status`, { batchId: payload.batchId, status: 'imported', revision: 2 }, headers)).status).toBe(200)
    expect((await request('POST', `/applies/${id}/register`, { batchId: payload.batchId, revision: 3 })).status).toBe(409)
    expect((await request('POST', `/applies/${id}/status`, { batchId: payload.batchId, status: 'imported', revision: 1 }, headers)).status).toBe(409)
    await ctx.db.query('UPDATE batch SET apply_end_at = 1')
    expect(await readError(await request('POST', `/applies/${randomUUID()}/register`, { batchId: payload.batchId, revision: 1 }))).toBe('申请已截止')
  })

  it('同一 applyId 不能注册到另一个批次；批量错误不泄露其他批次状态', async () => {
    const { payload, headers } = await batch()
    const other = { ...payload, batchId: randomUUID() }
    expect((await request('POST', '/batches', { batch: other }, headers)).status).toBe(200)
    await request('POST', `/batches/${other.batchId}/status`, { status: 'active' }, headers)
    const id = randomUUID()
    await request('POST', `/applies/${id}/register`, { batchId: payload.batchId, revision: 1 })
    expect((await request('POST', `/applies/${id}/register`, { batchId: other.batchId, revision: 2 })).status).toBe(409)
    await request('POST', `/applies/${id}/status`, { batchId: payload.batchId, status: 'confirmed', revision: 7 }, headers)
    const failed = await readData<{ results: Array<{ status: string; latestRevision: null; importedRevision: null }> }>(await request('POST', `/batches/${other.batchId}/apply-statuses`, { status: 'reviewing', applyIds: [id] }, headers))
    expect(failed.results[0]).toMatchObject({ status: 'draft', latestRevision: null, importedRevision: null })
    expect((await ctx.db.query<{ batch_id: string }>('SELECT batch_id FROM apply_status WHERE apply_id_hash = $1', [sha256Hex(id)]))[0]?.batch_id).toBe(payload.batchId)
  })

  it('批次请求严格遵守包装、keyId、模板归属和状态推进', async () => {
    const { payload, headers } = await batch()
    const next = { ...payload, batchId: randomUUID() }
    expect((await request('POST', '/batches', next, headers)).status).toBe(400)
    expect((await request('POST', '/batches', { batch: { ...next, keyId: undefined } }, headers)).status).toBe(400)
    expect((await request('POST', '/batches', { batch: next }, headers)).status).toBe(200)
    expect((await request('POST', `/batches/${next.batchId}/status`, { status: 'closed' }, headers)).status).toBe(409)
    expect((await request('POST', `/batches/${payload.batchId}/status`, { status: 'draft' }, headers)).status).toBe(409)
    await ctx.db.query("UPDATE config_template SET unit_id = 'test'")
    expect((await request('POST', '/batches', { batch: { ...next, batchId: randomUUID() } }, headers)).status).toBe(400)
  })

  it('CORS 白名单、安全头、无 Content-Length 超大请求、数据库不可用响应', async () => {
    vi.stubEnv('CORS_ORIGINS', 'https://allowed.example')
    const allowed = await request('OPTIONS', '/admin/units', undefined, { Origin: 'https://allowed.example' })
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://allowed.example')
    expect(allowed.headers.get('access-control-allow-methods')).toContain('DELETE')
    expect((await request('OPTIONS', '/admin/units', undefined, { Origin: 'https://evil.example' })).headers.has('access-control-allow-origin')).toBe(false)
    const health = await app.request('https://internal/api/v1/health')
    expect(health.headers.get('strict-transport-security')).toBeTruthy()
    expect(health.headers.get('cache-control')).toBe('no-store')
    expect(health.headers.get('x-request-id')).toBeTruthy()
    expect((await request('GET', '/health/ready')).status).toBe(200)
    const oversized = await app.request('http://internal/api/v1/admin/auth/login', { method: 'POST', body: ' '.repeat(5 * 1024 * 1024 + 1) })
    expect(oversized.status).toBe(413)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = createHonoApp({ db: unusedDb })
    expect((await broken.request('http://internal/api/v1/health/ready')).status).toBe(503)
    expect((await broken.request('http://internal/api/v1/authorize', { method: 'POST' })).status).toBe(503)
  })

  it('历史批次不伪造 keyId；单位停用后公开批次与注册均不可用', async () => {
    const { payload, unitId } = await batch()
    await ctx.db.query('UPDATE batch SET key_id = NULL WHERE id = $1', [payload.batchId])
    expect((await readData<{ batch: { keyId: null } }>(await request('GET', `/batches/active?unitId=${unitId}`))).batch.keyId).toBeNull()
    await ctx.db.query("UPDATE unit SET status = 'disabled' WHERE id = $1", [unitId])
    expect((await readData<{ batch: null }>(await request('GET', `/batches/active?unitId=${unitId}`))).batch).toBeNull()
    expect((await request('POST', `/applies/${randomUUID()}/register`, { batchId: payload.batchId, revision: 1 })).status).toBe(403)
  })

  it('单条与批量导入版本语义一致，新一轮审核不可重新导入', async () => {
    const { payload, headers } = await batch()
    const id = randomUUID()
    await request('POST', `/applies/${id}/register`, { batchId: payload.batchId, revision: 1 })
    const bulk = (revision: number) => request('POST', `/batches/${payload.batchId}/apply-statuses`, { status: 'imported', applyIds: [id], revision }, headers)
    await bulk(1)
    const advanced = await readData<{ results: Array<{ importedRevision: number }> }>(await bulk(2))
    expect(advanced.results[0]?.importedRevision).toBe(2)
    expect((await readData<{ failed: number }>(await bulk(1))).failed).toBe(1)
    await request('POST', `/applies/${id}/status`, { batchId: payload.batchId, status: 'confirmed' }, headers)
    expect((await request('POST', `/applies/${id}/review-rounds`, {}, headers)).status).toBe(403)
    const parent = await seedLevelOneUnit(ctx.db)
    const parentToken = await activateUnit(app, parent.code)
    const next = await readData<{ reviewRound: number }>(await request('POST', `/applies/${id}/review-rounds`, {}, unitHeaders(parentToken, parent.unitId)))
    expect(next.reviewRound).toBe(2)
    expect((await request('POST', `/applies/${id}/status`, { batchId: payload.batchId, status: 'reviewing', revision: 3 }, headers)).status).toBe(409)
  })

  it('500 条批量同步使用固定查询次数；重复 ID 和部分失败保留顺序', async () => {
    const { payload, headers, unitId } = await batch()
    const ids = Array.from({ length: 499 }, () => randomUUID())
    const now = Date.now()
    await ctx.db.query(`INSERT INTO apply_status (apply_id_hash, unit_id, batch_id, review_round, status, latest_revision, created_at, updated_at)
      SELECT value, $2, $3, 1, 'submitted', 1, $4, $4 FROM jsonb_array_elements_text($1::jsonb)`,
    [JSON.stringify(ids.map(sha256Hex)), unitId, payload.batchId, now])
    let queries = 0
    const original = ctx.db.transaction.bind(ctx.db)
    vi.spyOn(ctx.db, 'transaction').mockImplementation((fn) => original((tx) => fn({
      ...tx, query: (text, params) => { queries++; return tx.query(text, params) },
    })))
    const input = [...ids, ids[0]!]
    const response = await readData<{ succeeded: number; failed: number; results: Array<{ applyId: string; importedAt: number }> }>(
      await request('POST', `/batches/${payload.batchId}/apply-statuses`, { status: 'imported', revision: 1, applyIds: input }, headers))
    expect(response.succeeded).toBe(500)
    expect(response.results.map((row) => row.applyId)).toEqual(input)
    expect(queries).toBe(3)
    const timestamp = response.results[0]!.importedAt
    const replay = await readData<{ results: Array<{ importedAt: number }> }>(await request('POST', `/batches/${payload.batchId}/apply-statuses`,
      { status: 'imported', revision: 1, applyIds: input }, headers))
    expect(replay.results[0]!.importedAt).toBe(timestamp)
    const mixed = await readData<{ succeeded: number; failed: number }>(await request('POST', `/batches/${payload.batchId}/apply-statuses`,
      { status: 'confirmed', applyIds: [ids[0], randomUUID()] }, headers))
    expect(mixed).toMatchObject({ succeeded: 1, failed: 1 })
  })

  it('批量新轮次的重复 ID 不重复开轮或记审计；写入失败回滚', async () => {
    const { payload, headers } = await batch()
    const id = randomUUID()
    await request('POST', `/applies/${id}/register`, { batchId: payload.batchId, revision: 1 })
    await request('POST', `/applies/${id}/status`, { batchId: payload.batchId, status: 'confirmed', revision: 1 }, headers)
    const parent = await seedLevelOneUnit(ctx.db)
    const parentToken = await activateUnit(app, parent.code)
    const parentHeaders = unitHeaders(parentToken, parent.unitId)
    const response = await readData<{ succeeded: number; failed: number; results: Array<{ reviewRound: number }> }>(await request('POST',
      `/batches/${payload.batchId}/apply-statuses`, { status: 'reviewing', startNewRound: true, applyIds: [id, id] }, parentHeaders))
    expect(response).toMatchObject({ succeeded: 1, failed: 1 })
    expect(response.results.map((row) => row.reviewRound)).toEqual([2, 2])
    expect(await ctx.db.query("SELECT id FROM audit_log WHERE action = 'apply-review-round'")).toHaveLength(1)
    await request('POST', `/applies/${id}/status`, { batchId: payload.batchId, status: 'confirmed' }, headers)
    const original = ctx.db.transaction.bind(ctx.db)
    vi.spyOn(ctx.db, 'transaction').mockImplementation((fn) => original((tx) => fn({ ...tx,
      query: (text, params) => text.includes('INSERT INTO audit_log') ? Promise.reject(new Error('injected audit failure')) : tx.query(text, params),
    })))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await request('POST', `/batches/${payload.batchId}/apply-statuses`,
      { status: 'reviewing', startNewRound: true, applyIds: [id] }, parentHeaders)).status).toBe(500)
    expect(await ctx.db.query('SELECT review_round FROM apply_status WHERE apply_id_hash = $1', [sha256Hex(id)])).toHaveLength(2)
  })
})
