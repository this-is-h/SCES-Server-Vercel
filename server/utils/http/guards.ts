import { createMiddleware } from 'hono/factory'
import type { Context } from 'hono'
import { sha256Hex } from '../lib/hash.js'
import { forbidden, unauthorized } from '../lib/errors.js'
import { effectiveLicenseStatus, findLicenseByCode, type LicenseRow } from '../repos/licenses.js'
import { findTokenAuthByHash } from '../repos/unit-tokens.js'
import type { AppEnv, UnitAuthContext } from './env.js'
import { requireHeader } from './parse.js'

/** 自助换机月限（决策 #40）。 */
export const REBIND_MONTHLY_LIMIT = 3

/**
 * 管理端写接口鉴权：`Authorization: Bearer <unitToken>`。
 * 令牌明文不落库，按 SHA-256 哈希查；辅助头 X-Unit-Id / X-Install-Id 仅用于审计。
 */
export const requireUnitToken = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization')
  if (header === undefined || !header.startsWith('Bearer ')) throw unauthorized()
  const token = header.slice('Bearer '.length).trim()
  if (token === '') throw unauthorized()

  const row = await findTokenAuthByHash(c.get('db'), sha256Hex(token))
  if (row === undefined) throw unauthorized()
  const isLicenseStatusRead = c.req.method === 'GET' && c.req.path.endsWith('/license/status')
  if (row.token_status !== 'active' || (!isLicenseStatusRead && row.token_expires_at <= Date.now())) throw unauthorized()
  if (row.license_status === 'revoked') throw forbidden('授权码已作废')
  if (row.unit_status !== 'active') throw forbidden('授权已失效，请重新激活')

  c.set('unitAuth', {
    tokenId: row.token_id,
    unitId: row.unit_id,
    installId: row.install_id,
    licenseCode: row.license_code,
    unitLevel: row.unit_level,
  })
  await next()
})

/**
 * 校验辅助标识头与令牌上下文一致（X-Unit-Id / X-Install-Id 为契约必填头，
 * 仅用于审计与错配识别，不作为信任凭证；路径 unitId 亦须与令牌一致）。
 */
export function assertUnitIdentity(c: Context<AppEnv>, auth: UnitAuthContext, pathUnitId?: string): void {
  const headerUnitId = requireHeader(c, 'X-Unit-Id')
  const headerInstallId = requireHeader(c, 'X-Install-Id')
  const mismatched =
    headerUnitId !== auth.unitId ||
    headerInstallId !== auth.installId ||
    (pathUnitId !== undefined && pathUnitId !== auth.unitId)
  if (mismatched) throw forbidden('授权校验未通过，请重新激活')
}

/** 新一轮审核仅一级单位令牌可发起（决策 #30/#31）。 */
export function assertLevelOne(auth: UnitAuthContext): void {
  if (auth.unitLevel !== 1) throw forbidden('仅一级单位可发起新一轮审核')
}

/** 写接口公共前置：令牌上下文一致性 + 授权处于有效期内。 */
export async function requireWritableUnit(c: Context<AppEnv>): Promise<UnitAuthContext> {
  const auth = c.get('unitAuth')
  assertUnitIdentity(c, auth)
  const license = await findLicenseByCode(c.get('db'), auth.licenseCode)
  if (license === undefined) throw unauthorized()
  assertLicenseUsable(license)
  return auth
}

/** 写接口要求授权处于有效期内（revoked/expired 的差异化中文文案）。 */
export function assertLicenseUsable(license: Pick<LicenseRow, 'status' | 'expires_at'>): void {
  const status = effectiveLicenseStatus(license)
  if (status === 'revoked') throw forbidden('授权码已作废')
  if (status === 'expired') throw forbidden('授权已过期，请联系服务商续期')
}
