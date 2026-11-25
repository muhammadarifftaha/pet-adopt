// The one place that knows which database is in use.
//
// DATABASE_URL picks the dialect:
//   postgres://...      -> PostgreSQL
//   file:./pet-adopt.db -> SQLite in a local file (zero setup). The default is data/pet-adopt.db at
//                          the repo root (DEFAULT_SQLITE_URL).
//   libsql://...        -> SQLite hosted by a libSQL server such as Turso (optional; token in
//                          DATABASE_AUTH_TOKEN). https:// and http:// (a local `turso dev`) work too.
// Both SQLite kinds go through @libsql/client, so they share one schema, one set of migrations and
// the same queries.
//
// Drizzle's SQLite and Postgres tables are different TypeScript types, so the repositories are
// written once against the SQLite-typed objects and this file hands them the right ones at runtime.
// Both query builders share the same API (select / insert / update / delete / where / returning),
// and `scripts/check-schemas.ts` plus the dual-database test run guard against the two drifting.
import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

import { sql } from 'drizzle-orm'
import type { Client, InStatement, Transaction } from '@libsql/client'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import { logError } from '@/server/result'

import * as pgSchema from './schema/pg'
import * as sqliteSchema from './schema/sqlite'

export type Dialect = 'sqlite' | 'pg'
export type Schema = typeof sqliteSchema
/** The type every repository is written against (see the note above). */
export type Db = LibSQLDatabase<Schema>

export type TransactionOptions = {
  /**
   * Serialises transactions that use the same name, across processes (PostgreSQL advisory lock).
   * Use it when a rule spans several rows, like "never remove the last admin": without it two
   * transactions can each see the other's row, both pass the check, and both commit. SQLite
   * transactions already run one at a time (see openSqlite), so it ignores this.
   */
  lock?: string
}

export type Database = {
  dialect: Dialect
  /**
   * True for a local SQLite file: its migrations (the site's and plugins') run when it is opened.
   * PostgreSQL and hosted libSQL are shared by every server instance, so they need `pnpm migrate`.
   */
  migratesOnOpen: boolean
  db: Db
  /** The tables for this dialect. */
  t: Schema
  /**
   * Runs `fn` atomically. Everything inside should use the `tx` it is given. A transaction started
   * inside another one joins it.
   *
   * SQLite note: transactions run one at a time per process, and on a local file every other
   * statement waits while one is open. Keep transaction bodies short and free of slow awaits (file
   * or network work belongs outside).
   */
  withTransaction<T>(fn: (tx: Db) => Promise<T>, options?: TransactionOptions): Promise<T>
  close(): Promise<void>
}

// Read at runtime from the project folder, so keep Turbopack from tracing the whole project for it.
const MIGRATIONS_ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd(), 'drizzle')
export const migrationsFolder = (dialect: Dialect) => path.join(MIGRATIONS_ROOT, dialect)

/**
 * Local data lives in data/ at the monorepo root (git-ignored), not inside the app: relative to the
 * app's folder (apps/web), which is the working directory for `next` and the scripts.
 */
export const DEFAULT_SQLITE_URL = 'file:../../data/pet-adopt.db'

