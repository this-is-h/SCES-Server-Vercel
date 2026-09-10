import { describe, expect, it } from 'vitest'
import { app } from '../src/app'

describe('GET /api/v1/health', () => {
  it('返回统一 ok 包裹与 web 架构标识', async () => {
    const res = await app.request('http://internal/api/v1/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      data: { status: string; now: number; architecture: string }
    }
    expect(body.ok).toBe(true)
    expect(body.data.status).toBe('ok')
    expect(body.data.architecture).toBe('web')
    expect(Number.isInteger(body.data.now)).toBe(true)
  })
})

describe('统一失败包裹', () => {
  it('未知路径返回 404 中文错误', async () => {
    const res = await app.request('http://internal/api/v1/not-found')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { ok: false; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toBeTruthy()
  })
})
