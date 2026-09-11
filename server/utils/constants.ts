/**
 * 架构标识：本实现 = Node runtime + PostgreSQL（与 SCES-Server web 架构同源），
 * health 接口按契约返回 "web"。
 */
export const ARCHITECTURE = 'web' as const
