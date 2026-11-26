'use server'

import { can } from '@pet-adopt/plugin-sdk'

import { exportActivityCsv, listActivity, listActivityActors, recordActivity, type ActivityFilters, type ActivityPage } from '../activity'
import { asRecord, run, type ActionResult } from '../result'
import { requirePermission } from '../session'

// The activity log screen. Everyone reads their own entries; admins and audit read everyone's and
// download them (the permission table in the plugin SDK). Nothing here changes or deletes an entry.

function filtersOf(input: unknown): ActivityFilters {
  const raw = asRecord(input)
  const text = (value: unknown) => (typeof value === 'string' ? value : null)
  return { area: text(raw.area), actor: text(raw.actor), from: text(raw.from), to: text(raw.to), page: Number(raw.page) || 1 }
}

/** `{ area?, actor?, from?, to?, page? }` (from/to are ISO timestamps). `actors` only for those who see everyone's. */
export async function listActivityAction(
  input: unknown = {},
): Promise<ActionResult<ActivityPage & { scope: 'all' | 'own'; actors: Array<{ id: string; name: string }> }>> {
  return run(async () => {
    const user = await requirePermission('activity:own')
    const all = can(user.role, 'activity:view')
    const page = await listActivity({ id: user.id, all }, filtersOf(input))
    return { ...page, scope: all ? 'all' : 'own', actors: all ? await listActivityActors() : [] }
  })
}

/** The newest few entries the signed-in person may see, for the dashboard. */
export async function listRecentActivityAction(limit = 8): Promise<ActionResult<{ entries: ActivityPage['entries']; scope: 'all' | 'own' }>> {
  return run(async () => {
    const user = await requirePermission('activity:own')
    const all = can(user.role, 'activity:view')
    const { entries } = await listActivity({ id: user.id, all }, { limit: Math.min(Math.max(Math.floor(Number(limit)) || 8, 1), 20) })
    return { entries, scope: all ? 'all' : 'own' }
  })
}

/** The filtered entries as CSV (the screen turns it into a download). The download is logged too. */
export async function exportActivityCsvAction(input: unknown = {}): Promise<ActionResult<{ filename: string; csv: string; rows: number; truncated: boolean }>> {
  return run(async () => {
    const user = await requirePermission('activity:export')
    const file = await exportActivityCsv({ id: user.id, all: true }, filtersOf(input))
    await recordActivity({ actor: user, action: 'activity.export', area: 'activity', summary: `Downloaded the activity log (${file.rows} ${file.rows === 1 ? 'entry' : 'entries'}, CSV)` })
    return file
  })
}
