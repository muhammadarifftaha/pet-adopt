// What the public pages read. Thin wrappers over src/server (the data layer) that keep the
// names the pages already use, add the "no database during `next build`" fallback, and make sure a
// visitor can never ask for unlisted pets.
import type { Metadata } from 'next'
import { cache } from 'react'

import {
  AGE_GROUPS,
  GOOD_WITH,
  isPetStatus,
  labelFor,
  normalizeSpecies,
  PetStatus,
  SEXES,
  SIZES,
  SPECIES,
  STATUSES,
  TEMPERAMENTS,
  type Option,
} from '@/lib/options'
import { richTextToPlain, type RichTextDoc } from '@/lib/rich-text'
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
    // A missing file or data/ folder (a fresh clone: the app creates them on start, the build must
    // not) is SQLITE_CANTOPEN from client.ts; libSQL reports others as a plain Error with no code.
    if (typeof message === 'string' && /no such table|unable to open (database|connection to local database)|timeout exceeded when trying to connect/i.test(message)) return true
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

// Memoised per request (React `cache`): a layout, its nested layouts and the page can all ask for
// the settings and the database is read once. Outside a render it is a plain call.
export const getSettings = cache(async (): Promise<SiteSetting> => safely(loadSettings, DEFAULT_SETTINGS))

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

/**
 * The browser tab and home-screen icon from Settings > Brand, for a layout's metadata. Every upload
 * gets a new random file name, so a changed icon is a new URL and browsers cannot keep the old one.
 * Without one, Next serves no icon and browsers show their default.
 */
export function siteIcons(settings: SiteSetting): Metadata['icons'] {
  const icon = settings.favicon
  if (!icon?.url) return undefined
  return { icon: [{ url: icon.url, type: icon.mimeType }], apple: [{ url: icon.url }] }
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
/**
 * A pet for the Pet spotlight and the profile layouts: the card fields, a short plain excerpt of the
 * description (`story`), and the profile details, with option values already turned into labels.
 */
export type PetSpotlightData = PetCardData & {
  story: string
  sexLabel: string | null
  speciesLabel: string
  breed: string | null
  color: string | null
  neutered: boolean
  /** Health checks that are done, as labels ("Vaccinated", "Microchipped"...). */
  healthChecks: string[]
  temperament: string[]
  goodWith: string[]
  description: RichTextDoc | null
  healthNotes: RichTextDoc | null
  personalityNotes: RichTextDoc | null
}

const STORY_CHARS = 280

function toSpotlight(pet: Pet): PetSpotlightData {
  const text = pet.description ? richTextToPlain(pet.description).replace(/\s+/g, ' ').trim() : ''
  const story = text.length > STORY_CHARS ? `${text.slice(0, STORY_CHARS - 1).trimEnd()}…` : text
  return {
    ...toPetCard(pet),
    story,
    sexLabel: pet.sex && pet.sex !== 'unknown' ? labelFor(SEXES, pet.sex) : null,
    speciesLabel: labelFor(SPECIES, pet.species),
    breed: pet.breed,
    color: pet.color,
    neutered: pet.neutered,
    healthChecks: [
      pet.vaccinated && 'Vaccinated',
      pet.microchipped && 'Microchipped',
      pet.houseTrained && 'House trained',
      pet.specialNeeds && 'Has special needs',
    ].filter((label): label is string => Boolean(label)),
    temperament: pet.temperament.map((value) => labelFor(TEMPERAMENTS, value)),
    goodWith: pet.goodWith.map((value) => labelFor(GOOD_WITH, value)),
    description: pet.description,
    healthNotes: pet.healthNotes,
    personalityNotes: pet.personalityNotes,
  }
}

const visible = (pet: Pet | null): pet is Pet => Boolean(pet && !pet.unlisted && pet.status !== 'adopted')

/** One pet for the Pet spotlight, or null when visitors should not see it (unlisted or adopted). */
export async function getPetSpotlight(id: number): Promise<PetSpotlightData | null> {
  return safely(async () => {
    const pet = await pets.getPetById(id)
    return visible(pet) ? toSpotlight(pet) : null
  }, null)
}

/** Full profiles for the Pet grid's profile layout (at most 12: each is a full pet). */
export async function queryPetProfiles(filters: PetFilters = {}): Promise<PetSpotlightData[]> {
  return safely(async () => {
    const list = await pets.queryPetList(publicFilters({ ...filters, limit: Math.min(Number(filters.limit) || 6, 12) }))
    const full = await Promise.all(list.map((summary) => pets.getPetById(summary.id)))
    return full.filter(visible).map(toSpotlight)
  }, [] as PetSpotlightData[])
}

/**
 * Everything a pet's page shows (the Pet page template's blocks read it, src/puck/pet-page-config.tsx):
 * the profile, every photo, and labels for the facts.
 */
export type PetPageData = PetSpotlightData & {
  statusLabel: string
  photos: Array<{ url: string; alt: string }>
  sizeLabel: string | null
  ageLabel: string | null
  location: string | null
  state: string | null
  unlisted: boolean
}

function toPetPage(pet: Pet): PetPageData {
  return {
    ...toSpotlight(pet),
    statusLabel: labelFor(STATUSES, pet.status),
    photos: pet.photos.map(mediaOf).filter((m): m is { url: string; alt: string } => Boolean(m)),
    sizeLabel: pet.size ? labelFor(SIZES, pet.size) : null,
    ageLabel: pet.ageDescription || (pet.ageGroup ? labelFor(AGE_GROUPS, pet.ageGroup) : null),
    location: pet.location,
    state: pet.state,
    unlisted: pet.unlisted,
  }
}

/**
 * A pet's page by its address: unlisted pets open by link (the page sets noindex), adopted ones
 * too (their page says so). Null when there is no such pet.
 */
export async function getPetPage(slug: string): Promise<PetPageData | null> {
  return safely(async () => {
    const pet = await pets.getPetBySlug(slug)
    return pet ? toPetPage(pet) : null
  }, null)
}

/** Any pet by id, for previewing the Pet page template in the editor. */
export async function getPetPagePreview(id: number): Promise<PetPageData | null> {
  return safely(async () => {
    const pet = await pets.getPetById(id)
    return pet ? toPetPage(pet) : null
  }, null)
}

/** "More pets like this" for one pet (the ranking is pets.rankSimilarPets). */
export async function similarPets(pet: { id: number; species: string; state: string | null }, limit: number): Promise<PetCardData[]> {
  return safely(async () => (await pets.rankSimilarPets(pet, limit)).map(toPetCard), [] as PetCardData[])
}

/** The query string of a catalogue page, as Next gives it. */
export type CatalogParams = Record<string, string | string[] | undefined>

/** One page of the pet catalogue (the Pet catalogue block), with the filters it was asked for. */
export type CatalogData = {
  pets: PetCardData[]
  page: number
  totalPages: number
  hasPrevPage: boolean
  hasNextPage: boolean
  filters: { species: string; sex: string; ageGroup: string; size: string; status: string; location: string }
  /** Species to offer in the filter: those of visible pets, plus the chosen one. */
  speciesOptions: Option[]
}

const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)
const oneOfOptions = (value: string | undefined, options: readonly { value: string }[]) =>
  value && options.some((o) => o.value === value) ? value : ''

