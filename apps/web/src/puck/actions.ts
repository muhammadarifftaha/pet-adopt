'use server'

import { listForms } from '@pet-adopt/plugin-form-builder/server'

import { desc } from 'drizzle-orm'

import { getDatabase } from '@/db/client'
import { getPluginBlock } from '@/plugins/registry'
import { requirePermission } from '@/server/session'

import { fetchPluginBlockData } from './plugin-block-data'

// Server actions used by block fields in the page builder (signed in only).

export type PetChoice = { id: number; name: string; note: string | null }

/** Every pet, newest first, for the Pet spotlight's picker. Adopted and link-only pets are marked:
 *  the block hides itself for them on the live page. */
export async function listPetChoicesAction(): Promise<PetChoice[]> {
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
}

export type FormChoice = { id: number; name: string; note: string | null }

/** Every form of the form builder, for the Form block's picker. Closed forms are marked. */
export async function listFormChoicesAction(): Promise<FormChoice[]> {
  await requirePermission('pages:view')
  const forms = await listForms()
  return forms.map((form) => ({ id: form.id, name: form.name, note: form.isOpen ? null : 'closed' }))
}

/**
 * What a plugin's block shows, for the page builder's preview: the same loader the public site
 * runs, so the same public data. Signed in only, like the builder itself. An unknown block, options
 * that are not one flat object of plain values (or are too large) and a loader that fails all give null.
 */
export async function loadPluginBlockAction(name: string, props: Record<string, unknown>): Promise<unknown> {
  await requirePermission('pages:view')
  if (typeof name !== 'string' || name.length > 60 || !getPluginBlock(name)) return null
  return fetchPluginBlockData(name, props)
}
