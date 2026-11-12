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
  theme: 'sunrise',
  allowModeToggle: true,
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

/** The Pet fields a card needs. Queries select only these (see PET_CARD_SELECT). */
export type PetCardSource = Pick<
  Pet,
  'id' | 'slug' | 'name' | 'species' | 'status' | 'sex' | 'ageDescription' | 'location' | 'photos'
>

const PET_CARD_SELECT = {
  name: true,
  slug: true,
  species: true,
  status: true,
  sex: true,
  ageDescription: true,
  location: true,
  photos: true,
} as const

// Payload builds `url` from `filename` (and `updatedAt` for cache busting) after reading,
// so both must be selected along with `alt` or the url comes back null.
const PET_CARD_POPULATE = { media: { url: true, alt: true, filename: true, updatedAt: true } } as const

// Newest first; the id breaks ties so pages never repeat or skip pets created in the same instant.
const PET_SORT = ['-createdAt', '-id']

export function toPetCard(pet: PetCardSource): PetCardData {
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
  /** Exact city or state, as returned by getLocationOptions(). */
  city?: string
  state?: string
  featuredOnly?: boolean
  page?: number
  limit?: number
}

function buildWhere(filters: PetFilters): Where {
  // Unlisted pets are reachable by link only, so they never show up in listings.
  const and: Where[] = [{ unlisted: { not_equals: true } }]
  if (filters.species) and.push({ species: { equals: filters.species } })
  if (filters.status) and.push({ status: { equals: filters.status } })
  if (filters.sex) and.push({ sex: { equals: filters.sex } })
  if (filters.ageGroup) and.push({ ageGroup: { equals: filters.ageGroup } })
  if (filters.size) and.push({ size: { equals: filters.size } })
  // "contains" is a plain substring match on both SQLite and Postgres. Strip the LIKE wildcards
  // so visitors cannot turn the search into a pattern.
  const location = filters.location?.replace(/[%_\\]/g, '').trim()
  if (location) and.push({ location: { contains: location } })
  if (filters.city) and.push({ city: { equals: filters.city } })
  if (filters.state) and.push({ state: { equals: filters.state } })
  if (filters.featuredOnly) and.push({ featured: { equals: true } })
  return { and }
}

export async function queryPets(filters: PetFilters = {}) {
  return safely(
    async () => {
      const payload = await getPayloadClient()
      // Cards only need a few fields and the cover photo's url and alt, so don't load the
      // rich-text description or every image size.
      return await payload.find({
        collection: 'pets',
        where: buildWhere(filters),
        depth: 1,
        select: PET_CARD_SELECT,
        populate: PET_CARD_POPULATE,
        limit: filters.limit ?? PAGE_SIZE,
        page: filters.page ?? 1,
        sort: PET_SORT,
      })
    },
    {
      docs: [] as PetCardSource[],
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

/** Distinct states and cities of the pets visitors can see, for filter dropdowns. */
export async function getLocationOptions(): Promise<{ states: string[]; cities: string[] }> {
  return safely(
    async () => {
      const payload = await getPayloadClient()
      const where: Where = { unlisted: { not_equals: true } }
      const [states, cities] = await Promise.all([
        payload.findDistinct({ collection: 'pets', field: 'state', where }),
        payload.findDistinct({ collection: 'pets', field: 'city', where }),
      ])
      const clean = (values: Array<string | null | undefined>) =>
        [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b))
      return {
        states: clean(states.values.map((v) => v.state)),
        cities: clean(cities.values.map((v) => v.city)),
      }
    },
    { states: [] as string[], cities: [] as string[] },
  )
}

/** Pet cards for page-builder grids. No paging, so it skips the extra COUNT query. */
export async function queryPetCards(filters: PetFilters = {}): Promise<PetCardData[]> {
  return safely(async () => {
    const payload = await getPayloadClient()
    const result = await payload.find({
      collection: 'pets',
      where: buildWhere(filters),
      depth: 1,
      select: PET_CARD_SELECT,
      populate: PET_CARD_POPULATE,
      limit: filters.limit ?? PAGE_SIZE,
      pagination: false,
      sort: PET_SORT,
    })
    return result.docs.map(toPetCard)
  }, [] as PetCardData[])
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
