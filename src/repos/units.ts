import type { Db } from '../db/types'

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
