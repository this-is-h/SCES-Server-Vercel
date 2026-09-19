import type { Db } from '../db/types.js'
import type { ConfigTemplateRow, UnitConfig } from './config-templates.js'
import type { LicenseRow } from './licenses.js'
import type { UnitRow } from './units.js'
import { findPublishedTemplate } from './config-templates.js'
import { conflict } from '../lib/errors.js'

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

/** 接口 18 单位删除：一级单位有下级时返回 false（调用方转 409），否则级联删除全部关联数据。 */
export async function deleteUnit(db: Db, unitId: string): Promise<boolean> {
  const children = await db.query<{ id: string }>(
    `SELECT id FROM unit WHERE parent_id = $1 LIMIT 1`,
    [unitId],
  )
  if (children.length > 0) return false
  // batch → config_template 为 RESTRICT：先显式删批次，再删单位（其余表走 CASCADE）
  await db.query(`DELETE FROM batch WHERE unit_id = $1`, [unitId])
  const removed = await db.query<{ id: string }>(`DELETE FROM unit WHERE id = $1 RETURNING id`, [unitId])
  return removed.length > 0
}

export async function listLicensesForUnit(db: Db, unitId: string): Promise<LicenseRow[]> {
  return db.query<LicenseRow>(`SELECT * FROM license WHERE unit_id = $1 ORDER BY created_at`, [unitId])
}

/** 接口 18 单位详情：绑定的配置模板（该单位下的最新 published 行）。 */
export async function findLatestTemplateForUnit(db: Db, unitId: string): Promise<ConfigTemplateRow | undefined> {
  return findPublishedTemplate(db, unitId)
}

export async function insertUnit(db: Db, input: { id: string; name: string; unitType: string; parentId: string | null; level: number; configTemplateId?: string | null }): Promise<void> {
  const at = Date.now()
  await db.query(
    `INSERT INTO unit (id, name, unit_type, parent_id, level, config_template_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $7)`,
    [input.id, input.name, input.unitType, input.parentId, input.level, input.configTemplateId ?? null, at],
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
    `SELECT DISTINCT ON (id) * FROM config_template ORDER BY id, version DESC, revision DESC`,
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
  const rows = await db.query<{ id: string }>(
    `INSERT INTO config_template
       (id, unit_id, name, version, revision, status, schema_version,
        unit_json, class_json, student_json, dyf_json, calc_json, rank_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11, $12, $13, $13)
     ON CONFLICT (id, version, revision) DO UPDATE SET
       name = EXCLUDED.name, schema_version = EXCLUDED.schema_version,
       unit_json = EXCLUDED.unit_json, class_json = EXCLUDED.class_json,
       student_json = EXCLUDED.student_json, dyf_json = EXCLUDED.dyf_json,
       calc_json = EXCLUDED.calc_json, rank_json = EXCLUDED.rank_json, updated_at = EXCLUDED.updated_at
     WHERE config_template.status = 'draft' AND config_template.unit_id = EXCLUDED.unit_id
     RETURNING id`,
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
  if (rows.length === 0) throw conflict('该版本已发布，请升修订号后再上传')
}

/** 接口 20 发布：目标置 published、同 id 其他 published 转 archived（唯一部分索引约束）。 */
export async function publishTemplateVersion(db: Db, templateId: string, version: number, revision: number): Promise<void> {
  const at = Date.now()
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`template:${templateId}`])
    await tx.query(`UPDATE config_template SET status = 'archived', updated_at = $2 WHERE id = $1 AND status = 'published'`, [templateId, at])
    const result = await tx.query<{ id: string }>(
      `UPDATE config_template SET status = 'published', updated_at = $4
       WHERE id = $1 AND version = $2 AND revision = $3 AND status = 'draft'
       RETURNING id`,
      [templateId, version, revision, at],
    )
    if (result.length === 0) throw conflict('模板版本状态已改变')
  })
}
