// A pet's timeline: dated updates (arrived, vaccinated, moved to a foster home...) shown on its page
// by the Pet timeline block. Each entry is its own row (pet_timeline_entries), so adding one never
// resaves the pet or the other entries. Shapes and limits are in src/lib/pet-timeline.ts.
import { count, eq } from 'drizzle-orm'

import { getDatabase, type Db, type Schema } from '@/db/client'
import type * as S from '@/db/schema/sqlite'
import {
  compareTimelineNewestFirst,
  TIME_PATTERN,
  TIMELINE_MAX_ENTRIES,
  TIMELINE_MAX_PHOTOS,
  TIMELINE_TEXT_MAX_CHARS,
  TIMELINE_TITLE_MAX,
  type TimelineEntry,
  type TimelinePhoto,
} from '@/lib/pet-timeline'
import { safeRevalidate } from '@/lib/revalidate'

import { getMediaByIds } from './media'
import { asRecord, Fields, UserError, ValidationError } from './result'

type EntryRow = typeof S.petTimelineEntries.$inferSelect
type EntryInsert = typeof S.petTimelineEntries.$inferInsert

const entryColumns = (t: Schema) => ({ entry: t.petTimelineEntries, createdByName: t.users.name })

/** Rows (with the creator's name) as entries, photos resolved; newest first. */
async function toEntries(rows: Array<{ entry: EntryRow; createdByName: string | null }>): Promise<TimelineEntry[]> {
  const media = await getMediaByIds([...new Set(rows.flatMap((row) => photoIdsOf(row.entry)))])
  return rows
    .map(({ entry, createdByName }) => {
      const photoIds = photoIdsOf(entry)
      const photos: TimelinePhoto[] = []
      for (const id of photoIds) {
        const item = media.get(id)
        // A deleted image is left out; its id stays until the entry is saved again.
        if (item) photos.push({ id, url: item.url, alt: item.alt || '', thumbnailUrl: item.thumbnailUrl })
      }
      return {
        id: entry.id,
        petId: entry.petId,
        date: entry.date,
        time: entry.time ?? null,
        title: entry.title,
        body: entry.bodyDoc ?? null,
        photoIds,
        photos,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
        createdByName: createdByName ?? null,
      }
    })
    .sort(compareTimelineNewestFirst)
}

/** The stored id list, whatever an older or hand-edited row holds. */
const photoIdsOf = (entry: EntryRow): number[] =>
  Array.isArray(entry.photoIds) ? entry.photoIds.filter((id): id is number => Number.isSafeInteger(id) && id > 0) : []

async function selectEntries(db: Db, t: Schema, where: ReturnType<typeof eq>) {
  return db.select(entryColumns(t)).from(t.petTimelineEntries).leftJoin(t.users, eq(t.users.id, t.petTimelineEntries.createdBy)).where(where)
}

/** Every entry of a pet, newest first (by day, then time, then id). */
export async function listTimeline(petId: number): Promise<TimelineEntry[]> {
  const { db, t } = await getDatabase()
  return toEntries(await selectEntries(db, t, eq(t.petTimelineEntries.petId, petId)))
}

/** One entry, or null. */
export async function getTimelineEntry(entryId: number): Promise<TimelineEntry | null> {
  const { db, t } = await getDatabase()
  const [entry] = await toEntries(await selectEntries(db, t, eq(t.petTimelineEntries.id, entryId)))
  return entry ?? null
}

/** The pet an entry belongs to (for the activity log and revalidating its page), or null. */
export async function timelinePet(petId: number): Promise<{ id: number; name: string; slug: string } | null> {
  const { db, t } = await getDatabase()
  const [pet] = await db.select({ id: t.pets.id, name: t.pets.name, slug: t.pets.slug }).from(t.pets).where(eq(t.pets.id, petId)).limit(1)
  return pet ?? null
}

/**
 * Checks an entry's fields. Adding needs the date and the title; editing changes only the keys
 * sent (a date or title sent blank is an error). Field keys: date, time, title, body, photoIds.
 */
