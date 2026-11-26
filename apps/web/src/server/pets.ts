// Pets: reading, searching and saving. The rules that used to be Payload hooks live in `savePet`.
import { randomBytes } from 'node:crypto'

import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, like, lte, ne, or, type SQL } from 'drizzle-orm'

import { getDatabase, type Db, type Schema } from '@/db/client'
import type * as S from '@/db/schema/sqlite'
import { ageGroupRange, displayAge, displayAgeGroup, estimateBirthDate, todayISO } from '@/lib/age'
import { DESCRIPTION_MAX_CHARS, plainTextToDoc } from '@/lib/rich-text'
import { validateHttpsUrl } from '@/lib/links'
import {
  AGE_GROUPS,
  AGE_UNITS,
  GOOD_WITH,
  normalizeSpecies,
  type Option,
  PetStatus,
  SEXES,
  SIZES,
  SPECIES_MAX_LENGTH,
  speciesOptions,
  STATUSES,
  TEMPERAMENTS,
} from '@/lib/options'
import { foldText } from '@pet-adopt/plugin-sdk'

import { safeRevalidate } from '@/lib/revalidate'
import { slugify } from '@/lib/slugify'
import { normalizePhone } from '@/lib/whatsapp'

import { getMediaByIds, toMedia } from './media'
import { asRecord, Fields, isForeignKeyViolation, isUniqueViolation, UserError, ValidationError } from './result'
import type { MediaItem, Pet, PetPage, PetSummary } from './types'

type PetRow = typeof S.pets.$inferSelect
type PetInsert = typeof S.pets.$inferInsert

export const DEFAULT_PAGE_SIZE = 12
export const MAX_PHOTOS = 10

/** A number from outside (a URL, a form) forced into a safe range, so it can never reach SQL as NaN or 1e20. */
const wholeNumber = (value: unknown, fallback: number, min: number, max: number) =>
  Math.min(Math.max(Math.floor(Number(value)) || fallback, min), max)

export type PetFilters = {
  species?: string
  status?: PetStatus
  sex?: string
  ageGroup?: string
  size?: string
  location?: string
  /** Exact city or state, as returned by getLocationOptions(). */
  city?: string
  state?: string
  featuredOnly?: boolean
  /** Admin lists include unlisted pets. Public queries never do. */
  includeUnlisted?: boolean
  /** Admin search over name, breed and location. */
  search?: string
  page?: number
  limit?: number
}

// Pet pages are reachable by link only when unlisted, so every public listing hides them.
function conditions(t: Schema, f: PetFilters): SQL[] {
  const c: SQL[] = []
  if (!f.includeUnlisted) c.push(eq(t.pets.unlisted, false))
  // Species is stored normalised, so normalise the filter too ("Guinea Pig" finds "guinea-pig").
  if (f.species) c.push(eq(t.pets.species, normalizeSpecies(f.species)))
  if (f.status) c.push(eq(t.pets.status, f.status))
  if (f.sex) c.push(eq(t.pets.sex, f.sex))
  if (f.ageGroup) {
    // A pet with a birth date is in a group by how old it is today (a date range, so it moves on its
    // own); a pet without one is in the group that was picked for it.
    const picked = and(isNull(t.pets.birthDate), eq(t.pets.ageGroup, f.ageGroup))!
    const range = ageGroupRange(f.ageGroup, todayISO())
    if (!range) c.push(picked)
    else {
      const dated: SQL[] = [isNotNull(t.pets.birthDate)]
      if (range.after) dated.push(gt(t.pets.birthDate, range.after))
      if (range.onOrBefore) dated.push(lte(t.pets.birthDate, range.onOrBefore))
      c.push(or(and(...dated), picked)!)
    }
  }
  if (f.size) c.push(eq(t.pets.size, f.size))
  // A plain substring match. Strip the LIKE wildcards so visitors cannot turn the search into a pattern.
  // Folded text against a folded column: the same on SQLite, libSQL and PostgreSQL ("ile" finds
  // "Île-de-France"). Wildcards are stripped so visitors cannot turn the search into a pattern.
  const location = foldText(f.location).replace(/[%_\\]/g, '').trim()
  if (location) c.push(like(t.pets.locationSearch, `%${location}%`))
  if (f.city) c.push(eq(t.pets.city, f.city))
  if (f.state) c.push(eq(t.pets.state, f.state))
  if (f.featuredOnly) c.push(eq(t.pets.featured, true))
  const search = foldText(f.search).replace(/[%_\\]/g, '').trim()
  if (search) c.push(like(t.pets.searchText, `%${search}%`))
  return c
}

