import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/db.js'

/** 契约 DDL（schema-web.sql）的 12 张表。 */
const CONTRACT_TABLES = [
  'admin_user',
  'apply_status',
  'audit_log',
  'batch',
  'config_template',
  'license',
  'rebind_request',
  'refresh_token',
  'rate_limit_bucket',
  'schema_migrations',
  'unit',
  'unit_token',
]

/** 数据主权红线（决策 #29/#40）：服务端不存分数明细、课程成绩、综测结果、申请版本文件。 */
const FORBIDDEN_TABLES = ['dyf_score', 'course_score', 'final_grade', 'revision']

describe('建库 DDL 镜像（supabase/migrations/0001_init.sql）', () => {
  let ctx: TestDb

  beforeAll(async () => {
    ctx = await createTestDb()
  })

  afterAll(async () => {
    await ctx.close()
  })

  it('契约 12 张表齐备', async () => {
    const rows = await ctx.db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    )
    expect(rows.map((row) => row.table_name).sort()).toEqual([...CONTRACT_TABLES].sort())
  })

  it('红线：不存在分数明细/成绩/结果/版本表', async () => {
    const rows = await ctx.db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    )
    const tables = rows.map((row) => row.table_name)
    for (const forbidden of FORBIDDEN_TABLES) {
      expect(tables, `${forbidden} 不得存在`).not.toContain(forbidden)
    }
  })

  it('红线：apply_status 只存 apply_id_hash，不存明文 apply_id', async () => {
    const rows = await ctx.db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'apply_status'`,
    )
    const columns = rows.map((row) => row.column_name)
    expect(columns).toContain('apply_id_hash')
    expect(columns).not.toContain('apply_id')
  })

  it('红线：unit_token 只存 token_hash', async () => {
    const rows = await ctx.db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'unit_token'`,
    )
    const columns = rows.map((row) => row.column_name)
    expect(columns).toContain('token_hash')
    expect(columns).not.toContain('token')
  })

  it('契约：license 含部分唯一索引 uq_license_active_unit（一个单位至多一条未作废授权码）', async () => {
    const rows = await ctx.db.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE tablename = 'license' AND indexname = 'uq_license_active_unit'`,
    )
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.indexdef).toContain('UNIQUE')
    expect(row.indexdef).toContain('WHERE (status <>')
  })
})
