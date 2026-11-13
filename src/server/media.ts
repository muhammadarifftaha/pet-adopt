// Media rows. The files themselves are handled by src/server/uploads.ts.
import { and, count, desc, eq, inArray, like } from 'drizzle-orm'

import { getDatabase } from '@/db/client'
import type * as S from '@/db/schema/sqlite'

import { mediaUrl, thumbnailFilename } from './media-url'
import { UserError } from './result'
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
    url: mediaUrl(row.filename),
    thumbnailUrl: mediaUrl(thumbnailFilename(row.filename)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function listMedia(opts: { page?: number; limit?: number; search?: string } = {}) {
  const { db, t } = await getDatabase()
  const limit = Math.min(Math.max(opts.limit ?? 24, 1), 100)
  const page = Math.max(opts.page ?? 1, 1)
  const term = opts.search?.replace(/[%_\\]/g, '').trim().toLowerCase()
  const where = term ? like(t.media.alt, `%${term}%`) : undefined
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
}): Promise<MediaItem> {
  const { db, t } = await getDatabase()
  const [row] = await db.insert(t.media).values(input).returning()
  return toMedia(row)
}

export async function updateMediaAlt(id: number, alt: string): Promise<MediaItem> {
  const text = alt.trim()
  if (!text) throw new UserError('Describe the image in a few words (the alt text).')
  if (text.length > 200) throw new UserError('Keep the alt text under 200 characters.')
  const { db, t } = await getDatabase()
  const [row] = await db.update(t.media).set({ alt: text, updatedAt: new Date() }).where(eq(t.media.id, id)).returning()
  if (!row) throw new UserError('Image not found.')
  return toMedia(row)
}

/** Where an image is used. Deleting one that is in use would strip a pet's photos or a page's share image. */
export async function mediaUsage(id: number) {
  const { db, t } = await getDatabase()
  const one = async (query: Promise<Array<{ n: number }>>) => (await query)[0]?.n ?? 0
  const [petPhotos, petShares, pages, logo] = await Promise.all([
    one(db.select({ n: count() }).from(t.petPhotos).where(eq(t.petPhotos.mediaId, id))),
    one(db.select({ n: count() }).from(t.pets).where(eq(t.pets.seoImageId, id))),
    one(db.select({ n: count() }).from(t.pages).where(eq(t.pages.seoImageId, id))),
    one(db.select({ n: count() }).from(t.siteSettings).where(eq(t.siteSettings.logoId, id))),
  ])
  return { pets: petPhotos + petShares, pages, logo: logo > 0 }
}

/** Deletes the row and returns its filename so the caller can remove the stored files. */
export async function deleteMediaRow(id: number): Promise<string> {
  const { db, t } = await getDatabase()
  const [row] = await db.select().from(t.media).where(eq(t.media.id, id)).limit(1)
  if (!row) throw new UserError('Image not found.')
  const usage = await mediaUsage(id)
  if (usage.pets + usage.pages > 0 || usage.logo) {
    const where = [
      usage.pets ? `${usage.pets} pet(s)` : '',
      usage.pages ? `${usage.pages} page(s)` : '',
      usage.logo ? 'the site logo' : '',
    ].filter(Boolean)
    throw new UserError(`This image is still used by ${where.join(' and ')}. Replace it there first.`)
  }
  await db.delete(t.media).where(and(eq(t.media.id, id)))
  return row.filename
}
