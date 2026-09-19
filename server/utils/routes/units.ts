import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import type { AppEnv } from '../http/env.js'
import { REBIND_MONTHLY_LIMIT, assertLicenseUsable, assertUnitIdentity, requireUnitToken } from '../http/guards.js'
import { clientIp, optionalString, readJsonObject, readOptionalJsonObject } from '../http/parse.js'
import { recordAudit } from '../lib/audit.js'
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js'
import { UNIT_ID_PATTERN } from '../lib/hash.js'
import { publicKeyJwkSchema } from '../lib/jwk.js'
import { monthKey } from '../lib/time.js'
import { countRebindsInMonth, insertRebind } from '../repos/rebinds.js'
import { findLicenseByCode, issueLicense, revokeLicense, type LicenseRow } from '../repos/licenses.js'
import { revokeActiveTokensForLicense } from '../repos/unit-tokens.js'
import { findUnitById, updateUnitPublicKey } from '../repos/units.js'

/** 接口 2/3：公钥上报与自助换机（unitToken）。 */
export const unitsRouter = new Hono<AppEnv>()

// Transactional rebind implementation. The unit row lock serializes monthly
// quota checks across concurrent Vercel invocations.
unitsRouter.post('/units/rebind', requireUnitToken, async (c) => {
  const auth = c.get('unitAuth')
  assertUnitIdentity(c, auth)
  const body = await readOptionalJsonObject(c)
  const reason = optionalString(body, 'reason')?.slice(0, 200) ?? null
  const db = c.get('db')
  const at = Date.now()
  const key = monthKey(at)

  const result = await db.transaction(async (tx) => {
    await tx.query(`SELECT id FROM unit WHERE id = $1 FOR UPDATE`, [auth.unitId])
    const license = (await tx.query<LicenseRow>('SELECT * FROM license WHERE code = $1 FOR UPDATE', [auth.licenseCode]))[0]
    if (license === undefined) throw unauthorized()
    assertLicenseUsable(license)
    const unit = await findUnitById(tx, auth.unitId)
    if (unit === undefined) throw notFound()
    if (unit.status !== 'active') throw forbidden('授权已失效，请重新激活')

    const used = await countRebindsInMonth(tx, auth.unitId, key)
    if (used >= REBIND_MONTHLY_LIMIT) {
      await insertRebind(tx, {
        id: randomUUID(), unitId: auth.unitId, installId: auth.installId, reason,
        oldCode: license.code, newCode: null, status: 'pending', monthKey: key,
        monthCount: used + 1, resolvedAt: null,
      })
      await recordAudit(tx, { action: 'rebind-pending', target: auth.unitId, detail: '本月换机次数超限', ip: clientIp(c) ?? null })
      return { pending: true as const, monthCount: used + 1, oldCode: license.code }
    }

    await revokeLicense(tx, license.code)
    await revokeActiveTokensForLicense(tx, license.code)
    const code = await issueLicense(tx, auth.unitId, license.expires_at)
    await insertRebind(tx, {
      id: randomUUID(), unitId: auth.unitId, installId: auth.installId, reason,
      oldCode: license.code, newCode: code, status: 'self-served', monthKey: key,
      monthCount: used + 1, resolvedAt: at,
    })
    await recordAudit(tx, { action: 'rebind-self-served', target: auth.unitId, detail: '自助换机完成', ip: clientIp(c) ?? null })
    return { pending: false as const, code, expiresAt: license.expires_at, monthCount: used + 1, oldCode: license.code }
  })

  if (result.pending) {
    throw forbidden('本月更换设备次数已达上限，请联系服务商')
  }

  return c.json({ ok: true as const, data: { ok: true as const, code: result.code, expiresAt: result.expiresAt, monthCount: result.monthCount } })
})

unitsRouter.post('/units/:unitId/public-key', requireUnitToken, async (c) => {
  const unitId = c.req.param('unitId')
  if (!UNIT_ID_PATTERN.test(unitId)) throw badRequest()
  const auth = c.get('unitAuth')
  assertUnitIdentity(c, auth, unitId)

  const body = await readJsonObject(c)
  const jwk = publicKeyJwkSchema.safeParse(body.publicKeyJwk)
  if (!jwk.success) throw badRequest()

  const db = c.get('db')
  const license = await findLicenseByCode(db, auth.licenseCode)
  if (license === undefined) throw unauthorized()
  assertLicenseUsable(license)

  const unit = await findUnitById(db, unitId)
  if (unit === undefined) throw notFound()

  // 同一公钥重复上报幂等（比较 kty/n/e 语义值，忽略 JSON 字段顺序）
  if (unit.public_key_jwk !== null) {
    const current = publicKeyJwkSchema.safeParse(JSON.parse(unit.public_key_jwk))
    if (
      current.success &&
      current.data.kty === jwk.data.kty &&
      current.data.n === jwk.data.n &&
      current.data.e === jwk.data.e
    ) {
      return c.json({ ok: true as const, data: { ok: true as const } })
    }
  }

  await updateUnitPublicKey(db, unitId, JSON.stringify(body.publicKeyJwk))
  await recordAudit(db, {
    action: 'unit-public-key-update',
    target: unitId,
    detail: unit.public_key_jwk === null ? '首次上报公钥' : '公钥变更',
    ip: clientIp(c) ?? null,
  })
  return c.json({ ok: true as const, data: { ok: true as const } })
})
