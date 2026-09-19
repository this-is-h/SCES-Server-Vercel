import { createMiddleware } from 'hono/factory'
import type { AppEnv } from './env.js'
import { ApiError } from '../lib/errors.js'
import { clientIp } from './parse.js'
import { sha256Hex } from '../lib/hash.js'

/** 授权/隐私关键接口的严格档（契约 429 文案「操作过于频繁，请稍后再试」）。 */
export const STRICT_RATE_LIMIT = { windowMs: 60_000, max: 30 } as const

/**
 * 基于 PostgreSQL 的固定窗口限流。计数在所有 Vercel 实例间共享，数据库只保存
 * 路由和客户端地址的 SHA-256 摘要，不保存原始 IP。
 */
export function createRateLimiter(options: { windowMs: number; max: number }) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const now = Date.now()
    const windowStart = now - (now % options.windowMs)
    const rawKey = `${c.req.method}:${c.req.routePath}:${clientIp(c) ?? 'anonymous'}`
    const key = sha256Hex(rawKey)
    let rows: Array<{ hit_count: number }>
    try {
      rows = await c.get('db').query<{ hit_count: number }>(
        `INSERT INTO rate_limit_bucket (bucket_key, window_start, hit_count)
         VALUES ($1, $2, 1)
         ON CONFLICT (bucket_key) DO UPDATE SET
           window_start = CASE WHEN rate_limit_bucket.window_start < $2 THEN $2 ELSE rate_limit_bucket.window_start END,
           hit_count = CASE WHEN rate_limit_bucket.window_start < $2 THEN 1 ELSE rate_limit_bucket.hit_count + 1 END
         RETURNING hit_count`,
        [key, windowStart],
      )
    } catch (error) {
      console.error('rate limiter unavailable', error)
      throw new ApiError(503, '服务暂不可用，请稍后重试')
    }
    if ((rows[0]?.hit_count ?? options.max + 1) > options.max) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((windowStart + options.windowMs - now) / 1000))))
      throw new ApiError(429, '操作过于频繁，请稍后再试')
    }
    if (Math.random() < 0.01) {
      await c.get('db').query(`DELETE FROM rate_limit_bucket WHERE bucket_key IN
        (SELECT bucket_key FROM rate_limit_bucket WHERE window_start < $1 LIMIT 1000)`, [now - options.windowMs * 2])
    }
    await next()
  })
}
