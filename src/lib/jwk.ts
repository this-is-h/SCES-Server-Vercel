/** 契约 Jwk：服务端只关心可比较的 RSA 公钥三要素（私钥永不上报）。 */
export type PublicKeyJwk = {
  kty: string
  n: string
  e: string
}

/** 边界校验：外部传入的 JWK 形状未知，逐字段收窄后才允许使用。 */
export function parsePublicKeyJwk(value: unknown): PublicKeyJwk | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (!('kty' in value) || !('n' in value) || !('e' in value)) return undefined
  const { kty, n, e } = value
  if (typeof kty !== 'string' || typeof n !== 'string' || typeof e !== 'string') return undefined
  return { kty, n, e }
}
