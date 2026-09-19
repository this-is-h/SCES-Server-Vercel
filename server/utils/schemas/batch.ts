import { z } from 'zod'
import { UUID_PATTERN } from '../lib/hash.js'
import { publicKeyJwkSchema } from '../lib/jwk.js'

const epoch = z.number().int().min(0)
const ratio = z.number().min(0).max(1)

/** 契约 CalcConfig：判别字段 calcMode，与 unit-config.schema.json#/$defs/calc 同强度。 */
const weightedCalcConfig = z.strictObject({
  calcMode: z.literal('weighted'),
  dyfWeight: ratio,
  courseWeight: ratio,
})

const formulaCalcConfig = z.strictObject({
  calcMode: z.literal('formula'),
  dyfWeight: ratio,
  courseWeight: ratio,
  formula: z.string().min(1),
})

const commonBatchFields = {
  batchId: z.string().regex(UUID_PATTERN),
  year: z.number().int().min(2000).max(2999),
  semester: z.union([z.literal(1), z.literal(2)]),
  isTest: z.boolean(),
  applyStartAt: epoch.nullable().optional(),
  applyEndAt: epoch.nullable().optional(),
  keyId: z.string().min(1).max(128),
  publicKeyJwk: publicKeyJwkSchema,
  configTemplateId: z.string().min(1),
  configTemplateVersion: z.number().int().min(1),
  configTemplateRevision: z.number().int().min(0),
}

/**
 * 批次创建上报（接口 5）：
 * calcMode 为判别字段，同一对象的 calcConfig.calcMode 必须一致（契约 CalcConfig 判别约束）。
 */
export const batchPayloadSchema = z.discriminatedUnion('calcMode', [
  z.strictObject({ ...commonBatchFields, calcMode: z.literal('weighted'), calcConfig: weightedCalcConfig }),
  z.strictObject({ ...commonBatchFields, calcMode: z.literal('formula'), calcConfig: formulaCalcConfig }),
]).superRefine((batch, ctx) => {
  if (batch.applyStartAt !== null && batch.applyStartAt !== undefined &&
      batch.applyEndAt !== null && batch.applyEndAt !== undefined &&
      batch.applyStartAt >= batch.applyEndAt) {
    ctx.addIssue({ code: 'custom', path: ['applyEndAt'], message: '申请截止时间必须晚于开始时间' })
  }
})

export const batchStatusSchema = z.enum(['draft', 'active', 'closed'])
