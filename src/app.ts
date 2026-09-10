import { Hono } from 'hono'
import type { Db } from './db/types'
import type { AppEnv } from './http/env'
import { ApiError } from './lib/errors'
import { authorizeRouter } from './routes/authorize'
import { batchesRouter } from './routes/batches'
import { healthRouter } from './routes/health'
import { licenseRouter } from './routes/license'
import { unitsRouter } from './routes/units'

export interface AppDeps {
  /** 运行时为 Supabase 延迟连接；测试注入 PGlite。 */
  db: Db
}

/**
 * 统一失败包裹 `{ ok: false, error: "中文描述" }`（契约：错误文案面向最终用户）。
 * 状态码与错误码约定见 SCES-Server contracts/api-contract.md。
 */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.use('*', async (c, next) => {
    c.set('db', deps.db)
    await next()
  })

  app.notFound((c) => c.json({ ok: false as const, error: '资源不存在' }, 404))
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ ok: false as const, error: err.message }, err.status)
    // 契约示例文案
    console.error(err)
    return c.json({ ok: false as const, error: '服务端异常，请稍后重试' }, 500)
  })

  app.route('/api/v1', healthRouter)
  app.route('/api/v1', authorizeRouter)
  app.route('/api/v1', unitsRouter)
  app.route('/api/v1', licenseRouter)
  app.route('/api/v1', batchesRouter)

  return app
}
