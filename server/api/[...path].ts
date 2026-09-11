import { toWebRequest, defineEventHandler } from 'h3'
import app from '../utils/app.js'

/**
 * Nuxt 服务端唯一入口：把整个 /api/** 请求桥接给既有 Hono 应用。
 *
 * 架构（决策记录）：
 * - Nuxt（full-stack framework，Vercel 官方支持）承载 UI 与 server 路由。
 * - API 业务层保持 Hono 实现不变——它受 OpenAPI 契约冻结、有 63 个契约测试，
 *   迁移到 h3 文件路由无收益；Hono handler 即 web 标准 fetch 接口，
 *   h3 v1 的 toWebRequest 原生桥接，两层零适配层。
 * - Nuxt 页面（管理后台）挂 /admin/**，与 API 同源，cookie 会话可用。
 */
export default defineEventHandler((event) => {
  return app.fetch(toWebRequest(event))
})
