'use server'

import type { Data } from '@puckeditor/core'

import { isPetStatus, normalizeSpecies } from '@/lib/options'
import {
  getPetPagePreview,
  getPetSpotlight,
  queryCatalog,
  similarPets,
  queryPetCards,
  queryPetProfiles,
  type CatalogData,
  type PetCardData,
  type PetFilters,
  type PetPageData,
  type PetSpotlightData,
} from '@/lib/queries'
import { fetchPublicForm, type PublicForm } from '@/puck/forms'
import { recordPageActivity } from '@/server/activity'
import { publishPage, saveDraft } from '@/server/pages'
import { assertId, toFailure } from '@/server/result'
import { requirePermission } from '@/server/session'

// `version` is the page's `updatedAt` in milliseconds. The builder sends the last one it received
// and gets the new one back, so a save from a stale tab is refused instead of overwriting.
type Result = { ok: true; message: string; version: number } | { ok: false; message: string }

async function persist(id: number, data: Data, publish: boolean, baseVersion?: number): Promise<Result> {
  try {
    const user = await requirePermission('pages:edit')
    const pageId = assertId(id)
    const base = typeof baseVersion === 'number' && Number.isFinite(baseVersion) ? baseVersion : undefined
    const { version } = publish ? await publishPage(pageId, data, base, user.id) : await saveDraft(pageId, data, base, user.id)
    await (publish
      ? recordPageActivity(user, pageId, 'page.publish', (title) => `Published the page ${title}`)
      : recordPageActivity(user, pageId, 'page.draft', (title) => `Saved a draft of the page ${title}`))
    return { ok: true, message: publish ? 'Published. The live page is updated.' : 'Draft saved.', version }
  } catch (error) {
    return { ok: false, message: toFailure(error).error }
  }
}

export async function saveDraftAction(id: number, data: Data, baseVersion?: number): Promise<Result> {
  return persist(id, data, false, baseVersion)
}

export async function publishAction(id: number, data: Data, baseVersion?: number): Promise<Result> {
  return persist(id, data, true, baseVersion)
}

/** One pet for the editor's Pet spotlight preview. Public data (hidden pets come back as null). */
export async function fetchPetSpotlightAction(id: number): Promise<PetSpotlightData | null> {
  const petId = Number(id)
  if (!Number.isSafeInteger(petId) || petId < 1) return null
  return getPetSpotlight(petId)
}

/** The first page of the catalogue, for the editor's Pet catalogue preview (no filters). */
export async function fetchCatalogAction(): Promise<CatalogData> {
  return queryCatalog({})
}

/** Full profiles for the editor's pet grid preview (profile layout). Same clamping as below. */
export async function fetchPetProfilesAction(filters: PetFilters): Promise<PetSpotlightData[]> {
  const f = filters ?? {}
  return queryPetProfiles({
    species: normalizeSpecies(f.species) || undefined,
    status: isPetStatus(f.status) ? f.status : undefined,
    featuredOnly: Boolean(f.featuredOnly),
    limit: Math.min(Math.max(Number(f.limit) || 6, 1), 12),
  })
}

/** Live pets for the editor's pet grid preview. Public data, but inputs are clamped. */
export async function fetchPetsAction(filters: PetFilters): Promise<PetCardData[]> {
  // A client can send anything, including nothing.
  const f = filters ?? {}
  return queryPetCards({
    species: normalizeSpecies(f.species) || undefined,
    status: isPetStatus(f.status) ? f.status : undefined,
    featuredOnly: Boolean(f.featuredOnly),
    limit: Math.min(Math.max(Number(f.limit) || 8, 1), 24),
  })
}

/** One form for the editor's Form block preview. Public data: the same form visitors see. */
export async function fetchFormAction(id: number): Promise<PublicForm | null> {
  return fetchPublicForm(id)
}

/**
 * The "Preview with" pet of the Pet page template. Any pet, hidden ones included (an adopted pet's
 * page is worth previewing), so it needs `pages:view` like the builder itself.
 */
export async function fetchPetPagePreviewAction(id: number): Promise<PetPageData | null> {
  await requirePermission('pages:view')
  const petId = Number(id)
  if (!Number.isSafeInteger(petId) || petId < 1) return null
  return getPetPagePreview(petId)
}

/** "More pets like this" in the editor. Public data (available, listed pets); inputs are checked. */
export async function fetchSimilarPetsAction(pet: { id: number; species: string; state: string | null }, limit: number): Promise<PetCardData[]> {
  const id = Number(pet?.id)
  if (!Number.isSafeInteger(id) || id < 1) return []
  const species = typeof pet.species === 'string' ? pet.species.slice(0, 100) : ''
  const state = typeof pet.state === 'string' ? pet.state.slice(0, 200) : null
  return similarPets({ id, species, state }, Math.min(Math.max(Number(limit) || 3, 1), 12))
}
