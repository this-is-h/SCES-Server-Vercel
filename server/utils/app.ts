import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { lazyDb } from './db/client.js'
import type { Db } from './db/types.js'
import type { AppEnv } from './http/env.js'
import { createRateLimiter, STRICT_RATE_LIMIT } from './http/rate-limit.js'
import { ApiError } from './lib/errors.js'
import { appliesRouter } from './routes/applies.js'
import { adminAuthRouter } from './routes/admin-auth.js'
import { authorizeRouter } from './routes/authorize.js'
import { adminUnitsRouter } from './routes/admin-units.js'
import { adminOpsRouter } from './routes/admin-ops.js'
import { batchesRouter } from './routes/batches.js'
import { healthRouter } from './routes/health.js'
import { licenseRouter } from './routes/license.js'
import { publicRouter } from './routes/public.js'
import { unitsRouter } from './routes/units.js'

export interface AppDeps {
  /** 运行时为 Supabase 延迟连接；测试注入 PGlite。 */
  db: Db
}

/**
 * 应用工厂：统一失败包裹 `{ ok: false, error: "中文描述" }`（契约：错误文案面向最终用户）。
 * 限流计数持久化在 PostgreSQL；Hono 工厂只负责组装中间件，便于测试注入数据库。
 */
export function createHonoApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.use('*', async (c, next) => {
    c.header('X-Request-Id', randomUUID())
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('Cache-Control', 'no-store')
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if (c.req.url.startsWith('https://')) {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    const origin = c.req.header('origin')
    const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    if (origin !== undefined && allowedOrigins.includes(origin)) {
      c.header('Access-Control-Allow-Origin', origin)
      c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Unit-Id, X-Install-Id')
      c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      c.header('Access-Control-Expose-Headers', 'X-Request-Id, Retry-After')
      c.header('Vary', 'Origin')
    }
    if (c.req.method === 'OPTIONS') return c.body(null, 204)
    const contentLength = c.req.header('content-length')
    if (contentLength !== undefined) {
      const length = Number(contentLength)
      if (!Number.isSafeInteger(length) || length < 0 || length > 5 * 1024 * 1024) throw new ApiError(413, '请求体过大')
    }
    c.set('db', deps.db)
    await next()
  })

  // 严格限流（决策 #40）：授权入口、applyId 隐私接口、后台登录；先于路由挂载注册
  const strictLimiter = createRateLimiter(STRICT_RATE_LIMIT)
  app.on('POST', '/api/v1/authorize', strictLimiter)
  app.on('POST', '/api/v1/admin/auth/login', strictLimiter)
  app.on('POST', '/api/v1/admin/auth/refresh', strictLimiter)
  app.on('POST', '/api/v1/units/rebind', strictLimiter)
  app.on('POST', '/api/v1/applies/:applyId/register', strictLimiter)
  app.on('GET', '/api/v1/applies/:applyId', strictLimiter)

  app.notFound((c) => c.json({ ok: false as const, error: '资源不存在' }, 404))
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ ok: false as const, error: err.message }, err.status)
    console.error(err)
    return c.json({ ok: false as const, error: '服务端异常，请稍后重试' }, 500)
  })

  app.route('/api/v1', healthRouter)
  app.route('/api/v1', adminAuthRouter)
  app.route('/api/v1', adminOpsRouter)
  app.route('/api/v1', adminUnitsRouter)
  app.route('/api/v1', authorizeRouter)
  app.route('/api/v1', unitsRouter)
  app.route('/api/v1', licenseRouter)
  app.route('/api/v1', batchesRouter)
  app.route('/api/v1', appliesRouter)
  app.route('/api/v1', publicRouter)

  return app
}
/** 生产单例：server/api/[...path].ts 桥接 Nuxt 请求到 Hono app。 */
const productionApp = createHonoApp({ db: lazyDb })
export default productionApp
