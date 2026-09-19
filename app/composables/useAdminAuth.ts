/**
 * 后台会话（Nuxt 端）：
 * - accessToken 存内存级 useState（15 分钟，不落 localStorage 降低 XSS 面）；
 * - refreshToken 存 sessionStorage（标签页关闭即失效）；
 * - 请求 401 时自动刷新令牌并重放一次；刷新失败跳登录页。
 */

export interface AdminLogin {
  accessToken: string
  accessTokenExpiresAt: number
  refreshToken: string
  username: string
  mustChangePassword: boolean
}

/** ofetch 错误：携带 HTTP 状态码。 */
interface FetchErrorLike {
  status?: number
}

function is401(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'status' in e && (e as FetchErrorLike).status === 401
}

// Shared by all composable consumers in this SPA tab.
let refreshing: Promise<void> | null = null

export const useAdminAuth = () => {
  const accessToken = useState<string | null>('admin-access-token', () => null)
  const username = useState<string>('admin-username', () => '')
  const mustChangePassword = useState<boolean>('admin-must-change', () => false)

  function refreshToken(): string | null {
    if (import.meta.server) return null
    return sessionStorage.getItem('admin-refresh-token')
  }

  function refresh(): Promise<void> {
    refreshing ??= performRefresh().finally(() => { refreshing = null })
    return refreshing
  }

  async function performRefresh(): Promise<void> {
    const token = refreshToken()
    if (!token) {
      accessToken.value = null
      navigateTo('/admin/login')
      return
    }
    try {
      const data = await $fetch<{ ok: true; data: { accessToken: string; refreshToken: string } }>('/api/v1/admin/auth/refresh', {
        method: 'POST',
        retry: 0,
        body: { refreshToken: token },
      })
      accessToken.value = data.data.accessToken
      sessionStorage.setItem('admin-refresh-token', data.data.refreshToken)
    }
    catch {
      accessToken.value = null
      sessionStorage.removeItem('admin-refresh-token')
      navigateTo('/admin/login')
    }
  }

  /**
   * 带鉴权的请求：401 时刷新令牌并重放一次（并发 401 只触发一次刷新）。
   * ofetch 的 onResponseError 无法用重放结果替代原请求的失败，故在调用层包装。
   */
  async function api<T>(path: string, options: Record<string, unknown> | (() => Record<string, unknown>) = {}): Promise<T> {
    const call = () =>
      $fetch<T>(path, {
        ...(typeof options === 'function' ? options() : options),
        baseURL: '/api/v1',
        headers: accessToken.value ? { Authorization: `Bearer ${accessToken.value}` } : undefined,
      })
    try {
      return await call()
    }
    catch (e) {
      if (!is401(e)) throw e
      await refresh()
      if (!accessToken.value) throw e
      return call()
    }
  }

  async function login(user: string, password: string): Promise<{ mustChangePassword: boolean }> {
    const data = await $fetch<{ ok: true; data: AdminLogin }>('/api/v1/admin/auth/login', {
      method: 'POST',
      body: { username: user, password },
    })
    accessToken.value = data.data.accessToken
    username.value = data.data.username
    mustChangePassword.value = data.data.mustChangePassword
    sessionStorage.setItem('admin-refresh-token', data.data.refreshToken)
    return { mustChangePassword: data.data.mustChangePassword }
  }

  async function logout(): Promise<void> {
    try {
      if (refreshing) await refreshing
      await api('/admin/auth/logout', () => ({ method: 'POST', body: { refreshToken: refreshToken() } }))
    }
    catch {
      // 幂等：失败不阻塞跳转
    }
    accessToken.value = null
    username.value = ''
    mustChangePassword.value = false
    sessionStorage.removeItem('admin-refresh-token')
  }

  return { accessToken, username, mustChangePassword, login, refresh, logout, api }
}
