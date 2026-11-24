'use server'

import type { Data } from '@puckeditor/core'

import { isPetStatus, normalizeSpecies } from '@/lib/options'
import { getPetSpotlight, queryPetCards, queryPetProfiles, type PetCardData, type PetFilters, type PetSpotlightData } from '@/lib/queries'
import { publishPage, saveDraft } from '@/server/pages'
import { assertId, toFailure } from '@/server/result'
import { requireUser } from '@/server/session'

// `version` is the page's `updatedAt` in milliseconds. The builder sends the last one it received
// and gets the new one back, so a save from a stale tab is refused instead of overwriting.
type Result = { ok: true; message: string; version: number } | { ok: false; message: string }

async function persist(id: number, data: Data, publish: boolean, baseVersion?: number): Promise<Result> {
  try {
    const user = await requireUser()
    const pageId = assertId(id)
    const base = typeof baseVersion === 'number' && Number.isFinite(baseVersion) ? baseVersion : undefined
    const { version } = publish ? await publishPage(pageId, data, base, user.id) : await saveDraft(pageId, data, base, user.id)
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
