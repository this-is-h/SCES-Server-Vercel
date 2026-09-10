import { z } from 'zod'

/**
 * 契约 Jwk：服务端只关心可比较的 RSA 公钥三要素（私钥永不上报）；
 * alg / ext / key_ops 等其余字段原样保留。
 */
export const publicKeyJwkSchema = z.looseObject({
  kty: z.string().min(1),
  n: z.string().min(1),
  e: z.string().min(1),
})

export type PublicKeyJwk = z.infer<typeof publicKeyJwkSchema>
