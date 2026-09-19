import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createHash } from 'node:crypto'
import postgres from 'postgres'

export const root = new URL('../../', import.meta.url)
export function loadEnvironment() {
  const file = new URL('.env', root)
  return { ...(existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}), ...process.env }
}
export function databaseIdentity(value) {
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database protocol')
  const ref = /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(url.username))?.[1]
    ?? /^db\.([a-z0-9]+)\.supabase\.co$/.exec(url.hostname)?.[1]
  // Supabase direct and pooler URLs MUST compare as the same project.
  return ref ? `supabase:${ref}` : `${url.hostname}:${url.port || '5432'}:${decodeURIComponent(url.pathname)}`
}
export const identityFingerprint = (value) => createHash('sha256').update(databaseIdentity(value)).digest('hex').slice(0, 12)
export async function verifiedStagingEnvironment() {
  const env = loadEnvironment()
  if (!env.STAGING_DATABASE_URL || !env.DATABASE_URL || !env.VERCEL_TOKEN) throw new Error('Staging, production comparison URL and Vercel inspection token are required')
  const staging = new URL(env.STAGING_DATABASE_URL)
  if (!staging.password || /\[PASSWORD\]|YOUR_PASSWORD/i.test(decodeURIComponent(staging.password))) throw new Error('Staging password is missing or placeholder')
  const identity = databaseIdentity(env.STAGING_DATABASE_URL)
  if (identity === databaseIdentity(env.DATABASE_URL)) throw new Error('Staging points at the local production database')
  const project = JSON.parse(readFileSync(new URL('.vercel/project.json', root), 'utf8'))
  const get = async (path) => {
    const response = await fetch(`https://api.vercel.com${path}?teamId=${encodeURIComponent(project.orgId)}`, {
      headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` }, signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`Production isolation check failed: HTTP ${response.status}`)
    return response.json()
  }
  const variables = await get(`/v9/projects/${project.projectId}/env`)
  const production = variables.envs.filter((v) => v.key === 'DATABASE_URL' && v.target.includes('production'))
  if (!production.length) throw new Error('Cannot establish production database identity')
  for (const variable of production) {
    const result = await get(`/v1/projects/${project.projectId}/env/${variable.id}`)
    const value = result.value ?? result.env?.value
    if (!value || databaseIdentity(value) === identity) throw new Error('Staging is not isolated from Vercel production')
  }
  return env
}
export function connectStaging(url, max = 4) {
  return postgres(url, { max, prepare: false, ssl: 'require', connect_timeout: 15,
    connection: { statement_timeout: 60000, lock_timeout: 15000 }, onnotice: () => {},
    types: { bigint: { to: 20, from: [20], serialize: String, parse: Number } },
  })
}
export function wrapDatabase(connection) {
  return {
    query: (text, params = []) => connection.unsafe(text, params),
    exec: (text) => connection.unsafe(text),
    transaction: (fn) => connection.begin((tx) => fn(wrapDatabase(tx))),
  }
}
