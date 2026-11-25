// Plugins' own tables at runtime: are they set up, set them up, and open them.
//
//   pnpm migrate           applies every plugin's pending migrations (after the site's own).
//   a local SQLite file    also applies them when the app opens the database, like the site's own.
//   PostgreSQL, Turso      never on their own: until `pnpm migrate` runs, the server warns at start and
//                          the plugin's admin screens show a notice in place of the screen.
//
// Server-only. The registry is imported lazily (it imports the plugins). Loading this module
// registers the storage provider that a plugin's `storage.open()` (from @pet-adopt/plugin-sdk) goes
// through; instrumentation.ts and registry.ts load it, so it is in place before any plugin code runs.
import { getDatabase, type Database, type Db } from '@/db/client'
import { applyPluginMigrations, pluginMigrationStates } from '@/db/plugin-migrations'
import { describeError, UserError } from '@/server/result'

import { provideStorage, type PluginStorage } from '@pet-adopt/plugin-sdk'

export type PluginStorageStatus = {
  plugin: string
  title: string
  ready: boolean
  /** Migrations that have not run yet. */
  pending: string[]
  /** What the owner should do, in one or two sentences; null when ready. */
  problem: string | null
}

const registry = () => import('./registry')

/** The last error per plugin from applying its migrations on start (local SQLite file), so the status can say why. */
const applyErrors = new Map<string, string>()

/**
 * Applies pending plugin migrations. `pnpm migrate` passes `throwOnError` so a failure stops it with
 * the reason; on a local SQLite file's automatic run a failing plugin is logged and left not ready, and the rest
 * of the site keeps working.
 */
export async function migratePlugins(
  database: Database,
  opts: { throwOnError?: boolean } = {},
): Promise<Array<{ plugin: string; ran: string[] }>> {
  const sets = (await registry()).getPluginMigrationSets()
  const results: Array<{ plugin: string; ran: string[] }> = []
  for (const set of sets) {
    try {
      results.push({ plugin: set.plugin, ran: await applyPluginMigrations(database, set) })
      applyErrors.delete(set.plugin)
    } catch (error) {
      if (opts.throwOnError) throw error
      // describeError: a failed query must not print its bound values.
      applyErrors.set(set.plugin, describeError(error))
      console.error(`Plugin "${set.plugin}": could not set up its tables: ${describeError(error)}`)
    }
  }
  cache = undefined
  return results
}

let cache: { at: number; statuses: PluginStorageStatus[] } | undefined
/** Not-ready answers are re-checked this often, so the notice clears soon after `pnpm migrate`. */
const RECHECK_MS = 5_000

/** Every plugin that has tables, and whether they are set up. Cached: ready stays ready. */
export async function getPluginStorageStatus(): Promise<PluginStorageStatus[]> {
  if (cache && (cache.statuses.every((s) => s.ready) || Date.now() - cache.at < RECHECK_MS)) return cache.statuses
  const sets = (await registry()).getPluginMigrationSets()
  if (!sets.length) return (cache = { at: Date.now(), statuses: [] }).statuses

  const database = await getDatabase()
  const states = await pluginMigrationStates(database, sets)
  const statuses = sets.map((set, i): PluginStorageStatus => {
    const state = states[i]
    const failed = applyErrors.get(set.plugin)
    let problem: string | null = null
    if (state.changed.length) {
      problem = `Its migration ${state.changed.join(', ')} was changed after it ran, so it will not run again. Reinstall the plugin version that matches this database, or ask its author.`
    } else if (failed) {
      problem = `Setting up its tables failed: ${failed}`
    } else if (state.pending.length) {
      const n = state.pending.length
      problem = `Its tables are not set up yet: run \`pnpm migrate\` (${n} migration${n === 1 ? '' : 's'} waiting: ${state.pending.join(', ')}).`
    }
    return { plugin: set.plugin, title: set.title, ready: problem === null, pending: state.pending, problem }
  })
  cache = { at: Date.now(), statuses }
  return statuses
}

/** Drops the cached answer (a ready plugin is otherwise never checked again). For tests and scripts. */
export function forgetPluginStorageStatus() {
  cache = undefined
}

export async function getPluginStorageStatusFor(plugin: string): Promise<PluginStorageStatus | null> {
  return (await getPluginStorageStatus()).find((s) => s.plugin === plugin) ?? null
}

/** Called on server start: one warning per plugin whose tables are not ready. Never throws. */
export async function warnAboutPluginStorage(): Promise<void> {
  try {
    for (const status of await getPluginStorageStatus()) {
      if (!status.ready) console.warn(`Plugin "${status.plugin}" is installed but not ready. ${status.problem}`)
    }
  } catch (error) {
    console.warn(`Could not check plugin tables: ${describeError(error)}`)
  }
}

/** A plugin's tables were used before they were set up. Its message is safe to show to an owner. */
export class PluginNotReadyError extends UserError {
  constructor(title: string) {
    super(`${title} is not set up yet. An admin needs to run \`pnpm migrate\`.`)
  }
}

export type PluginDatabase<Tables> = {
  dialect: Database['dialect']
  db: Db
  /** The plugin's tables for this database, typed as the SQLite ones (like the site's own `t`). */
  t: Tables
  withTransaction: Database['withTransaction']
}

/**
 * Opens a plugin's tables. Throws PluginNotReadyError until its migrations have run, so a plugin
 * never queries a table that is not there. Write the plugin's queries once against `t` (typed as the
 * SQLite tables); on PostgreSQL `t` holds the Postgres twins, as for the site's own repositories.
 */
export async function getPluginDatabase<Tables extends Record<string, unknown>>(
  plugin: string,
  tables: { sqlite: Tables; pg: PluginStorage['tables']['pg'] },
): Promise<PluginDatabase<Tables>> {
  const status = await getPluginStorageStatusFor(plugin)
  if (!status) throw new Error(`Plugin "${plugin}" is not registered or declares no storage.`)
  if (!status.ready) throw new PluginNotReadyError(status.title)
  const database = await getDatabase()
  return {
    dialect: database.dialect,
    db: database.db,
    t: database.dialect === 'pg' ? (tables.pg as unknown as Tables) : tables.sqlite,
    withTransaction: database.withTransaction,
  }
}

// A plugin opens its tables with `storage.open()` from its `definePluginStorage` handle. Find the
// registered plugin that owns that handle (the same object it passed as `storage`) and open them.
provideStorage(async (storage) => {
  const { getPluginByStorage } = await registry()
  const plugin = getPluginByStorage(storage)
  if (!plugin) throw new Error('This plugin storage does not belong to any plugin registered in pet-adopt.config.ts.')
  return getPluginDatabase(plugin, storage.tables)
})
