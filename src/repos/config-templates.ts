import type { Db } from '../db/types.js'

export type ConfigTemplateRow = {
  id: string
  unit_id: string
  name: string
  version: number
  revision: number
  status: string
  schema_version: number
  unit_json: string
  class_json: string
  student_json: string
  dyf_json: string
  calc_json: string
  rank_json: string
  created_at: number
  updated_at: number
}

/** 单位配置（契约 UnitConfig）：由六个 *_json 列重组，结构唯一权威是 unit-config.schema.json。 */
export type UnitConfig = {
  schemaVersion: number
  id: string
  name: string
  version: number
  revision: number
  status: string
  unit: unknown
  class: unknown
  student: unknown
  dyf: unknown
  calc: unknown
  rank: unknown
  updatedAt: number
}

/** 每个模板 id 至多一个 published 版本（DDL 唯一部分索引保证）。 */
export async function findPublishedTemplate(db: Db, unitId: string): Promise<ConfigTemplateRow | undefined> {
  const rows = await db.query<ConfigTemplateRow>(
    `SELECT * FROM config_template WHERE unit_id = $1 AND status = 'published'`,
    [unitId],
  )
  return rows[0]
}

/** 批次以 (id, version, revision) 三元组快照引用模板（决策 #37）。 */
export async function findTemplateVersion(
  db: Db,
  templateId: string,
  version: number,
  revision: number,
): Promise<ConfigTemplateRow | undefined> {
  const rows = await db.query<ConfigTemplateRow>(
    `SELECT * FROM config_template WHERE id = $1 AND version = $2 AND revision = $3`,
    [templateId, version, revision],
  )
  return rows[0]
}

export function toUnitConfig(row: ConfigTemplateRow): UnitConfig {
  return {
    schemaVersion: row.schema_version,
    id: row.id,
    name: row.name,
    version: row.version,
    revision: row.revision,
    status: row.status,
    unit: JSON.parse(row.unit_json),
    class: JSON.parse(row.class_json),
    student: JSON.parse(row.student_json),
    dyf: JSON.parse(row.dyf_json),
    calc: JSON.parse(row.calc_json),
    rank: JSON.parse(row.rank_json),
    updatedAt: row.updated_at,
  }
}
