import { afterEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { applyMigrations } from '../scripts/lib/migrations.mjs'
import { importSeed } from '../scripts/lib/seeds.mjs'

const folder = new URL('../supabase/migrations/', import.meta.url)
const migrations = readdirSync(folder).filter((name) => name.endsWith('.sql')).sort()
  .map((name) => ({ name, sql: readFileSync(new URL(name, folder), 'utf8') }))
const databases = []
const wrap = (pg) => ({
  exec: (sql) => pg.exec(sql),
  query: async (sql, params = []) => (await pg.query(sql, params)).rows,
  transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
})
const open = async (options) => { const pg = new PGlite(options); databases.push(pg); await pg.waitReady; return pg }
afterEach(async () => { for (const pg of databases.splice(0)) await pg.close() })

describe('actual migration runner / local restore rehearsal', () => {
  it('initializes, records BIGINT millisecond timestamps and skips a repeat run', async () => {
    const pg = await open()
    expect((await applyMigrations(wrap(pg), migrations)).every((m) => m.status === 'applied')).toBe(true)
    const rows = (await pg.query('SELECT applied_at FROM schema_migrations')).rows
    expect(rows).toHaveLength(migrations.length)
    expect(rows.every((r) => r.applied_at > 1_000_000_000_000)).toBe(true)
    expect((await applyMigrations(wrap(pg), migrations)).every((m) => m.status === 'skipped')).toBe(true)
  })

  it('upgrades a pre-hardening database without replaying the original migration', async () => {
    const pg = await open()
    // Model the deployed schema: no keyId, template binding or limiter table;
    // the original migration ledger exists, including the old INTEGER variant.
    await pg.exec(migrations[0].sql)
    await pg.exec(`ALTER TABLE batch DROP COLUMN key_id;
      ALTER TABLE unit DROP COLUMN config_template_id;
      DROP TABLE rate_limit_bucket;
      ALTER TABLE schema_migrations ALTER COLUMN applied_at TYPE INTEGER;
      INSERT INTO schema_migrations VALUES ('0001_init.sql', 1), ('0002_enable_rls.sql', 1)`)
    const result = await applyMigrations(wrap(pg), migrations)
    expect(result.filter((m) => m.status === 'applied').map((m) => m.name)).toEqual(['0003_production_hardening.sql'])
    await pg.query('SELECT key_id FROM batch')
    await pg.query('SELECT config_template_id FROM unit')
    expect((await pg.query("SELECT rowsecurity FROM pg_tables WHERE tablename = 'rate_limit_bucket'")).rows[0].rowsecurity).toBe(true)
  })

  it('rolls back both DDL and ledger on a failed migration', async () => {
    const pg = await open()
    await applyMigrations(wrap(pg), migrations)
    await expect(applyMigrations(wrap(pg), [...migrations, { name: '9999_failure.sql', sql: 'CREATE TABLE test_rollback(id int); SELECT * FROM nonexistent_relation' }])).rejects.toThrow()
    expect((await pg.query("SELECT to_regclass('test_rollback') AS name")).rows[0].name).toBeNull()
    expect((await pg.query("SELECT version FROM schema_migrations WHERE version = '9999_failure.sql'")).rows).toHaveLength(0)
  })

  it('restores a PGlite physical snapshot into a separate database with schema and rows intact', async () => {
    const source = await open()
    await applyMigrations(wrap(source), migrations)
    const seed = JSON.parse(readFileSync(new URL('../contracts/seed/test-1.json', import.meta.url), 'utf8'))
    await importSeed(wrap(source), seed)
    await source.query("INSERT INTO audit_log(action, target, created_at) VALUES ('restore-rehearsal', 'local-only', $1)", [Date.now()])
    await source.query("INSERT INTO rate_limit_bucket VALUES ('test-hash', 1, 2)")
    const snapshot = await source.dumpDataDir()
    const restored = await open({ loadDataDir: snapshot })
    for (const table of ['schema_migrations', 'audit_log', 'rate_limit_bucket', 'unit', 'license', 'config_template']) {
      expect((await restored.query(`SELECT * FROM ${table} ORDER BY 1`)).rows).toEqual((await source.query(`SELECT * FROM ${table} ORDER BY 1`)).rows)
    }
    expect((await applyMigrations(wrap(restored), migrations)).every((m) => m.status === 'skipped')).toBe(true)
  }, 30000)

  it('imports all seeds idempotently and retains expired licenses on re-import', async () => {
    const pg = await open()
    await applyMigrations(wrap(pg), migrations)
    const folder = new URL('../contracts/seed/', import.meta.url)
    for (const name of readdirSync(folder).filter((name) => name.endsWith('.json'))) {
      const seed = JSON.parse(readFileSync(new URL(name, folder), 'utf8'))
      expect((await importSeed(wrap(pg), seed)).licenseIssued).toBe(true)
      await pg.query('UPDATE license SET expires_at = 1 WHERE unit_id = $1', [seed.unit.unitId])
      expect((await importSeed(wrap(pg), seed)).licenseIssued).toBe(false)
    }
    expect((await pg.query('SELECT * FROM license')).rows).toHaveLength(3)
    expect((await pg.query('SELECT * FROM config_template')).rows).toHaveLength(3)
  })
})
