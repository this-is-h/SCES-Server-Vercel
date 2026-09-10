/** 契约统一包裹：成功 `{ ok: true, data }` / 失败 `{ ok: false, error }`。 */
export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * 读取响应包裹：先按运行时形状收窄，业务数据形状由用例显式声明。
 * 用例里不再出现「内联断言 + 取成员」，形状不符立即抛错而不是静默读到 undefined。
 */
export async function readEnvelope<T>(res: Response): Promise<Envelope<T>> {
  const raw: unknown = await res.json()
  if (raw === null || typeof raw !== 'object' || !('ok' in raw)) {
    throw new Error('响应不符合契约统一包裹')
  }
  if (raw.ok === true) {
    if (!('data' in raw)) throw new Error('成功响应缺少 data 字段')
    // 包裹形状已运行时校验；data 的业务形状由调用方声明的 T 与后续断言负责
    const data = raw.data as T
    return { ok: true, data }
  }
  if (!('error' in raw) || typeof raw.error !== 'string') throw new Error('失败响应缺少 error 字段')
  return { ok: false, error: raw.error }
}

/** 期望成功：失败即抛错，返回值即 data。 */
export async function readData<T>(res: Response): Promise<T> {
  const body = await readEnvelope<T>(res)
  if (!body.ok) throw new Error(`预期成功响应，实际失败：${body.error}`)
  return body.data
}

/** 期望失败：成功即抛错，返回中文错误文案。 */
export async function readError(res: Response): Promise<string> {
  const body = await readEnvelope<unknown>(res)
  if (body.ok) throw new Error('预期失败响应，实际成功')
  return body.error
}
