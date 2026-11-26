// Builder pages. The layout JSON is kept twice: `puckDraft` (what the page builder edits) and
// `puckPublished` (what visitors see), so saving a draft never changes the live page.
//
// Two people (or two tabs) editing the same page would silently overwrite each other, so a save or
// publish can carry the `version` it was based on (the page's `updatedAt` in milliseconds, which
// every save returns). If the page has changed since, nothing is written and the person is told to
// reload. Leave `baseVersion` out to write regardless.
//
// History: one version per publish cycle, in `page_versions` (the latest KEEP_VERSIONS kept).
// The first draft save after a publish opens the next version; later saves update it in place;
// the next publish closes it. So version N holds the layout published as the Nth release (or, for
// the newest, the unpublished work since). Any version can be previewed and copied into the draft.
//
// Archiving takes a page off the site and makes it read-only, keeping everything (including its
// address) so it can be restored as it was. Only an archived page can be deleted.
import type { Data } from '@puckeditor/core'
import { and, desc, eq, gte, isNotNull, isNull, lt, lte, ne, sql } from 'drizzle-orm'
import { isEqual } from 'es-toolkit'

import { getDatabase, type Db, type Schema } from '@/db/client'
import type * as S from '@/db/schema/sqlite'
import { RESERVED_SLUGS } from '@/lib/options'
import { safeRevalidate } from '@/lib/revalidate'
import { DEFAULT_HOME_DATA, DEFAULT_PETS_DATA, isPuckData, isSystemPageSlug, stripControlChars, stripTransient } from '@/puck/data'

import { getMediaByIds } from './media'
import { asRecord, Fields, isUniqueViolation, UserError, ValidationError } from './result'
import type { MediaItem, Page, PageState, PageStatus, PageVersionSummary } from './types'

type PageRow = typeof S.pages.$inferSelect

/** The page shown at "/". It always exists (see ensureSystemPages), keeps this slug, and is never archived. */
export const HOME_SLUG = 'home'
/** The page shown at "/pets" (the catalogue). Same rules as the homepage. */
export const PETS_SLUG = 'pets'

/** How many snapshots each page keeps. */
export const KEEP_VERSIONS = 50

const toPath = (slug: string) => (slug === 'home' ? '/' : `/${slug}`)
/** Serialises writes to one page, so version numbers cannot collide. */
const pageLock = (id: number) => `pages:${id}`

const CONFLICT =
  'This page was changed somewhere else (another tab, or another person) since you opened it. ' +
  'Reload the page builder to see the latest version, then make your change again.'
const ARCHIVED = 'This page is archived. Restore it before making changes.'

/**
 * A page's settings as one value: what a version keeps and what `details_draft` holds. On a live
 * page, saving the settings form stores them as a draft (visitors keep the old title and address);
 * publishing applies them with the layout. On a page that is not live they are written straight away.
 */
export type PageDetails = { title: string; slug: string; seoDescription: string | null; seoImageId: number | null }

const liveDetails = (row: PageRow): PageDetails => ({
  title: row.title,
  slug: row.slug,
  seoDescription: row.seoDescription ?? null,
  seoImageId: row.seoImageId ?? null,
})

/** Stored details (a version's or the draft's), or null when missing or not the right shape. */
function asDetails(value: unknown): PageDetails | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.title !== 'string' || typeof v.slug !== 'string') return null
  return {
    title: v.title,
    slug: v.slug,
    seoDescription: typeof v.seoDescription === 'string' ? v.seoDescription : null,
    seoImageId: typeof v.seoImageId === 'number' ? v.seoImageId : null,
  }
}

/** The settings the next publish will have: the draft's, or else what is live. */
const draftOf = (row: PageRow): PageDetails => asDetails(row.detailsDraft) ?? liveDetails(row)

/**
 * How to store new settings. A live page keeps showing its published title and address, so they wait
 * in `details_draft` until the next publish (cleared when they match what is live again). A page that
 * is not live has nothing to protect: they are written straight away.
 */
