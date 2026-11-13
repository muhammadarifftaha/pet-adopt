// The one place that knows which database is in use.
//
// DATABASE_URL picks the dialect:
//   postgres://...      -> PostgreSQL (production)
//   file:./pet-adopt.db -> SQLite (zero-setup local development, the default)
//
// Drizzle's SQLite and Postgres tables are different TypeScript types, so the repositories are
// written once against the SQLite-typed objects and this file hands them the right ones at runtime.
// Both query builders share the same API (select / insert / update / delete / where / returning),
// and `scripts/check-schemas.ts` plus the dual-database test run guard against the two drifting.
import path from 'node:path'

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import * as pgSchema from './schema/pg'
import * as sqliteSchema from './schema/sqlite'

export type Dialect = 'sqlite' | 'pg'
export type Schema = typeof sqliteSchema
/** The type every repository is written against (see the note above). */
export type Db = BetterSQLite3Database<Schema>

export type Database = {
  dialect: Dialect
  db: Db
  /** The tables for this dialect. */
  t: Schema
  /** Runs `fn` atomically. Everything inside must use the `tx` it is given. */
  withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>
  close(): Promise<void>
}

// Read at runtime from the project folder, so keep Turbopack from tracing the whole project for it.
const MIGRATIONS_ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd(), 'drizzle')
export const migrationsFolder = (dialect: Dialect) => path.join(MIGRATIONS_ROOT, dialect)

export function resolveDatabaseUrl(): { dialect: Dialect; url: string } {
  const url = process.env.DATABASE_URL || 'file:./pet-adopt.db'
  if (/^postgres(ql)?:\/\//.test(url)) return { dialect: 'pg', url }
  if (/^(file:|sqlite:)/.test(url) || !url.includes('://')) return { dialect: 'sqlite', url }
  throw new Error(`Unsupported DATABASE_URL "${url.split('@').pop()}". Use postgres://... or file:./path.db`)
}

const isBuildPhase = () => process.env.NEXT_PHASE === 'phase-production-build'

async function openSqlite(url: string): Promise<Database> {
  const [{ default: BetterSqlite3 }, { drizzle }] = await Promise.all([
    import('better-sqlite3'),
    import('drizzle-orm/better-sqlite3'),
  ])
  const file = path.resolve(/* turbopackIgnore: true */ process.cwd(), url.replace(/^(sqlite:\/\/|sqlite:|file:)/, ''))
  // `next build` must not create an empty database file as a side effect.
  const client = new BetterSqlite3(file, { fileMustExist: isBuildPhase() })
  client.pragma('journal_mode = WAL')
  // SQLite ignores foreign keys unless asked; the schema relies on them (cascade, restrict).
  client.pragma('foreign_keys = ON')
  client.pragma('busy_timeout = 5000')
  const db = drizzle(client, { schema: sqliteSchema })

  // One connection serves every request, so transactions take turns instead of interleaving.
  let queue: Promise<unknown> = Promise.resolve()
  const withTransaction = <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
    const run = async () => {
      client.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn(db)
        client.exec('COMMIT')
        return result
      } catch (error) {
        client.exec('ROLLBACK')
        throw error
      }
    }
    const next = queue.then(run, run)
    queue = next.catch(() => undefined)
    return next
  }

  return {
    dialect: 'sqlite',
    db,
    t: sqliteSchema,
    withTransaction,
    close: async () => {
      client.close()
    },
  }
}

async function openPostgres(url: string): Promise<Database> {
  const [{ Pool }, { drizzle }] = await Promise.all([import('pg'), import('drizzle-orm/node-postgres')])
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX) || 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
  const db = drizzle(pool, { schema: pgSchema })
  return {
    dialect: 'pg',
    db: db as unknown as Db,
    t: pgSchema as unknown as Schema,
    withTransaction: (fn) => db.transaction((tx) => fn(tx as unknown as Db)),
    close: () => pool.end(),
  }
}

type Holder = { promise?: Promise<Database> }
// Kept on globalThis so hot reloads in development reuse the connection.
const holder = ((globalThis as { __petAdoptDb?: Holder }).__petAdoptDb ??= {})

/** Opens the database once per process. SQLite also applies pending migrations on first use. */
export function getDatabase(): Promise<Database> {
  holder.promise ??= (async () => {
    const { dialect, url } = resolveDatabaseUrl()
    const database = dialect === 'pg' ? await openPostgres(url) : await openSqlite(url)
    if (dialect === 'sqlite' && !isBuildPhase()) {
      const { runMigrations } = await import('./migrate')
      await runMigrations(database)
    }
    return database
  })().catch((error) => {
    holder.promise = undefined // let the next call try again
    throw error
  })
  return holder.promise
}

export async function closeDatabase() {
  const current = holder.promise
  holder.promise = undefined
  if (current) await (await current).close()
}
