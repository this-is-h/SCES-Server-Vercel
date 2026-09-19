#!/usr/bin/env node
// Explicit DATABASE_URL prevents accidental use of a production .env during seeding.
import postgres from 'postgres'
import { readdirSync, readFileSync } from 'node:fs'
import { importSeed } from './lib/seeds.mjs'

const directory = new URL('../contracts/seed/', import.meta.url)
const files = readdirSync(directory).filter((name) => name.endsWith('.json')).sort()
const names = process.argv.slice(2)
const targets = names.length ? names.map((name) => name.endsWith('.json') ? name : `${name}.json`) : files
if (targets.some((name) => !files.includes(name))) throw new Error('未知种子文件')
if (!process.env.DATABASE_URL) throw new Error('缺少显式 DATABASE_URL')
const sql = postgres(process.env.DATABASE_URL, {
  max: 1, prepare: false, ssl: 'require', connect_timeout: 15,
  connection: { statement_timeout: 60000, lock_timeout: 15000 },
})
const wrap = (connection) => ({
  query: (text, params = []) => connection.unsafe(text, params),
  transaction: (fn) => connection.begin((tx) => fn(wrap(tx))),
})
try {
  for (const name of targets) {
    const seed = JSON.parse(readFileSync(new URL(name, directory), 'utf8'))
    const key = `SEED_LICENSE_${seed.unit.unitId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
    // Generated license secrets are retrieved through the authenticated admin UI.
    console.log(JSON.stringify(await importSeed(wrap(sql), seed, process.env[key])))
  }
} catch (error) {
  console.error('种子导入失败', { code: error?.code ?? 'validation-error' })
  process.exitCode = 1
} finally { await sql.end({ timeout: 5 }) }
