import type { Db } from '../db/types.js'

/** 管理端写接口的令牌上下文（由 requireUnitToken 解析并校验）。 */
export interface UnitAuthContext {
  tokenId: string
  unitId: string
  installId: string
  licenseCode: string
  unitLevel: number
}

export interface AppEnv {
  Variables: {
    db: Db
    unitAuth: UnitAuthContext
    /** 后台认证上下文（由 requireAdminToken 解析并校验）。 */
    adminAuth: AdminAuthContext
  }
}

export interface AdminAuthContext {
  adminUserId: string
  username: string
}
