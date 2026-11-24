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
import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'

import { sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import { logError } from '@/server/result'

import * as pgSchema from './schema/pg'
import * as sqliteSchema from './schema/sqlite'

export type Dialect = 'sqlite' | 'pg'
export type Schema = typeof sqliteSchema
/** The type every repository is written against (see the note above). */
export type Db = BetterSQLite3Database<Schema>

export type TransactionOptions = {
  /**
   * Serialises transactions that use the same name, across processes (PostgreSQL advisory lock).
   * Use it when a rule spans several rows, like "never remove the last admin": without it two
   * transactions can each see the other's row, both pass the check, and both commit. SQLite already
   * runs transactions one at a time, so it ignores this.
   */
  lock?: string
}

export type Database = {
  dialect: Dialect
  db: Db
  /** The tables for this dialect. */
  t: Schema
  /**
   * Runs `fn` atomically. Everything inside must use the `tx` it is given. A transaction started
   * inside another one joins it.
   *
   * SQLite note: there is a single connection, so while a transaction is open a statement from an
   * unrelated request can run inside it (and would be rolled back with it). Keep transaction bodies
   * short and free of slow awaits (file or network work belongs outside).
   */
  withTransaction<T>(fn: (tx: Db) => Promise<T>, options?: TransactionOptions): Promise<T>
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
  // SQLite's built-in lower() only folds ASCII, so a search for "île" would never match "Île-de-France".
  // PostgreSQL folds every letter. Replace it with the same behaviour here, so `lower(col) like ...`
  // in the shared queries means the same thing on both databases.
  client.function('lower', { deterministic: true }, (value) => (typeof value === 'string' ? value.toLowerCase() : value))
  const db = drizzle(client, { schema: sqliteSchema })

  // One connection serves every request, so transactions take turns instead of interleaving.
  const insideTransaction = new AsyncLocalStorage<true>()
  let queue: Promise<unknown> = Promise.resolve()
  const withTransaction = <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
    // Already inside a transaction (this call is part of its work): join it. Queueing behind
    // ourselves would wait for a transaction that is waiting for us.
    if (insideTransaction.getStore()) return fn(db)

    const run = () =>
      insideTransaction.run(true, async () => {
        client.exec('BEGIN IMMEDIATE')
        try {
          const result = await fn(db)
          client.exec('COMMIT')
          return result
        } catch (error) {
          try {
            client.exec('ROLLBACK')
          } catch {
            // SQLite already ended the transaction (for example a failed COMMIT). Report the original error.
          }
          throw error
        }
      })
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
  // A query that runs longer than this is cancelled by the server, so one stuck statement cannot
  // hold a pooled connection forever. 0 turns it off (the migrate script does, for slow DDL).
  const statementTimeout = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 15_000) || 0
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX) || 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: statementTimeout || undefined,
    query_timeout: statementTimeout ? statementTimeout + 5_000 : undefined,
    idle_in_transaction_session_timeout: 30_000,
    application_name: 'pet-adopt',
  })
  // An idle connection can be dropped at any time (database restart, failover, a proxy's idle
  // timeout). The pool reports that as an 'error' event; with no listener Node treats it as an
  // uncaught exception and the whole server exits. The pool discards the dead connection itself.
  pool.on('error', (error) => logError(error, 'postgres pool'))
  const db = drizzle(pool, { schema: pgSchema })
  return {
    dialect: 'pg',
    db: db as unknown as Db,
    t: pgSchema as unknown as Schema,
    withTransaction: (fn, options) =>
      db.transaction(async (tx) => {
        if (options?.lock) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${options.lock}))`)
        return fn(tx as unknown as Db)
      }),
    close: () => pool.end(),
  }
}

type Holder = { promise?: Promise<Database>; reboundTo?: Schema }
// Kept on globalThis so hot reloads in development reuse the connection.
const holder = ((globalThis as { __petAdoptDb?: Holder }).__petAdoptDb ??= {})

const tablesFor = (dialect: Dialect): Schema => (dialect === 'pg' ? (pgSchema as unknown as Schema) : sqliteSchema)

/**
 * Opens the database once per process. SQLite also applies pending migrations on first use.
 *
 * In development the connection outlives hot reloads, but a reload can bring a changed schema
 * module (a new column). The cached tables would then be stale and Drizzle fails on the new column
 * ("Cannot convert undefined or null to object"). So the tables are re-bound to the current module
 * when it changes, and SQLite applies any new migrations then too. In production the module never
 * changes, so this is one identity check.
 */
export async function getDatabase(): Promise<Database> {
  const database = await openOnce()
  const t = tablesFor(database.dialect)
  if (database.t === t) return database
  // Synchronous after the await, so concurrent callers start one re-bind, not several.
  if (holder.reboundTo !== t) {
    holder.reboundTo = t
    const rebound: Database = { ...database, t }
    holder.promise = (async () => {
      if (rebound.dialect === 'sqlite' && !isBuildPhase()) {
        const { runMigrations } = await import('./migrate')
        await runMigrations(rebound)
      }
      return rebound
    })()
  }
  return holder.promise!
}

function openOnce(): Promise<Database> {
  holder.promise ??= (async () => {
    const { dialect, url } = resolveDatabaseUrl()
    const database = dialect === 'pg' ? await openPostgres(url) : await openSqlite(url)
    if (dialect === 'sqlite' && !isBuildPhase()) {
      try {
        const { runMigrations } = await import('./migrate')
        await runMigrations(database)
      } catch (error) {
        // Don't leave the file open: the next call opens it again, and they would pile up.
        await database.close().catch(() => undefined)
        throw error
      }
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
