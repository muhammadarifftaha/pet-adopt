'use server'

import type { Data } from '@puckeditor/core'

import { queryPetCards, type PetCardData, type PetFilters } from '@/lib/queries'
import { publishPage, saveDraft } from '@/server/pages'
import { toFailure } from '@/server/result'
import { requireUser } from '@/server/session'

type Result = { ok: true; message: string } | { ok: false; message: string }

async function persist(id: number, data: Data, publish: boolean): Promise<Result> {
  try {
    await requireUser()
    if (publish) await publishPage(id, data)
    else await saveDraft(id, data)
    return { ok: true, message: publish ? 'Published. The live page is updated.' : 'Draft saved.' }
  } catch (error) {
    return { ok: false, message: toFailure(error).error }
  }
}

export async function saveDraftAction(id: number, data: Data): Promise<Result> {
  return persist(id, data, false)
}

export async function publishAction(id: number, data: Data): Promise<Result> {
  return persist(id, data, true)
}

/** Live pets for the editor's pet grid preview. Public data, but inputs are clamped. */
export async function fetchPetsAction(filters: PetFilters): Promise<PetCardData[]> {
  return queryPetCards({
    species: typeof filters.species === 'string' ? filters.species.slice(0, 20) : undefined,
    status: typeof filters.status === 'string' ? filters.status.slice(0, 20) : undefined,
    featuredOnly: Boolean(filters.featuredOnly),
    limit: Math.min(Math.max(Number(filters.limit) || 8, 1), 24),
  })
}
