import { Hono } from 'hono'
import type { AppEnv } from '../http/env'
import { listActiveUnits, type UnitTreeNode } from '../repos/units'

/** 接口 10：公开单位树（学生端单位选择，无鉴权）。 */
export const publicRouter = new Hono<AppEnv>()

publicRouter.get('/units/public', async (c) => {
  const units = await listActiveUnits(c.get('db'))

  const parents = units.filter((unit) => unit.level === 1)
  const childrenByParent = new Map<string, UnitTreeNode[]>()
  for (const unit of units) {
    if (unit.level === 2 && unit.parent_id !== null) {
      const siblings = childrenByParent.get(unit.parent_id) ?? []
      siblings.push({ text: unit.name, value: unit.id })
      childrenByParent.set(unit.parent_id, siblings)
    }
  }

  const tree: UnitTreeNode[] = parents.map((parent) => {
    const node: UnitTreeNode = { text: parent.name, value: parent.id }
    const children = childrenByParent.get(parent.id)
    if (children !== undefined && children.length > 0) node.children = children
    return node
  })

  return c.json({ ok: true as const, data: { units: tree } })
})