import { Hono } from 'hono'
import type { AppEnv } from '../http/env.js'
import { readOptionalJsonObject } from '../http/parse.js'
import { recordAudit } from '../lib/audit.js'
import { badRequest, conflict, notFound } from '../lib/errors.js'
import { findActiveLicenseForUnit, findLicenseByCode, issueLicense, revokeLicense } from '../repos/licenses.js'
import { revokeActiveTokensForLicense } from '../repos/unit-tokens.js'
import { requireAdminToken } from './admin-auth.js'


type BatchRow = {
  id: string
  unit_id: string
  year: number
  semester: number
  is_test: number
  status: string
  apply_start_at: number | null
  apply_end_at: number | null
  calc_mode: string
  calc_config: string
  public_key_jwk: string
  config_template_id: string
  config_template_version: number
  config_template_revision: number
  created_at: number
  updated_at: number
}

function toBatchPublic(row: BatchRow) {
  return {
    batchId: row.id,
    unitId: row.unit_id,
    year: row.year,
    semester: row.semester,
    isTest: row.is_test === 1,
    status: row.status,
    applyStartAt: row.apply_start_at,
    applyEndAt: row.apply_end_at,
    calcMode: row.calc_mode,
    calcConfig: JSON.parse(row.calc_config),
    publicKeyJwk: JSON.parse(row.public_key_jwk),
    configTemplateId: row.config_template_id,
    configTemplateVersion: row.config_template_version,
    configTemplateRevision: row.config_template_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

type RebindRow = {
  id: string
  unit_id: string
  install_id: string
  reason: string | null
  old_code: string | null
  new_code: string | null
  status: string
  month_key: string
  month_count: number
  created_at: number
}

function toRebindRequest(row: RebindRow) {
  return {
    id: row.id,
    unitId: row.unit_id,
    installId: row.install_id,
    reason: row.reason,
    oldCode: row.old_code,
    newCode: row.new_code,
    status: row.status,
    monthKey: row.month_key,
    monthCount: row.month_count,
    createdAt: row.created_at,
  }
}

export const adminOpsRouter = new Hono<AppEnv>()
adminOpsRouter.use('/admin/*', requireAdminToken)

/** 接口 21：批次列表（运维排障，?unitId/?status 过滤）。 */
adminOpsRouter.get('/admin/batches', async (c) => {
  const db = c.get('db')
  const unitId = c.req.query('unitId')
  const status = c.req.query('status')

  const rows = await db.query<BatchRow>(
    `SELECT * FROM batch WHERE ($1::text IS NULL OR unit_id = $1)
       AND ($2::text IS NULL OR status = $2)
     ORDER BY created_at DESC`,
    [unitId ?? null, status ?? null],
  )
  return c.json({ ok: true as const, data: { batches: rows.map(toBatchPublic) } })
})

/** 接口 21：换机记录列表（?status 过滤）。 */
adminOpsRouter.get('/admin/rebinds', async (c) => {
  const db = c.get('db')
  const status = c.req.query('status')
  const rows = await db.query<RebindRow>(
    `SELECT id, unit_id, install_id, reason, old_code, new_code, status, month_key, month_count, created_at
     FROM rebind_request WHERE ($1::text IS NULL OR status = $1)
     ORDER BY created_at DESC`,
    [status ?? null],
  )
  return c.json({ ok: true as const, data: { rebinds: rows.map(toRebindRequest) } })
})

/** 接口 21：放行超频换机（作废旧码 + 按原授权剩余期签发新码；拒绝则仅登记）。 */
adminOpsRouter.post('/admin/rebinds/:rebindId/approve', async (c) => {
  const db = c.get('db')
  const auth = c.get('adminAuth')
  const rebindId = c.req.param('rebindId')
  const body = await readOptionalJsonObject(c)
  const approve = body.approve === undefined ? true : body.approve === true
  const reason = typeof body.reason === 'string' ? body.reason : undefined

  const rebind = (await db.query<RebindRow>(`SELECT * FROM rebind_request WHERE id = $1`, [rebindId])).at(0)
  if (rebind === undefined) throw notFound('换机申请不存在')
  if (rebind.status !== 'pending') throw conflict('该换机申请无需放行')

  if (!approve) {
    await db.query(`UPDATE rebind_request SET status = 'rejected', resolved_at = $2 WHERE id = $1`, [rebindId, Date.now()])
    await recordAudit(db, {
      adminUserId: auth.adminUserId,
      action: 'rebind-reject',
      target: rebindId,
      detail: reason ?? null,
      ip: c.req.header('x-forwarded-for') ?? null,
    })
    return c.json({ ok: true as const, data: { id: rebindId, status: 'rejected' as const, code: null, expiresAt: null } })
  }

  // 放行：作废旧授权码（级联失效令牌），按原授权剩余期签发新码；整段同事务
  // （uq_license_active_unit 只约束未作废行，故须先作废再签发）
  const old = rebind.old_code === null ? undefined : await findLicenseByCode(db, rebind.old_code)
  if (old?.status === 'revoked' && (await findActiveLicenseForUnit(db, rebind.unit_id)) !== undefined) {
    // 旧码已被作废且单位已有新授权码：该放行请求已失效
    throw conflict('该单位已有未作废授权码')
  }

  const result = await db.transaction<{ code: string; expiresAt: number }>(async (tx) => {
    if (old !== undefined && old.status !== 'revoked') {
      await revokeLicense(tx, old.code)
      await revokeActiveTokensForLicense(tx, old.code)
    }
    const expiresAt = old?.expires_at ?? Date.now() + 30 * 86_400_000
    const code = await issueLicense(tx, rebind.unit_id, expiresAt)
    await tx.query(
      `UPDATE rebind_request SET status = 'approved', new_code = $2, resolved_at = $3 WHERE id = $1`,
      [rebindId, code, Date.now()],
    )
    return { code, expiresAt }
  })

  await recordAudit(db, {
    adminUserId: auth.adminUserId,
    action: 'rebind-approve',
    target: rebindId,
    detail: `新授权码 ${result.code}`,
    ip: c.req.header('x-forwarded-for') ?? null,
  })
  return c.json({
    ok: true as const,
    data: { id: rebindId, status: 'approved' as const, code: result.code, expiresAt: result.expiresAt },
  })
})

/** 接口 21：审计日志（游标分页，?action/?target/?limit 过滤）。 */
adminOpsRouter.get('/admin/audit-logs', async (c) => {
  const db = c.get('db')
  const action = c.req.query('action')
  const target = c.req.query('target')
  const limitRaw = c.req.query('limit')
  const limit = limitRaw === undefined ? 50 : Number.parseInt(limitRaw, 10)
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw badRequest()
  const cursorRaw = c.req.query('cursor')
  const cursor = cursorRaw === undefined ? undefined : Number.parseInt(cursorRaw, 10)
  if (cursor !== undefined && (!Number.isInteger(cursor) || cursor < 1)) throw badRequest()

  const rows = await db.query<{
    id: number
    admin_user_id: string | null
    action: string
    target: string
    detail: string | null
    ip: string | null
    created_at: number
  }>(
    `SELECT id, admin_user_id, action, target, detail, ip, created_at
     FROM audit_log
     WHERE ($1::text IS NULL OR action = $1)
       AND ($2::text IS NULL OR target = $2)
       AND ($3::bigint IS NULL OR id < $3)
     ORDER BY id DESC
     LIMIT $4`,
    [action ?? null, target ?? null, cursor ?? null, limit + 1],
  )

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  return c.json({
    ok: true as const,
    data: {
      logs: page.map((row) => ({
        id: row.id,
        adminUserId: row.admin_user_id,
        action: row.action,
        target: row.target,
        detail: row.detail,
        ip: row.ip,
        createdAt: row.created_at,
      })),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    },
  })
})

