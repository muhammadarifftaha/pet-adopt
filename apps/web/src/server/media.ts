// Media rows. The files themselves are handled by src/server/uploads.ts.
import { foldText } from '@pet-adopt/plugin-sdk'
import { count, desc, eq, inArray, like } from 'drizzle-orm'

import { getDatabase } from '@/db/client'
import type * as S from '@/db/schema/sqlite'
import { cleanMediaName } from '@/lib/media-name'
import { safeRevalidate } from '@/lib/revalidate'

import { mediaUrl, thumbnailFilename } from './media-url'
import { isForeignKeyViolation, UserError, ValidationError } from './result'
import type { MediaItem } from './types'

export type MediaRow = typeof S.media.$inferSelect

export function toMedia(row: MediaRow): MediaItem {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    width: row.width,
    height: row.height,
    alt: row.alt,
    name: row.name ?? null,
    url: mediaUrl(row.filename),
    thumbnailUrl: mediaUrl(thumbnailFilename(row.filename)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** A page number from outside: a whole number from 1 to 10000, whatever was sent. */
const pageNumber = (value: unknown) => Math.min(Math.max(Math.floor(Number(value)) || 1, 1), 10_000)

export async function listMedia(opts: { page?: number; limit?: number; search?: string } = {}) {
  const { db, t } = await getDatabase()
  const limit = Math.min(Math.max(Math.floor(Number(opts.limit)) || 24, 1), 100)
  const page = pageNumber(opts.page)
  // Folded term against the folded name and alt text: the same on every database (see foldText).
  const term = foldText(opts.search).replace(/[%_\\]/g, '').trim()
  const where = term ? like(t.media.searchText, `%${term}%`) : undefined
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(t.media).where(where).orderBy(desc(t.media.createdAt), desc(t.media.id)).limit(limit).offset((page - 1) * limit),
    db.select({ total: count() }).from(t.media).where(where),
  ])
  return {
    docs: rows.map(toMedia),
    totalDocs: total,
    totalPages: Math.max(Math.ceil(total / limit), 1),
    page,
    limit,
  }
}

export async function getMediaByIds(ids: number[]): Promise<Map<number, MediaItem>> {
  const map = new Map<number, MediaItem>()
  if (!ids.length) return map
  const { db, t } = await getDatabase()
  const rows = await db.select().from(t.media).where(inArray(t.media.id, ids))
  for (const row of rows) map.set(row.id, toMedia(row))
  return map
}

export async function getMedia(id: number): Promise<MediaItem | null> {
  return (await getMediaByIds([id])).get(id) ?? null
}

export async function createMediaRow(input: {
  filename: string
  mimeType: string
  size: number
  width: number | null
  height: number | null
  alt: string
  name?: string | null
}): Promise<MediaItem> {
  const { db, t } = await getDatabase()
  const [row] = await db.insert(t.media).values({ ...input, searchText: mediaSearchText(input) }).returning()
  return toMedia(row)
}

/**
 * The image page's form: display name and alt text together, one error per field. The name is
 * only a label (cleaned by `cleanMediaName`); the stored file keeps its random name, so links and
 * pages that show the image are unaffected.
 */
export async function updateMediaDetails(id: number, input: { name: string; alt: string }): Promise<MediaItem> {
  const errors: Record<string, string> = {}
  const name = cleanMediaName(typeof input.name === 'string' ? input.name : '')
  if (!name) errors.name = 'Give the image a name.'
  const alt = typeof input.alt === 'string' ? input.alt.trim() : ''
  if (!alt) errors.alt = 'Describe the image in a few words (the alt text).'
  else if (alt.length > 200) errors.alt = 'Keep the alt text under 200 characters.'
  if (Object.keys(errors).length) throw new ValidationError(errors)
  const { db, t } = await getDatabase()
  const [row] = await db.update(t.media).set({ name, alt, searchText: mediaSearchText({ name, alt }), updatedAt: new Date() }).where(eq(t.media.id, id)).returning()
  if (!row) throw new UserError('Image not found.')
  // The alt text is printed on every page that shows the image.
  safeRevalidate([['/', 'layout']])
  return toMedia(row)
}

export async function updateMediaAlt(id: number, alt: string): Promise<MediaItem> {
  const text = alt.trim()
  if (!text) throw new UserError('Describe the image in a few words (the alt text).')
  if (text.length > 200) throw new UserError('Keep the alt text under 200 characters.')
  const { db, t } = await getDatabase()
  const [current] = await db.select({ name: t.media.name }).from(t.media).where(eq(t.media.id, id)).limit(1)
  const [row] = await db
    .update(t.media)
    .set({ alt: text, searchText: mediaSearchText({ name: current?.name, alt: text }), updatedAt: new Date() })
    .where(eq(t.media.id, id))
    .returning()
  if (!row) throw new UserError('Image not found.')
  // The alt text is printed on every page that shows the image.
  safeRevalidate([['/', 'layout']])
  return toMedia(row)
}

