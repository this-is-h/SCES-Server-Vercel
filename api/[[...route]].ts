import { handle } from 'hono/vercel'
import { app } from '../src/app'

export const config = {
  runtime: 'nodejs22.x',
  maxDuration: 10,
}

// 单一 catch-all 入口：全部 /api/* 请求在此函数内按 URL 分发（Hono 路由）。
// 规避 Vercel Hobby 对单次部署函数数量的限制，并共享一个冷启动面。
export const GET = handle(app)
export const POST = handle(app)
export const PUT = handle(app)
export const PATCH = handle(app)
export const DELETE = handle(app)
export const HEAD = handle(app)
export const OPTIONS = handle(app)
