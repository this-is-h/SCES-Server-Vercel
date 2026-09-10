// 从 .env 读 VERCEL_TOKEN 透传给本地安装的 vercel CLI
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
function readDotEnv(key) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '')
  }
  return undefined
}
const token = readDotEnv('VERCEL_TOKEN')
if (!token) { console.error('.env 缺少 VERCEL_TOKEN'); process.exit(1) }
const result = spawnSync('pnpm', ['exec', 'vercel', ...process.argv.slice(2)], {
  stdio: 'inherit', shell: true,
  env: { ...process.env, VERCEL_TOKEN: token },
})
process.exit(result.status ?? 1)
