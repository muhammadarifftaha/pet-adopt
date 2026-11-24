// Applies the SQL files in ./drizzle/<dialect> (created by `pnpm db:generate`).
// SQLite runs this on first connection; Postgres runs it with `pnpm migrate` before the server starts.
import type { Database } from './client'
import { migrationsFolder } from './client'

export async function runMigrations(database: Database): Promise<void> {
  const folder = migrationsFolder(database.dialect)
  if (database.dialect === 'pg') {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    await migrate(database.db as never, { migrationsFolder: folder })
  } else {
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
    migrate(database.db, { migrationsFolder: folder })
  }
}
