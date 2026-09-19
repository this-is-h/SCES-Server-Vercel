/**
 * 后台访问令牌（接口 14–17，决策 #40）：
 * - 15 分钟短期，HS256 JWT 形态（契约 securitySchemes.adminToken bearerFormat: JWT）；
 * - 无状态：不落库、无吊销名单，登出只删刷新 token，访问 token 自然过期；
 * - 签名密钥 `TOKEN_SIGNING_SECRET`（HMAC-SHA256）。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const ACCESS_TOKEN_TTL_MS = 15 * 60_000

interface AccessTokenClaims {
  sub: string
  username: string
  ver: number
  exp: number
}

function requireSecret(): string {
  const secret = process.env.TOKEN_SIGNING_SECRET
  if (secret === undefined || secret.length < 32) {
    throw new Error('缺少环境变量 TOKEN_SIGNING_SECRET（HMAC 签名密钥，见 .env.example）')
  }
  return secret
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

function hmac(data: string): string {
  return createHmac('sha256', requireSecret()).update(data).digest('base64url')
}

export function signAccessToken(claims: Omit<AccessTokenClaims, 'exp'>, now = Date.now()): string {
  const payload: AccessTokenClaims = { ...claims, exp: Math.floor((now + ACCESS_TOKEN_TTL_MS) / 1000) }
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const signature = hmac(`${head}.${body}`)
  return `${head}.${body}.${signature}`
}

export function verifyAccessToken(token: string, now = Date.now()): AccessTokenClaims | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  const [head, body, signature] = parts as [string, string, string]
  try {
    const header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8')) as { alg?: unknown; typ?: unknown }
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return undefined
  } catch {
    return undefined
  }
  const expected = hmac(`${head}.${body}`)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined

  let claims: AccessTokenClaims
  try {
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccessTokenClaims
    if (
      typeof decoded.sub !== 'string' ||
      typeof decoded.username !== 'string' ||
      typeof decoded.ver !== 'number' ||
      typeof decoded.exp !== 'number' ||
      !Number.isSafeInteger(decoded.ver)
    ) {
      return undefined
    }
    claims = decoded
  } catch {
    return undefined
  }
  if (!Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(now / 1000)) return undefined
  return claims
}
