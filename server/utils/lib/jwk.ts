import { z } from 'zod'

/**
 * 契约 Jwk：服务端只关心可比较的 RSA 公钥三要素（私钥永不上报）；
 * alg / ext / key_ops 等其余字段原样保留。
 */
const PRIVATE_JWK_MEMBERS = new Set(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'])

export const publicKeyJwkSchema = z.looseObject({
  kty: z.literal('RSA'),
  n: z.string().min(1),
  e: z.string().min(1),
}).superRefine((jwk, ctx) => {
  for (const member of PRIVATE_JWK_MEMBERS) {
    if (member in jwk) {
      ctx.addIssue({ code: 'custom', path: [member], message: '公钥中不得包含私钥字段' })
    }
  }
})

export type PublicKeyJwk = z.infer<typeof publicKeyJwkSchema>
