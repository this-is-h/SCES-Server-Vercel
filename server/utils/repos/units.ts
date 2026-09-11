import type { Db } from '../db/types.js'

export type UnitRow = {
  id: string
  name: string
  unit_type: string
  parent_id: string | null
  level: number
  public_key_jwk: string | null
  status: string
  created_at: number
  updated_at: number
}

/** 契约 UnitSummary（激活响应与后台列表共用）。 */
export type UnitSummary = {
  unitId: string
  unitName: string
  unitType: string
  level: number
  parentUnitId: string | null
}

export async function findUnitById(db: Db, unitId: string): Promise<UnitRow | undefined> {
  const rows = await db.query<UnitRow>(`SELECT * FROM unit WHERE id = $1`, [unitId])
  return rows[0]
}

export async function updateUnitPublicKey(db: Db, unitId: string, publicKeyJwk: string): Promise<void> {
  await db.query(`UPDATE unit SET public_key_jwk = $2, updated_at = $3 WHERE id = $1`, [
    unitId,
    publicKeyJwk,
    Date.now(),
  ])
}

export function toUnitSummary(unit: UnitRow): UnitSummary {
  return {
    unitId: unit.id,
    unitName: unit.name,
    unitType: unit.unit_type,
    level: unit.level,
    parentUnitId: unit.parent_id,
  }
}

/** 契约 UnitTreeNode：公开单位树节点（学生端单位选择，无配置/授权信息）。 */
export type UnitTreeNode = {
  text: string
  value: string
  children?: UnitTreeNode[]
}

export type ActiveUnitRow = {
  id: string
  name: string
  level: number
  parent_id: string | null
}

/** 公开单位树（接口 10）：仅 active 单位，一级为分组、二级为叶子（决策 #34）。 */
export async function listActiveUnits(db: Db): Promise<ActiveUnitRow[]> {
  return db.query<ActiveUnitRow>(
    `SELECT id, name, level, parent_id FROM unit WHERE status = 'active' ORDER BY created_at`,
  )
}
