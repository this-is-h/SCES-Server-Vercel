#!/usr/bin/env node
// ---------------------------------------------------------------------------
// 契约快照比对（挂 verify / pre-push）
//
// 断言：
//   1. 镜像文件（contracts/、supabase/migrations/0001_init.sql）与清单 sha256
//      一致 —— 检出"勿手改"被破坏（手改或缺失）。
//   2. 权威源可访问时（本地开发，SCES_SERVER_CONTRACTS_SOURCE 或默认兄弟目录），
//      与权威源逐字节一致 —— 检出"改了 SCES-Server 但忘了 sync"。
//   3. 迁移镜像 == schema-web.sql（由 2/1 共同推出，无需单独断言）。
// ---------------------------------------------------------------------------
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(process.env.SCES_CONTRACTS_SOURCE ?? join(root, '..', 'SCES-Server', 'contracts'))
const manifestPath = join(root, 'scripts/contracts-manifest.json')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const toPosix = (p) => p.replaceAll('\\', '/')

function fail(relPath, reason) {
  console.error(`契约镜像不一致：${relPath} — ${reason}`)
  process.exitCode = 1
}

function main() {
  if (!existsSync(manifestPath)) {
    console.error(`清单缺失：${manifestPath}，先运行 pnpm sync:contracts。`)
    process.exit(1)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const sourceAvailable = existsSync(source)

  for (const [relPath, expectedSha] of Object.entries(manifest)) {
    const file = join(root, relPath)
    if (!existsSync(file)) {
      fail(relPath, '文件缺失')
      continue
    }
    const diskSha = sha256(readFileSync(file))
    if (diskSha !== expectedSha) {
      fail(relPath, '与清单不一致（镜像被手改，勿手改：请 pnpm sync:contracts 恢复）')
      continue
    }
    if (sourceAvailable) {
      const sourceName =
        relPath.startsWith('contracts/')
          ? relPath.slice('contracts/'.length)
          : relPath === 'supabase/migrations/0001_init.sql'
            ? 'schema-web.sql'
            : relPath === 'server/utils/schemas/unit-config.schema.json'
              ? 'unit-config.schema.json'
              : undefined
      const srcFile = sourceName === undefined ? '' : join(source, sourceName)
      if (srcFile && existsSync(srcFile)) {
        const srcSha = sha256(readFileSync(srcFile))
        if (srcSha !== expectedSha) {
          fail(relPath, '与权威源不一致（源已更新：请 pnpm sync:contracts 重新同步）')
        }
      }
    }
  }

  const count = Object.keys(manifest).length
  if (process.exitCode) {
    console.error(`契约比对未通过（${count} 个镜像文件）。`)
  } else {
    console.log(`契约比对通过（${count} 个镜像文件${sourceAvailable ? '，权威源已核' : ''}）。`)
  }
}

main()
