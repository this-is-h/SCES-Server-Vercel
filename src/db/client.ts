import postgres from 'postgres'
import type { Db, Row } from './types.js'

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (url === undefined || url === '') {
    throw new Error('缺少环境变量 DATABASE_URL（Supabase 事务池连接串，见 .env.example）')
  }
  return url
}

function wrap(sql: postgres.Sql): Db {
  return {
    async query<T = Row>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      // postgres.js 的参数类型为 ParameterOrJSON<never>[]；参数已在上层显式构造
      const rows = await sql.unsafe(text, params as never[])
      return rows as unknown as T[]
    },
    transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return sql.begin((tx) => fn(wrap(tx as unknown as postgres.Sql))) as Promise<T>
    },
  }
}

let instance: Db | undefined

/**
 * Supabase 事务池（Supavisor）：
 * - `prepare: false`：池化事务模式下不支持预处理语句；
 * - `max: 1`：serverless 每个实例只占一条池化连接，并发由池侧复用。
 */
export function getDb(): Db {
  instance ??= wrap(
    postgres(requireDatabaseUrl(), {
      max: 1,
      prepare: false,
      idle_timeout: 20,
      ssl: 'require',
    }),
  )
  return instance
}

/** 延迟连接：模块导入不触碰 DATABASE_URL，首次查询才建连（Vercel 冷启动友好）。 */
export const lazyDb: Db = {
  query: (text, params) => getDb().query(text, params),
  transaction: (fn) => getDb().transaction(fn),
}
