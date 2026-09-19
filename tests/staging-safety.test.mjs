import { describe, it, expect } from 'vitest'
import { databaseIdentity } from '../scripts/lib/staging.mjs'
describe('staging identity safety', () => {
  it('normalizes Supabase direct and pooler connections, even different database paths', () => {
    expect(databaseIdentity('postgresql://postgres:fixture@db.projectone.supabase.co:5432/postgres'))
      .toBe(databaseIdentity('postgres://postgres.projectone:fixture@region.pooler.supabase.com:6543/other'))
  })
  it('distinguishes projects and rejects non-PostgreSQL protocols', () => {
    expect(databaseIdentity('postgres://postgres:fixture@db.projectone.supabase.co/postgres'))
      .not.toBe(databaseIdentity('postgres://postgres:fixture@db.projecttwo.supabase.co/postgres'))
    expect(() => databaseIdentity('https://example.com')).toThrow()
  })
})
