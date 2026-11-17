// Builder pages. The layout JSON is kept twice: `puckDraft` (what the page builder edits) and
// `puckPublished` (what visitors see), so saving a draft never changes the live page.
//
// Two people (or two tabs) editing the same page would silently overwrite each other, so a save or
// publish can carry the `version` it was based on (the page's `updatedAt` in milliseconds, which
// every save returns). If the page has changed since, nothing is written and the person is told to
// reload. Leave `baseVersion` out to write regardless.
import { and, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm'

import { getDatabase } from '@/db/client'
import type * as S from '@/db/schema/sqlite'
import { RESERVED_SLUGS } from '@/lib/options'
import { safeRevalidate } from '@/lib/revalidate'
import { isPuckData, stripControlChars, stripTransient } from '@/puck/data'

import { getMediaByIds } from './media'
import { asRecord, Fields, isUniqueViolation, UserError, ValidationError } from './result'
import type { MediaItem, Page, PageStatus } from './types'

type PageRow = typeof S.pages.$inferSelect

const toPath = (slug: string) => (slug === 'home' ? '/' : `/${slug}`)

const CONFLICT =
  'This page was changed somewhere else (another tab, or another person) since you opened it. ' +
  'Reload the page builder to see the latest version, then make your change again.'

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
    // Deleted by someone else between the lookup and the update.
    if (!row) throw new UserError('Page not found.')
    safeRevalidate([toPath(row.slug), toPath(before.slug)])
    return row
  } catch (error) {
    if (isUniqueViolation(error)) throw new ValidationError({ slug: 'Another page already uses this address.' })
    throw error
  }
}

/**
 * The `updatedAt` a save writes. A version is that time in milliseconds, so two saves in the same
 * millisecond would share one and a stale save would slip through; making each version strictly
 * greater than the one it was based on rules that out.
 */
function nextVersion(baseVersion?: number): Date {
  return new Date(Math.max(Date.now(), (baseVersion ?? 0) + 1))
}

/**
 * Matches rows whose `updatedAt` is the given version, to the millisecond. Not an exact equality:
 * PostgreSQL fills a new row's timestamp from its own clock with microseconds (.123456), while a
 * version is milliseconds (.123), so `=` would reject the first save of every new page.
 */
function atVersion(t: { pages: { updatedAt: Parameters<typeof gte>[0] } }, version: number) {
  return and(gte(t.pages.updatedAt, new Date(version)), lt(t.pages.updatedAt, new Date(version + 1)))
}

function cleanLayout(data: unknown) {
  // Render-only props (such as PetGrid's `pets`) must never be saved, whatever the save path.
  if (!isPuckData(data)) throw new UserError('The page data looks invalid, so nothing was saved.')
  // A NUL anywhere in the JSON makes PostgreSQL refuse the whole save.
  return stripTransient(stripControlChars(data))
}

export async function saveDraft(id: number, data: unknown, baseVersion?: number): Promise<{ version: number }> {
  const layout = cleanLayout(data)
  const { db, t } = await getDatabase()
  const now = nextVersion(baseVersion)
  // With a base version the update only matches if nobody has changed the page since.
  const where = baseVersion === undefined ? eq(t.pages.id, id) : and(eq(t.pages.id, id), atVersion(t, baseVersion))
  const updated = await db.update(t.pages).set({ puckDraft: layout, updatedAt: now }).where(where).returning({ id: t.pages.id })
  if (!updated.length) {
    // Nothing matched: either the page is gone, or someone else saved first.
    const [page] = await db.select({ id: t.pages.id }).from(t.pages).where(eq(t.pages.id, id)).limit(1)
    throw new UserError(page ? CONFLICT : 'Page not found.')
  }
  return { version: now.getTime() }
}

/**
 * Makes the draft the live page. With `data`, that layout is saved as the draft first (in the same
 * statement). Without it, the draft already stored is copied across inside the database, so a draft
 * saved at the same moment cannot be overwritten by an older copy read earlier.
 */
export async function publishPage(id: number, data?: unknown, baseVersion?: number): Promise<{ slug: string; version: number }> {
  const { db, t } = await getDatabase()
  const layout = data !== undefined ? cleanLayout(data) : undefined
  const now = nextVersion(baseVersion)
  const set = layout !== undefined ? { puckDraft: layout, puckPublished: layout } : { puckPublished: sql`${t.pages.puckDraft}` }
  const where = and(
    eq(t.pages.id, id),
    baseVersion === undefined ? undefined : atVersion(t, baseVersion),
    layout === undefined ? isNotNull(t.pages.puckDraft) : undefined,
  )
  const [row] = await db
    .update(t.pages)
    .set({ ...set, status: 'published' as PageStatus, publishedAt: now, updatedAt: now } as never)
    .where(where)
    .returning({ slug: t.pages.slug })
  if (!row) {
    const [page] = await db.select({ draft: t.pages.puckDraft }).from(t.pages).where(eq(t.pages.id, id)).limit(1)
    if (!page) throw new UserError('Page not found.')
    if (layout === undefined && page.draft == null) throw new UserError('This page has no layout yet. Open the page builder first.')
    throw new UserError(CONFLICT)
  }
  safeRevalidate([toPath(row.slug)])
  return { slug: row.slug, version: now.getTime() }
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
