// What a plugin's `storage` must look like, checked when the config loads (registry.ts), so a
// mistake stops the server with a clear message instead of failing on a half-made table later.
//
// The table-name checks keep plugins from colliding with each other or with the site by accident.
// They are not a sandbox: a plugin is code the owner chose to install and already runs with full
// access to the database.
import { compareTables, sqliteShapes } from '@/db/compare-tables'
import { splitStatements } from '@/db/plugin-migrations'

import { pluginTablePrefix, type PluginStorage } from '@pet-adopt/plugin-sdk'

const MIGRATION_ID = /^\d{4}_[a-z0-9_]+$/

// An identifier, optionally quoted (`x` or "x") and optionally in the "public" schema.
const IDENT = String.raw`(?:[\x60"]?public[\x60"]?\.)?[\x60"]?([A-Za-z0-9_]+)[\x60"]?`
const DDL_NAMES: RegExp[] = [
  new RegExp(String.raw`\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}`, 'gi'),
  new RegExp(String.raw`\bALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?${IDENT}`, 'gi'),
  new RegExp(String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?${IDENT}`, 'gi'),
  new RegExp(String.raw`\bRENAME\s+TO\s+${IDENT}`, 'gi'),
  new RegExp(String.raw`\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}\s+ON\s+(?:ONLY\s+)?${IDENT}`, 'gi'),
  new RegExp(String.raw`\bDROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?${IDENT}`, 'gi'),
  new RegExp(String.raw`\bREFERENCES\s+${IDENT}`, 'gi'),
  new RegExp(String.raw`\bINSERT\s+INTO\s+${IDENT}`, 'gi'),
  new RegExp(String.raw`\bDELETE\s+FROM\s+${IDENT}`, 'gi'),
  new RegExp(String.raw`^\s*UPDATE\s+${IDENT}`, 'gim'),
]

/** Tables and indexes a migration names that do not belong to the plugin (drizzle-kit's `__new_` copies included). */
export function foreignNames(sqlText: string, prefix: string): string[] {
  const out = new Set<string>()
  for (const statement of splitStatements(sqlText)) {
    for (const pattern of DDL_NAMES) {
      for (const match of statement.matchAll(pattern)) {
        for (const name of match.slice(1).filter(Boolean)) {
          if (!name.startsWith(prefix) && !name.startsWith(`__new_${prefix}`)) out.add(name)
        }
      }
    }
  }
  return [...out]
}

/** Every problem with a plugin's storage, as one sentence each. Empty when it is fine. */
export function storageProblems(pluginName: string, storage: PluginStorage): string[] {
  const problems: string[] = []
  const prefix = pluginTablePrefix(pluginName)
  const tables = storage?.tables
  if (!tables || typeof tables.sqlite !== 'object' || typeof tables.pg !== 'object' || !tables.sqlite || !tables.pg) {
    return ['storage.tables must be { sqlite: {...tables}, pg: {...tables} }.']
  }

  const names = [...sqliteShapes(tables.sqlite).keys()]
  if (!names.length) problems.push('storage.tables declares no tables.')
  for (const name of names) {
    if (!name.startsWith(prefix)) problems.push(`table "${name}" must start with "${prefix}".`)
  }
  problems.push(...compareTables(tables.sqlite, tables.pg).map((p) => `storage.tables are not twins: ${p}`))

  const migrations = storage.migrations
  if (!Array.isArray(migrations) || !migrations.length) {
    problems.push('storage.migrations must list at least one migration (run `pnpm plugin:generate <plugin folder>`).')
    return problems
  }
  let previous = ''
  for (const migration of migrations) {
    const id = migration?.id
    if (typeof id !== 'string' || !MIGRATION_ID.test(id)) {
      problems.push(`migration id "${String(id)}" must look like "0000_init" (four digits, then lowercase letters, digits, _).`)
      continue
    }
    if (id <= previous) problems.push(`migration "${id}" must sort after "${previous}" (ids are unique and in order).`)
    previous = id
    for (const dialect of ['sqlite', 'pg'] as const) {
      const sqlText = migration[dialect]
      if (typeof sqlText !== 'string' || !sqlText.trim()) {
        problems.push(`migration "${id}" has no ${dialect} SQL.`)
        continue
      }
      const foreign = foreignNames(sqlText, prefix)
      if (foreign.length) {
        problems.push(`migration "${id}" (${dialect}) touches ${foreign.map((n) => `"${n}"`).join(', ')}: a plugin may only use tables and indexes that start with "${prefix}".`)
      }
    }
  }
  return problems
}
