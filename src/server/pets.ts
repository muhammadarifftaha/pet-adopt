// Pets: reading, searching and saving. The rules that used to be Payload hooks live in `savePet`.
import { and, count, desc, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm'

import { getDatabase, type Db, type Schema } from '@/db/client'
import type * as S from '@/db/schema/sqlite'
import { validateWebUrl } from '@/lib/links'
import { AGE_GROUPS, GOOD_WITH, SEXES, SIZES, SPECIES, STATUSES, TEMPERAMENTS } from '@/lib/options'
import { safeRevalidate } from '@/lib/revalidate'
import { slugify } from '@/lib/slugify'
import { normalizePhone } from '@/lib/whatsapp'

import { getMediaByIds, toMedia } from './media'
import { asRecord, Fields, isUniqueViolation, UserError, ValidationError } from './result'
import type { MediaItem, Pet, PetPage, PetSummary } from './types'

type PetRow = typeof S.pets.$inferSelect
type PetInsert = typeof S.pets.$inferInsert

export const DEFAULT_PAGE_SIZE = 12
export const MAX_PHOTOS = 10

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
  if (f.species) c.push(eq(t.pets.species, f.species))
  if (f.status) c.push(eq(t.pets.status, f.status))
  if (f.sex) c.push(eq(t.pets.sex, f.sex))
  if (f.ageGroup) c.push(eq(t.pets.ageGroup, f.ageGroup))
  if (f.size) c.push(eq(t.pets.size, f.size))
  // A plain substring match. Strip the LIKE wildcards so visitors cannot turn the search into a pattern.
  const location = f.location?.replace(/[%_\\]/g, '').trim().toLowerCase()
  if (location) c.push(sql`lower(${t.pets.location}) like ${`%${location}%`}`)
  if (f.city) c.push(eq(t.pets.city, f.city))
  if (f.state) c.push(eq(t.pets.state, f.state))
  if (f.featuredOnly) c.push(eq(t.pets.featured, true))
  const search = f.search?.replace(/[%_\\]/g, '').trim().toLowerCase()
  if (search) {
    const like = `%${search}%`
    c.push(or(sql`lower(${t.pets.name}) like ${like}`, sql`lower(${t.pets.breed}) like ${like}`, sql`lower(${t.pets.location}) like ${like}`)!)
  }
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

async function summaries(db: Db, t: Schema, rows: Array<Omit<PetSummary, 'photos'>>): Promise<PetSummary[]> {
  const photos = await loadPhotos(db, t, rows.map((r) => r.id), true)
  return rows.map((r) => ({ ...r, photos: photos.get(r.id) ?? [] }))
}

export async function queryPets(filters: PetFilters = {}): Promise<PetPage> {
  const { db, t } = await getDatabase()
  const limit = Math.min(Math.max(Math.floor(filters.limit ?? DEFAULT_PAGE_SIZE), 1), 100)
  const page = Math.max(Math.floor(filters.page ?? 1), 1)
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
  const limit = Math.min(Math.max(Math.floor(filters.limit ?? DEFAULT_PAGE_SIZE), 1), 100)
  const rows = await db
    .select(summaryColumns(t))
    .from(t.pets)
    .where(and(...conditions(t, filters)))
    .orderBy(desc(t.pets.createdAt), desc(t.pets.id))
    .limit(limit)
  return summaries(db, t, rows)
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

function toPet(row: PetRow, photos: MediaItem[], seoImage: MediaItem | null): Pet {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    species: row.species,
    status: row.status,
    sex: row.sex,
    ageDescription: row.ageDescription,
    location: row.location,
    featured: row.featured,
    unlisted: row.unlisted,
    urgent: row.urgent,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    adoptedAt: row.adoptedAt,
    breed: row.breed,
    ageGroup: row.ageGroup,
    size: row.size,
    birthDate: row.birthDate,
    color: row.color,
    city: row.city,
    state: row.state,
    vaccinated: row.vaccinated,
    neutered: row.neutered,
    microchipped: row.microchipped,
    houseTrained: row.houseTrained,
    specialNeeds: row.specialNeeds,
    healthNotes: row.healthNotes,
    temperament: row.temperament ?? [],
    goodWith: row.goodWith ?? [],
    description: row.description,
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
  put('species', f.oneOf('species', SPECIES) ?? undefined)
  put('sex', f.oneOf('sex', SEXES))
  put('ageGroup', f.oneOf('ageGroup', AGE_GROUPS))
  put('size', f.oneOf('size', SIZES))
  put('breed', f.text('breed', 80))
  put('ageDescription', f.text('ageDescription', 40))
  put('birthDate', f.date('birthDate'))
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
  put('healthNotes', f.text('healthNotes', 500))
  put('temperament', f.list('temperament', TEMPERAMENTS))
  put('goodWith', f.list('goodWith', GOOD_WITH))
  put('description', f.text('description', 5000))
  put('videoUrl', f.text('videoUrl', 300, { validate: (s) => validateWebUrl(s) }))
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
  }

  // Stamp the adoption date when a pet is marked adopted, and clear it when it is not any more.
  const status = v.status ?? existing?.status ?? 'available'
  if (status === 'adopted') v.adoptedAt = existing?.adoptedAt ?? new Date()
  else if (!creating && v.status) v.adoptedAt = null

  // The slug stays put on partial updates so public URLs never change by accident.
  const name = v.name ?? existing?.name ?? ''
  let slug = slugInput ?? existing?.slug ?? ''
  if (!slug) slug = await uniqueSlug(db, t, name, id)
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
      throw new ValidationError({ slug: 'Another pet already uses this address.' })
    }
    throw error
  }
}

export async function deletePet(id: number): Promise<void> {
  const { db, t } = await getDatabase()
  const deleted = await db.delete(t.pets).where(eq(t.pets.id, id)).returning({ id: t.pets.id })
  if (!deleted.length) throw new UserError('Pet not found.')
  safeRevalidate([['/', 'layout']])
}
