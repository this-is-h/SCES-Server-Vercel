import { Hono } from 'hono'
import type { Db } from './db/types'
import type { AppEnv } from './http/env'
import { createRateLimiter, STRICT_RATE_LIMIT } from './http/rate-limit'
import { ApiError } from './lib/errors'
import { appliesRouter } from './routes/applies'
import { authorizeRouter } from './routes/authorize'
import { batchesRouter } from './routes/batches'
import { healthRouter } from './routes/health'
import { licenseRouter } from './routes/license'
import { publicRouter } from './routes/public'
import { unitsRouter } from './routes/units'

export interface AppDeps {
  /** 运行时为 Supabase 延迟连接；测试注入 PGlite。 */
  db: Db
}

/**
 * 应用工厂：统一失败包裹 `{ ok: false, error: "中文描述" }`（契约：错误文案面向最终用户）。
 * 限流计数等有状态中间件在工厂内创建——每个应用实例独立计数，测试与部署互不串扰。
 */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.use('*', async (c, next) => {
    c.set('db', deps.db)
    await next()
  })

  // 严格限流（决策 #40）：授权与 applyId 隐私接口；先于路由挂载注册
  const strictLimiter = createRateLimiter(STRICT_RATE_LIMIT)
  app.on('POST', '/api/v1/authorize', strictLimiter)
  app.on('POST', '/api/v1/applies/:applyId/register', strictLimiter)
  app.on('GET', '/api/v1/applies/:applyId', strictLimiter)

  app.notFound((c) => c.json({ ok: false as const, error: '资源不存在' }, 404))
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ ok: false as const, error: err.message }, err.status)
    console.error(err)
    return c.json({ ok: false as const, error: '服务端异常，请稍后重试' }, 500)
  })

  app.route('/api/v1', healthRouter)
  app.route('/api/v1', authorizeRouter)
  app.route('/api/v1', unitsRouter)
  app.route('/api/v1', licenseRouter)
  app.route('/api/v1', batchesRouter)
  app.route('/api/v1', appliesRouter)
  app.route('/api/v1', publicRouter)

  return app
}