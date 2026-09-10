import { Hono } from 'hono'
import { ARCHITECTURE } from '../constants'

/**
 * 探活（不计入 21 个业务接口）：GET /api/v1/health
 * 成功 data：{ status: "ok", now: EpochMs, architecture: "web" }
 */
export const healthRouter = new Hono().get('/health', (c) =>
  c.json({
    ok: true,
    data: {
      status: 'ok' as const,
      now: Date.now(),
      architecture: ARCHITECTURE,
    },
  }),
)
