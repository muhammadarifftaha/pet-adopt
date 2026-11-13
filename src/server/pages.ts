// Builder pages. The layout JSON is kept twice: `puckDraft` (what the page builder edits) and
// `puckPublished` (what visitors see), so saving a draft never changes the live page.
import { desc, eq } from 'drizzle-orm'

import { getDatabase } from '@/db/client'
import type * as S from '@/db/schema/sqlite'
import { RESERVED_SLUGS } from '@/lib/options'
import { safeRevalidate } from '@/lib/revalidate'
import { isPuckData, stripTransient } from '@/puck/data'

import { getMediaByIds } from './media'
import { asRecord, Fields, isUniqueViolation, UserError, ValidationError } from './result'
import type { MediaItem, Page, PageStatus } from './types'

type PageRow = typeof S.pages.$inferSelect

const toPath = (slug: string) => (slug === 'home' ? '/' : `/${slug}`)

function toPage(row: PageRow, image: MediaItem | null): Page {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status === 'published' ? 'published' : 'draft',
    puckDraft: row.puckDraft ?? null,
    puckPublished: row.puckPublished ?? null,
    seo: { description: row.seoDescription, image },
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function withImage(row: PageRow | undefined): Promise<Page | null> {
  if (!row) return null
  const image = row.seoImageId ? ((await getMediaByIds([row.seoImageId])).get(row.seoImageId) ?? null) : null
  return toPage(row, image)
}

export async function listPages(): Promise<Array<Omit<Page, 'puckDraft' | 'puckPublished'> & { hasUnpublishedChanges: boolean }>> {
  const { db, t } = await getDatabase()
  const rows = await db.select().from(t.pages).orderBy(desc(t.pages.updatedAt))
  return rows.map((row) => {
    const { puckDraft, puckPublished, ...page } = toPage(row, null)
    return {
      ...page,
      hasUnpublishedChanges: JSON.stringify(puckDraft ?? null) !== JSON.stringify(puckPublished ?? null) && puckDraft != null,
    }
  })
}

export async function getPageById(id: number): Promise<Page | null> {
  const { db, t } = await getDatabase()
  const [row] = await db.select().from(t.pages).where(eq(t.pages.id, id)).limit(1)
  return withImage(row)
}

/** The published version of a page, or null. Visitors only ever see this. */
export async function getPublishedPage(slug: string): Promise<(Page & { puckData: unknown }) | null> {
  const { db, t } = await getDatabase()
  const [row] = await db.select().from(t.pages).where(eq(t.pages.slug, slug)).limit(1)
  if (!row || row.status !== 'published' || row.puckPublished == null) return null
  const page = await withImage(row)
  return page && { ...page, puckData: page.puckPublished }
}

function parseDetails(raw: unknown, creating: boolean) {
  const f = new Fields(asRecord(raw), creating)
  const values = {
    title: f.requiredText('title', 120),
    slug: f.slug('slug', { required: true, reserved: RESERVED_SLUGS }),
    seoDescription: f.text('seoDescription', 200),
    seoImageId: f.id('seoImageId'),
  }
  f.done()
  return values
}

async function assertImage(imageId: number | null | undefined) {
  if (imageId && !(await getMediaByIds([imageId])).has(imageId)) {
    throw new ValidationError({ seoImageId: 'That image no longer exists.' })
  }
}

/** Title, address and share details of a page. The layout is edited with saveDraft/publish. */
export async function savePageDetails(id: number | null, raw: unknown): Promise<{ id: number; slug: string }> {
  const values = parseDetails(raw, id === null)
  await assertImage(values.seoImageId)
  const { db, t } = await getDatabase()
  const defined = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined))
  try {
    if (id === null) {
      const [row] = await db
        .insert(t.pages)
        .values(defined as unknown as typeof t.pages.$inferInsert)
        .returning({ id: t.pages.id, slug: t.pages.slug })
      safeRevalidate([toPath(row.slug)])
      return row
    }
    const [before] = await db.select({ slug: t.pages.slug }).from(t.pages).where(eq(t.pages.id, id)).limit(1)
    if (!before) throw new UserError('Page not found.')
    const [row] = await db
      .update(t.pages)
      .set({ ...defined, updatedAt: new Date() })
      .where(eq(t.pages.id, id))
      .returning({ id: t.pages.id, slug: t.pages.slug })
    safeRevalidate([toPath(row.slug), toPath(before.slug)])
    return row
  } catch (error) {
    if (isUniqueViolation(error)) throw new ValidationError({ slug: 'Another page already uses this address.' })
    throw error
  }
}

function cleanLayout(data: unknown) {
  // Render-only props (such as PetGrid's `pets`) must never be saved, whatever the save path.
  if (!isPuckData(data)) throw new UserError('The page data looks invalid, so nothing was saved.')
  return stripTransient(data)
}

export async function saveDraft(id: number, data: unknown): Promise<void> {
  const layout = cleanLayout(data)
  const { db, t } = await getDatabase()
  const updated = await db
    .update(t.pages)
    .set({ puckDraft: layout, updatedAt: new Date() })
    .where(eq(t.pages.id, id))
    .returning({ id: t.pages.id })
  if (!updated.length) throw new UserError('Page not found.')
}

/** Saves `data` (when given) as the draft, then makes the draft the live page. */
export async function publishPage(id: number, data?: unknown): Promise<{ slug: string }> {
  const { db, t } = await getDatabase()
  const [row] = await db.select().from(t.pages).where(eq(t.pages.id, id)).limit(1)
  if (!row) throw new UserError('Page not found.')
  const layout = data !== undefined ? cleanLayout(data) : row.puckDraft
  if (layout == null) throw new UserError('This page has no layout yet. Open the page builder first.')
  await db
    .update(t.pages)
    .set({ puckDraft: layout, puckPublished: layout, status: 'published' as PageStatus, publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(t.pages.id, id))
  safeRevalidate([toPath(row.slug)])
  return { slug: row.slug }
}

/** Takes the page offline. The draft is kept. */
export async function unpublishPage(id: number): Promise<void> {
  const { db, t } = await getDatabase()
  const [row] = await db
    .update(t.pages)
    .set({ puckPublished: null, status: 'draft' as PageStatus, publishedAt: null, updatedAt: new Date() })
    .where(eq(t.pages.id, id))
    .returning({ slug: t.pages.slug })
  if (!row) throw new UserError('Page not found.')
  safeRevalidate([toPath(row.slug)])
}

export async function deletePage(id: number): Promise<void> {
  const { db, t } = await getDatabase()
  const [row] = await db.delete(t.pages).where(eq(t.pages.id, id)).returning({ slug: t.pages.slug })
  if (!row) throw new UserError('Page not found.')
  safeRevalidate([toPath(row.slug)])
}
