import type { Context } from 'hono'
import { badRequest } from '../lib/errors'

/** 解析 JSON 请求体；非对象或非法 JSON 一律 400「请求参数不合法」。 */
export async function readJsonObject(c: Context): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw badRequest()
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw badRequest()
  return body as Record<string, unknown>
}

/** 请求体可选（换机等）：空体视为 {}。 */
export async function readOptionalJsonObject(c: Context): Promise<Record<string, unknown>> {
  const text = (await c.req.text()).trim()
  if (text === '') return {}
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw badRequest()
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw badRequest()
  return body as Record<string, unknown>
}

export function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value.trim() === '') throw badRequest()
  return value
}

export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw badRequest()
  return value
}

/** 契约中标记为必填的头部；缺失即 400。 */
export function requireHeader(c: Context, name: string): string {
  const value = c.req.header(name)
  if (value === undefined || value.trim() === '') throw badRequest()
  return value
}

export function optionalHeader(c: Context, name: string): string | undefined {
  const value = c.req.header(name)
  return value === undefined || value.trim() === '' ? undefined : value
}

/** 审计用来源 IP：Vercel 经 x-forwarded-for 透传。 */
export function clientIp(c: Context): string | undefined {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded !== undefined && forwarded.trim() !== '') {
    return forwarded.split(',')[0]?.trim()
  }
  return optionalHeader(c, 'x-real-ip')
}
