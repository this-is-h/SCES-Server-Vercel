/** Postgres 唯一约束冲突（SQLSTATE 23505）：用于把并发重复写入映射为 409。 */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505'
}
