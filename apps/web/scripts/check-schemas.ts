/**
 * Fails when the SQLite and Postgres schemas disagree about tables or columns.
 *   pnpm check:schemas
 *
 * The repositories are written once and run on both databases, so the two schema files must stay
 * twins: same tables, same column names, same nullability. (Column *types* differ on purpose.)
 * Plugins' own tables get the same check when the plugin registry loads.
 */
import { compareTables, sqliteShapes } from '../src/db/compare-tables'
import * as pg from '../src/db/schema/pg'
import * as sqlite from '../src/db/schema/sqlite'

const problems = compareTables(sqlite, pg)
if (problems.length) {
  console.error(`The schemas have drifted:\n - ${problems.join('\n - ')}`)
  process.exit(1)
}
console.log(`Schemas match (${sqliteShapes(sqlite).size} tables).`)
