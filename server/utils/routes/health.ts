import { Hono } from 'hono'
import type { AppEnv } from '../http/env.js'
import { ARCHITECTURE } from '../constants.js'

/**
 * 探活（不计入 21 个业务接口）：GET /api/v1/health
 * 成功 data：{ status: "ok", now: EpochMs, architecture: "web" }
 */
export const healthRouter = new Hono<AppEnv>().get('/health', (c) =>
  c.json({
    ok: true as const,
    data: {
      status: 'ok' as const,
      now: Date.now(),
      architecture: ARCHITECTURE,
    },
  }),
)

/** Readiness probe: verifies that the configured database is reachable. */
healthRouter.get('/health/ready', async (c) => {
  try {
    await c.get('db').query(`SELECT b.key_id, u.config_template_id, r.bucket_key
      FROM batch b CROSS JOIN unit u CROSS JOIN rate_limit_bucket r LIMIT 0`)
    return c.json({ ok: true as const, data: { status: 'ready' as const, now: Date.now() } })
  } catch (error) {
    console.error('readiness probe failed', error)
    return c.json({ ok: false as const, error: '服务暂不可用，请稍后重试' }, 503)
  }
})
