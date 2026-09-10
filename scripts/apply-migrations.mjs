#!/usr/bin/env node
// ---------------------------------------------------------------------------
// 迁移执行：把 supabase/migrations/*.sql 按文件名顺序执行到 DATABASE_URL 指向的库。
//
// 契约侧 schema-web.sql 全程使用 IF NOT EXISTS，本仓迁移镜像同样幂等 ——
// 可整段重放，执行过的版本记入 schema_migrations（同 DDL，勿改表名）。
// 免 supabase CLI：直接用连接串（Supabase 事务池端口 6543，prepare: false）。
// ---------------------------------------------------------------------------
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

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

  const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 15 })

  try {
    for (const name of files) {
      const content = readFileSync(join(migrationsDir, name), 'utf8')
      await sql.unsafe(content)
      await sql`
        INSERT INTO schema_migrations (version, applied_at)
        VALUES (${name}, ${Date.now()})
        ON CONFLICT (version) DO NOTHING
      `
      console.log(`已执行 ${name}`)
    }

    const [{ count }] = await sql`
      SELECT count(*)::int AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `
    console.log(`public 架构表数量：${count}`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((err) => {
  console.error(`迁移失败：${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
