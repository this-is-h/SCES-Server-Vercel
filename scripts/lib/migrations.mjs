/** One transaction keeps the advisory lock attached to the transaction-pool
 * connection. DDL and the version ledger commit or roll back together. */
export async function applyMigrations(db, migrations) {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('sces-schema-migrations'))")
    await tx.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT NOT NULL PRIMARY KEY, applied_at BIGINT NOT NULL
    )`)
    // Repair the historical bootstrap script's INTEGER timestamp column.
    await tx.exec('ALTER TABLE schema_migrations ALTER COLUMN applied_at TYPE BIGINT')
    const applied = new Set((await tx.query('SELECT version FROM schema_migrations')).map((row) => row.version))
    const result = []
    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        result.push({ name: migration.name, status: 'skipped' })
        continue
      }
      await tx.exec(migration.sql)
      await tx.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', [migration.name, Date.now()])
      result.push({ name: migration.name, status: 'applied' })
    }
    return result
  })
}
