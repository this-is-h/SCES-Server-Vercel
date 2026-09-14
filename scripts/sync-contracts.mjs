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
/** 契约详细文档：权威侧 build 生成 api-contract.md，本仓由其装配 docs/api.md（零改写）。 */
const DOC_SOURCE = 'api-contract.md'
const DOC_TARGET = 'docs/api.md'

/** 从权威 api-contract.md 装配 docs/api.md：保留接口详情原文，替换总则/服务地址为本仓形态，补 Vercel 版差异说明。 */
function buildApiDoc(contractMd) {
  const start = contractMd.indexOf('## 通用约定')
  const indexEnd = contractMd.indexOf('## 接口详情')
  if (start < 0 || indexEnd < 0) throw new Error(`权威文档缺章节：${DOC_SOURCE}`)
  const details = contractMd.slice(indexEnd) // '## 接口详情' 起（含公共数据结构、错误码约定）
  const index = contractMd.slice(start, indexEnd) // 通用约定/鉴权/状态机/服务地址/接口索引

  return `# API 接口文档（详细版）

> **零改写装配**：接口详情逐字取自权威契约文档 SCES-Server/contracts/api-contract.md（由 openapi.yaml 生成，勿手改本文档；契约改动请改 openapi.yaml 后在 SCES-Server 执行 \`pnpm --filter @sces/contracts build\`，再本仓 \`pnpm sync:contracts\` 重新生成）。
> 双仓同改约定：Vercel 版为当前主力开发线；发现契约问题（如字段冗余 unit_type、枚举口径变化）时，直接修改 SCES-Server/contracts 并随同一批变更同步到本仓，两个服务端实现随之对齐。

## 本仓差异说明

| 项 | 权威契约描述 | Vercel 版实际 |
|----|--------------|---------------|
| 服务地址 | http://127.0.0.1:3100（server/web）/ 8787（cloudflare） | 本地 \`http://localhost:3000\`；生产 \`https://sces.thisish.cn\` |
| 架构标识 | \`architecture\` 返回 \`web\` / \`cloudflare\` | 健康检查固定返回 \`web\`（\`server/utils/constants.ts\`） |
| 限流实现 | 平台差异，契约不断言 | 内存固定窗口 60s/30 次，键 (path, IP)：\`POST /authorize\`、\`POST /admin/auth/login\`、\`POST /applies/:id/register\`、\`GET /applies/:id\`（\`server/utils/app.ts\`） |
| 令牌签发 | — | accessToken HS256 15 分钟（\`ACCESS_TOKEN_TTL_MS\`）；refreshToken 30 天仅存哈希 |

${index}${details}`
}

// 归一化 CRLF→LF 后再哈希，避免 Windows 工作树（CRLF）与 CI/git blob（LF）因行尾产生漂移。
const sha256 = (buf) => createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g, '\n')).digest('hex')

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

  // 契约详细文档装配：docs/api.md（零改写取自权威 api-contract.md）
  const contractMdPath = join(source, DOC_SOURCE)
  if (!existsSync(contractMdPath)) {
    console.error(`权威源缺少文件：${relative(root, contractMdPath)}（先在 SCES-Server 执行 contracts build）`)
    process.exit(1)
  }
  writeFileSync(join(root, DOC_TARGET), buildApiDoc(readFileSync(contractMdPath, 'utf8')))

  console.log(`已同步 ${targets.size} 个镜像文件 + ${DOC_TARGET}：${relative(root, source)} -> contracts/ 与 supabase/migrations/`)
}

main()