function draftSettings(current: PageRow, details: PageDetails) {
  if (current.status === 'published') {
    return { detailsDraft: isEqual(details, liveDetails(current)) ? null : details }
  }
  return { title: details.title, slug: details.slug, seoDescription: details.seoDescription, seoImageId: details.seoImageId, detailsDraft: null }
}

/**
 * Another page uses this address already, live or waiting to be published. The unique index only
 * sees live addresses, so pending ones are checked here: two drafts cannot both claim /about.
 */
async function assertSlugFree(tx: Db, t: Schema, id: number, slug: string, when: 'save' | 'publish' | 'restore') {
  const [live] = await tx.select({ id: t.pages.id }).from(t.pages).where(and(eq(t.pages.slug, slug), ne(t.pages.id, id))).limit(1)
  const pending = live
    ? []
    : await tx.select({ id: t.pages.id, detailsDraft: t.pages.detailsDraft }).from(t.pages).where(and(isNotNull(t.pages.detailsDraft), ne(t.pages.id, id)))
  if (!live && !pending.some((row) => asDetails(row.detailsDraft)?.slug === slug)) return
  if (when === 'save') throw new ValidationError({ slug: 'Another page already uses this address.' })
  throw new UserError(`Another page already uses the address ${toPath(slug)}. Change this page's address before you ${when === 'publish' ? 'publish' : 'restore that version'}.`)
}

/** The image if it still exists, or null (a version or draft may point at one deleted since). */
async function existingImage(id: number | null): Promise<number | null> {
  return id && (await getMediaByIds([id])).has(id) ? id : null
}

function toPage(row: PageRow, image: MediaItem | null, draftImage: MediaItem | null = null): Page {
  const draft = asDetails(row.detailsDraft)
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status === 'published' ? 'published' : 'draft',
    puckDraft: row.puckDraft ?? null,
    puckPublished: row.puckPublished ?? null,
    seo: { description: row.seoDescription, image },
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    draftDetails: draft ? { title: draft.title, slug: draft.slug, seo: { description: draft.seoDescription, image: draftImage } } : null,
  }
}

async function withImage(row: PageRow | undefined): Promise<Page | null> {
  if (!row) return null
  const draftImageId = asDetails(row.detailsDraft)?.seoImageId ?? null
  const ids = [row.seoImageId, draftImageId].filter((id): id is number => typeof id === 'number')
  const images = ids.length ? await getMediaByIds(ids) : new Map<number, MediaItem>()
  return toPage(row, row.seoImageId ? (images.get(row.seoImageId) ?? null) : null, draftImageId ? (images.get(draftImageId) ?? null) : null)
}

export type PageListItem = Omit<Page, 'puckDraft' | 'puckPublished'> & {
  state: PageState
  hasUnpublishedChanges: boolean
  /** The newest snapshot's number, or 0 when the page has none yet. */
  latestVersion: number
}

export async function listPages(): Promise<PageListItem[]> {
  const { db, t } = await getDatabase()
  const rows = await db.select().from(t.pages).orderBy(desc(t.pages.updatedAt))
  const latest = await db
    .select({ pageId: t.pageVersions.pageId, n: sql<number>`max(${t.pageVersions.number})` })
    .from(t.pageVersions)
    .groupBy(t.pageVersions.pageId)
  const latestOf = new Map(latest.map((r) => [r.pageId, Number(r.n)]))
  return rows.map((row) => {
    // The list leaves the layouts out (they can be large); hasUnpublishedChanges reads them from the row.
    const { puckDraft: _draft, puckPublished: _published, ...page } = toPage(row, null)
    return {
      ...page,
      state: page.archivedAt ? 'archived' : page.status,
      hasUnpublishedChanges: hasUnpublishedChanges(row),
      latestVersion: latestOf.get(row.id) ?? 0,
    }
  })
}

/** The draft differs from what is live: a layout change, or settings waiting to be published. */
export function hasUnpublishedChanges(row: { puckDraft: unknown; puckPublished: unknown; detailsDraft?: unknown }): boolean {
  return (row.puckDraft != null && !isEqual(row.puckDraft, row.puckPublished ?? null)) || asDetails(row.detailsDraft) !== null
}

