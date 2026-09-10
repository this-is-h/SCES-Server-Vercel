import { createMiddleware } from 'hono/factory'
import type { AppEnv } from './env'
import { ApiError } from '../lib/errors'
import { clientIp } from './parse'

/** 授权/隐私关键接口的严格档（契约 429 文案「操作过于频繁，请稍后再试」）。 */
export const STRICT_RATE_LIMIT = { windowMs: 60_000, max: 30 } as const

/**
 * 实例内固定窗口限流（决策 #40：applyId 隐私 + 授权入口走严格限流）。
 * 以 (路径, 客户端 IP) 为键做内存计数；Vercel 免费层无共享存储，
 * 多实例各自独立计数（语义如实记录在 README 风险栏）。
 */
export function createRateLimiter(options: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>()

  return createMiddleware<AppEnv>(async (c, next) => {
    const now = Date.now()
    const key = `${c.req.path}::${clientIp(c) ?? 'anonymous'}`
    const entry = hits.get(key)

    if (entry === undefined || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs })
    } else {
      entry.count += 1
      if (entry.count > options.max) {
        throw new ApiError(429, '操作过于频繁，请稍后再试')
      }
    }

    // 惰性清理：超量时删除窗口已过的键，防内存膨胀
    if (hits.size > 10_000) {
      for (const [key, value] of hits) {
        if (value.resetAt <= now) hits.delete(key)
      }
    }

    await next()
  })
}