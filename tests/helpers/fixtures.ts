import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import type { Db } from '../../src/db/types'
import type { AppEnv } from '../../src/http/env'
import { readData } from './http'

export const TEST_LICENSE_CODE = 'A1B2-C3D4-E5F6-G7H8'
export const TEST_INSTALL_ID = 'install-test-1'

/** 契约种子 test-1.json（与 Supabase 将灌入的模板同构）。 */
export type UnitConfigSeed = {
  schemaVersion: number
  id: string
  name: string
  version: number
  revision: number
  status: string
  unit: { unitId: string; name: string; unitType: string; parentUnit: { unitId: string; name: string } }
  class: unknown
  student: unknown
  dyf: unknown
  calc: unknown
  rank: unknown
}

export const TEST_JWK = {
  kty: 'RSA',
  n: 'test-modulus-base64url',
  e: 'AQAB',
  alg: 'RSA-OAEP-256',
  ext: true,
}

const seedPath = fileURLToPath(new URL('../../contracts/seed/test-1.json', import.meta.url))
let cachedSeed: UnitConfigSeed | undefined

export function loadTestSeed(): UnitConfigSeed {
  cachedSeed ??= JSON.parse(readFileSync(seedPath, 'utf8')) as UnitConfigSeed
  return cachedSeed
}

export interface SeededUnit {
  seed: UnitConfigSeed
  code: string
  expiresAt: number
  unitId: string
}

/** 灌入可激活的二级单位：父级单位 + 单位 + 授权码 + published 配置模板。 */
export async function seedTestUnit(
  db: Db,
  options: {
    licenseStatus?: string
    expiresAt?: number
    unitStatus?: string
    published?: boolean
  } = {},
): Promise<SeededUnit> {
  const seed = loadTestSeed()
  const at = Date.now()
  const unitId = seed.unit.unitId
  const expiresAt = options.expiresAt ?? at + 30 * 86_400_000
  await db.query(
    `INSERT INTO unit (id, name, unit_type, parent_id, level, status, created_at, updated_at)
     VALUES ($1, $2, 'other', NULL, 1, 'active', $3, $3)
     ON CONFLICT (id) DO NOTHING`,
    [seed.unit.parentUnit.unitId, seed.unit.parentUnit.name, at],
  )
  await db.query(
    `INSERT INTO unit (id, name, unit_type, parent_id, level, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 2, $5, $6, $6)
     ON CONFLICT (id) DO NOTHING`,
    [unitId, seed.unit.name, seed.unit.unitType, seed.unit.parentUnit.unitId, options.unitStatus ?? 'active', at],
  )
  await db.query(
    `INSERT INTO license (code, unit_id, expires_at, status, renew_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 0, $5, $5)
     ON CONFLICT (code) DO NOTHING`,
    [TEST_LICENSE_CODE, unitId, expiresAt, options.licenseStatus ?? 'active', at],
  )
  if (options.published !== false) {
    await db.query(
      `INSERT INTO config_template
         (id, unit_id, name, version, revision, status, schema_version,
          unit_json, class_json, student_json, dyf_json, calc_json, rank_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'published', $6, $7, $8, $9, $10, $11, $12, $13, $13)
       ON CONFLICT (id, version, revision) DO NOTHING`,
      [
        seed.id,
        unitId,
        seed.name,
        seed.version,
        seed.revision,
        seed.schemaVersion,
        JSON.stringify(seed.unit),
        JSON.stringify(seed.class),
        JSON.stringify(seed.student),
        JSON.stringify(seed.dyf),
        JSON.stringify(seed.calc),
        JSON.stringify(seed.rank),
        at,
      ],
    )
  }

  return { seed, code: TEST_LICENSE_CODE, expiresAt, unitId }
}

export function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'content-type': 'application/json', ...extra }
}

export function unitHeaders(
  token: string,
  unitId: string,
  installId: string = TEST_INSTALL_ID,
): Record<string, string> {
  return jsonHeaders({
    Authorization: `Bearer ${token}`,
    'X-Unit-Id': unitId,
    'X-Install-Id': installId,
  })
}

/** 走一次激活拿 unitToken（等价管理端激活链路）。 */
export async function activateUnit(
  app: Hono<AppEnv>,
  code: string,
  installId: string = TEST_INSTALL_ID,
): Promise<string> {
  const res = await app.request('http://internal/api/v1/authorize', {
    method: 'POST',
    headers: jsonHeaders({ 'X-Install-Id': installId }),
    body: JSON.stringify({ code }),
  })
  if (res.status !== 200) throw new Error(`激活失败：HTTP ${res.status}`)
  const data = await readData<{ unitToken: string }>(res)
  return data.unitToken
}

let batchSeq = 0
/** 每个用例独立的 UUID（格式合规即可，非真实 v4 校验位）。 */
export function nextBatchId(): string {
  batchSeq += 1
  return `b1c9d4e2-5a37-4f18-9d6b-${String(batchSeq).padStart(12, '0')}`
}

let applySeq = 0
/** 每个用例独立的 UUID v4 学生申请 id。 */
export function nextApplyId(): string {
  applySeq += 1
  return `3f2a6c58-7b41-4d2e-9c05-${String(applySeq).padStart(12, '0')}`
}

/**
 * 灌入一级单位 + 其授权码（新一轮审核需要一级单位令牌，决策 #31）。
 * 激活链路要求目标单位有 published 配置模板，故与 seedTestUnit 共用同一份种子模板
 * （config_template 主键是 (id, version, revision)，二级单位先建则此处跳过）。
 */
export async function seedLevelOneUnit(
  db: Db,
  options: { code?: string } = {},
): Promise<{ unitId: string; code: string }> {
  const seed = loadTestSeed()
  const at = Date.now()
  const code = options.code ?? 'LLLL-LLLL-LLLL-LLLL'
  await db.query(
    `INSERT INTO unit (id, name, unit_type, parent_id, level, status, created_at, updated_at)
     VALUES ('test', '测试学校', 'other', NULL, 1, 'active', $1, $1)
     ON CONFLICT (id) DO NOTHING`,
    [at],
  )
  await db.query(
    `INSERT INTO license (code, unit_id, expires_at, status, renew_count, created_at, updated_at)
     VALUES ($1, 'test', $2, 'active', 0, $3, $3)
     ON CONFLICT (code) DO NOTHING`,
    [code, at + 30 * 86_400_000, at],
  )
  await db.query(
    `INSERT INTO config_template
       (id, unit_id, name, version, revision, status, schema_version,
        unit_json, class_json, student_json, dyf_json, calc_json, rank_json, created_at, updated_at)
     VALUES ($1, 'test', $2, $3, $4, 'published', $5, $6, $7, $8, $9, $10, $11, $12, $12)
     ON CONFLICT (id, version, revision) DO NOTHING`,
    [
      `${seed.id}-l1`,
      seed.name,
      seed.version,
      seed.revision,
      seed.schemaVersion,
      JSON.stringify(seed.unit),
      JSON.stringify(seed.class),
      JSON.stringify(seed.student),
      JSON.stringify(seed.dyf),
      JSON.stringify(seed.calc),
      JSON.stringify(seed.rank),
      at,
    ],
  )
  return { unitId: 'test', code }
}
