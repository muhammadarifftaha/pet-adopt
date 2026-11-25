/**
 * Applies pending database migrations.
 *   pnpm migrate
 *
 * A local SQLite file also migrates itself the first time the app opens it. PostgreSQL and hosted
 * libSQL (Turso) never do, because several servers can share them: run this before starting the
 * server, again after every `pnpm db:generate`, and after adding or updating a plugin that has
 * tables of its own (the server warns at start while one is waiting). `pnpm build` runs it too, for
 * PostgreSQL and hosted libSQL (see migrate-on-build.ts).
 */
import { describeError } from '../src/server/result'
import { migrateAll } from './migrate-all'

try {
  await migrateAll()
} catch (error) {
  // Never the error object: database errors carry the bound values (records, emails).
  console.error(`Migration failed: ${describeError(error)}`)
  process.exit(1)
}
