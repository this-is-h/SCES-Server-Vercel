// Read-only external preview probe. No account creation, credentials or DB writes.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

export function previewUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' ||
      !/^sces-server-vercel-[a-z0-9-]+\.vercel\.app$/.test(url.hostname)) throw new Error('Only an SCES Vercel preview URL is allowed')
  return url.origin
}

export async function checkPreview(base, fetcher = fetch) {
  const reports = []
  for (const [path, expected, kind] of [
    ['/api/v1/health', 200, 'ok'], ['/api/v1/health/ready', 200, 'ready'],
    ['/api/v1/admin/units', 401, 'unauthorized'], ['/admin/login', 200, 'html'],
  ]) {
    const report = { path, expected }
    try {
      const response = await fetcher(`${base}${path}`, { signal: AbortSignal.timeout(25000), redirect: 'manual' })
      report.status = response.status
      assert.equal(response.status, expected)
      if (kind === 'html') assert.match(await response.text(), /<html/i)
      else {
        const body = await response.json()
        assert.equal(body.ok, expected === 200)
        if (expected === 200) assert.equal(body.data.status, kind)
        assert.equal(response.headers.get('cache-control'), 'no-store')
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
        assert.ok(response.headers.get('x-request-id'))
      }
      report.passed = true
    } catch (error) {
      report.passed = false
      report.error = error.code === 'ERR_ASSERTION' ? 'unexpected status or API contract' : 'network or response parsing error'
      // Response bodies can include runtime diagnostics; never print them.
    }
    reports.push(report)
  }
  return reports
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const base = previewUrl(process.env.PREVIEW_URL ?? process.argv[2])
    const checks = await checkPreview(base)
    console.log(JSON.stringify({ target: base, checks }, null, 2))
    if (checks.some((check) => !check.passed)) process.exitCode = 1
  } catch { console.error('Invalid preview URL'); process.exitCode = 1 }
}
