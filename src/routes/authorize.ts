import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import type { AppEnv } from '../http/env'
import { readJsonObject, requireHeader, requireString } from '../http/parse'
import { ApiError, badRequest, forbidden, notFound } from '../lib/errors'
import { LICENSE_CODE_PATTERN, randomToken, sha256Hex } from '../lib/hash'
import { effectiveLicenseStatus, findLicenseByCode } from '../repos/licenses'
import { findPublishedTemplate, toUnitConfig } from '../repos/config-templates'
import { insertUnitToken, revokeActiveTokensForInstall } from '../repos/unit-tokens'
import { findUnitById, toUnitSummary } from '../repos/units'

/** 接口 1：授权码核验（公开；严格限流在 createApp 内统一挂载）。 */
export const authorizeRouter = new Hono<AppEnv>()

authorizeRouter.post('/authorize', async (c) => {
  const installId = requireHeader(c, 'X-Install-Id')
  const body = await readJsonObject(c)
  const code = requireString(body, 'code').trim().toUpperCase()
  if (!LICENSE_CODE_PATTERN.test(code)) throw badRequest()

  const db = c.get('db')
  const license = await findLicenseByCode(db, code)
  if (license === undefined) throw forbidden('授权码无效')
  if (license.status === 'revoked') throw forbidden('授权码已作废')
  if (effectiveLicenseStatus(license) === 'expired') throw forbidden('授权已过期，请联系服务商续期')

  const unit = await findUnitById(db, license.unit_id)
  if (unit === undefined) throw notFound()
  if (unit.status !== 'active') throw forbidden('授权已失效，请重新激活')

  const template = await findPublishedTemplate(db, license.unit_id)
  if (template === undefined) {
    console.error(`单位 ${license.unit_id} 无已发布配置模板，无法激活`)
    throw new ApiError(500, '服务端异常，请稍后重试')
  }

  const unitToken = randomToken()
  await db.transaction(async (tx) => {
    await revokeActiveTokensForInstall(tx, license.unit_id, installId)
    await insertUnitToken(tx, {
      id: randomUUID(),
      unitId: license.unit_id,
      installId,
      licenseCode: license.code,
      tokenHash: sha256Hex(unitToken),
      expiresAt: license.expires_at,
    })
  })

  return c.json({
    ok: true as const,
    data: {
      unit: toUnitSummary(unit),
      unitToken,
      license: { expiresAt: license.expires_at, status: effectiveLicenseStatus(license) },
      configTemplate: toUnitConfig(template),
    },
  })
})