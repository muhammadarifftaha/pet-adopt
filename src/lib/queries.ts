// What the public pages read. Thin wrappers over src/server (the data layer) that keep the
// names the pages already use, add the "no database during `next build`" fallback, and make sure a
// visitor can never ask for unlisted pets.
import { getPublishedPage as loadPublishedPage } from '@/server/pages'
import * as pets from '@/server/pets'
import type { PetFilters } from '@/server/pets'
import { DEFAULT_SETTINGS, getSettings as loadSettings } from '@/server/settings'
import type { MediaItem, Page, Pet, PetPage, PetSummary, SiteSetting } from '@/server/types'

export type { PetFilters }
export { DEFAULT_SETTINGS }

export const PAGE_SIZE = pets.DEFAULT_PAGE_SIZE

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

// Visitors never get unlisted pets or the admin search, whatever a caller passes.
function publicFilters(filters: PetFilters): PetFilters {
  const { includeUnlisted: _includeUnlisted, search: _search, ...rest } = filters
  return rest
}

export async function getSettings(): Promise<SiteSetting> {
  return safely(loadSettings, DEFAULT_SETTINGS)
}

/** Plain, serialisable shape used by pet cards (safe to send through server actions). */
export type PetCardData = {
  id: number
  slug: string
  name: string
  species: string
  status: string
  sex?: string | null
  ageDescription?: string | null
  location?: string | null
  image: { url: string; alt: string } | null
}

export function mediaOf(value: MediaItem | null | undefined): { url: string; alt: string } | null {
  if (!value?.url) return null
  return { url: value.url, alt: value.alt || '' }
}

/** The pet fields a card needs. */
export type PetCardSource = Pick<
  PetSummary,
  'id' | 'slug' | 'name' | 'species' | 'status' | 'sex' | 'ageDescription' | 'location' | 'photos'
>

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
    image: mediaOf(pet.photos[0]),
  }
}

const EMPTY_PAGE: PetPage = {
  docs: [],
  totalDocs: 0,
  totalPages: 1,
  page: 1,
  limit: PAGE_SIZE,
  hasNextPage: false,
  hasPrevPage: false,
}

export async function queryPets(filters: PetFilters = {}): Promise<PetPage> {
  return safely(() => pets.queryPets(publicFilters(filters)), EMPTY_PAGE)
}

/** Pet cards for page-builder grids. No paging, so it skips the extra COUNT query. */
export async function queryPetCards(filters: PetFilters = {}): Promise<PetCardData[]> {
  return safely(async () => (await pets.queryPetList(publicFilters(filters))).map(toPetCard), [] as PetCardData[])
}

/** Distinct states and cities of listed pets, for filter dropdowns. */
export async function getLocationOptions(): Promise<{ states: string[]; cities: string[] }> {
  return safely(() => pets.getLocationOptions(), { states: [] as string[], cities: [] as string[] })
}

/** A pet by its address. Unlisted pets open too: the page is for people who have the link. */
export async function getPetBySlug(slug: string): Promise<Pet | null> {
  return safely(() => pets.getPetBySlug(slug), null)
}

/** Published version of a builder page, or null. */
export async function getPublishedPage(slug: string): Promise<(Page & { puckData: unknown }) | null> {
  return safely(() => loadPublishedPage(slug), null)
}
