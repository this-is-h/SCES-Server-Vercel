import { createHash, randomBytes, randomInt } from 'node:crypto'

/** 契约 LicenseCode：大写字母数字，4 组 × 4 位。 */
export const LICENSE_CODE_PATTERN = /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/

/** 契约 UnitId：camelCase，字母开头、仅字母数字。 */
export const UNIT_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*$/

/** 契约 BatchId / ApplyId：UUID v4（管理端或学生端生成）。 */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const LICENSE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/** applyId / unitToken 一律只存 SHA-256 哈希（数据主权红线），查询时现算现比。 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** 令牌明文：256 bit，base64url；仅签发时返回一次，落库只存哈希。 */
export function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

/** 授权码：16 位（≈82 bit），无模偏（crypto.randomInt）。 */
export function generateLicenseCode(): string {
  const chars = Array.from({ length: 16 }, () => LICENSE_ALPHABET.charAt(randomInt(LICENSE_ALPHABET.length)))
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}-${chars.slice(12, 16).join('')}`
}
