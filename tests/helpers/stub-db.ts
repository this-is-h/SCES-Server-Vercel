import type { Db } from '../../server/utils/db/types.js'

/** 不触碰数据库的用例（health 等）注入此桩；任何查询都意味着用例越界。 */
export const unusedDb: Db = {
  query: () => Promise.reject(new Error('用例未预期访问数据库')),
  transaction: () => Promise.reject(new Error('用例未预期访问数据库')),
}
