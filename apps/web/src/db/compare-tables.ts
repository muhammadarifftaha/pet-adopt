// Compares a set of SQLite tables with its Postgres twin: same tables, same column names, same
// nullability (column *types* differ on purpose). Used by `pnpm check:schemas` for the core schema
// and by the plugin registry for each plugin's own tables.
import { getTableColumns, getTableName, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import { SQLiteTable } from 'drizzle-orm/sqlite-core'

export type TableShapes = Map<string, Set<string>>

function describe(tables: Record<string, unknown>, kind: typeof PgTable | typeof SQLiteTable): TableShapes {
  return new Map(
    Object.values(tables)
      .filter((t) => is(t, kind))
      .map((t) => {
        const table = t as PgTable | SQLiteTable
        const columns = Object.values(getTableColumns(table)).map((c) => `${c.name}${c.notNull ? '!' : '?'}${c.primary ? ' pk' : ''}`)
        return [getTableName(table), new Set(columns)] as const
      }),
  )
}

export const sqliteShapes = (tables: Record<string, unknown>) => describe(tables, SQLiteTable)
export const pgShapes = (tables: Record<string, unknown>) => describe(tables, PgTable)

/** Every difference between the two, as one sentence each. Empty when they are twins. */
export function compareTables(sqliteTables: Record<string, unknown>, pgTables: Record<string, unknown>): string[] {
  const a = sqliteShapes(sqliteTables)
  const b = pgShapes(pgTables)
  const problems: string[] = []
  for (const name of new Set([...a.keys(), ...b.keys()])) {
    const left = a.get(name)
    const right = b.get(name)
    if (!left || !right) {
      problems.push(`Table "${name}" exists only in ${left ? 'sqlite' : 'pg'}.`)
      continue
    }
    for (const column of left) if (!right.has(column)) problems.push(`${name}: "${column}" is in sqlite but not in pg.`)
    for (const column of right) if (!left.has(column)) problems.push(`${name}: "${column}" is in pg but not in sqlite.`)
  }
  return problems
}
