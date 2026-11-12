'use server'

import type { Data } from '@puckeditor/core'
import { headers } from 'next/headers'

import { safeRevalidate } from '@/lib/revalidate'
import { getPayloadClient } from '@/lib/payload'
import { queryPetCards, type PetCardData, type PetFilters } from '@/lib/queries'
import { isPuckData, stripTransient } from '@/puck/data'

type Result = { ok: true; message: string } | { ok: false; message: string }

async function requireOwner() {
  const payload = await getPayloadClient()
  const { user } = await payload.auth({ headers: await headers() })
  if (!user) throw new Error('You need to be signed in.')
  return { payload, user }
}

async function persist(id: number, data: Data, status: 'draft' | 'published'): Promise<Result> {
  try {
    const { payload, user } = await requireOwner()
    if (!isPuckData(data)) return { ok: false, message: 'The page data looks invalid, so nothing was saved.' }

    const page = await payload.update({
      collection: 'pages',
      id,
      data: { puckData: stripTransient(data) as unknown as Record<string, unknown>, _status: status },
      draft: status === 'draft',
      user,
      overrideAccess: false,
    })

    if (status === 'published') safeRevalidate([page.slug === 'home' ? '/' : `/${page.slug}`])
    return { ok: true, message: status === 'published' ? 'Published. The live page is updated.' : 'Draft saved.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Something went wrong.' }
  }
}

export async function saveDraftAction(id: number, data: Data): Promise<Result> {
  return persist(id, data, 'draft')
}

export async function publishAction(id: number, data: Data): Promise<Result> {
  return persist(id, data, 'published')
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
