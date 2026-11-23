// What the public pages read. Thin wrappers over src/server (the data layer) that keep the
// names the pages already use, add the "no database during `next build`" fallback, and make sure a
// visitor can never ask for unlisted pets.
import type { Option, PetStatus } from '@/lib/options'
import { getPublishedPage as loadPublishedPage } from '@/server/pages'
import * as pets from '@/server/pets'
import { describeError } from '@/server/result'
import type { PetFilters } from '@/server/pets'
import { DEFAULT_SETTINGS, getSettings as loadSettings } from '@/server/settings'
import type { MediaItem, Page, Pet, PetPage, PetSummary, SiteSetting } from '@/server/types'

export type { PetFilters }
export { DEFAULT_SETTINGS }

export const PAGE_SIZE = pets.DEFAULT_PAGE_SIZE

// During `next build` the database may not exist yet (CI, Docker image builds).
// Fall back to empty content there; at runtime real errors still surface.
const isBuildPhase = () => process.env.NEXT_PHASE === 'phase-production-build'

/**
 * "There is no database to read from yet": unreachable server, missing file, missing table or
 * database. Anything else (a bug in a query, a wrong column) is a real failure and must not be
 * hidden behind an empty site.
 */
function isDatabaseMissing(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const { code, message, cause } = current as { code?: unknown; message?: unknown; cause?: unknown }
    if (typeof code === 'string' && ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'SQLITE_CANTOPEN', '42P01', '3D000'].includes(code)) return true
    if (typeof message === 'string' && /no such table|unable to open database|timeout exceeded when trying to connect/i.test(message)) return true
    current = cause
  }
  return false
}

async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (isBuildPhase() && isDatabaseMissing(error)) {
      // Say so: a build that silently bakes in an empty site is hard to diagnose.
      console.warn(`Building without a usable database, using empty content: ${describeError(error)}`)
      return fallback
    }
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
  status: PetStatus
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
/** Species of the pets visitors can see, for the catalog's filter. */
export async function getSpeciesOptions(): Promise<Option[]> {
  return safely(() => pets.getSpeciesOptions(), [] as Option[])
}

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
