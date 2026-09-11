import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHonoApp } from '../server/utils/app.js'
import { hashPassword, randomToken, sha256Hex } from '../server/utils/lib/hash.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import { loadTestSeed } from './helpers/fixtures.js'
import { jsonHeaders } from './helpers/fixtures.js'
import { readData, readError } from './helpers/http.js'

const ADMIN_PASSWORD = 'initial-pass-123'

type LoginData = { accessToken: string; refreshToken: string; username: string; mustChangePassword: boolean }

describe('后台管理接口 18–21', () => {
  let ctx: TestDb
  let token: string

  beforeEach(async () => {
    ctx = await createTestDb()
    // 管理员 + 登录拿 token
    await ctx.db.query(
      `INSERT INTO admin_user (id, username, password_hash, must_change_password, created_at, updated_at)
       VALUES (gen_random_uuid(), 'admin', $1, 0, $2, $2)`,
      [hashPassword(ADMIN_PASSWORD), Date.now()],
    )
    const app = createHonoApp({ db: ctx.db })
    const res = await app.request('http://internal/api/v1/admin/auth/login', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }),
    })
    token = (await readData<LoginData>(res)).accessToken
  })

  afterEach(async () => {
    await ctx.close()
  })

  const call = (
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    withToken = true,
  ) =>
    createHonoApp({ db: ctx.db }).request(`http://internal${path}`, {
      method,
      headers: jsonHeaders(withToken ? { Authorization: `Bearer ${token}` } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  /** 预置一级单位 + 二级单位（复用种子模板数据）。 */
  async function seedSchoolAndUnit() {
    const seed = loadTestSeed()
    const at = Date.now()
    await ctx.db.query(
      `INSERT INTO unit (id, name, unit_type, parent_id, level, status, created_at, updated_at)
       VALUES ($1, $2, 'other', NULL, 1, 'active', $3, $3) ON CONFLICT (id) DO NOTHING`,
      [seed.unit.parentUnit.unitId, seed.unit.parentUnit.name, at],
    )
    await ctx.db.query(
      `INSERT INTO unit (id, name, unit_type, parent_id, level, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 2, 'active', $5, $5) ON CONFLICT (id) DO NOTHING`,
      [seed.unit.unitId, seed.unit.name, seed.unit.unitType, seed.unit.parentUnit.unitId, at],
    )
    return seed
  }

  describe('接口 18：单位', () => {
    it('未带访问令牌返回 401', async () => {
      const res = await call('GET', '/api/v1/admin/units', undefined, false)
      expect(res.status).toBe(401)
    })

    it('创建一级单位成功，无授权码', async () => {
      const data = await readData<{ unit: { unitId: string; level: number }; code: string | null }>(
        await call('POST', '/api/v1/admin/units', {
          unitId: 'testSchool1',
          name: '测试学校',
          level: 1,
        }),
      )
      expect(data.unit.unitId).toBe('testSchool1')
      expect(data.code).toBeNull()
    })

    it('创建二级单位即签发首个授权码', async () => {
      const seed = await seedSchoolAndUnit()
      const data = await readData<{ code: string; expiresAt: number }>(
        await call('POST', '/api/v1/admin/units', {
          unitId: 'newUnit2',
          name: '新书院',
          level: 2,
          parentId: seed.unit.parentUnit.unitId,
          templateId: 'tpl-x',
        }),
      )
      expect(data.code).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/)
      expect(data.expiresAt).toBeGreaterThan(Date.now())
    })

    it('unitId 重复返回 409 契约文案', async () => {
      const seed = await seedSchoolAndUnit()
      const res = await call('POST', '/api/v1/admin/units', {
        unitId: seed.unit.unitId,
        name: '重复',
        level: 2,
        parentId: seed.unit.parentUnit.unitId,
        templateId: 'tpl-x',
      })
      expect(res.status).toBe(409)
      expect(await readError(res)).toBe('该单位标识已存在')
    })

    it('单位列表按 level 过滤', async () => {
      const seed = await seedSchoolAndUnit()
      const all = await readData<{ units: { unitId: string }[] }>(await call('GET', '/api/v1/admin/units'))
      expect(all.units.length).toBeGreaterThanOrEqual(2)
      const onlyTwo = await readData<{ units: { unitId: string; level: number }[] }>(
        await call('GET', '/api/v1/admin/units?level=2'),
      )
      expect(onlyTwo.units.every((u) => u.level === 2)).toBe(true)
      void seed
    })

    it('单位详情返回授权码列表与模板', async () => {
      const seed = await seedSchoolAndUnit()
      const at = Date.now()
      const cfg = loadTestSeed()
      await ctx.db.query(
        `INSERT INTO config_template
           (id, unit_id, name, version, revision, status, schema_version,
            unit_json, class_json, student_json, dyf_json, calc_json, rank_json, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'published', $6, $7, $8, $9, $10, $11, $12, $13, $13)
         ON CONFLICT (id, version, revision) DO NOTHING`,
        [
          cfg.id, cfg.unit.unitId, cfg.name, cfg.version, cfg.revision, cfg.schemaVersion,
          JSON.stringify(cfg.unit), JSON.stringify(cfg.class), JSON.stringify(cfg.student),
          JSON.stringify(cfg.dyf), JSON.stringify(cfg.calc), JSON.stringify(cfg.rank), at,
        ],
      )
      await ctx.db.query(
        `INSERT INTO license (code, unit_id, expires_at, status, renew_count, created_at, updated_at)
         VALUES ($1, $2, $3, 'active', 0, $4, $4)`,
        ['AAAA-BBBB-CCCC-DDDD', seed.unit.unitId, at + 86_400_000, at],
      )
      const data = await readData<{
        unit: { unitId: string }
        template: { id: string } | null
        licenses: { code: string; status: string }[]
      }>(await call('GET', `/api/v1/admin/units/${seed.unit.unitId}`))
      expect(data.unit.unitId).toBe(seed.unit.unitId)
      expect(data.template?.id).toBe(seed.id)
      expect(data.licenses).toHaveLength(1)
      expect(data.licenses[0]?.status).toBe('active')
    })

    it('单位详情不存在返回 404', async () => {
      const res = await call('GET', '/api/v1/admin/units/noUnit9')
      expect(res.status).toBe(404)
    })
  })

  describe('接口 19：授权码签发 / 作废 / 续期', () => {
    beforeEach(async () => {
      await seedSchoolAndUnit()
    })

    const UNIT = loadTestSeed().unit.unitId

    it('签发新授权码成功', async () => {
      const data = await readData<{ code: string; expiresAt: number }>(
        await call('POST', `/api/v1/admin/units/${UNIT}/licenses`, { months: 6 }),
      )
      expect(data.code).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/)
    })

    it('作废后激活链失效且幂等', async () => {
      const { code } = await readData<{ code: string }>(
        await call('POST', `/api/v1/admin/units/${UNIT}/licenses`, { months: 12 }),
      )
      const first = await call('POST', `/api/v1/admin/licenses/${code}/revoke`, { reason: 'test' })
      expect(first.status).toBe(200)
      // 幂等
      const again = await call('POST', `/api/v1/admin/licenses/${code}/revoke`)
      expect(again.status).toBe(200)
      // 库内状态与令牌级联
      const rows = await ctx.db.query<{ status: string }>(`SELECT status FROM license WHERE code = $1`, [code])
      expect(rows[0]?.status).toBe('revoked')
    })

    it('作废不存在的授权码返回 404', async () => {
      const res = await call('POST', '/api/v1/admin/licenses/ZZZZ-ZZZZ-ZZZZ-ZZZZ/revoke')
      expect(res.status).toBe(404)
    })

    it('续期延长有效期并递增 renewCount；已作废 409', async () => {
      const { code } = await readData<{ code: string }>(
        await call('POST', `/api/v1/admin/units/${UNIT}/licenses`, { months: 12 }),
      )
      const data = await readData<{ code: string; renewCount: number; status: string }>(
        await call('POST', `/api/v1/admin/licenses/${code}/renew`, { months: 3 }),
      )
      expect(data.renewCount).toBe(1)
      expect(data.status).toBe('active')

      await call('POST', `/api/v1/admin/licenses/${code}/revoke`)
      const res = await call('POST', `/api/v1/admin/licenses/${code}/renew`, { months: 3 })
      expect(res.status).toBe(409)
      expect(await readError(res)).toBe('授权码已作废，不可续期')
    })
  })

  describe('接口 20：配置模板', () => {
    beforeEach(async () => {
      await seedSchoolAndUnit()
    })

    it('上传合法种子配置为 draft', async () => {
      const seed = loadTestSeed()
      const data = await readData<{ id: string; status: string; version: number; revision: number }>(
        await call('POST', '/api/v1/admin/templates', { config: seed }),
      )
      expect(data.id).toBe(seed.id)
      expect(data.status).toBe('draft')
      expect(data.version).toBe(seed.version)
    })

    it('查看模板配置内容返回完整 UnitConfig；不存在的版本 404', async () => {
      const seed = loadTestSeed()
      await call('POST', '/api/v1/admin/templates', { config: seed })

      const res = await call(
        'GET',
        `/api/v1/admin/templates/${seed.id}/versions/${seed.version}/${seed.revision}/config`,
      )
      const { config } = await readData<{ config: typeof seed }>(res)
      expect(config).toEqual({ ...seed, status: 'draft', updatedAt: expect.any(Number) })
      // 六段 JSON 重组与上传时逐字段一致
      expect(config.class).toEqual(seed.class)
      expect(config.dyf).toEqual(seed.dyf)
      expect(config.calc).toEqual(seed.calc)
      expect(config.rank).toEqual(seed.rank)

      const missing = await call('GET', `/api/v1/admin/templates/${seed.id}/versions/9/0/config`)
      expect(missing.status).toBe(404)
    })

    it('上传非法配置返回 400「配置格式不合法：…」', async () => {
      const res = await call('POST', '/api/v1/admin/templates', { config: { schemaVersion: 1 } })
      expect(res.status).toBe(400)
      expect(await readError(res)).toContain('配置格式不合法')
    })

    it('发布后不可再上传同版本（409）；发布其他版本归档旧版', async () => {
      const seed = { ...loadTestSeed() }
      await call('POST', '/api/v1/admin/templates', { config: seed })
      const published = await readData<{ status: string }>(
        await call('POST', `/api/v1/admin/templates/${seed.id}/publish`, {
          version: seed.version,
          revision: seed.revision,
        }),
      )
      expect(published.status).toBe('published')

      // 同三元组再上传 → 冲突
      const res = await call('POST', '/api/v1/admin/templates', { config: seed })
      expect(res.status).toBe(409)
      expect(await readError(res)).toBe('该版本已发布，请升修订号后再上传')

      // 新修订发布后旧版归档
      const next = { ...seed, revision: seed.revision + 1 }
      await call('POST', '/api/v1/admin/templates', { config: next })
      await readData<{ status: string }>(
        await call('POST', `/api/v1/admin/templates/${seed.id}/publish`, {
          version: next.version,
          revision: next.revision,
        }),
      )
      const rows = await ctx.db.query<{ status: string }>(
        `SELECT status FROM config_template WHERE id = $1 AND version = $2 AND revision = $3`,
        [seed.id, seed.version, seed.revision],
      )
      expect(rows[0]?.status).toBe('archived')
    })

    it('版本历史倒序返回；未知模板 404', async () => {
      const seed = { ...loadTestSeed() }
      await call('POST', '/api/v1/admin/templates', { config: seed })
      await call('POST', '/api/v1/admin/templates', { config: { ...seed, revision: seed.revision + 1 } })
      const data = await readData<{ versions: { revision: number }[] }>(
        await call('GET', `/api/v1/admin/templates/${seed.id}/versions`),
      )
      expect(data.versions[0]?.revision).toBe(seed.revision + 1)
      expect(data.versions.length).toBe(2)

      const missing = await call('GET', '/api/v1/admin/templates/no-such-template/versions')
      expect(missing.status).toBe(404)
    })
  })

  describe('接口 21：运维', () => {
    it('批次列表与审计日志可查询（空数据）', async () => {
      const batches = await readData<{ batches: unknown[] }>(await call('GET', '/api/v1/admin/batches'))
      expect(batches.batches).toEqual([])
      const logs = await readData<{ logs: unknown[]; nextCursor: null }>(await call('GET', '/api/v1/admin/audit-logs'))
      expect(logs.logs).toEqual([])
      expect(logs.nextCursor).toBeNull()
    })

    it('审计日志分页与游标', async () => {
      const seed = await seedSchoolAndUnit()
      // 造 3 条审计
      for (let i = 0; i < 3; i += 1) {
        await call('POST', '/api/v1/admin/units', {
          unitId: `unitX${i}`,
          name: `单位${i}`,
          level: 1,
        })
        void seed
      }
      const page1 = await readData<{ logs: { id: number }[]; nextCursor: number | null }>(
        await call('GET', '/api/v1/admin/audit-logs?limit=2'),
      )
      expect(page1.logs).toHaveLength(2)
      expect(page1.nextCursor).not.toBeNull()
      const page2 = await readData<{ logs: { id: number }[]; nextCursor: number | null }>(
        await call('GET', `/api/v1/admin/audit-logs?limit=2&cursor=${page1.nextCursor}`),
      )
      expect(page2.logs).toHaveLength(1)
      expect(page2.nextCursor).toBeNull()
    })

    it('超频换机放行：作废旧码签发新码并登记', async () => {
      const seed = await seedSchoolAndUnit()
      const unitId = seed.unit.unitId
      const oldCode = 'AAAA-BBBB-CCCC-DDDD'
      const at = Date.now()
      await ctx.db.query(
        `INSERT INTO license (code, unit_id, expires_at, status, renew_count, created_at, updated_at)
         VALUES ($1, $2, $3, 'active', 0, $4, $4)`,
        [oldCode, unitId, at + 180 * 86_400_000, at],
      )
      await ctx.db.query(
        `INSERT INTO unit_token (id, unit_id, install_id, license_code, token_hash, expires_at, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
        ['tok-1', unitId, 'install-1', oldCode, sha256Hex(randomToken()), at + 86_400_000, at],
      )
      await ctx.db.query(
        `INSERT INTO rebind_request (id, unit_id, install_id, reason, old_code, new_code, status, month_key, month_count, created_at, resolved_at)
         VALUES ($1, $2, $3, $4, $5, NULL, 'pending', $6, 4, $7, NULL)`,
        ['rb-1', unitId, 'install-1', '手机丢失', oldCode, '2026-09', at],
      )

      const data = await readData<{ id: string; status: string; code: string | null }>(
        await call('POST', '/api/v1/admin/rebinds/rb-1/approve', { approve: true }),
      )
      expect(data.status).toBe('approved')
      expect(data.code).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/)
      // 旧码作废 + 令牌级联失效
      const lic = await ctx.db.query<{ status: string }>(`SELECT status FROM license WHERE code = $1`, [oldCode])
      expect(lic[0]?.status).toBe('revoked')
      const toks = await ctx.db.query<{ status: string }>(`SELECT status FROM unit_token WHERE license_code = $1`, [oldCode])
      expect(toks.every((row) => row.status === 'revoked')).toBe(true)
      // 重复放行 409
      const again = await call('POST', '/api/v1/admin/rebinds/rb-1/approve')
      expect(again.status).toBe(409)
      expect(await readError(again)).toBe('该换机申请无需放行')
    })

    it('拒绝换机申请登记 rejected 且不签发新码', async () => {
      const seed = await seedSchoolAndUnit()
      await ctx.db.query(
        `INSERT INTO rebind_request (id, unit_id, install_id, reason, old_code, new_code, status, month_key, month_count, created_at, resolved_at)
         VALUES ($1, $2, $3, $4, $5, NULL, 'pending', $6, 4, $7, NULL)`,
        ['rb-2', seed.unit.unitId, 'install-1', '测试拒绝', 'AAAA-BBBB-CCCC-DDDD', '2026-09', Date.now()],
      )
      const data = await readData<{ status: string; code: null }>(
        await call('POST', '/api/v1/admin/rebinds/rb-2/approve', { approve: false }),
      )
      expect(data.status).toBe('rejected')
      expect(data.code).toBeNull()
    })
  })
})
