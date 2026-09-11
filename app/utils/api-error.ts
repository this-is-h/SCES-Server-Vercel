/** 从 ofetch/hono 错误中提取契约 ErrorBody 的中文 error 文案。 */
export function extractApiError(e: unknown, fallback: string): string {
  if (typeof e === 'object' && e !== null && 'data' in e) {
    const data = (e as { data?: unknown }).data
    if (typeof data === 'object' && data !== null && 'error' in data) {
      const msg = (data as { error?: unknown }).error
      if (typeof msg === 'string' && msg.length > 0) return msg
    }
  }
  return fallback
}
