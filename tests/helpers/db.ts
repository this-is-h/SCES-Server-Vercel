import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Db } from '../../server/utils/db/types.js'

const migrationSql = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/0001_init.sql', import.meta.url)),
  'utf8',
)

export interface TestDb {
  db: Db
  close(): Promise<void>
}

function wrap(pg: PGlite): Db {
  return {
    async query<T = Record<string, unknown>>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      const result = await pg.query<Record<string, unknown>>(text, [...params])
      return result.rows as T[]
    },
    transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return pg.transaction((tx) => fn(wrap(tx as unknown as PGlite)))
    },
  }
}

/**
 * 真实 PostgreSQL 语义（WASM）：跑与 Supabase 完全同一份建库 DDL，
 * 因此迁移文件、SQL 方言、约束（CHECK/唯一部分索引/外键）都在测试覆盖内。
 */
export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite()
  await pg.exec(migrationSql)
  return { db: wrap(pg), close: () => pg.close() }
}