async function parseEntry(raw: unknown, creating: boolean): Promise<Partial<EntryInsert>> {
  const input = asRecord(raw)
  const f = new Fields(input, creating)
  const v: Partial<EntryInsert> = {}

  const date = f.date('date')
  if (date === null || (creating && date === undefined && !f.errors.date)) f.fail_('date', 'Pick the day it happened.')
  else if (date) v.date = date

  const time = f.text('time', 10, { validate: (s) => TIME_PATTERN.test(s) || 'Use a time like 09:30 (24-hour).' })
  if (time !== undefined) v.time = time

  const title = f.requiredText('title', TIMELINE_TITLE_MAX, {})
  if (title) v.title = title.replace(/\s+/g, ' ')

  // A rich-text document, or plain text (one paragraph per line), as the pet description takes.
  const body = f.richText('body', { maxChars: TIMELINE_TEXT_MAX_CHARS })
  if (body !== undefined) v.bodyDoc = body

  if (input.photoIds === null) v.photoIds = []
  else {
    const photoIds = f.ids('photoIds', { max: TIMELINE_MAX_PHOTOS })
    if (photoIds) v.photoIds = photoIds
  }
  f.done()

  // Every photo must be an image in the media library.
  if (v.photoIds?.length) {
    const found = await getMediaByIds(v.photoIds)
    if (v.photoIds.some((id) => !found.has(id))) throw new ValidationError({ photoIds: 'One of the photos no longer exists. Pick it again.' })
  }
  return v
}

const revalidatePet = (slug: string | undefined) => {
  if (slug) safeRevalidate([`/pets/${slug}`])
}

/** Adds an entry to a pet's timeline (at most TIMELINE_MAX_ENTRIES per pet). */
export async function addTimelineEntry(petId: number, raw: unknown, userId: string | null): Promise<TimelineEntry> {
  const v = await parseEntry(raw, true)
  const { t, withTransaction } = await getDatabase()
  // Counted and inserted under one lock per pet, so two parallel adds cannot both pass the limit.
  const { id, slug } = await withTransaction(
    async (tx) => {
      const [pet] = await tx.select({ slug: t.pets.slug }).from(t.pets).where(eq(t.pets.id, petId)).limit(1)
      if (!pet) throw new UserError('Pet not found.')
      const [{ n }] = await tx.select({ n: count() }).from(t.petTimelineEntries).where(eq(t.petTimelineEntries.petId, petId))
      if (n >= TIMELINE_MAX_ENTRIES) throw new UserError(`A pet's timeline holds at most ${TIMELINE_MAX_ENTRIES} entries. Delete an older one first.`)
      const [row] = await tx
        .insert(t.petTimelineEntries)
        .values({ ...v, petId, createdBy: userId, photoIds: v.photoIds ?? [] } as EntryInsert)
        .returning({ id: t.petTimelineEntries.id })
      return { id: row.id, slug: pet.slug }
    },
    { lock: `pets:${petId}:timeline` },
  )
  revalidatePet(slug)
  const entry = await getTimelineEntry(id)
  if (!entry) throw new UserError('Timeline entry not found.')
  return entry
}

/** Changes the fields sent; the others stay as they are. */
export async function updateTimelineEntry(entryId: number, raw: unknown): Promise<TimelineEntry> {
  const v = await parseEntry(raw, false)
  const { db, t } = await getDatabase()
  const [row] = await db
    .update(t.petTimelineEntries)
    .set({ ...v, updatedAt: new Date() })
    .where(eq(t.petTimelineEntries.id, entryId))
    .returning({ petId: t.petTimelineEntries.petId })
  if (!row) throw new UserError('Timeline entry not found.')
  revalidatePet((await timelinePet(row.petId))?.slug)
  const entry = await getTimelineEntry(entryId)
  if (!entry) throw new UserError('Timeline entry not found.')
  return entry
}

/** Deletes one entry; returns what the activity log needs. */
export async function deleteTimelineEntry(entryId: number): Promise<{ petId: number; title: string }> {
  const { db, t } = await getDatabase()
  const [row] = await db
    .delete(t.petTimelineEntries)
    .where(eq(t.petTimelineEntries.id, entryId))
    .returning({ petId: t.petTimelineEntries.petId, title: t.petTimelineEntries.title })
  if (!row) throw new UserError('Timeline entry not found.')
  revalidatePet((await timelinePet(row.petId))?.slug)
  return row
}
