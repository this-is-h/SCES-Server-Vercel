import { Ajv2020 } from 'ajv/dist/2020.js'
import unitConfigSchemaJson from './unit-config.schema.json' with { type: 'json' }

/**
 * 契约 UnitConfig 校验（接口 20 上传模板）。
 * schema 为 unit-config.schema.json 的运行时镜像（sync:contracts 同步、check:contracts 把关），
 * 与契约侧 verify-seeds 用同一 Ajv2020 编译方式，校验强度完全一致。
 */

const unitConfigSchema = unitConfigSchemaJson as object

const ajv = new Ajv2020({ allErrors: true, strict: true })
const validateUnitConfig = ajv.compile(unitConfigSchema)

export function isUnitConfig(value: unknown): value is Record<string, unknown> {
  return validateUnitConfig(value) === true
}

/** 取第一条校验错误，拼接契约 400 示例风格的「配置格式不合法：…」文案。 */
export function firstConfigError(value: unknown): string | undefined {
  validateUnitConfig(value)
  const first = validateUnitConfig.errors?.[0]
  if (first === undefined) return undefined
  const where = first.instancePath === '' ? '根' : first.instancePath
  return `${where} ${first.message ?? '校验失败'}`
}
