import type { Where } from 'payload'

import type { Media, Page, Pet, SiteSetting } from '@/payload-types'

import { getPayloadClient } from './payload'

export const PAGE_SIZE = 12

// During `next build` the database may not exist yet (CI, Docker image builds).
// Fall back to empty content there; at runtime real errors still surface.
const isBuildPhase = () => process.env.NEXT_PHASE === 'phase-production-build'

async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (isBuildPhase()) return fallback
    throw error
  }
}

export const DEFAULT_SETTINGS: SiteSetting = {
  id: 0,
  siteName: 'Pet Adopt',
  tagline: 'Find your new best friend',
  primaryColor: '#e8590c',
  whatsappMessage: "Hi! I'm interested in adopting {pet}.",
  updatedAt: '',
  createdAt: '',
}

export async function getSettings(): Promise<SiteSetting> {
  return safely(async () => {
    const payload = await getPayloadClient()
    return await payload.findGlobal({ slug: 'site-settings', depth: 1 })
  }, DEFAULT_SETTINGS)
}

/** Plain, serialisable shape used by pet cards (safe to send through server actions). */
export type PetCardData = {
  id: number
  slug: string
  name: string
  species: Pet['species']
  status: Pet['status']
  sex?: Pet['sex']
  ageDescription?: string | null
  location?: string | null
  image: { url: string; alt: string } | null
}

export function mediaOf(value: number | Media | null | undefined): { url: string; alt: string } | null {
  if (!value || typeof value === 'number' || !value.url) return null
  return { url: value.url, alt: value.alt || '' }
}

export function toPetCard(pet: Pet): PetCardData {
  return {
    id: pet.id,
    slug: pet.slug || String(pet.id),
    name: pet.name,
    species: pet.species,
    status: pet.status,
    sex: pet.sex,
    ageDescription: pet.ageDescription,
    location: pet.location,
    image: mediaOf(pet.photos?.[0]),
  }
}

export type PetFilters = {
  species?: string
  status?: string
  sex?: string
  ageGroup?: string
  size?: string
  location?: string
  featuredOnly?: boolean
  page?: number
  limit?: number
}

function buildWhere(filters: PetFilters): Where {
  const and: Where[] = []
  if (filters.species) and.push({ species: { equals: filters.species } })
  if (filters.status) and.push({ status: { equals: filters.status } })
  if (filters.sex) and.push({ sex: { equals: filters.sex } })
  if (filters.ageGroup) and.push({ ageGroup: { equals: filters.ageGroup } })
  if (filters.size) and.push({ size: { equals: filters.size } })
  if (filters.location) and.push({ location: { like: filters.location } })
  if (filters.featuredOnly) and.push({ featured: { equals: true } })
  return and.length ? { and } : {}
}

export async function queryPets(filters: PetFilters = {}) {
  return safely(
    async () => {
      const payload = await getPayloadClient()
      return await payload.find({
        collection: 'pets',
        where: buildWhere(filters),
        depth: 1,
        limit: filters.limit ?? PAGE_SIZE,
        page: filters.page ?? 1,
        sort: '-createdAt',
      })
    },
    {
      docs: [] as Pet[],
      totalDocs: 0,
      totalPages: 1,
      page: 1,
      hasNextPage: false,
      hasPrevPage: false,
      limit: PAGE_SIZE,
      pagingCounter: 1,
    },
  )
}

export async function getPetBySlug(slug: string): Promise<Pet | null> {
  return safely(async () => {
    const payload = await getPayloadClient()
    const result = await payload.find({
      collection: 'pets',
      where: { slug: { equals: slug } },
      depth: 1,
      limit: 1,
    })
    return result.docs[0] ?? null
  }, null)
}

/** Published version of a builder page, or null. */
export async function getPublishedPage(slug: string): Promise<Page | null> {
  return safely(async () => {
    const payload = await getPayloadClient()
    const result = await payload.find({
      collection: 'pages',
      where: { slug: { equals: slug }, _status: { equals: 'published' } },
      depth: 1,
      limit: 1,
      draft: false,
    })
    return result.docs[0] ?? null
  }, null)
}