/**
 * The catalogue for a query string: filters parsed and checked (unknown values are ignored), then
 * one page of visible pets. No status in the URL means "available"; an empty status means "any".
 */
export async function queryCatalog(params: CatalogParams = {}): Promise<CatalogData> {
  // Species is free text (owners can add their own), so there is no fixed list to check against.
  const species = normalizeSpecies(firstParam(params.species))
  const sex = oneOfOptions(firstParam(params.sex), SEXES)
  const ageGroup = oneOfOptions(firstParam(params.ageGroup), AGE_GROUPS)
  const size = oneOfOptions(firstParam(params.size), SIZES)
  const location = (firstParam(params.location) ?? '').trim().slice(0, 80)
  const rawStatus = firstParam(params.status)
  const status = rawStatus === undefined ? PetStatus.Available : oneOfOptions(rawStatus, STATUSES)
  const page = Math.min(Math.max(1, Number.parseInt(firstParam(params.page) ?? '1', 10) || 1), 10_000)

  const [result, speciesChoices] = await Promise.all([
    queryPets({ species, sex, ageGroup, size, status: isPetStatus(status) ? status : undefined, location, page, limit: PAGE_SIZE }),
    getSpeciesOptions(),
  ])
  // Keep the chosen species selectable even when no listed pet has it (a link to an empty species).
  const speciesOptions =
    !species || speciesChoices.some((o) => o.value === species) ? speciesChoices : [...speciesChoices, { label: labelFor(SPECIES, species), value: species }]
  return {
    pets: result.docs.map(toPetCard),
    page: result.page,
    totalPages: result.totalPages,
    hasPrevPage: result.hasPrevPage,
    hasNextPage: result.hasNextPage,
    filters: { species, sex, ageGroup, size, status, location },
    speciesOptions,
  }
}

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
