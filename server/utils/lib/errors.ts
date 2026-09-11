import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** 业务错误：携带 HTTP 状态码与面向最终用户的中文文案（契约错误码约定）。 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const badRequest = (message = '请求参数不合法') => new ApiError(400, message)
export const unauthorized = (message = '未登录或登录已过期') => new ApiError(401, message)
export const forbidden = (message: string) => new ApiError(403, message)
export const notFound = (message = '资源不存在') => new ApiError(404, message)
export const conflict = (message: string) => new ApiError(409, message)