export function resolveDatabaseUrl(): { dialect: Dialect; url: string } {
  const url = process.env.DATABASE_URL || DEFAULT_SQLITE_URL
  if (/^postgres(ql)?:\/\//.test(url)) return { dialect: 'pg', url }
  if (/^(file:|sqlite:)/.test(url) || isRemoteSqlite(url) || !url.includes('://')) return { dialect: 'sqlite', url }
  throw new Error(`Unsupported DATABASE_URL "${url.split('@').pop()}". Use postgres://..., file:./path.db or libsql://...`)
}

/** A libSQL server (Turso, or `turso dev` locally) rather than a file. */
const isRemoteSqlite = (url: string) => /^(libsql|https?|wss?):\/\//.test(url)

const isBuildPhase = () => process.env.NEXT_PHASE === 'phase-production-build'

/** How long a statement waits for another process's write lock, or for this process's open transaction (ms). */
const BUSY_TIMEOUT_MS = 5000

/**
 * A shared/exclusive gate for one local SQLite file. Plain statements share it; a transaction takes
 * it alone. Why: libSQL's local driver is synchronous. If a statement from another request needed
 * the write lock while a transaction held it, it would busy-wait inside native code, blocking the
 * event loop, so the transaction could never reach its COMMIT. Waiting here is asynchronous instead.
 * A waiting transaction goes before new statements, so a steady stream of reads cannot starve it.
 */
class Gate {
  private shared = 0
  private exclusive = false
  private exclusiveWaiting = 0
  private waiters: Array<() => void> = []

  constructor(private readonly timeoutMs: number) {}

  /**
   * Waits for a wake-up, but never past `deadline`. Without a limit, code inside a transaction that
   * awaits a promise another request started (a shared cache, say) would wait for that request,
   * which waits for the transaction: forever. Giving up turns that into an error, as SQLite's own
   * busy timeout does.
   */
  private wait(deadline: number) {
    return new Promise<void>((resolve, reject) => {
      const ms = deadline - Date.now()
      if (ms <= 0) return reject(busyError(this.timeoutMs))
      const wake = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== wake)
        reject(busyError(this.timeoutMs))
      }, ms)
      this.waiters.push(wake)
    })
  }

  private wake() {
    const waiters = this.waiters
    this.waiters = []
    for (const resolve of waiters) resolve()
  }

  async share<T>(fn: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + this.timeoutMs
    while (this.exclusive || this.exclusiveWaiting > 0) await this.wait(deadline)
    this.shared++
    try {
      return await fn()
    } finally {
      if (--this.shared === 0) this.wake()
    }
  }

  async alone<T>(fn: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + this.timeoutMs
    this.exclusiveWaiting++
    try {
      while (this.exclusive || this.shared > 0) await this.wait(deadline)
    } catch (error) {
      // Gave up: statements held back for this transaction may go now.
      this.exclusiveWaiting--
      this.wake()
      throw error
    }
    this.exclusiveWaiting--
    this.exclusive = true
    try {
      return await fn()
    } finally {
      this.exclusive = false
      this.wake()
    }
  }
}

/** Same code SQLite gives a statement that waited too long for a lock. */
const busyError = (ms: number) =>
  Object.assign(new Error(`The database is busy: waited ${ms / 1000} s for another transaction to finish.`), { code: 'SQLITE_BUSY' })

