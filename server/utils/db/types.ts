/**
 * 跨驱动的最小 SQL 接口：运行时为 postgres.js（Supabase 事务池），
 * 测试为 PGlite（WASM PostgreSQL，跑同一份建库 DDL）。
 * 只暴露「SQL 文本 + 参数」与事务，不引入 ORM/查询构造器。
 */
export type Row = Record<string, unknown>

export interface Db {
  query<T = Row>(text: string, params?: readonly unknown[]): Promise<T[]>
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>
}
