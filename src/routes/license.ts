import { Hono } from 'hono'
import type { AppEnv } from '../http/env'
import { assertUnitIdentity, requireUnitToken } from '../http/guards'
import { forbidden, notFound, unauthorized } from '../lib/errors'
import { effectiveLicenseStatus, findLicenseByCode } from '../repos/licenses'
import { findUnitById, toUnitSummary } from '../repos/units'

/** 接口 4：授权状态拉取（unitToken；过期不报错，返回 status=expired 供管理端提醒）。 */
export const licenseRouter = new Hono<AppEnv>()

licenseRouter.get('/license/status', requireUnitToken, async (c) => {
  const auth = c.get('unitAuth')
  assertUnitIdentity(c, auth)

  const db = c.get('db')
  const license = await findLicenseByCode(db, auth.licenseCode)
  if (license === undefined) throw unauthorized()

  const unit = await findUnitById(db, auth.unitId)
  if (unit === undefined) throw notFound()
  if (unit.status !== 'active') throw forbidden('授权已失效，请重新激活')

  return c.json({
    ok: true as const,
    data: {
      code: license.code,
      expiresAt: license.expires_at,
      status: effectiveLicenseStatus(license),
      unit: toUnitSummary(unit),
    },
  })
})
