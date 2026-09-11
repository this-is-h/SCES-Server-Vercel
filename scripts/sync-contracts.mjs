#!/usr/bin/env node
// ---------------------------------------------------------------------------
// 契约快照同步（受控镜像，模式同 SCES-Server seed-sources → seed 的单向快照）
//
// 权威源：SCES-Server/contracts（可用环境变量 SCES_CONTRACTS_SOURCE 覆盖）。
// 产物（均勿手改，check:contracts 逐字节把关）：
//   contracts/          本仓镜像：openapi.yaml / unit-config.schema.json /
//                       schema-web.sql / schema-d1.sql / seed/*.json
//   supabase/migrations/0001_init.sql
//                       schema-web.sql 的逐字节副本（建库 DDL 的 Supabase 载体）
//   scripts/contracts-manifest.json
//                       每个镜像文件的 sha256 清单（check:contracts 校验基准）
// ---------------------------------------------------------------------------
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(process.env.SCES_CONTRACTS_SOURCE ?? join(root, '..', 'SCES-Server', 'contracts'))

const FILE_MIRRORS = ['openapi.yaml', 'unit-config.schema.json', 'schema-web.sql', 'schema-d1.sql']
/** 运行时镜像：unit-config schema 需要被 server/ 打包（Nitro 不打 repo 内 contracts/）。 */
const RUNTIME_MIRRORS = [{ from: 'unit-config.schema.json', to: 'server/utils/schemas/unit-config.schema.json' }]
const SEED_MIRROR = 'seed'
const MIGRATION_MIRROR = { from: 'schema-web.sql', to: 'supabase/migrations/0001_init.sql' }

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function collectTargets() {
  const targets = new Map() // 目标相对路径 -> 源绝对路径
  for (const file of FILE_MIRRORS) {
    targets.set(join('contracts', file), join(source, file))
  }
  const seedDir = join(source, SEED_MIRROR)
  if (!existsSync(seedDir)) {
    throw new Error(`种子目录缺失：${seedDir}`)
  }
  for (const name of readdirSync(seedDir)) {
    if (!name.endsWith('.json')) continue
    targets.set(join('contracts', SEED_MIRROR, name), join(seedDir, name))
  }
  for (const mirror of RUNTIME_MIRRORS) {
    targets.set(mirror.to, join(source, mirror.from))
  }
  targets.set(MIGRATION_MIRROR.to, join(source, MIGRATION_MIRROR.from))
  return targets
}

function main() {
  if (!existsSync(source)) {
    console.error(`权威源不存在：${source}`)
    console.error('用 SCES_CONTRACTS_SOURCE 指向 SCES-Server/contracts 后重试。')
    process.exit(1)
  }

  const targets = collectTargets()
  const manifest = {}
  const missing = []

  for (const [relPath, absPath] of targets) {
    if (!existsSync(absPath)) {
      missing.push(relative(root, absPath))
      continue
    }
    const buf = readFileSync(absPath)
    const out = join(root, relPath)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, buf)
    manifest[relPath.replaceAll('\\', '/')] = sha256(buf)
  }

  if (missing.length > 0) {
    console.error('权威源缺少文件：')
    for (const m of missing) console.error(`  - ${m}`)
    process.exit(1)
  }

  writeFileSync(
    join(root, 'scripts/contracts-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )

  console.log(`已同步 ${targets.size} 个文件：${relative(root, source)} -> contracts/ 与 supabase/migrations/`)
}

main()
