// Read-only deployment inspection. Never print credentials, environment values,
// tokens, database rows, or upstream response bodies.
import { readFileSync, existsSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { resolve4, resolve6 } from 'node:dns/promises'

const root = fileURLToPath(new URL('../', import.meta.url))
const local = existsSync(`${root}.env`) ? parseEnv(readFileSync(`${root}.env`, 'utf8')) : {}
const env = { ...local, ...process.env }
const fingerprint = (value) => createHash('sha256').update(value).digest('hex').slice(0, 12)
const databaseIdentity = (value) => {
  const url = new URL(value)
  const projectRef = /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(url.username))?.[1]
    ?? /^db\.([a-z0-9]+)\.supabase\.co$/.exec(url.hostname)?.[1]
  if (projectRef) return fingerprint(`supabase:${projectRef}:${url.pathname}`)
  return fingerprint(`${url.hostname}:${url.port}/${url.pathname}/${decodeURIComponent(url.username)}`)
}
const report = { inspectedAt: new Date().toISOString(), mode: 'read-only' }
report.local = Object.fromEntries(['DATABASE_URL', 'TOKEN_SIGNING_SECRET', 'ADMIN_INITIAL_PASSWORD', 'VERCEL_TOKEN', 'STAGING_DATABASE_URL', 'SUPABASE_ACCESS_TOKEN'].map((key) => [key, Boolean(env[key])]))

if (env.VERCEL_TOKEN) {
  const project = JSON.parse(readFileSync(`${root}.vercel/project.json`, 'utf8'))
  const get = async (path) => {
    const response = await fetch(`https://api.vercel.com${path}?teamId=${encodeURIComponent(project.orgId)}`, {
      headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` }, signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`Vercel HTTP ${response.status}`)
    return response.json()
  }
  try {
    const details = await get(`/v9/projects/${project.projectId}`)
    const variables = await get(`/v9/projects/${project.projectId}/env`)
    report.vercel = {
      project: details.name, framework: details.framework, nodeVersion: details.nodeVersion,
      git: { provider: details.link?.type, repo: details.link?.repo, productionBranch: details.link?.productionBranch },
      deployments: Object.entries(details.targets ?? {}).map(([target, d]) => ({ target, url: d.url, state: d.readyState, aliases: d.alias })),
      environment: (variables.envs ?? []).map((v) => ({ key: v.key, target: v.target, branch: v.gitBranch ?? null, type: v.type })),
    }
    // Compare DB identities without disclosing values. Separate names alone do
    // not establish isolation; production and preview must use different DBs.
    const identities = []
    for (const variable of variables.envs ?? []) {
      if (variable.key !== 'DATABASE_URL') continue
      const result = await get(`/v1/projects/${project.projectId}/env/${variable.id}`)
      const value = result.value ?? result.env?.value
      if (value?.startsWith('postgres')) identities.push({ target: variable.target, branch: variable.gitBranch ?? null, identity: databaseIdentity(value) })
    }
    report.vercel.databaseIdentities = identities
  } catch (error) { report.vercelError = error instanceof Error ? error.message : 'inspection failed' }
}

for (const path of ['/api/v1/health', '/api/v1/health/ready', '/admin/login']) {
  try {
    const response = await fetch(`https://sces.thisish.cn${path}`, { signal: AbortSignal.timeout(15000), redirect: 'manual' })
    report.http ??= []
    report.http.push({ path, status: response.status, headers: Object.fromEntries(['cache-control', 'x-request-id', 'strict-transport-security', 'x-content-type-options'].map((name) => [name, response.headers.get(name)])) })
    await response.body?.cancel()
  } catch { (report.http ??= []).push({ path, error: 'unreachable' }) }
}

for (const [key, label] of [['DATABASE_URL', 'database'], ['STAGING_DATABASE_URL', 'staging']]) {
  if (!env[key]) continue
  let url
  try { url = new URL(env[key]) } catch { report[label] = { error: 'invalid URL' }; continue }
  const identity = databaseIdentity(env[key])
  report[label] = { identity, configured: true,
    passwordPresent: Boolean(url.password), placeholderPassword: /\[PASSWORD\]|YOUR_PASSWORD/i.test(decodeURIComponent(url.password)),
    dns: { ipv4: (await resolve4(url.hostname).catch(() => [])).length, ipv6: (await resolve6(url.hostname).catch(() => [])).length },
  }
  if (label === 'staging') {
    report.staging.distinctFromLocalDatabase = env.DATABASE_URL ? identity !== databaseIdentity(env.DATABASE_URL) : null
    report.staging.distinctFromVercelProduction = report.vercel?.databaseIdentities?.some((entry) => entry.target.includes('production'))
      ? report.vercel.databaseIdentities.filter((entry) => entry.target.includes('production')).every((entry) => entry.identity !== identity) : null
  }
  const sql = postgres(env[key], { max: 1, prepare: false, ssl: 'require', connect_timeout: 10, connection: { statement_timeout: 10000 } })
  try {
    Object.assign(report[label], await sql.begin('READ ONLY', async (tx) => {
      const tables = await tx`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
      return {
        tables,
        migrations: tables.some((table) => table.tablename === 'schema_migrations') ? await tx`SELECT version FROM schema_migrations ORDER BY version` : [],
        columns: await tx`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'batch' AND column_name = 'key_id') OR (table_name = 'unit' AND column_name = 'config_template_id') OR table_name = 'schema_migrations') ORDER BY table_name, column_name`,
      }
    }))
  } catch (error) { report[label].error = { code: error?.code ?? 'unreachable' } }
  finally { await sql.end({ timeout: 5 }) }
}
console.log(JSON.stringify(report, null, 2))
