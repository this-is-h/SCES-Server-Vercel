// Opt-in, real PostgreSQL acceptance. No production SQL is executed.
// Standard seeds remain; only this run's randomized fixtures are removed.
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { randomUUID, randomBytes, generateKeyPairSync, createHash, scryptSync } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { verifiedStagingEnvironment, connectStaging, wrapDatabase, identityFingerprint, root } from './lib/staging.mjs'
import { applyMigrations } from './lib/migrations.mjs'
import { importSeed } from './lib/seeds.mjs'

if (!process.argv.includes('--execute')) throw new Error('Explicit --execute is required for staging writes')
const report = { startedAt: new Date().toISOString(), checks: [], mode: 'isolated staging writes' }
const children = []
const fixture = randomUUID().replaceAll('-', '')
const parentId = `acceptance${fixture}`
const unitId = `${parentId}Unit`
const templateId = `acceptance-${fixture}`
const adminId = randomUUID()
const username = `acceptance-${fixture}`
const password = randomBytes(32).toString('base64url')
const hash = (value) => createHash('sha256').update(value).digest('hex')
const ip = `2001:db8:${fixture.match(/.{4}/g).slice(0, 6).join(':')}`
let sql
let fixtureInserted = false
let stage = 'isolation preflight'
const check = async (name, fn) => {
  stage = name
  const start = performance.now()
  const detail = await fn()
  const result = { name, status: 'passed', elapsedMs: Math.round(performance.now() - start), ...detail }
  report.checks.push(result)
  console.log(JSON.stringify(result))
}
try {
  const env = await verifiedStagingEnvironment()
  report.databaseIdentity = identityFingerprint(env.STAGING_DATABASE_URL)
  sql = connectStaging(env.STAGING_DATABASE_URL)
  const db = wrapDatabase(sql)
  await check('postgres.js serialized JSON transport is an array, not double encoded', async () => {
    const [row] = await db.query('SELECT jsonb_typeof($1::text::jsonb) AS kind', [JSON.stringify(['fixture'])])
    assert.equal(row.kind, 'array')
  })
  const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  const directory = new URL('supabase/migrations/', root)
  const migrations = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()
    .map((name) => ({ name, sql: readFileSync(new URL(name, directory), 'utf8') }))
  // Existing unknown schemas are not upgrade targets for this fixture runner.
  if (tables.length && !tables.some((t) => t.tablename === 'schema_migrations')) throw new Error('Unknown staging schema; backup and manual review required')
  if (tables.length) {
    const applied = new Set((await sql`SELECT version FROM schema_migrations`).map((row) => row.version))
    if (migrations.some((m) => !applied.has(m.name))) throw new Error('Existing staging schema needs an upgrade; back up before migrating')
  }
  await check('concurrent migration runners and repeatability', async () => {
    const results = await Promise.all([applyMigrations(db, migrations), applyMigrations(db, migrations)])
    assert.equal((await sql`SELECT count(*)::int AS n FROM schema_migrations`)[0].n, migrations.length)
    assert.ok((await applyMigrations(db, migrations)).every((m) => m.status === 'skipped'))
    assert.equal((await sql`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity`)[0].n, 0)
    return { migrations: results }
  })
  await check('failed migration rolls back DDL and ledger on PostgreSQL', async () => {
    await assert.rejects(applyMigrations(db, [{ name: `acceptance-${fixture}`, sql: `CREATE TABLE acceptance_${fixture}(id int); SELECT 1/0;` }]))
    assert.equal((await sql`SELECT to_regclass(${`public.acceptance_${fixture}`}) AS name`)[0].name, null)
    assert.equal((await sql`SELECT count(*)::int AS n FROM schema_migrations WHERE version = ${`acceptance-${fixture}`}`)[0].n, 0)
  })
  await check('all standard seeds import twice without duplicate licenses', async () => {
    const seeds = new URL('contracts/seed/', root)
    for (const name of readdirSync(seeds).filter((n) => n.endsWith('.json'))) {
      const seed = JSON.parse(readFileSync(new URL(name, seeds), 'utf8'))
      await importSeed(db, seed)
      assert.equal((await importSeed(db, seed)).licenseIssued, false)
    }
    return { standardSeeds: 3 }
  })
  const salt = randomBytes(16)
  const passwordHash = `scrypt$16384$8$1$${salt.toString('base64')}$${scryptSync(password, salt, 64).toString('base64')}`
  await sql`INSERT INTO admin_user (id, username, password_hash, must_change_password, created_at, updated_at)
    VALUES (${adminId}, ${username}, ${passwordHash}, 0, ${Date.now()}, ${Date.now()})`
  fixtureInserted = true
  stage = 'start three independent built server processes'
  const signingSecret = randomBytes(32).toString('hex')
  const bases = await Promise.all(Array.from({ length: 3 }, () => new Promise((resolve, reject) => {
    const childEnv = { ...process.env, DATABASE_URL: env.STAGING_DATABASE_URL, TOKEN_SIGNING_SECRET: signingSecret,
      SCES_STAGING_ACCEPTANCE: '1', CORS_ORIGINS: '' }
    for (const key of ['VERCEL_TOKEN', 'STAGING_DATABASE_URL', 'ADMIN_INITIAL_PASSWORD']) delete childEnv[key]
    const child = fork(new URL('lib/staging-listener.mjs', import.meta.url), [], { env: childEnv, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    children.push(child)
    const timer = setTimeout(() => reject(new Error('Built server start timed out')), 20000)
    child.once('error', () => { clearTimeout(timer); reject(new Error('Built server failed to start')) })
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Built server exited')) })
    child.on('message', (message) => {
      if (message.port) { clearTimeout(timer); resolve(`http://127.0.0.1:${message.port}`) }
      if (message.errorCodes) console.log(JSON.stringify({ childDatabaseErrorCodes: message.errorCodes }))
    })
  })))
  let sequence = 0
  const request = async (method, path, body, headers = {}, timeout = 60000) => {
    const response = await fetch(`${bases[sequence++ % bases.length]}/api/v1${path}`, {
      method, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout),
    })
    const json = await response.json()
    return { status: response.status, data: json.data, ok: json.ok, headers: response.headers }
  }
  const data = async (...args) => { const result = await request(...args); assert.equal(result.status, 200, `API ${args[0]} returned unexpected HTTP ${result.status}`); return result.data }
  let adminHeaders
  let unitHeaders
  const batchId = randomUUID()
  await check('all three built instances are ready against staging', async () => {
    for (let i = 0; i < 3; i++) await data('GET', '/health/ready')
  })
  await check('refresh rotation has one winner across three processes', async () => {
    const login = await data('POST', '/admin/auth/login', { username, password })
    const results = await Promise.all(Array.from({ length: 3 }, () => request('POST', '/admin/auth/refresh', { refreshToken: login.refreshToken })))
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 401, 401])
    adminHeaders = { Authorization: `Bearer ${results.find((r) => r.status === 200).data.accessToken}` }
  })
  await check('admin unit creation, template publication and activation via HTTP', async () => {
    const seed = JSON.parse(readFileSync(new URL('contracts/seed/test-1.json', root), 'utf8'))
    seed.id = templateId; seed.unit.unitId = unitId; seed.unit.parentUnit.unitId = parentId
    await data('POST', '/admin/units', { unitId: parentId, name: 'Acceptance parent', level: 1 }, adminHeaders)
    const created = await data('POST', '/admin/units', { unitId, name: 'Acceptance unit', level: 2, parentId, templateId }, adminHeaders)
    await data('POST', '/admin/templates', { config: seed }, adminHeaders)
    await data('POST', `/admin/templates/${templateId}/publish`, { version: 1, revision: 0 }, adminHeaders)
    const activated = await data('POST', '/authorize', { code: created.code }, { 'X-Install-Id': fixture })
    assert.equal(activated.configTemplate.unit.unitId, unitId)
    unitHeaders = { Authorization: `Bearer ${activated.unitToken}`, 'X-Unit-Id': unitId, 'X-Install-Id': fixture }
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    await data('POST', '/batches', { batch: { batchId, year: 2026, semester: 1, isTest: true,
      keyId: fixture, publicKeyJwk: { ...publicKey.export({ format: 'jwk' }), alg: 'RSA-OAEP-256' },
      calcMode: 'weighted', calcConfig: { calcMode: 'weighted', dyfWeight: 0.3, courseWeight: 0.7 },
      configTemplateId: templateId, configTemplateVersion: 1, configTemplateRevision: 0 } }, unitHeaders)
    await data('POST', `/batches/${batchId}/status`, { status: 'active' }, unitHeaders)
    assert.equal((await data('GET', `/batches/active?unitId=${unitId}`)).batch.keyId, fixture)
  })
  await check('concurrent first registration and monotonic revisions across processes', async () => {
    const id = randomUUID()
    const responses = await Promise.all(Array.from({ length: 9 }, () => request('POST', `/applies/${id}/register`, { batchId, revision: 1 })))
    assert.ok(responses.every((r) => r.status === 200), `Concurrent register statuses: ${responses.map((r) => r.status).join(',')}`)
    assert.equal((await sql`SELECT count(*)::int AS n FROM apply_status WHERE apply_id_hash = ${hash(id)}`)[0].n, 1)
    await data('POST', `/applies/${id}/register`, { batchId, revision: 2 })
    assert.equal((await request('POST', `/applies/${id}/register`, { batchId, revision: 1 })).status, 409)
    await data('POST', `/applies/${id}/status`, { batchId, status: 'imported', revision: 2 }, unitHeaders)
    assert.equal((await request('POST', `/applies/${id}/register`, { batchId, revision: 3 })).status, 409)
  })
  await check('maximum 500-item bulk request and idempotent replay', async () => {
    const ids = Array.from({ length: 500 }, () => randomUUID())
    await sql`INSERT INTO apply_status (apply_id_hash, unit_id, batch_id, review_round, status, latest_revision, created_at, updated_at)
      SELECT value, ${unitId}, ${batchId}, 1, 'submitted', 1, ${Date.now()}, ${Date.now()} FROM unnest(${ids.map(hash)}::text[]) AS value`
    const started = performance.now()
    const result = await data('POST', `/batches/${batchId}/apply-statuses`, { status: 'imported', revision: 1, applyIds: ids }, unitHeaders, 240000)
    const firstMs = Math.round(performance.now() - started)
    assert.equal(result.succeeded, 500); assert.equal(result.failed, 0)
    const replay = await data('POST', `/batches/${batchId}/apply-statuses`, { status: 'imported', revision: 1, applyIds: ids }, unitHeaders, 240000)
    assert.equal(replay.succeeded, 500)
    const overlaps = await Promise.all([ids, [...ids].reverse()].map((applyIds) => request('POST', `/batches/${batchId}/apply-statuses`,
      { status: 'confirmed', applyIds }, unitHeaders)))
    assert.ok(overlaps.every((response) => response.status === 200 && response.data.succeeded === 500))
    assert.ok(firstMs < 60000, '500-item batch exceeded acceptance budget of 60 seconds')
    return { items: 500, firstRequestMs: firstMs, scope: 'local built HTTP to remote PostgreSQL; not Vercel load test' }
  })
  await check('shared campus-IP limit is enforced across processes', async () => {
    const remaining = 60000 - Date.now() % 60000
    if (remaining < 20000) await new Promise((resolve) => setTimeout(resolve, remaining + 100))
    // A boundary crossing would make the exact count ambiguous, so fail and rerun.
    const window = Math.floor(Date.now() / 60000)
    const results = await Promise.all(Array.from({ length: 35 }, () => request('GET', `/applies/${randomUUID()}`)))
    assert.equal(Math.floor(Date.now() / 60000), window, 'Rate-limit minute boundary crossed; rerun')
    assert.equal(results.filter((r) => r.status === 200).length, 30)
    assert.equal(results.filter((r) => r.status === 429).length, 5)
    assert.ok(results.filter((r) => r.status === 429).every((r) => Number(r.headers.get('retry-after')) > 0))
    return { accepted: 30, rejected: 5, limitation: '30/minute per shared IP is NOT campus-scale capacity approval' }
  })
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  // Do not print SQL errors, response data or credential-bearing URLs.
  report.failure = { stage, code: error?.code ?? error?.name ?? 'unknown' }
  if (error?.code === 'ERR_ASSERTION') report.failure.assertion = error.message
  process.exitCode = 1
} finally {
  for (const child of children) child.kill()
  if (sql && fixtureInserted) {
    try {
      await sql.begin(async (tx) => {
        await tx`DELETE FROM batch WHERE unit_id = ${unitId}`
        await tx`DELETE FROM unit WHERE id = ${unitId}`
        await tx`DELETE FROM unit WHERE id = ${parentId}`
        await tx`DELETE FROM audit_log WHERE admin_user_id = ${adminId} OR target = ${unitId}`
        await tx`DELETE FROM admin_user WHERE id = ${adminId}`
        for (const [method, path] of [['POST', '/api/v1/admin/auth/login'], ['POST', '/api/v1/admin/auth/refresh'], ['POST', '/api/v1/authorize'], ['POST', '/api/v1/applies/:applyId/register'], ['GET', '/api/v1/applies/:applyId']]) {
          await tx`DELETE FROM rate_limit_bucket WHERE bucket_key = ${hash(`${method}:${path}:${ip}`)}`
        }
      })
      report.fixtureCleanup = 'completed; standard seeds retained'
    } catch { report.fixtureCleanup = 'failed; manual review required'; report.status = 'failed'; process.exitCode = 1 }
  }
  if (sql) await sql.end({ timeout: 5 })
  report.finishedAt = new Date().toISOString()
  writeFileSync(new URL('.vercel/staging-acceptance.json', root), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
