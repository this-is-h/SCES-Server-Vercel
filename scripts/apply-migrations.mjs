#!/usr/bin/env node
// ---------------------------------------------------------------------------
// 迁移执行：把 supabase/migrations/*.sql 按文件名顺序执行到 DATABASE_URL 指向的库。
//
// schema_migrations 记录已应用版本，重复执行自动跳过（幂等）。契约侧
// schema-web.sql 全程 IF NOT EXISTS，本仓迁移镜像同样幂等 —— 半途失败重跑
// 也安全。免 supabase CLI：直接用连接串（Supabase 事务池端口 6543，prepare: false）。
// ---------------------------------------------------------------------------
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { applyMigrations } from './lib/migrations.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase', 'migrations')

/** 极简 .env 读取：仅在环境变量缺省时兜底，避免为一次迁移引入 dotenv。 */
function readDotEnv(key) {
  const file = join(root, '.env')
  if (!existsSync(file)) return undefined
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (match && match[1] === key) return match[2].replace(/^["']|["']$/g, '')
  }
  return undefined
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? readDotEnv('DATABASE_URL')
  if (!databaseUrl) {
    console.error('缺少 DATABASE_URL：请在 .env 或环境变量中提供 Supabase 事务池连接串（端口 6543）。')
    process.exit(1)
  }

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()

  const sql = postgres(databaseUrl, { max: 1, prepare: false, ssl: 'require', connect_timeout: 15,
    connection: { statement_timeout: 60000, lock_timeout: 15000 } })
  const wrap = (connection) => ({
    query: (text, params = []) => connection.unsafe(text, params),
    exec: (text) => connection.unsafe(text),
    transaction: (fn) => connection.begin((tx) => fn(wrap(tx))),
  })

  try {
    const result = await applyMigrations(wrap(sql), files.map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), 'utf8') })))
    for (const migration of result) console.log(`${migration.status}: ${migration.name}`)

    const [{ count }] = await sql`
      SELECT count(*)::int AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `
    const [{ applied_count: appliedCount }] = await sql`
      SELECT count(*)::int AS applied_count
      FROM schema_migrations
    `
    console.log(`public 架构表数量：${count}；已应用迁移：${appliedCount}`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((err) => {
  console.error(`迁移失败：${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