/**
 * Every page layout and email template as text, for finding images placed inside them. Read once
 * and passed to `mediaUsage` when several images are checked in a row (a bulk delete): the layouts
 * do not change while images are deleted, and reading them again for each image is the slow part.
 */
export type LayoutTexts = { pages: string[]; emails: string[]; /** Each pet timeline entry's photo ids. */ timeline: number[][] }

export async function loadLayoutTexts(): Promise<LayoutTexts> {
  const { db, t } = await getDatabase()
  const [pages, emails, timeline] = await Promise.all([
    db.select({ draft: t.pages.puckDraft, published: t.pages.puckPublished }).from(t.pages),
    db.select({ data: t.emailTemplates.data }).from(t.emailTemplates),
    // Timeline photos are JSON id lists (src/server/pet-timeline.ts), compared here in JavaScript so it
    // works the same on both databases (a pet holds at most a few hundred entries).
    db.select({ photoIds: t.petTimelineEntries.photoIds }).from(t.petTimelineEntries),
  ])
  return {
    pages: pages.map((page) => JSON.stringify([page.draft, page.published])),
    emails: emails.map((template) => JSON.stringify(template.data)),
    timeline: timeline.map((row) => (Array.isArray(row.photoIds) ? row.photoIds : [])),
  }
}

/** Where an image is used. Deleting one that is in use would strip a pet's photos or a page's share image. */
export async function mediaUsage(id: number, layoutTexts?: LayoutTexts) {
  const { db, t } = await getDatabase()
  const one = async (query: Promise<Array<{ n: number }>>) => (await query)[0]?.n ?? 0
  const [petPhotos, petShares, pages, logo, favicon, [row]] = await Promise.all([
    one(db.select({ n: count() }).from(t.petPhotos).where(eq(t.petPhotos.mediaId, id))),
    one(db.select({ n: count() }).from(t.pets).where(eq(t.pets.seoImageId, id))),
    one(db.select({ n: count() }).from(t.pages).where(eq(t.pages.seoImageId, id))),
    one(db.select({ n: count() }).from(t.siteSettings).where(eq(t.siteSettings.logoId, id))),
    one(db.select({ n: count() }).from(t.siteSettings).where(eq(t.siteSettings.faviconId, id))),
    db.select({ filename: t.media.filename }).from(t.media).where(eq(t.media.id, id)).limit(1),
  ])

  // Images placed in a page layout (a Hero or Gallery block) are saved inline in the layout JSON,
  // not as references the database can see. Their file name is random and unique, so finding it in
  // the JSON text finds exactly the pages that use it.
  let layouts = 0
  let emails = 0
  let timeline = 0
  if (row) {
    const texts = layoutTexts ?? (await loadLayoutTexts())
    // Timeline entries that show it (by id: their photos are a JSON list of media ids).
    timeline = texts.timeline.filter((ids) => ids.includes(id)).length
    layouts = texts.pages.filter((text) => text.includes(row.filename)).length
    // Email templates keep their Image blocks the same way.
    emails = texts.emails.filter((text) => text.includes(row.filename)).length
  }
  return { pets: petPhotos + petShares, pages, logo: logo > 0, favicon: favicon > 0, layouts, emails, timeline }
}

/** Deletes the row and returns its filename so the caller can remove the stored files. */
export async function deleteMediaRow(id: number, layoutTexts?: LayoutTexts): Promise<string> {
  const { db, t } = await getDatabase()
  const [row] = await db.select().from(t.media).where(eq(t.media.id, id)).limit(1)
  if (!row) throw new UserError('Image not found.')
  const usage = await mediaUsage(id, layoutTexts)
  const stillUsed = () => {
    const where = [
      usage.pets ? `${usage.pets} pet(s)` : '',
      usage.pages ? `${usage.pages} page(s)` : '',
      usage.layouts ? `${usage.layouts} page layout(s)` : '',
      usage.emails ? `${usage.emails} email template(s)` : '',
      usage.timeline ? `${usage.timeline} pet timeline entr${usage.timeline === 1 ? 'y' : 'ies'}` : '',
      usage.logo ? 'the site logo' : '',
      usage.favicon ? 'the site icon (favicon)' : '',
    ].filter(Boolean)
    return new UserError(`This image is still used by ${where.join(' and ') || 'something else'}. Replace it there first.`)
  }
  if (usage.pets + usage.pages + usage.layouts + usage.emails + usage.timeline > 0 || usage.logo || usage.favicon) throw stillUsed()
  try {
    await db.delete(t.media).where(eq(t.media.id, id))
  } catch (error) {
    // A pet claimed the image between the check above and the delete: the database refused.
    if (isForeignKeyViolation(error)) throw stillUsed()
    throw error
  }
  return row.filename
}

/** The image's folded search text: display name and alt text (see foldText). */
export function mediaSearchText(media: { name?: string | null; alt?: string | null }): string {
  return [media.name, media.alt].map(foldText).filter(Boolean).join('\n')
}

