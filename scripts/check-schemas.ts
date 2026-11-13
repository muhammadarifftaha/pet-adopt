/**
 * Fails when the SQLite and Postgres schemas disagree about tables or columns.
 *   pnpm check:schemas
 *
 * The repositories are written once and run on both databases, so the two schema files must stay
 * twins: same tables, same column names, same nullability. (Column *types* differ on purpose.)
 */
import { getTableColumns, getTableName, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import { SQLiteTable } from 'drizzle-orm/sqlite-core'

import * as pg from '../src/db/schema/pg'
import * as sqlite from '../src/db/schema/sqlite'

const describe = (tables: Record<string, unknown>, kind: typeof PgTable | typeof SQLiteTable) =>
  new Map(
    Object.values(tables)
      .filter((t) => is(t, kind))
      .map((t) => {
        const table = t as PgTable | SQLiteTable
        const columns = Object.values(getTableColumns(table)).map(
          (c) => `${c.name}${c.notNull ? '!' : '?'}${c.primary ? ' pk' : ''}`,
        )
        return [getTableName(table), new Set(columns)] as const
      }),
  )

const a = describe(sqlite, SQLiteTable)
const b = describe(pg, PgTable)
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

if (problems.length) {
  console.error(`The schemas have drifted:\n - ${problems.join('\n - ')}`)
  process.exit(1)
}
console.log(`Schemas match (${a.size} tables).`)