const summaryColumns = (t: Schema) => ({
  id: t.pets.id,
  slug: t.pets.slug,
  name: t.pets.name,
  species: t.pets.species,
  status: t.pets.status,
  sex: t.pets.sex,
  ageDescription: t.pets.ageDescription,
  // Not part of PetSummary: only used to work out the live age in `summaries`.
  birthDate: t.pets.birthDate,
  birthDateEstimated: t.pets.birthDateEstimated,
  location: t.pets.location,
  featured: t.pets.featured,
  unlisted: t.pets.unlisted,
  urgent: t.pets.urgent,
  updatedAt: t.pets.updatedAt,
})

async function loadPhotos(db: Db, t: Schema, petIds: number[], coverOnly: boolean) {
  const map = new Map<number, MediaItem[]>()
  if (!petIds.length) return map
  const rows = await db
    .select({ petId: t.petPhotos.petId, media: t.media })
    .from(t.petPhotos)
    .innerJoin(t.media, eq(t.media.id, t.petPhotos.mediaId))
    .where(and(inArray(t.petPhotos.petId, petIds), coverOnly ? eq(t.petPhotos.position, 0) : undefined))
    .orderBy(t.petPhotos.petId, t.petPhotos.position)
  for (const row of rows) {
    const list = map.get(row.petId) ?? []
    list.push(toMedia(row.media))
    map.set(row.petId, list)
  }
  return map
}

type SummaryRow = Omit<PetSummary, 'photos'> & Pick<PetRow, 'birthDate' | 'birthDateEstimated'>

async function summaries(db: Db, t: Schema, rows: SummaryRow[]): Promise<PetSummary[]> {
  const photos = await loadPhotos(db, t, rows.map((r) => r.id), true)
  const today = todayISO()
  return rows.map(({ birthDate, birthDateEstimated, ...r }) => ({
    ...r,
    // Worked out from the birth date when there is one, so cards and lists never show a stale age.
    ageDescription: displayAge({ birthDate, birthDateEstimated, ageDescription: r.ageDescription }, today),
    photos: photos.get(r.id) ?? [],
  }))
}