export async function getPageById(id: number): Promise<Page | null> {
  const { db, t } = await getDatabase()
  const [row] = await db.select().from(t.pages).where(eq(t.pages.id, id)).limit(1)
  return withImage(row)
}

/** The published version of a page, or null. Visitors only ever see this, and never an archived page. */
export async function getPublishedPage(slug: string): Promise<(Page & { puckData: unknown }) | null> {
  const { db, t } = await getDatabase()
  const [row] = await db.select().from(t.pages).where(eq(t.pages.slug, slug)).limit(1)
  if (!row || row.status !== 'published' || row.puckPublished == null || row.archivedAt) return null
  const page = await withImage(row)
  return page && { ...page, puckData: page.puckPublished }
}

/** `ownSlug`: a system page may keep its own address even when that word is reserved ("pets"). */
function parseDetails(raw: unknown, creating: boolean, ownSlug?: string) {
  const f = new Fields(asRecord(raw), creating)
  const values = {
    title: f.requiredText('title', 120),
    slug: f.slug('slug', { required: true, reserved: RESERVED_SLUGS.filter((word) => word !== ownSlug) }),
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

/**
 * Title, address and share details of a page. The layout is edited with saveDraft/publish. On a live
 * page they are saved as a draft and go live with the next publish (see PageDetails).
 */
export async function savePageDetails(id: number | null, raw: unknown, opts: { by?: string | null } = {}): Promise<{ id: number; slug: string }> {
  // A system page's own address is allowed for that page only (it is reserved for every other).
  let ownSlug: string | undefined
  if (id !== null) {
    const { db: lookup, t: tables } = await getDatabase()
    const [current] = await lookup.select({ slug: tables.pages.slug }).from(tables.pages).where(eq(tables.pages.id, id)).limit(1)
    if (current && isSystemPageSlug(current.slug)) ownSlug = current.slug
  }
  const values = parseDetails(raw, id === null, ownSlug)
  await assertImage(values.seoImageId)
  const { db, t, withTransaction } = await getDatabase()
  const defined = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) as Partial<PageDetails>
  try {
    if (id === null) {
      // The unique index covers live addresses; this also covers ones waiting to be published.
      if (defined.slug) await assertSlugFree(db, t, 0, defined.slug, 'save')
      const [row] = await db
        .insert(t.pages)
        .values(defined as unknown as typeof t.pages.$inferInsert)
        .returning({ id: t.pages.id, slug: t.pages.slug })
      safeRevalidate([toPath(row.slug)])
      return row
    }
    const result = await withTransaction(
      async (tx) => {
        const [before] = await tx.select().from(t.pages).where(eq(t.pages.id, id)).limit(1)
        if (!before) throw new UserError('Page not found.')
        if (before.archivedAt) throw new UserError(ARCHIVED)
        if (isSystemPageSlug(before.slug) && defined.slug !== undefined && defined.slug !== before.slug) {
          throw new ValidationError({ slug: `This page keeps the address "${before.slug}".` })
        }
        const details: PageDetails = { ...draftOf(before), ...defined }
        if (details.slug !== before.slug) await assertSlugFree(tx, t, id, details.slug, 'save')
        const [row] = await tx
          .update(t.pages)
          .set({ ...draftSettings(before, details), updatedAt: new Date() })
          .where(and(eq(t.pages.id, id), isNull(t.pages.archivedAt)))
          .returning()
        // Deleted or archived by someone else between the lookup and the update.
        if (!row) throw new UserError('Page not found.')
        // The history records settings too: a change opens (or updates) the draft version.
        if (row.puckDraft != null) {
          const draft = draftOf(row)
          await saveOpenVersion(tx, t, { pageId: id, title: draft.title, data: row.puckDraft, details: draft, by: opts.by })
        }
        return { id: row.id, slug: row.slug, previousSlug: before.slug }
      },
      { lock: pageLock(id) },
    )
    safeRevalidate([toPath(result.slug), toPath(result.previousSlug)])
    return { id: result.id, slug: result.slug }
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

/** Why a guarded update matched nothing: gone, archived, or changed by someone else. */
async function explainMiss(tx: Db, t: Schema, id: number, opts: { needsDraft?: boolean } = {}): Promise<never> {
  const [page] = await tx
    .select({ draft: t.pages.puckDraft, archivedAt: t.pages.archivedAt })
    .from(t.pages)
    .where(eq(t.pages.id, id))
    .limit(1)
  if (!page) throw new UserError('Page not found.')
  if (page.archivedAt) throw new UserError(ARCHIVED)
  if (opts.needsDraft && page.draft == null) throw new UserError('This page has no layout yet. Open the page builder first.')
  throw new UserError(CONFLICT)
}

type VersionInput = { pageId: number; title: string; data: unknown; details: PageDetails; by?: string | null }

async function latestVersion(tx: Db, t: Schema, pageId: number) {
  const [latest] = await tx
    .select({ number: t.pageVersions.number, kind: t.pageVersions.kind, data: t.pageVersions.data, details: t.pageVersions.details })
    .from(t.pageVersions)
    .where(eq(t.pageVersions.pageId, pageId))
    .orderBy(desc(t.pageVersions.number))
    .limit(1)
  return latest
}

/**
 * A version already holds this layout and these settings. isEqual ignores key order (PostgreSQL's
 * jsonb hands objects back with their keys re-sorted). A version saved before settings were kept
 * has none, so it never matches: the first save after the upgrade records them once.
 */
const sameVersion = (latest: { data: unknown; details: unknown }, input: VersionInput) =>
  isEqual(latest.data, input.data) && isEqual(asDetails(latest.details), input.details)

async function trimVersions(tx: Db, t: Schema, pageId: number, newest: number) {
  await tx
    .delete(t.pageVersions)
    .where(and(eq(t.pageVersions.pageId, pageId), lte(t.pageVersions.number, newest - KEEP_VERSIONS)))
}

/**
 * A draft save: updates the open (unpublished) version, or opens the next one after a publish.
 * Nothing is opened while the layout is still what was last published. Returns the open version's
 * number, or null when there is none. `restoredFrom` marks a restore from that version;
 * a plain save leaves an earlier mark alone.
 */
async function saveOpenVersion(
  tx: Db,
  t: Schema,
  input: VersionInput & {
    restoredFrom?: number
    /**
     * Always start a new version, leaving an open draft as it is (a restore: the unpublished work in
     * it stays in the history instead of being overwritten).
     */
    newVersion?: boolean
  },
): Promise<number | null> {
  const latest = await latestVersion(tx, t, input.pageId)
  const now = new Date()
  if (latest?.kind === 'draft' && !input.newVersion) {
    await tx
      .update(t.pageVersions)
      .set({
        title: input.title,
        data: input.data as never,
        details: input.details as never,
        createdBy: input.by ?? null,
        updatedAt: now,
        ...(input.restoredFrom !== undefined ? { restoredFrom: input.restoredFrom } : {}),
      })
      .where(and(eq(t.pageVersions.pageId, input.pageId), eq(t.pageVersions.number, latest.number)))
    return latest.number
  }
  // isEqual ignores key order: PostgreSQL's jsonb hands objects back with their keys re-sorted.
  if (latest && sameVersion(latest, input)) return null
  const number = (latest?.number ?? 0) + 1
  await tx.insert(t.pageVersions).values({
    pageId: input.pageId,
    number,
    kind: 'draft',
    title: input.title,
    data: input.data as never,
    details: input.details as never,
    createdBy: input.by ?? null,
    restoredFrom: input.restoredFrom ?? null,
    createdAt: now,
    updatedAt: now,
  })
  await trimVersions(tx, t, input.pageId, number)
  return number
}

/**
 * A publish: closes the open version with what went live. With no open version, a new published
 * version is added, unless the layout is the same as the last one published (a re-publish).
 */
async function closeVersion(tx: Db, t: Schema, input: VersionInput): Promise<void> {
  const latest = await latestVersion(tx, t, input.pageId)
  const now = new Date()
  if (latest?.kind === 'draft') {
    await tx
      .update(t.pageVersions)
      .set({ kind: 'published', title: input.title, data: input.data as never, details: input.details as never, createdBy: input.by ?? null, updatedAt: now })
      .where(and(eq(t.pageVersions.pageId, input.pageId), eq(t.pageVersions.number, latest.number)))
    return
  }
  if (latest && sameVersion(latest, input)) return
  const number = (latest?.number ?? 0) + 1
  await tx.insert(t.pageVersions).values({
    pageId: input.pageId,
    number,
    kind: 'published',
    title: input.title,
    data: input.data as never,
    details: input.details as never,
    createdBy: input.by ?? null,
    createdAt: now,
    updatedAt: now,
  })
  await trimVersions(tx, t, input.pageId, number)
}

export type SaveOptions = { baseVersion?: number; by?: string | null }

export async function saveDraft(id: number, data: unknown, baseVersion?: number, by?: string | null): Promise<{ version: number }> {
  const layout = cleanLayout(data)
  const { t, withTransaction } = await getDatabase()
  const now = nextVersion(baseVersion)
  return withTransaction(
    async (tx) => {
      // With a base version the update only matches if nobody has changed the page since.
      const where = and(eq(t.pages.id, id), isNull(t.pages.archivedAt), baseVersion === undefined ? undefined : atVersion(t, baseVersion))
      const [row] = await tx.update(t.pages).set({ puckDraft: layout, updatedAt: now }).where(where).returning()
      if (!row) return explainMiss(tx, t, id)
      const details = draftOf(row)
      await saveOpenVersion(tx, t, { pageId: id, title: details.title, data: layout, details, by })
      return { version: now.getTime() }
    },
    { lock: pageLock(id) },
  )
}

/**
 * Makes the draft the live page. With `data`, that layout is saved as the draft first (in the same
 * statement). Without it, the draft already stored is copied across inside the database, so a draft
 * saved at the same moment cannot be overwritten by an older copy read earlier.
 */
export async function publishPage(
  id: number,
  data?: unknown,
  baseVersion?: number,
  by?: string | null,
): Promise<{ slug: string; version: number }> {
  const { t, withTransaction } = await getDatabase()
  const layout = data !== undefined ? cleanLayout(data) : undefined
  const now = nextVersion(baseVersion)
  const set = layout !== undefined ? { puckDraft: layout, puckPublished: layout } : { puckPublished: sql`${t.pages.puckDraft}` }
  const result = await withTransaction(
    async (tx) => {
      // Settings saved since the last publish go live with the layout (a new address included).
      const [before] = await tx.select({ slug: t.pages.slug, detailsDraft: t.pages.detailsDraft }).from(t.pages).where(eq(t.pages.id, id)).limit(1)
      const pending = asDetails(before?.detailsDraft)
      if (pending && pending.slug !== before!.slug) await assertSlugFree(tx, t, id, pending.slug, 'publish')
      const details = pending
        ? { title: pending.title, slug: pending.slug, seoDescription: pending.seoDescription, seoImageId: await existingImage(pending.seoImageId), detailsDraft: null }
        : {}
      const where = and(
        eq(t.pages.id, id),
        isNull(t.pages.archivedAt),
        baseVersion === undefined ? undefined : atVersion(t, baseVersion),
        layout === undefined ? isNotNull(t.pages.puckDraft) : undefined,
      )
      const [row] = await tx
        .update(t.pages)
        .set({ ...set, ...details, status: 'published' as PageStatus, publishedAt: now, updatedAt: now } as never)
        .where(where)
        .returning()
      if (!row) return explainMiss(tx, t, id, { needsDraft: layout === undefined })
      await closeVersion(tx, t, { pageId: id, title: row.title, data: row.puckPublished, details: liveDetails(row), by })
      return { slug: row.slug, previousSlug: before?.slug ?? row.slug, version: now.getTime() }
    },
    { lock: pageLock(id) },
  )
  // A new address: the old one stops showing the page, so refresh both.
  safeRevalidate([toPath(result.slug), toPath(result.previousSlug)])
  return { slug: result.slug, version: result.version }
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

/** Takes the page off the site and makes it read-only. Everything is kept for a restore. */
export async function archivePage(id: number): Promise<void> {
  const { db, t } = await getDatabase()
  await assertNotSystem(id, 'archived')
  const now = new Date()
  const [row] = await db
    .update(t.pages)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(t.pages.id, id), isNull(t.pages.archivedAt)))
    .returning({ slug: t.pages.slug })
  if (!row) {
    const [page] = await db.select({ id: t.pages.id }).from(t.pages).where(eq(t.pages.id, id)).limit(1)
    if (!page) throw new UserError('Page not found.')
    return // Already archived.
  }
  safeRevalidate([toPath(row.slug)])
}

/** Brings an archived page back exactly as it was (a published page is live again). */
export async function restorePage(id: number): Promise<void> {
  const { db, t } = await getDatabase()
  const [row] = await db
    .update(t.pages)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(t.pages.id, id))
    .returning({ slug: t.pages.slug })
  if (!row) throw new UserError('Page not found.')
  safeRevalidate([toPath(row.slug)])
}

/** Deletes a page and its history for good. Only an archived page can be deleted. */
export async function deletePage(id: number): Promise<void> {
  const { db, t } = await getDatabase()
  await assertNotSystem(id, 'deleted')
  const [row] = await db
    .delete(t.pages)
    .where(and(eq(t.pages.id, id), isNotNull(t.pages.archivedAt)))
    .returning({ slug: t.pages.slug })
  if (!row) {
    const [page] = await db.select({ id: t.pages.id }).from(t.pages).where(eq(t.pages.id, id)).limit(1)
    throw new UserError(page ? 'Archive the page before deleting it.' : 'Page not found.')
  }
  safeRevalidate([toPath(row.slug)])
}

/** A page's versions, newest first, without their layouts. */
export async function listPageVersions(pageId: number): Promise<PageVersionSummary[]> {
  const { db, t } = await getDatabase()
  const rows = await db
    .select({
      number: t.pageVersions.number,
      kind: t.pageVersions.kind,
      title: t.pageVersions.title,
      createdAt: t.pageVersions.createdAt,
      updatedAt: t.pageVersions.updatedAt,
      restoredFrom: t.pageVersions.restoredFrom,
      createdBy: t.users.name,
    })
    .from(t.pageVersions)
    .leftJoin(t.users, eq(t.users.id, t.pageVersions.createdBy))
    .where(eq(t.pageVersions.pageId, pageId))
    .orderBy(desc(t.pageVersions.number))
  return rows.map((r) => ({
    ...r,
    kind: r.kind === 'published' ? ('published' as const) : ('draft' as const),
    restoredFrom: r.restoredFrom ?? null,
    createdBy: r.createdBy ?? null,
  }))
}

/** The layout of one snapshot, for the preview. */
export async function getPageVersionData(pageId: number, number: number): Promise<unknown | null> {
  const { db, t } = await getDatabase()
  const [row] = await db
    .select({ data: t.pageVersions.data })
    .from(t.pageVersions)
    .where(and(eq(t.pageVersions.pageId, pageId), eq(t.pageVersions.number, number)))
    .limit(1)
  return row?.data ?? null
}

/**
 * Restore: copies a version's layout into the draft as a NEW version that remembers where it came
 * from (the live page is not touched; publish to make it live, or use restoreAndPublishPageVersion).
 * History is never rewritten: an open draft with unpublished work stays as its own version. Returns
 * the new version's number (the latest version's, when the layout is what is already published).
 * Takes the same `baseVersion` as saveDraft.
 */
export async function restorePageVersion(
  pageId: number,
  number: number,
  opts: SaveOptions = {},
): Promise<{ version: number; number: number }> {
  const { t, withTransaction } = await getDatabase()
  const now = nextVersion(opts.baseVersion)
  return withTransaction(
    async (tx) => {
      const [snapshot] = await tx
        .select({ data: t.pageVersions.data, kind: t.pageVersions.kind, details: t.pageVersions.details })
        .from(t.pageVersions)
        .where(and(eq(t.pageVersions.pageId, pageId), eq(t.pageVersions.number, number)))
        .limit(1)
      if (!snapshot) throw new UserError('That version no longer exists.')
      if (snapshot.kind === 'draft') {
        const latest = await latestVersion(tx, t, pageId)
        if (latest?.number === number) throw new UserError('That version is already the draft.')
      }
      const where = and(
        eq(t.pages.id, pageId),
        isNull(t.pages.archivedAt),
        opts.baseVersion === undefined ? undefined : atVersion(t, opts.baseVersion),
      )
      // The version's settings come back with its layout (versions saved before settings were kept
      // have none, and leave the current settings as they are).
      const [current] = await tx.select().from(t.pages).where(where).limit(1)
      if (!current) return explainMiss(tx, t, pageId)
      let settings = {}
      const restored = asDetails(snapshot.details)
      if (restored) {
        // A system page keeps its address whatever an old version says.
        const details: PageDetails = {
          ...restored,
          slug: isSystemPageSlug(current.slug) ? current.slug : restored.slug,
          seoImageId: await existingImage(restored.seoImageId),
        }
        if (details.slug !== current.slug) await assertSlugFree(tx, t, pageId, details.slug, 'restore')
        settings = draftSettings(current, details)
      }
      const [row] = await tx
        .update(t.pages)
        .set({ puckDraft: snapshot.data, ...settings, updatedAt: now })
        .where(where)
        .returning()
      if (!row) return explainMiss(tx, t, pageId)
      const details = draftOf(row)
      const open = await saveOpenVersion(tx, t, { pageId, title: details.title, data: snapshot.data, details, by: opts.by, restoredFrom: number, newVersion: true })
      const latest = open ?? (await latestVersion(tx, t, pageId))?.number ?? number
      return { version: now.getTime(), number: latest }
    },
    { lock: pageLock(pageId) },
  )
}

/**
 * Restore and publish in one step, for rolling a broken live page back quickly. Restoring copies the
 * old version into the draft as a new version (nothing in the history is removed or renumbered), and
 * publishing then makes that draft live. One transaction: if publishing fails, the restore is undone.
 */
export async function restoreAndPublishPageVersion(
  pageId: number,
  number: number,
  opts: SaveOptions = {},
): Promise<{ version: number; number: number }> {
  const { withTransaction } = await getDatabase()
  return withTransaction(
    async () => {
      const restored = await restorePageVersion(pageId, number, opts)
      const published = await publishPage(pageId, undefined, restored.version, opts.by)
      return { version: published.version, number: restored.number }
    },
    { lock: pageLock(pageId) },
  )
}

async function assertNotSystem(id: number, verb: 'archived' | 'deleted') {
  const { db, t } = await getDatabase()
  const [row] = await db.select({ slug: t.pages.slug }).from(t.pages).where(eq(t.pages.id, id)).limit(1)
  const def = row ? SYSTEM_PAGES.find((page) => page.slug === row.slug) : undefined
  if (!def) return
  throw new UserError(
    verb === 'archived'
      ? `${def.label} cannot be archived. Unpublish it to show the built-in ${def.fallback} instead.`
      : `${def.label} cannot be deleted.`,
  )
}

/** The homepage's id. ensureSystemPages keeps it there. */
export const HOME_ID = 1
/** The Pets page's id. */
export const PETS_ID = 2

type SystemPage = { slug: string; id: number; title: string; data: Data; path: string; label: string; fallback: string }

/** In order: the homepage is placed first, so it can never be the page that moves out of the way. */
const SYSTEM_PAGES: SystemPage[] = [
  { slug: HOME_SLUG, id: HOME_ID, title: 'Home', data: DEFAULT_HOME_DATA, path: '/', label: 'The homepage', fallback: 'homepage' },
  { slug: PETS_SLUG, id: PETS_ID, title: 'Adoptable pets', data: DEFAULT_PETS_DATA, path: '/pets', label: 'The Pets page', fallback: 'catalogue' },
]

/**
 * Makes sure a system page exists at its fixed id, so it is listed, edited, versioned and previewed
 * like any other page, in a fixed place.
 *
 *  - Missing: it is created from its built-in layout, published, with that layout as version 1, so
 *    its address looks exactly as before.
 *  - Under another id (a site set up before this rule): it swaps ids with the page on its id. When
 *    it is missing, a page on its id moves to the next free id. Versions follow
 *    (page_versions.page_id is ON UPDATE CASCADE), and the id counter is moved past the highest id.
 *  - The other system pages are never moved out of the way (they come first in SYSTEM_PAGES).
 *
 * Cheap when everything is in place (one query). Two calls at once are serialised by a lock.
 */
async function ensureSystemPage(def: SystemPage): Promise<'created' | 'moved' | 'exists'> {
  const { db, t, dialect, withTransaction } = await getDatabase()
  const [current] = await db.select({ id: t.pages.id }).from(t.pages).where(eq(t.pages.slug, def.slug)).limit(1)
  if (current?.id === def.id) return 'exists'

  const layout = cleanLayout(def.data)
  const result = await withTransaction(
    async (tx) => {
      const [page] = await tx.select({ id: t.pages.id }).from(t.pages).where(eq(t.pages.slug, def.slug)).limit(1)
      if (page?.id === def.id) return 'exists' as const

      const [occupant] = await tx.select({ id: t.pages.id, slug: t.pages.slug }).from(t.pages).where(eq(t.pages.id, def.id)).limit(1)
      if (occupant && isSystemPageSlug(occupant.slug)) {
        throw new Error(`Page id ${def.id} belongs to the system page "${occupant.slug}"; not moving it.`)
      }
      const [{ max }] = await tx.select({ max: sql<number>`max(${t.pages.id})` }).from(t.pages)
      const spare = Number(max ?? 0) + 1

      if (page) {
        // Swap: this page takes its id and the page that had it takes this page's old id
        // (through a spare id, since ids are unique at every step).
        await tx.update(t.pages).set({ id: spare }).where(eq(t.pages.id, page.id))
        if (occupant) await tx.update(t.pages).set({ id: page.id }).where(eq(t.pages.id, def.id))
        await tx.update(t.pages).set({ id: def.id }).where(eq(t.pages.id, spare))
      } else {
        // Free the id: whatever page holds it moves to the end.
        if (occupant) await tx.update(t.pages).set({ id: spare }).where(eq(t.pages.id, def.id))
        const now = new Date()
        await tx.insert(t.pages).values({
          id: def.id,
          title: def.title,
          slug: def.slug,
          status: 'published',
          puckDraft: layout,
          puckPublished: layout,
          publishedAt: now,
          createdAt: now,
          updatedAt: now,
        } as never)
        await closeVersion(tx, t, { pageId: def.id, title: def.title, data: layout, details: { title: def.title, slug: def.slug, seoDescription: null, seoImageId: null } })
      }

      // Explicit ids do not move the id counter, so the next new page could collide: move it past
      // the highest id. (SQLite's AUTOINCREMENT keeps its counter in sqlite_sequence.)
      if (dialect === 'pg') {
        await (tx as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(
          sql`select setval(pg_get_serial_sequence('pages', 'id'), (select max(id) from pages))`,
        )
      } else {
        await tx.run(sql`update sqlite_sequence set seq = (select max(id) from pages) where name = 'pages' and seq < (select max(id) from pages)`)
      }
      return page ? ('moved' as const) : ('created' as const)
    },
    { lock: 'pages:system' },
  )
  if (result !== 'exists') safeRevalidate([def.path])
  return result
}

/** The homepage at id 1 (see ensureSystemPage). */
export const ensureHomePage = () => ensureSystemPage(SYSTEM_PAGES[0])
/** The Pets page at id 2 (see ensureSystemPage). */
export const ensurePetsPage = () => ensureSystemPage(SYSTEM_PAGES[1])

/** Every system page, in order. Runs on start, in the seed, and when the pages list loads. */
export async function ensureSystemPages(): Promise<void> {
  for (const def of SYSTEM_PAGES) await ensureSystemPage(def)
}
