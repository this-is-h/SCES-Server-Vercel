import { z } from 'zod'
import { APPLY_ID_PATTERN, UUID_PATTERN } from '../lib/hash.js'

export const applyStatusSchema = z.enum(['draft', 'submitted', 'imported', 'reviewing', 'confirmed'])
export const revisionSchema = z.number().int().min(1)
const applyIdSchema = z.string().regex(APPLY_ID_PATTERN)

/** 学生端注册（接口 12）。 */
export const registerBodySchema = z.strictObject({
  batchId: z.string().regex(UUID_PATTERN),
  revision: revisionSchema,
})

/** 单条申请状态上报（接口 8）：管理端仅上报 imported / reviewing / confirmed。 */
export const applyStatusBodySchema = z.strictObject({
  batchId: z.string().regex(UUID_PATTERN),
  status: z.enum(['imported', 'reviewing', 'confirmed']),
  revision: revisionSchema.optional(),
})

/** 批量申请状态上报（接口 7）：applyIds 单批上限 500。 */
export const bulkApplyBodySchema = z.strictObject({
  status: applyStatusSchema,
  applyIds: z.array(applyIdSchema).min(1).max(500),
  revision: revisionSchema.optional(),
  startNewRound: z.boolean().optional(),
})

/** 发起新一轮审核（接口 9）：请求体可选。 */
export const reviewRoundBodySchema = z.strictObject({
  reason: z.string().max(200).optional(),
})