export async function queryPets(filters: PetFilters = {}): Promise<PetPage> {
  const { db, t } = await getDatabase()
  const limit = wholeNumber(filters.limit, DEFAULT_PAGE_SIZE, 1, 100)
  // A visitor can put anything in ?page=: 1e20 as an OFFSET is an error on both databases.
  const page = wholeNumber(filters.page, 1, 1, 10_000)
  const where = and(...conditions(t, filters))
  const [rows, [{ total }]] = await Promise.all([
    db
      .select(summaryColumns(t))
      .from(t.pets)
      .where(where)
      // Newest first; the id breaks ties so pages never repeat or skip pets created in the same instant.
      .orderBy(desc(t.pets.createdAt), desc(t.pets.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(t.pets).where(where),
  ])
  const totalPages = Math.max(Math.ceil(total / limit), 1)
  return {
    docs: await summaries(db, t, rows),
    totalDocs: total,
    totalPages,
    page,
    limit,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  }
}

/** Pet cards for page-builder grids. No paging, so it skips the COUNT query. */
export async function queryPetList(filters: PetFilters = {}): Promise<PetSummary[]> {
  const { db, t } = await getDatabase()
  const limit = wholeNumber(filters.limit, DEFAULT_PAGE_SIZE, 1, 100)
  const rows = await db
    .select(summaryColumns(t))
    .from(t.pets)
    .where(and(...conditions(t, filters)))
    .orderBy(desc(t.pets.createdAt), desc(t.pets.id))
    .limit(limit)
  return summaries(db, t, rows)
}

/**
 * "More pets like this" on a pet's page (agreed with the owner): available, listed pets other than
 * this one, the same species first, then the same state, then any other, newest first within each.
 * The one place that decides the order, so a later signal (visitor behaviour, say) is added here
 * and the block and the page stay as they are.
 */
export async function rankSimilarPets(pet: { id: number; species: string; state: string | null }, limit: number): Promise<PetSummary[]> {
  const want = wholeNumber(limit, 3, 1, 12)
  const base: PetFilters = { status: PetStatus.Available, limit: want + 1 }
  const tiers: PetFilters[] = [{ ...base, species: pet.species }, ...(pet.state ? [{ ...base, state: pet.state }] : []), base]
  const picked: PetSummary[] = []
  const seen = new Set<number>([pet.id])
  for (const filters of tiers) {
    for (const row of await queryPetList(filters)) {
      if (picked.length >= want) return picked
      if (seen.has(row.id)) continue
      seen.add(row.id)
      picked.push(row)
    }
  }
  return picked
}

/**
 * The pets a visitor can pick in a form ("Which pet are you applying for?"): listed (the same
 * public rule as every listing) and not adopted, by name. Pending ones are marked.
 */
export async function listPetChoices(): Promise<Array<{ id: number; name: string; status: PetStatus }>> {
  const { db, t } = await getDatabase()
  const rows = await db
    .select({ id: t.pets.id, name: t.pets.name, status: t.pets.status })
    .from(t.pets)
    .where(and(...conditions(t, {}), ne(t.pets.status, PetStatus.Adopted)))
    // searchText starts with the folded name, so the 500 kept are the first by name on every database.
    .orderBy(asc(t.pets.searchText), asc(t.pets.id))
    .limit(500)
  // Sorted again here: databases collate the folded text slightly differently (PostgreSQL locales).
  return rows.sort((a, b) => foldText(a.name).localeCompare(foldText(b.name)) || a.id - b.id)
}

/** Distinct states and cities of the pets visitors can see, for filter dropdowns. */
export async function getLocationOptions(): Promise<{ states: string[]; cities: string[] }> {
  const { db, t } = await getDatabase()
  const visible = eq(t.pets.unlisted, false)
  const [states, cities] = await Promise.all([
    db.selectDistinct({ value: t.pets.state }).from(t.pets).where(and(visible, isNotNull(t.pets.state))),
    db.selectDistinct({ value: t.pets.city }).from(t.pets).where(and(visible, isNotNull(t.pets.city))),
  ])
  const clean = (rows: Array<{ value: string | null }>) =>
    [...new Set(rows.map((r) => r.value).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b))
  return { states: clean(states), cities: clean(cities) }
}

/** Species in use, as filter options: visible pets only, or every pet for the admin. */
export async function getSpeciesOptions(opts: { includeUnlisted?: boolean } = {}): Promise<Option[]> {
  const { db, t } = await getDatabase()
  const rows = await db
    .selectDistinct({ value: t.pets.species })
    .from(t.pets)
    .where(opts.includeUnlisted ? undefined : eq(t.pets.unlisted, false))
  return speciesOptions(rows.map((r) => r.value))
}

function toPet(row: PetRow, photos: MediaItem[], seoImage: MediaItem | null): Pet {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    species: row.species,
    status: row.status,
    sex: row.sex,
    ageDescription: displayAge(row),
    location: row.location,
    featured: row.featured,
    unlisted: row.unlisted,
    urgent: row.urgent,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    adoptedAt: row.adoptedAt,
    breed: row.breed,
    ageGroup: displayAgeGroup(row),
    size: row.size,
    birthDate: row.birthDate,
    birthDateEstimated: row.birthDateEstimated,
    color: row.color,
    city: row.city,
    state: row.state,
    vaccinated: row.vaccinated,
    neutered: row.neutered,
    microchipped: row.microchipped,
    houseTrained: row.houseTrained,
    specialNeeds: row.specialNeeds,
    // The document, or an old plain-text note turned into one (nothing is lost, and no data migration is needed).
    healthNotes: row.healthNotesDoc ?? (row.healthNotes ? plainTextToDoc(row.healthNotes) : null),
    temperament: row.temperament ?? [],
    goodWith: row.goodWith ?? [],
    personalityNotes: row.personalityNotesDoc ?? null,
    // The document, or an old plain-text description turned into one.
    description: row.descriptionDoc ?? (row.description ? plainTextToDoc(row.description) : null),
    videoUrl: row.videoUrl,
    adoptionFee: row.adoptionFee,
    rescuedAt: row.rescuedAt,
    contactWhatsApp: row.contactWhatsApp,
    photos,
    seo: { title: row.seoTitle, description: row.seoDescription, image: seoImage },
  }
}

async function fullPet(row: PetRow | undefined): Promise<Pet | null> {
  if (!row) return null
  const { db, t } = await getDatabase()
  const [photos, share] = await Promise.all([
    loadPhotos(db, t, [row.id], false),
    row.seoImageId ? getMediaByIds([row.seoImageId]) : Promise.resolve(new Map<number, MediaItem>()),
  ])
  return toPet(row, photos.get(row.id) ?? [], row.seoImageId ? (share.get(row.seoImageId) ?? null) : null)
}

export async function getPetById(id: number): Promise<Pet | null> {
  const { db, t } = await getDatabase()
  const [row] = await db.select().from(t.pets).where(eq(t.pets.id, id)).limit(1)
  return fullPet(row)
}

/** Public lookup. Unlisted pets are returned too: the page is for people who have the link. */
export async function getPetBySlug(slug: string): Promise<Pet | null> {
  const { db, t } = await getDatabase()
  const [row] = await db.select().from(t.pets).where(eq(t.pets.slug, slug)).limit(1)
  return fullPet(row)
}

async function uniqueSlug(db: Db, t: Schema, name: string, selfId: number | null) {
  // Names without Latin letters (Chinese, Tamil, Arabic...) slugify to nothing.
  const base = slugify(name) || `pet-${Date.now().toString(36)}`
  let candidate = base
  for (let i = 2; i <= 50; i++) {
    const [hit] = await db.select({ id: t.pets.id }).from(t.pets).where(eq(t.pets.slug, candidate)).limit(1)
    if (!hit || hit.id === selfId) return candidate
    candidate = `${base}-${i}`
  }
  return `${base}-${Date.now().toString(36)}`
}

/**
 * Creates (`id` = null) or updates a pet. `raw` is the form data as a plain object; keys that are
 * left out stay as they are. Photos are `photoIds`, the share image is `seoImageId`.
 * Throws ValidationError with one message per field.
 */
export async function savePet(id: number | null, raw: unknown): Promise<{ id: number; slug: string }> {
  const input = asRecord(raw)
  const creating = id === null
  const f = new Fields(input, creating)

  const v: Partial<PetInsert> = {}
  const put = <K extends keyof PetInsert>(key: K, value: PetInsert[K] | undefined) => {
    if (value !== undefined) v[key] = value
  }

  put('name', f.requiredText('name', 60))
  put('status', f.oneOf('status', STATUSES) ?? undefined)
  // Free text, stored normalised ("Guinea  Pig" -> "guinea-pig"). Blank keeps the current value (or "cat" on create).
  const species = f.text('species', SPECIES_MAX_LENGTH, {
    collapse: true,
    validate: (value) => normalizeSpecies(value) !== '' || 'Use letters or numbers.',
  })
  put('species', species ? normalizeSpecies(species) : undefined)
  put('sex', f.oneOf('sex', SEXES))
  put('ageGroup', f.oneOf('ageGroup', AGE_GROUPS))
  put('size', f.oneOf('size', SIZES))
  put('breed', f.text('breed', 80))
  put('ageDescription', f.text('ageDescription', 40))
  // Age: an exact birth date, or an estimate ("about 8 months") that is stored as a birth date and
  // flagged, so the age keeps advancing with the calendar. A blank date next to an age means "use the age".
  const birthDate = f.date('birthDate')
  const ageValue = f.number('ageValue', { min: 1, max: 200 })
  const ageUnit = f.oneOf('ageUnit', AGE_UNITS)
  const today = todayISO()
  if (ageValue != null && !Number.isInteger(ageValue)) f.fail_('ageValue', 'Use a whole number.')
  if ((ageValue != null) !== (ageUnit != null)) {
    if (ageValue != null) f.fail_('ageUnit', 'Pick weeks, months or years.')
    else f.fail_('ageValue', 'Enter a number.')
  } else if (birthDate && ageValue != null) {
    f.fail_('ageValue', 'Enter either a birth date or an age, not both.')
  }
  if (birthDate && birthDate > today) f.fail_('birthDate', 'The birth date cannot be in the future.')
  let estimated: string | undefined
  if (!birthDate && ageValue != null && ageUnit != null) {
    estimated = estimateBirthDate(ageValue, ageUnit, today)
    if (estimated < '1850-01-01') f.fail_('ageValue', 'That is too old.')
  }
  if (estimated) {
    v.birthDate = estimated
    v.birthDateEstimated = true
  } else if (birthDate) {
    v.birthDate = birthDate
    v.birthDateEstimated = false
  } else if (birthDate === null && ageValue == null) {
    v.birthDate = null
    v.birthDateEstimated = false
  }
  put('color', f.text('color', 60))
  put('city', f.text('city', 60, { collapse: true }))
  put('state', f.text('state', 60, { collapse: true }))
  put('location', f.text('location', 120))
  put('featured', f.flag('featured'))
  put('unlisted', f.flag('unlisted'))
  put('urgent', f.flag('urgent'))
  put('vaccinated', f.flag('vaccinated'))
  put('neutered', f.flag('neutered'))
  put('microchipped', f.flag('microchipped'))
  put('houseTrained', f.flag('houseTrained'))
  put('specialNeeds', f.flag('specialNeeds'))
  // A rich-text document (or plain text, one paragraph per line). Saving writes the document and clears the legacy text column.
  const healthNotes = f.richText('healthNotes')
  if (healthNotes !== undefined) {
    put('healthNotesDoc', healthNotes)
    put('healthNotes', null)
  }
  put('temperament', f.list('temperament', TEMPERAMENTS))
  put('goodWith', f.list('goodWith', GOOD_WITH))
  // A rich-text document (or plain text), like the health notes, with the same length cap.
  const personalityNotes = f.richText('personalityNotes')
  if (personalityNotes !== undefined) put('personalityNotesDoc', personalityNotes)
  // Same as the health notes: a document (or plain text), written to the document column; the legacy text column is cleared.
  const description = f.richText('description', { maxChars: DESCRIPTION_MAX_CHARS })
  if (description !== undefined) {
    put('descriptionDoc', description)
    put('description', null)
  }
  put('videoUrl', f.text('videoUrl', 300, { validate: (s) => validateHttpsUrl(s) }))
  put('adoptionFee', f.number('adoptionFee', { min: 0 }))
  put('rescuedAt', f.date('rescuedAt'))
  put(
    'contactWhatsApp',
    f.text('contactWhatsApp', 40, {
      validate: (s) => normalizePhone(s) !== '' || 'Enter a valid number, for example +60 12-345 6789.',
    }),
  )
  put('seoTitle', f.text('seoTitle', 70))
  put('seoDescription', f.text('seoDescription', 160))
  put('seoImageId', f.id('seoImageId'))
  const slugInput = f.slug('slug')
  const photoIds = f.ids('photoIds', { min: creating ? 1 : 0, max: MAX_PHOTOS })
  if (input.photoIds !== undefined && photoIds && photoIds.length === 0) f.fail_('photoIds', 'Add at least 1.')
  f.done()

  const { db, t, withTransaction } = await getDatabase()

  let existing: PetRow | undefined
  if (!creating) {
    ;[existing] = await db.select().from(t.pets).where(eq(t.pets.id, id)).limit(1)
    if (!existing) throw new UserError('Pet not found.')
  }

  // Saving the same estimated date again (an edit that left the age alone) must not turn it into an exact one.
  if (existing && estimated === undefined && v.birthDate !== undefined && v.birthDate === existing.birthDate) {
    v.birthDateEstimated = existing.birthDateEstimated
  }

  // Every referenced image must exist, so the database never has to reject the write halfway.
  const mediaIds = [...(photoIds ?? []), ...(v.seoImageId ? [v.seoImageId] : [])]
  if (mediaIds.length) {
    const found = await getMediaByIds(mediaIds)
    const errors: Record<string, string> = {}
    if (photoIds?.some((m) => !found.has(m))) errors.photoIds = 'One of the photos no longer exists.'
    if (v.seoImageId && !found.has(v.seoImageId)) errors.seoImageId = 'That image no longer exists.'
    if (Object.keys(errors).length) throw new ValidationError(errors)
  }

  // The display location follows city and state ("Petaling Jaya, Selangor"); a city equal to the
  // state shows once. A pet with neither keeps whatever `location` text it has.
  if (v.city !== undefined || v.state !== undefined) {
    const city = v.city !== undefined ? v.city : existing?.city
    const state = v.state !== undefined ? v.state : existing?.state
    const parts = [city, state].filter((p): p is string => Boolean(p))
    const unique = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i)
    if (unique.length) v.location = unique.join(', ')
    // Both cleared: the text built from them goes too, instead of lingering in the catalog and the
    // search. (Unless one was typed, or the pet never had a city or state: then `location` is its own.)
    else if (v.location === undefined && (existing?.city || existing?.state)) v.location = null
  }

  // Stamp the adoption date when a pet is marked adopted, and clear it when it is not any more.
  const status = v.status ?? existing?.status ?? PetStatus.Available
  if (status === PetStatus.Adopted) v.adoptedAt = existing?.adoptedAt ?? new Date()
  else if (!creating && v.status) v.adoptedAt = null

  // The slug stays put on partial updates so public URLs never change by accident.
  const name = v.name ?? existing?.name ?? ''

  // Folded copies for search, from the values the pet will have after this save.
  const breed = v.breed !== undefined ? v.breed : existing?.breed
  const location = v.location !== undefined ? v.location : existing?.location
  v.searchText = petSearchText({ name, breed, location })
  v.locationSearch = foldText(location) || null
  const generated = !slugInput && !existing?.slug
  let slug = slugInput ?? existing?.slug ?? ''
  if (!slug) slug = await uniqueSlug(db, t, name, id)

  for (let attempt = 0; ; attempt++) {
    v.slug = slug
    try {
      const saved = await withTransaction(async (tx) => {
        let petId: number
        if (creating) {
          const [row] = await tx.insert(t.pets).values(v as PetInsert).returning({ id: t.pets.id })
          petId = row.id
        } else {
          await tx.update(t.pets).set({ ...v, updatedAt: new Date() }).where(eq(t.pets.id, id))
          petId = id
        }
        if (photoIds) {
          await tx.delete(t.petPhotos).where(eq(t.petPhotos.petId, petId))
          await tx.insert(t.petPhotos).values(photoIds.map((mediaId, position) => ({ petId, mediaId, position })))
        }
        return petId
      })
      // Pet grids can sit on any page the owners build, so refresh the whole site.
      safeRevalidate([['/', 'layout']])
      return { id: saved, slug }
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Two owners saving the same name at the same moment both saw the address as free, and the
        // database let one win. A generated address is nobody's choice, so just pick another one.
        if (generated && attempt < 5) {
          slug = `${slugify(name) || 'pet'}-${randomBytes(3).toString('hex')}`
          continue
        }
        throw new ValidationError({ slug: 'Another pet already uses this address.' })
      }
      // A photo or the share image was deleted after it was checked above.
      if (isForeignKeyViolation(error)) {
        throw new ValidationError({ photoIds: 'One of the images no longer exists. Pick it again.' })
      }
      throw error
    }
  }
}

export async function deletePet(id: number): Promise<void> {
  const { db, t } = await getDatabase()
  const deleted = await db.delete(t.pets).where(eq(t.pets.id, id)).returning({ id: t.pets.id })
  if (!deleted.length) throw new UserError('Pet not found.')
  safeRevalidate([['/', 'layout']])
}

/** The pet's folded search text: name, breed and location (see foldText). */
export function petSearchText(pet: { name?: string | null; breed?: string | null; location?: string | null }): string {
  return [pet.name, pet.breed, pet.location].map(foldText).filter(Boolean).join('\n')
}

