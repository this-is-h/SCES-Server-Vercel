import { randomInt } from 'node:crypto'
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'

const schema = JSON.parse(readFileSync(new URL('../../contracts/unit-config.schema.json', import.meta.url), 'utf8'))
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema)
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const generateCode = () => Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('')).join('-')

/** Import one seed atomically. Existing expired-but-not-revoked licenses must
 * be retained; otherwise the active-unit uniqueness constraint rejects a retry. */
export async function importSeed(db, seed, explicitCode) {
  if (!validate(seed)) throw new Error('种子配置不符合 schema')
  if (explicitCode && !/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(explicitCode)) throw new Error('种子授权码格式不合法')
  return db.transaction(async (tx) => {
    const now = Date.now()
    const unitId = seed.unit.unitId
    const parent = seed.unit.parentUnit
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`seed:${unitId}`])
    if (parent) await tx.query(
      `INSERT INTO unit (id, name, unit_type, parent_id, level, status, created_at, updated_at)
       VALUES ($1, $2, 'other', NULL, 1, 'active', $3, $3) ON CONFLICT (id) DO NOTHING`,
      [parent.unitId, parent.name, now],
    )
    await tx.query(
      `INSERT INTO unit (id, name, unit_type, parent_id, level, status, created_at, updated_at, config_template_id)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $6, $7) ON CONFLICT (id) DO NOTHING`,
      [unitId, seed.unit.name, seed.unit.unitType ?? 'other', parent?.unitId ?? null, parent ? 2 : 1, now, seed.id],
    )
    await tx.query('SELECT id FROM unit WHERE id = $1 FOR UPDATE', [unitId])
    const wrongOwner = await tx.query('SELECT id FROM config_template WHERE id = $1 AND unit_id <> $2 LIMIT 1', [seed.id, unitId])
    if (wrongOwner.length) throw new Error('种子模板属于其他单位，请先核对数据')
    const published = await tx.query("SELECT id FROM config_template WHERE id = $1 AND status = 'published'", [seed.id])
    await tx.query(
      `INSERT INTO config_template (id, unit_id, name, version, revision, status, schema_version,
       unit_json, class_json, student_json, dyf_json, calc_json, rank_json, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
       ON CONFLICT (id, version, revision) DO NOTHING`,
      [seed.id, unitId, seed.name, seed.version, seed.revision, published.length ? 'draft' : 'published', seed.schemaVersion,
        ...['unit', 'class', 'student', 'dyf', 'calc', 'rank'].map((field) => JSON.stringify(seed[field])), now],
    )
    await tx.query('UPDATE unit SET config_template_id = COALESCE(config_template_id, $2) WHERE id = $1', [unitId, seed.id])
    const active = await tx.query("SELECT code FROM license WHERE unit_id = $1 AND status <> 'revoked'", [unitId])
    if (active.length) return { unitId, templateId: seed.id, licenseIssued: false }
    const code = explicitCode ?? generateCode()
    await tx.query(
      `INSERT INTO license (code, unit_id, expires_at, status, renew_count, created_at, updated_at)
       VALUES ($1,$2,$3,'active',0,$4,$4)`, [code, unitId, now + 360 * 86400000, now],
    )
    return { unitId, templateId: seed.id, licenseIssued: true }
  })
}
