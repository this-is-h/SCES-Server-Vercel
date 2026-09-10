import app from './app'

/**
 * 官方 Hono on Vercel 布局：默认导出 app（https://vercel.com/docs/frameworks/backend/hono）。
 * Vercel 自动探测 hono 框架并将整个应用构建为单个 Fluid 函数，
 * 路由完全交给 Hono（含 /api/v1 前缀），不再使用 api/ 文件函数模式。
 */
export default app
