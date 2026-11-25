// Applies the SQL files in ./drizzle/<dialect> (created by `pnpm db:generate`).
// A local SQLite file runs this on first connection; PostgreSQL and hosted libSQL run it with
// `pnpm migrate` before the server starts.
import type { Database } from './client'
import { migrationsFolder } from './client'

export async function runMigrations(database: Database): Promise<void> {
  const folder = migrationsFolder(database.dialect)
  if (database.dialect === 'pg') {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    await migrate(database.db as never, { migrationsFolder: folder })
  } else {
    // One batch in one transaction, with foreign keys off while it runs (libSQL's own migrate), so a
    // table rebuild in a migration does not cascade into other tables.
    const { migrate } = await import('drizzle-orm/libsql/migrator')
    await migrate(database.db, { migrationsFolder: folder })
  }
}
