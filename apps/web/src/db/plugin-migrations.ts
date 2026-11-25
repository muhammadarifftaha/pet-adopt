// Applies plugins' own migrations and reports which ones are still waiting. The site's migrations
// (./drizzle) come first and are Drizzle's; these are tracked separately in `plugin_migrations`, one
// row per plugin and migration, so a plugin added to a site that is already running gets its tables
// on the next `pnpm migrate` (or the next start, on SQLite) without touching the site's schema.
//
// Knows nothing about the plugin registry: callers pass the plugins in (src/plugins/storage.ts).
import { createHash } from 'node:crypto'

import { and, eq, sql } from 'drizzle-orm'

import type { PluginMigration } from '@pet-adopt/plugin-sdk'

import type { Database } from './client'

export type PluginMigrationSet = { plugin: string; migrations: readonly PluginMigration[] }

export type PluginMigrationState = {
  plugin: string
  applied: string[]
  /** Not run yet, in the order they will run. */
  pending: string[]
  /** Ran, but the plugin now ships different SQL for it. Never re-run: someone must look. */
  changed: string[]
  /** Recorded as run, but the plugin no longer ships it. Harmless, reported for the record. */
  unknown: string[]
}

export const STATEMENT_BREAK = '--> statement-breakpoint'

export const migrationChecksum = (sqlText: string) => createHash('sha256').update(sqlText).digest('hex')

/** drizzle-kit's output is several statements split by a marker; each runs on its own. */
export function splitStatements(sqlText: string): string[] {
  return sqlText
    .split(STATEMENT_BREAK)
    .map((statement) => statement.trim())
    .filter(Boolean)
}

type AppliedRow = { plugin: string; migration: string; checksum: string }

/**
 * What has run. `null` when `plugin_migrations` itself is missing: on PostgreSQL that means the
 * site's own migrations have not run either (it was added by them).
 */
async function appliedRows(database: Database): Promise<AppliedRow[] | null> {
  const { db, t } = database
  try {
    return await db
      .select({ plugin: t.pluginMigrations.plugin, migration: t.pluginMigrations.migration, checksum: t.pluginMigrations.checksum })
      .from(t.pluginMigrations)
  } catch (error) {
    // Only "that table does not exist". Drizzle's "Failed query: ... from plugin_migrations" names the
    // table for EVERY failure, so matching the name would report a database outage as "run migrate".
    const cause = (error as { cause?: unknown })?.cause ?? error
    const code = (cause as { code?: unknown })?.code
    const message = cause instanceof Error ? cause.message : ''
    if (code === '42P01' || /no such table: plugin_migrations/.test(message)) return null
    throw error
  }
}

function stateOf(set: PluginMigrationSet, dialect: Database['dialect'], rows: AppliedRow[]): PluginMigrationState {
  const recorded = new Map(rows.filter((row) => row.plugin === set.plugin).map((row) => [row.migration, row.checksum]))
  const shipped = new Set(set.migrations.map((m) => m.id))
  const state: PluginMigrationState = { plugin: set.plugin, applied: [], pending: [], changed: [], unknown: [] }
  for (const migration of set.migrations) {
    const sum = recorded.get(migration.id)
    if (sum === undefined) state.pending.push(migration.id)
    else if (sum !== migrationChecksum(migration[dialect])) state.changed.push(migration.id)
    else state.applied.push(migration.id)
  }
  state.unknown = [...recorded.keys()].filter((id) => !shipped.has(id))
  return state
}

export async function pluginMigrationStates(database: Database, sets: PluginMigrationSet[]): Promise<PluginMigrationState[]> {
  if (!sets.length) return []
  const rows = await appliedRows(database)
  return sets.map((set) => stateOf(set, database.dialect, rows ?? []))
}

export class PluginMigrationError extends Error {}

/**
 * Runs a plugin's pending migrations in order, each in its own transaction with its record, so a
 * failure leaves it exactly as it was before that migration. Two servers starting at once cannot
 * both run one: the lock serialises them and the record is checked again inside it.
 * Returns the ids it ran.
 */
export async function applyPluginMigrations(database: Database, set: PluginMigrationSet): Promise<string[]> {
  const rows = await appliedRows(database)
  if (rows === null) {
    throw new PluginMigrationError('The table plugin_migrations is missing: run the site\'s own migrations first (`pnpm migrate`).')
  }
  const state = stateOf(set, database.dialect, rows)
  if (state.changed.length) {
    throw new PluginMigrationError(
      `Plugin "${set.plugin}": migration ${state.changed.join(', ')} was changed after it ran. ` +
        'A migration that has shipped must never change; restore it and add a new one instead.',
    )
  }
  // A migration inserted before one that already ran would run out of order.
  const lastApplied = [...state.applied].sort().at(-1)
  const outOfOrder = lastApplied ? state.pending.filter((id) => id < lastApplied) : []
  if (outOfOrder.length) {
    throw new PluginMigrationError(
      `Plugin "${set.plugin}": migration ${outOfOrder.join(', ')} sorts before ${lastApplied}, which already ran. ` +
        'Give new migrations ids that sort after every shipped one.',
    )
  }

  const ran: string[] = []
  for (const migration of set.migrations.filter((m) => state.pending.includes(m.id))) {
    const sqlText = migration[database.dialect]
    const sum = migrationChecksum(sqlText)
    await database.withTransaction(
      async (tx) => {
        const { t } = database
        const [row] = await tx
          .select({ checksum: t.pluginMigrations.checksum })
          .from(t.pluginMigrations)
          .where(and(eq(t.pluginMigrations.plugin, set.plugin), eq(t.pluginMigrations.migration, migration.id)))
          .limit(1)
        if (row) return // another server ran it while we waited for the lock
        for (const statement of splitStatements(sqlText)) {
          if (database.dialect === 'pg') await (tx as unknown as { execute(q: unknown): Promise<unknown> }).execute(sql.raw(statement))
          else await tx.run(sql.raw(statement))
        }
        await tx.insert(t.pluginMigrations).values({ plugin: set.plugin, migration: migration.id, checksum: sum })
        ran.push(migration.id)
      },
      { lock: 'plugins:migrate' },
    )
  }
  return ran
}
