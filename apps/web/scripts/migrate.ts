/**
 * Applies pending database migrations.
 *   pnpm migrate
 *
 * SQLite also migrates itself the first time the app opens it. PostgreSQL never does: run this
 * before starting the server, again after every `pnpm db:generate`, and after adding or updating a
 * plugin that has tables of its own (the server warns at start while one is waiting).
 */
// Slow DDL (building an index on a big table) must not be cut off by the app's query timeout.
process.env.DB_STATEMENT_TIMEOUT_MS ??= '0'

const { closeDatabase, getDatabase } = await import('../src/db/client')
import { runMigrations } from '../src/db/migrate'
const { migratePlugins } = await import('../src/plugins/storage')

try {
  const database = await getDatabase()
  await runMigrations(database)
  // After the site's own, which create plugin_migrations. A plugin's failure stops here with the reason.
  for (const { plugin, ran } of await migratePlugins(database, { throwOnError: true })) {
    if (ran.length) console.log(`Plugin "${plugin}": ran ${ran.join(', ')}.`)
  }
  console.log(`Migrations are up to date (${database.dialect}).`)
  await closeDatabase()
} catch (error) {
  console.error(error)
  process.exit(1)
}
