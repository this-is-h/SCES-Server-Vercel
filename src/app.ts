import { Hono } from 'hono'
import { healthRouter } from './routes/health'

/**
 * 统一失败包裹 `{ ok: false, error: "中文描述" }`（契约：错误文案面向最终用户）。
 * 状态码与错误码约定见 SCES-Server contracts/api-contract.md。
 */
export function createApp(): Hono {
  const app = new Hono()

  app.notFound((c) => c.json({ ok: false, error: '资源不存在' }, 404))
  app.onError((err, c) => {
    // 契约示例文案
    console.error(err)
    return c.json({ ok: false, error: '服务端异常，请稍后重试' }, 500)
  })

  app.route('/api/v1', healthRouter)

  return app
}

export const app = createApp()
