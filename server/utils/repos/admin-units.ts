import type { Db } from '../db/types.js'
import type { ConfigTemplateRow, UnitConfig } from './config-templates.js'
import type { LicenseRow } from './licenses.js'
import type { UnitRow } from './units.js'

/** 契约 UnitSummary（后台列表）。 */
export function toUnitSummaryRow(unit: UnitRow): {
  unitId: string
  unitName: string
  unitType: string
  level: number
  parentUnitId: string | null
} {
  return {
    unitId: unit.id,
    unitName: unit.name,
    unitType: unit.unit_type,
    level: unit.level,
    parentUnitId: unit.parent_id,
  }
}

export async function listUnits(db: Db, level?: number): Promise<UnitRow[]> {
  if (level === undefined) {
    return db.query<UnitRow>(`SELECT * FROM unit ORDER BY level, created_at`)
  }
  return db.query<UnitRow>(`SELECT * FROM unit WHERE level = $1 ORDER BY created_at`, [level])
}

export async function listLicensesForUnit(db: Db, unitId: string): Promise<LicenseRow[]> {
  return db.query<LicenseRow>(`SELECT * FROM license WHERE unit_id = $1 ORDER BY created_at`, [unitId])
}

/** 接口 18 单位详情：绑定的配置模板（该单位下的最新 published 行）。 */
export async function findLatestTemplateForUnit(db: Db, unitId: string): Promise<ConfigTemplateRow | undefined> {
  const rows = await db.query<ConfigTemplateRow>(
    `SELECT * FROM config_template WHERE unit_id = $1 AND status = 'published'
     ORDER BY version DESC, revision DESC LIMIT 1`,
    [unitId],
  )
  return rows[0]
}

export async function insertUnit(db: Db, input: { id: string; name: string; unitType: string; parentId: string | null; level: number }): Promise<void> {
  const at = Date.now()
  await db.query(
    `INSERT INTO unit (id, name, unit_type, parent_id, level, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'active', $6, $6)`,
    [input.id, input.name, input.unitType, input.parentId, input.level, at],
  )
}

export type TemplateVersionSummary = {
  id: string
  unitId: string
  name: string
  version: number
  revision: number
  status: string
  createdAt: number
  updatedAt: number
}

export function toTemplateVersion(row: ConfigTemplateRow): TemplateVersionSummary {
  return {
    id: row.id,
    unitId: row.unit_id,
    name: row.name,
    version: row.version,
    revision: row.revision,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 接口 20 列表：每个模板 id 的最新版本行（含 draft）。 */
export async function listLatestTemplateVersions(db: Db): Promise<ConfigTemplateRow[]> {
  return db.query<ConfigTemplateRow>(
    `SELECT t.* FROM config_template t
     JOIN (
       SELECT id, MAX(version * 1000 + revision) AS top FROM config_template GROUP BY id
     ) latest ON latest.id = t.id
          AND latest.top = t.version * 1000 + t.revision
     ORDER BY t.id`,
  )
}

/** 接口 20 版本历史：按 (version, revision) 倒序。 */
export async function listTemplateVersions(db: Db, templateId: string): Promise<ConfigTemplateRow[]> {
  return db.query<ConfigTemplateRow>(
    `SELECT * FROM config_template WHERE id = $1 ORDER BY version DESC, revision DESC`,
    [templateId],
  )
}

export async function insertTemplateFromConfig(db: Db, config: UnitConfig, unitId: string): Promise<void> {
  const at = Date.now()
  await db.query(
    `INSERT INTO config_template
       (id, unit_id, name, version, revision, status, schema_version,
        unit_json, class_json, student_json, dyf_json, calc_json, rank_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
    [
      config.id,
      unitId,
      config.name,
      config.version,
      config.revision,
      config.schemaVersion,
      JSON.stringify(config.unit),
      JSON.stringify(config.class),
      JSON.stringify(config.student),
      JSON.stringify(config.dyf),
      JSON.stringify(config.calc),
      JSON.stringify(config.rank),
      at,
    ],
  )
}

/** 接口 20 发布：目标置 published、同 id 其他 published 转 archived（唯一部分索引约束）。 */
export async function publishTemplateVersion(db: Db, templateId: string, version: number, revision: number): Promise<void> {
  const at = Date.now()
  await db.query(`UPDATE config_template SET status = 'archived', updated_at = $2 WHERE id = $1 AND status = 'published'`, [templateId, at])
  const result = await db.query(
    `UPDATE config_template SET status = 'published', updated_at = $4
     WHERE id = $1 AND version = $2 AND revision = $3 AND status = 'draft'`,
    [templateId, version, revision, at],
  )
  void result
}
