import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useAdminAuth } from '../app/composables/useAdminAuth.ts'

const storage = new Map()
const states = new Map()
beforeEach(() => {
  storage.clear(); states.clear()
  vi.stubGlobal('useState', (key, initial) => {
    if (!states.has(key)) states.set(key, { value: initial() })
    return states.get(key)
  })
  vi.stubGlobal('sessionStorage', { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) })
  vi.stubGlobal('navigateTo', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('管理后台实际会话封装', () => {
  it('多个组件并发刷新只使用一次旧凭证并保存新的 refreshToken', async () => {
    storage.set('admin-refresh-token', 'old')
    const fetch = vi.fn(async () => ({ ok: true, data: { accessToken: 'new-access', refreshToken: 'new-refresh' } }))
    vi.stubGlobal('$fetch', fetch)
    const first = useAdminAuth(), second = useAdminAuth()
    await Promise.all([first.refresh(), second.refresh()])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(storage.get('admin-refresh-token')).toBe('new-refresh')
    expect(second.accessToken.value).toBe('new-access')
  })
  it('登出遇到访问令牌过期时，重试使用轮换后的刷新令牌', async () => {
    storage.set('admin-refresh-token', 'old-refresh')
    const requests = []
    vi.stubGlobal('$fetch', async (path, options) => {
      requests.push({ path, options })
      if (path.endsWith('/refresh')) return { ok: true, data: { accessToken: 'new-access', refreshToken: 'new-refresh' } }
      if (options.headers.Authorization === 'Bearer old-access') throw { status: 401 }
      expect(options.body.refreshToken).toBe('new-refresh')
      return { ok: true, data: { ok: true } }
    })
    const auth = useAdminAuth()
    auth.accessToken.value = 'old-access'
    await auth.logout()
    expect(requests).toHaveLength(3)
    expect(requests[2].options.body.refreshToken).toBe('new-refresh')
    expect(auth.accessToken.value).toBeNull()
    expect(storage.has('admin-refresh-token')).toBe(false)
  })
})
