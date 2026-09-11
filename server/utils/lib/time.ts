/** 换机频次计数月份键（YYYY-MM，UTC，保证跨实例一致）。 */
export function monthKey(at: number): string {
  const date = new Date(at)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}