async function openSqlite(url: string): Promise<Database> {
  const [{ createClient }, { drizzle }] = await Promise.all([import('@libsql/client'), import('drizzle-orm/libsql')])
  const remote = isRemoteSqlite(url)

  let clientUrl = url
  if (!remote) {
    const file = path.resolve(/* turbopackIgnore: true */ process.cwd(), url.replace(/^(sqlite:\/\/|sqlite:|file:)/, ''))
    if (isBuildPhase()) {
      // `next build` must not create an empty database file (or its folder) as a side effect, and
      // libSQL creates a missing file on open. Same code the old driver reported, for the fallback.
      if (!existsSync(file)) throw Object.assign(new Error(`SQLite database ${file} does not exist`), { code: 'SQLITE_CANTOPEN' })
    } else {
      mkdirSync(path.dirname(file), { recursive: true })
    }
    clientUrl = `file:${file}`
  }

  const raw = createClient({
    url: clientUrl,
    authToken: remote ? process.env.DATABASE_AUTH_TOKEN || undefined : undefined,
    timeout: remote ? undefined : BUSY_TIMEOUT_MS,
  })
  try {
    // WAL lets readers carry on while one connection writes. It is stored in the file, so once is
    // enough; a hosted database manages its own journal. Skipped by the build, which only reads.
    if (!remote && !isBuildPhase()) await raw.execute('PRAGMA journal_mode = WAL')
    // The schema relies on foreign keys (cascade, restrict). libSQL enables them on every connection
    // by default; refuse to run on a server where they are off rather than lose data quietly.
    const { rows } = await raw.execute('PRAGMA foreign_keys')
    if (Number(Object.values(rows[0] ?? {})[0]) !== 1) {
      throw new Error('This SQLite database does not enforce foreign keys (PRAGMA foreign_keys is off), which the site relies on.')
    }
  } catch (error) {
    raw.close()
    throw error
  }

  // The open transaction of the current async context (see withTransaction).
  const current = new AsyncLocalStorage<Transaction>()
  const openTransaction = () => {
    const tx = current.getStore()
    return tx && !tx.closed ? tx : undefined
  }
  const gate = new Gate(BUSY_TIMEOUT_MS)
  // Statements made while a transaction is open in this async context join it, as nested
  // withTransaction calls do. Anything else waits its turn on a local file (see Gate); a hosted
  // database queues writers itself, so there they run straight away.
  const outside = <T>(fn: () => Promise<T>) => (remote ? fn() : gate.share(fn))
  const client = new Proxy(raw, {
    get(target, prop, receiver) {
      if (prop === 'execute') {
        return (stmt: InStatement | string, args?: never) => {
          const statement = (typeof stmt === 'string' ? { sql: stmt, args: args ?? [] } : stmt) as InStatement
          const tx = openTransaction()
          return tx ? tx.execute(statement) : outside(() => target.execute(statement))
        }
      }
      if (prop === 'batch') {
        return (stmts: InStatement[], mode?: 'write' | 'read' | 'deferred') => {
          const tx = openTransaction()
          return tx ? tx.batch(stmts) : outside(() => target.batch(stmts, mode))
        }
      }
      if (prop === 'migrate') {
        return (stmts: InStatement[]) => {
          // Migrations need their own transaction (with foreign keys off), so they cannot join one,
          // and waiting for the open one would wait for ourselves.
          if (openTransaction()) return Promise.reject(new Error('Migrations cannot run inside a transaction.'))
          return outside(() => target.migrate(stmts))
        }
      }
      if (prop === 'transaction') {
        return () => {
          throw new Error('Use withTransaction() from src/db/client.ts, not db.transaction(), on SQLite.')
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as Client
  const db = drizzle(client, { schema: sqliteSchema })

  // Transactions take turns in this process, on a local file and on a hosted database alike.
  const queue = new Gate(BUSY_TIMEOUT_MS)
  const withTransaction = <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
    // Already inside a transaction (this call is part of its work): join it. Queueing behind
    // ourselves would wait for a transaction that is waiting for us.
    if (openTransaction()) return fn(db)
    const run = async () => {
      const tx = await raw.transaction('write')
      try {
        // `db` routes every statement made in this async context into `tx`, so code that is handed
        // `tx` and code that reaches for the database itself both take part.
        const result = await current.run(tx, () => fn(db))
        await tx.commit()
        return result
      } catch (error) {
        try {
          await tx.rollback()
        } catch {
          // The transaction already ended (for example a failed COMMIT). Report the original error.
        }
        throw error
      } finally {
        tx.close()
      }
    }
    return queue.alone(() => (remote ? run() : gate.alone(run)))
  }

  return {
    dialect: 'sqlite',
    migratesOnOpen: !remote,
    db,
    t: sqliteSchema,
    withTransaction,
    close: async () => {
      raw.close()
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
    migratesOnOpen: false,
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
 * Opens the database once per process. A local SQLite file also applies pending migrations (the
 * site's, then plugins') on first use.
 *
 * In development the connection outlives hot reloads, but a reload can bring a changed schema
 * module (a new column). The cached tables would then be stale and Drizzle fails on the new column
 * ("Cannot convert undefined or null to object"). So the tables are re-bound to the current module
 * when it changes, and a local SQLite file applies any new migrations then too. In production the module never
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
      if (rebound.migratesOnOpen && !isBuildPhase()) {
        const { runMigrations } = await import('./migrate')
        await runMigrations(rebound)
        await migratePluginsQuietly(rebound)
      }
      return rebound
    })()
  }
  return holder.promise!
}

/**
 * A local SQLite file: plugins' own migrations run right after the site's, as the site's do. A plugin that fails
 * is logged and shown as not ready in the admin; it never stops the site from opening its database.
 * (Must not call getDatabase: the database is still being opened.)
 */
async function migratePluginsQuietly(database: Database) {
  try {
    const { migratePlugins } = await import('@/plugins/storage')
    await migratePlugins(database)
  } catch (error) {
    logError(error, 'Could not set up plugin tables')
  }
}

function openOnce(): Promise<Database> {
  holder.promise ??= (async () => {
    const { dialect, url } = resolveDatabaseUrl()
    const database = dialect === 'pg' ? await openPostgres(url) : await openSqlite(url)
    if (database.migratesOnOpen && !isBuildPhase()) {
      try {
        const { runMigrations } = await import('./migrate')
        await runMigrations(database)
      } catch (error) {
        // Don't leave the file open: the next call opens it again, and they would pile up.
        await database.close().catch(() => undefined)
        throw error
      }
      await migratePluginsQuietly(database)
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
