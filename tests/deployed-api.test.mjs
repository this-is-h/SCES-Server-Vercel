import { describe, it, expect } from 'vitest'
import { previewUrl, checkPreview } from '../scripts/check-deployed-api.mjs'

describe('external preview acceptance', () => {
  it('rejects production, credentials, non-HTTPS and unrelated targets', () => {
    for (const value of ['https://sces.thisish.cn', 'http://localhost', 'https://example.vercel.app',
      'https://secret@sces-server-vercel-abc.vercel.app', 'https://sces-server-vercel-abc.vercel.app?secret=x']) {
      expect(() => previewUrl(value)).toThrow()
    }
    expect(previewUrl('https://sces-server-vercel-abc.vercel.app')).toBe('https://sces-server-vercel-abc.vercel.app')
  })
  it('does not count deployment READY as database readiness, and reports all probes', async () => {
    const results = await checkPreview('https://sces-server-vercel-test.vercel.app', async () => new Response('blocked', { status: 503 }))
    expect(results).toHaveLength(4)
    expect(results.every((row) => row.status === 503 && row.passed === false)).toBe(true)
  })
})
