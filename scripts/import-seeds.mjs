#!/usr/bin/env node
// ---------------------------------------------------------------------------
// 种子导入：contracts/seed/*.json -> Supabase（幂等，可重复执行）
//
// 每个种子导入：一级单位 + 二级单位 + 授权码 + published 配置模板。
// 幂等性：unit 按 id 冲突跳过；config_template 按 (id, version, revision) 冲突跳过；
// license 若该单位已有任意 active 授权码则跳过，否则签发（独立单位首次导入或旧码全失效时补发）。
// 授权码环境变量 SEED_LICENSE_<大写UNITID> 可覆盖；缺省随机生成并打印（导入后请尽快在后台改签）。
//
// 用法：
//   node scripts/import-seeds.mjs                # 全部种子
//   node scripts/import-seeds.mjs test-1 test-2  # 指定种子
// ---------------------------------------------------------------------------
import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const seedDir = join(process.cwd(), 'contracts/seed')
const names = process.argv.slice(2)
const allSeeds = readdirSync(seedDir).filter((f) => f.endsWith('.json'))
const targets = names.length > 0 ? allSeeds.filter((f) => names.some((n) => f.startsWith(n))) : allSeeds
if (targets.length === 0) {
  console.error('未匹配到种子文件。可用：', allSeeds.join(', '))
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('缺少 DATABASE_URL 环境变量')
  process.exit(1)
}

const { default: postgres } = await import('postgres')
const sql = postgres(databaseUrl, {
  prepare: false,
  max: 1,
  types: {
    bigint: {
      to: 20,
      from: [20],
      serialize: (value) => String(value),
      parse: (value) => Number(value),
    },
  },
})

function generateLicenseCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const group = () => Array.from(randomBytes(4), (b) => alphabet[b % alphabet.length]).join('')
  return `${group()}-${group()}-${group()}-${group()}`
}

const now = Date.now()

for (const file of targets) {
  const seed = JSON.parse(readFileSync(join(seedDir, file), 'utf8'))
  const unitId = seed.unit.unitId
  const parentId = seed.unit.parentUnit?.unitId ?? null

  if (parentId !== null) {
    await sql`
      INSERT INTO unit (id, name, unit_type, parent_id, level, status, created_at, updated_at)
      VALUES (${parentId}, ${seed.unit.parentUnit.name}, 'other', NULL, 1, 'active', ${now}, ${now})
      ON CONFLICT (id) DO NOTHING`
  }

  const unitType = ['college', 'department', 'other'].includes(seed.unit.unitType) ? seed.unit.unitType : 'other'
  await sql`
    INSERT INTO unit (id, name, unit_type, parent_id, level, status, created_at, updated_at)
    VALUES (${unitId}, ${seed.unit.name}, ${unitType}, ${parentId}, ${parentId === null ? 1 : 2}, 'active', ${now}, ${now})
    ON CONFLICT (id) DO NOTHING`

  // 配置模板：published（种子即运行时权威配置）
  await sql`
    INSERT INTO config_template
      (id, unit_id, name, version, revision, status, schema_version,
       unit_json, class_json, student_json, dyf_json, calc_json, rank_json, created_at, updated_at)
    VALUES (${seed.id}, ${unitId}, ${seed.name}, ${seed.version}, ${seed.revision}, 'published', ${seed.schemaVersion},
            ${JSON.stringify(seed.unit)}, ${JSON.stringify(seed.class)}, ${JSON.stringify(seed.student)},
            ${JSON.stringify(seed.dyf)}, ${JSON.stringify(seed.calc)}, ${JSON.stringify(seed.rank)}, ${now}, ${now})
    ON CONFLICT (id, version, revision) DO NOTHING`

  // 授权码：已有 active 授权码则跳过
  const active = await sql`
    SELECT code FROM license WHERE unit_id = ${unitId} AND status = 'active' AND expires_at > ${now}`
  let code
  if (active.length > 0) {
    code = active[0].code
    console.log(`[${file}] 单位 ${unitId} 已有有效授权码，跳过：${code}`)
  }
  else {
    code = process.env[`SEED_LICENSE_${unitId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] ?? generateLicenseCode()
    const expiresAt = now + 12 * 30 * 86_400_000
    await sql`
      INSERT INTO license (code, unit_id, expires_at, status, renew_count, created_at, updated_at)
      VALUES (${code}, ${unitId}, ${expiresAt}, 'active', 0, ${now}, ${now})
      ON CONFLICT (code) DO NOTHING`
    console.log(`[${file}] 单位 ${unitId} 授权码：${code}（${new Date(expiresAt).toLocaleDateString()} 到期）`)
  }
  console.log(`[${file}] 模板 ${seed.id}@v${seed.version}.${seed.revision} published，单位 ${unitId} 就绪`)
}

await sql.end()
console.log(`完成：${targets.length} 个种子`)
