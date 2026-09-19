// Runs the actual Vercel Node listener over loopback. Runtime credentials are
// replaced with local-only values. .env is read solely to scan public bundles.
import { createServer } from 'node:http'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { parseEnv } from 'node:util'
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:9/isolated_unavailable'
process.env.TOKEN_SIGNING_SECRET = 'local-build-smoke-test-secret-000000000000'
process.env.CORS_ORIGINS = 'https://local-smoke.example'
delete process.env.ADMIN_INITIAL_PASSWORD
const { default: listener } = await import('../.vercel/output/functions/__fallback.func/index.mjs')
const server = createServer(listener)
const checks = []
const run = async (name, fn) => { await fn(); checks.push(name) }
try {
  await run('Vercel function runtime matches project Node 24', async () => {
    const config = JSON.parse(readFileSync(new URL('../.vercel/output/functions/__fallback.func/.vc-config.json', import.meta.url), 'utf8'))
    assert.equal(config.runtime, 'nodejs24.x')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const get = (path, options) => fetch(base + path, { ...options, signal: AbortSignal.timeout(10000) })
  await run('Nitro/Hono health envelope and security headers', async () => {
    const response = await get('/api/v1/health')
    assert.equal(response.status, 200)
    assert.equal((await response.json()).data.status, 'ok')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.ok(response.headers.get('x-request-id'))
  })
  await run('CORS allowed preflight including DELETE', async () => {
    const response = await get('/api/v1/admin/units', { method: 'OPTIONS', headers: { origin: 'https://local-smoke.example', 'access-control-request-method': 'DELETE' } })
    assert.equal(response.status, 204)
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://local-smoke.example')
    assert.match(response.headers.get('access-control-allow-methods'), /DELETE/)
  })
  await run('CORS unlisted origin is not granted access', async () => {
    const response = await get('/api/v1/health', { headers: { origin: 'https://not-allowed.example' } })
    assert.equal(response.headers.get('access-control-allow-origin'), null)
  })
  await run('Admin unauthenticated request returns JSON 401', async () => {
    const response = await get('/api/v1/admin/units')
    assert.equal(response.status, 401); assert.equal((await response.json()).ok, false)
  })
  await run('Removed legacy route returns JSON 404', async () => {
    const response = await get('/api/v1/_legacy/admin/rebinds/example/approve', { method: 'POST' })
    assert.equal(response.status, 404); assert.equal((await response.json()).ok, false)
  })
  await run('Readiness returns JSON 503 when database is unavailable', async () => {
    const response = await get('/api/v1/health/ready')
    assert.equal(response.status, 503); assert.equal((await response.json()).ok, false)
  })
  await run('Built admin login shell is served', async () => {
    const response = await get('/admin/login')
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /<html/); assert.match(html, /_nuxt\//)
  })
  await run('Local credentials are absent from public JS/CSS/HTML', async () => {
    const envPath = new URL('../.env', import.meta.url)
    const local = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {}
    const secrets = Object.entries(local).filter(([key, value]) => /SECRET|PASSWORD|TOKEN|DATABASE_URL/.test(key) && value.length >= 12)
    const root = new URL('../.vercel/output/static/', import.meta.url)
    const files = readdirSync(root, { recursive: true }).filter((name) => /\.(js|css|html|json)$/.test(name))
    for (const name of files) {
      const content = readFileSync(new URL(name.replaceAll('\\', '/'), root), 'utf8')
      for (const [key, value] of secrets) assert.equal(content.includes(value), false, `Public bundle contains ${key}`)
    }
  })
  console.log(JSON.stringify({ status: 'passed', checks, database: 'intentionally unavailable loopback only' }, null, 2))
} catch (error) {
  console.error('Built API smoke check failed:', error.message)
  process.exitCode = 1
} finally {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
