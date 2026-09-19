import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import type { AppEnv } from '../http/env.js'
import { readJsonObject, requireHeader, requireString } from '../http/parse.js'
import { ApiError, badRequest, forbidden, notFound } from '../lib/errors.js'
import { LICENSE_CODE_PATTERN, randomToken, sha256Hex } from '../lib/hash.js'
import { effectiveLicenseStatus, findLicenseByCode } from '../repos/licenses.js'
import { findPublishedTemplate, toUnitConfig } from '../repos/config-templates.js'
import { insertUnitToken, revokeActiveTokensForInstall } from '../repos/unit-tokens.js'
import { findUnitById, toUnitSummary } from '../repos/units.js'

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
  let authorizedLicense = license
  await db.transaction(async (tx) => {
    await tx.query(`SELECT id FROM unit WHERE id = $1 FOR UPDATE`, [license.unit_id])
    const currentLicense = (await tx.query<typeof license>(
      `SELECT * FROM license WHERE code = $1 FOR UPDATE`,
      [license.code],
    )).at(0)
    if (currentLicense === undefined) throw forbidden('授权码无效')
    if (currentLicense.status === 'revoked') throw forbidden('授权码已作废')
    if (effectiveLicenseStatus(currentLicense) === 'expired') throw forbidden('授权已过期，请联系服务商续期')
    authorizedLicense = currentLicense
    const activeOtherInstall = await tx.query<{ install_id: string }>(
      `SELECT install_id FROM unit_token WHERE unit_id = $1 AND status = 'active' AND install_id <> $2 LIMIT 1`,
      [license.unit_id, installId],
    )
    if (activeOtherInstall.length > 0) throw forbidden('该单位已绑定其他设备，请先申请换机')
    await revokeActiveTokensForInstall(tx, license.unit_id, installId)
    await insertUnitToken(tx, {
      id: randomUUID(),
      unitId: license.unit_id,
      installId,
      licenseCode: currentLicense.code,
      tokenHash: sha256Hex(unitToken),
      expiresAt: currentLicense.expires_at,
    })
  })

  return c.json({
    ok: true as const,
    data: {
      unit: toUnitSummary(unit),
      unitToken,
      license: { expiresAt: authorizedLicense.expires_at, status: effectiveLicenseStatus(authorizedLicense) },
      configTemplate: toUnitConfig(template),
    },
  })
})
