'use server'

import { desc } from 'drizzle-orm'

import { getDatabase } from '@/db/client'
import { getPluginBlock } from '@/plugins/registry'
import { run, type ActionResult } from '@/server/result'
import { requirePermission } from '@/server/session'

import { fetchPluginBlockData } from './plugin-block-data'

// Server actions used by block fields in the page builder (signed in only).

export type PetChoice = { id: number; name: string; note: string | null }

/** Every pet, newest first, for the Pet spotlight's picker. Adopted and link-only pets are marked:
 *  the block hides itself for them on the live page. */
export async function listPetChoicesAction(): Promise<ActionResult<PetChoice[]>> {
  return run(async () => {
    await requirePermission('pages:view')
    const { db, t } = await getDatabase()
    const rows = await db
      .select({ id: t.pets.id, name: t.pets.name, status: t.pets.status, unlisted: t.pets.unlisted })
      .from(t.pets)
      .orderBy(desc(t.pets.createdAt))
      .limit(500)
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      note: row.status === 'adopted' ? 'adopted, hidden' : row.unlisted ? 'link only, hidden' : null,
    }))
  })
}

/**
 * What a plugin's block shows, for the page builder's preview: the same loader the public site
 * runs, so the same public data. Signed in only, like the builder itself. An unknown block, options
 * that are not one flat object of plain values (or are too large) and a loader that fails all give null.
 */
export async function loadPluginBlockAction(name: string, props: Record<string, unknown>): Promise<ActionResult<unknown>> {
  return run(async () => {
    await requirePermission('pages:view')
    if (typeof name !== 'string' || name.length > 60 || !getPluginBlock(name)) return null
    return fetchPluginBlockData(name, props)
  })
}
