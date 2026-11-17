/**
 * Applies pending database migrations.
 *   pnpm migrate
 *
 * SQLite also migrates itself the first time the app opens it. PostgreSQL never does: run this
 * before starting the server, and again after every `pnpm db:generate`.
 */
// Slow DDL (building an index on a big table) must not be cut off by the app's query timeout.
process.env.DB_STATEMENT_TIMEOUT_MS ??= '0'

const { closeDatabase, getDatabase } = await import('../src/db/client')
import { runMigrations } from '../src/db/migrate'

try {
  const database = await getDatabase()
  await runMigrations(database)
  console.log(`Migrations are up to date (${database.dialect}).`)
  await closeDatabase()
} catch (error) {
  console.error(error)
  process.exit(1)
}
