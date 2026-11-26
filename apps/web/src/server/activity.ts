// The activity log: who changed what, and when. Agreed with the owner:
//  - Changes are recorded (create, edit, delete, publish, restore, roles...), plus sign-ins,
//    sign-outs, failed sign-ins and downloads of personal data. Reads are not.
//  - An entry names the fields that changed, never their values, so the log holds no personal
//    data or secrets (a failed sign-in does not even keep the email that was typed: people type
//    passwords into the email box).
//  - Everyone reads their own entries; admins and audit read everyone's and download them as CSV.
//  - Entries are kept ACTIVITY_LOG_DAYS days (default 365), then purged.
//
// Entries are written by the server actions after the change succeeded (`recordActivity`). A failure
// to write one is logged and never undoes or fails the change. Inside `withTransaction` the insert
// joins the open transaction, so code that needs the change and its entry to commit together can
// call it there.
import { csvCell, type Role } from '@pet-adopt/plugin-sdk'
import { and, desc, eq, gte, lt, max, or, sql, type SQL } from 'drizzle-orm'
import { isEqual } from 'es-toolkit'
import { headers } from 'next/headers'

import { getDatabase } from '@/db/client'
import { isActivityArea, type ActivityArea } from '@/lib/activity'

import { getPageById } from './pages'
import { logError, UserError } from './result'
import { clientAddress } from './throttle'


export type Actor = { id: string; name: string; role: Role }

export type ActivityInput = {
  /** Who did it: the signed-in person, or null when nobody is (a failed sign-in). */
  actor: Actor | null
  action: string
  area: ActivityArea
  /** One sentence, past tense: `Updated pet "Bella"`. */
  summary: string
  subject?: { id: string | number; label?: string | null } | null
  /** Names of the fields that changed (no values). Empty or missing: not listed. */
  fields?: string[] | null
  /** The client's address; read from the request when left out. */
  client?: string | null
}

export type ActivityEntry = {
  id: number
  at: Date
  actorId: string | null
  actorName: string | null
  actorRole: string | null
  action: string
  area: string
  summary: string
  subjectId: string | null
  subjectLabel: string | null
  fields: string[] | null
  client: string | null
}

const MAX_TEXT = 300
const CONTROL = /[\u0000-\u001f\u007f]/g
const clip = (value: string | null | undefined, length = MAX_TEXT) => (value == null ? null : value.replace(CONTROL, ' ').slice(0, length))

/** Days entries are kept: ACTIVITY_LOG_DAYS, default 365, at least 1. */
export function activityRetentionDays(): number {
  const days = Math.floor(Number(process.env.ACTIVITY_LOG_DAYS))
  return Number.isFinite(days) && days >= 1 ? days : 365
}

async function requestClient(): Promise<string | null> {
  try {
    return clientAddress(await headers())
  } catch {
    // Outside a request (a script, a test): no address.
    return null
  }
}

/** Adds an entry. Never throws: the change it describes already happened. */
export async function recordActivity(entry: ActivityInput): Promise<void> {
  try {
    const { db, t } = await getDatabase()
    const fields = entry.fields?.length ? [...new Set(entry.fields)].slice(0, 100).map((field) => clip(field, 100) as string) : null
    await db.insert(t.activityLog).values({
      actorId: entry.actor?.id ?? null,
      actorName: clip(entry.actor?.name),
      actorRole: entry.actor?.role ?? null,
      action: clip(entry.action, 100) as string,
      area: entry.area,
      summary: clip(entry.summary, 500) as string,
      subjectId: entry.subject ? clip(String(entry.subject.id), 100) : null,
      subjectLabel: clip(entry.subject?.label),
      fields,
      client: entry.client !== undefined ? entry.client : await requestClient(),
    })
  } catch (error) {
    logError(error, `could not record activity (${entry.action})`)
  }
}

/**
 * Top-level keys whose values differ between two versions of a record, minus `ignore`. Compared
 * deeply, so lists and nested settings count as one field each. A key missing on one side counts.
 */
export function changedFields<T extends object>(before: T | null | undefined, after: T | null | undefined, ignore: readonly string[] = []): string[] {
  if (!before || !after) return []
  const skip = new Set(['createdAt', 'updatedAt', ...ignore])
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].filter((key) => !skip.has(key) && !isEqual((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key]))
}

/** `“Bella”`, in curly quotes; a blank name reads as “untitled”. */
export const quoted = (name: string | null | undefined) => `“${(name ?? '').trim() || 'untitled'}”`

// --- Reading -------------------------------------------------------------------------------

export type ActivityFilters = {
  area?: string | null
  /** Someone's user id (only for those who see everyone's entries). */
  actor?: string | null
  /** ISO timestamps: from (inclusive) and to (exclusive). */
  from?: string | null
  to?: string | null
  page?: number
  /** Entries per page (1 to 50, default 50). */
  limit?: number
}

export type ActivityPage = { entries: ActivityEntry[]; total: number; page: number; pages: number; limit: number }

/** Whose entries a reader sees: everyone's (`all`), or their own. */
export type ActivityViewer = { id: string; all: boolean }

const PAGE_SIZE = 50
/** A CSV download holds at most this many entries (the newest). */
export const EXPORT_LIMIT = 50_000

function parseInstant(value: unknown, name: string): Date | null {
  if (value == null || value === '') return null
  const date = typeof value === 'string' && value.length <= 40 ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) throw new UserError(`The ${name} date is not valid.`)
  return date
}

/** Own scope: what they did, plus failed sign-ins on their account. */
async function whereFor(viewer: ActivityViewer, filters: ActivityFilters): Promise<SQL | undefined> {
  const { t } = await getDatabase()
  const conditions: Array<SQL | undefined> = []
  if (!viewer.all) {
    conditions.push(or(eq(t.activityLog.actorId, viewer.id), and(eq(t.activityLog.action, 'auth.sign-in-failed'), eq(t.activityLog.subjectId, viewer.id))))
  } else if (typeof filters.actor === 'string' && filters.actor) {
    conditions.push(eq(t.activityLog.actorId, filters.actor.slice(0, 64)))
  }
  if (typeof filters.area === 'string' && filters.area) {
    if (!isActivityArea(filters.area)) throw new UserError('Unknown area.')
    conditions.push(eq(t.activityLog.area, filters.area))
  }
  const from = parseInstant(filters.from, 'start')
  const to = parseInstant(filters.to, 'end')
  if (from) conditions.push(gte(t.activityLog.at, from))
  if (to) conditions.push(lt(t.activityLog.at, to))
  return conditions.length ? and(...conditions) : undefined
}

/** Newest first, 50 a page. */
export async function listActivity(viewer: ActivityViewer, filters: ActivityFilters = {}): Promise<ActivityPage> {
  await purgeOldActivitySometimes()
  const { db, t } = await getDatabase()
  const where = await whereFor(viewer, filters)
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(t.activityLog).where(where)
  const count = Number(total)
  const size = Math.min(Math.max(Math.floor(Number(filters.limit) || PAGE_SIZE), 1), PAGE_SIZE)
  const pages = Math.max(Math.ceil(count / size), 1)
  const page = Math.min(Math.max(Math.floor(Number(filters.page) || 1), 1), pages)
  const entries = await db
    .select()
    .from(t.activityLog)
    .where(where)
    .orderBy(desc(t.activityLog.at), desc(t.activityLog.id))
    .limit(size)
    .offset((page - 1) * size)
  return { entries: entries as ActivityEntry[], total: count, page, pages, limit: size }
}

/** Everyone who has an entry, under the newest name each had (accounts deleted since included). */
export async function listActivityActors(): Promise<Array<{ id: string; name: string }>> {
  const { db, t } = await getDatabase()
  const rows = await db
    .select({ id: t.activityLog.actorId, name: t.activityLog.actorName, last: max(t.activityLog.at) })
    .from(t.activityLog)
    .where(sql`${t.activityLog.actorId} is not null`)
    .groupBy(t.activityLog.actorId, t.activityLog.actorName)
  const newest = new Map<string, { name: string; last: number }>()
  for (const row of rows) {
    const last = row.last ? new Date(row.last).getTime() : 0
    const seen = newest.get(row.id as string)
    if (!seen || last > seen.last) newest.set(row.id as string, { name: row.name ?? 'Unknown', last })
  }
  return [...newest].map(([id, { name }]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

/** The filtered entries as CSV (newest first, at most EXPORT_LIMIT). */
export async function exportActivityCsv(
  viewer: ActivityViewer,
  filters: ActivityFilters = {},
): Promise<{ filename: string; csv: string; rows: number; truncated: boolean }> {
  const { db, t } = await getDatabase()
  const rows = (await db
    .select()
    .from(t.activityLog)
    .where(await whereFor(viewer, filters))
    .orderBy(desc(t.activityLog.at), desc(t.activityLog.id))
    .limit(EXPORT_LIMIT + 1)) as ActivityEntry[]
  const truncated = rows.length > EXPORT_LIMIT
  const kept = truncated ? rows.slice(0, EXPORT_LIMIT) : rows
  const header = ['When (UTC)', 'Who', 'Role', 'User id', 'Area', 'Action', 'What happened', 'Item id', 'Item', 'Fields changed', 'Client address']
  const lines = kept.map((row) => [
    row.at.toISOString(),
    row.actorName ?? '',
    row.actorRole ?? '',
    row.actorId ?? '',
    row.area,
    row.action,
    row.summary,
    row.subjectId ?? '',
    row.subjectLabel ?? '',
    (row.fields ?? []).join('; '),
    row.client ?? '',
  ])
  // BOM so spreadsheets read UTF-8; CRLF line ends as RFC 4180 has them.
  const csv = '\uFEFF' + [header, ...lines].map((cells) => cells.map(csvCell).join(',')).join('\r\n') + '\r\n'
  return { filename: `activity-log-${new Date().toISOString().slice(0, 10)}.csv`, csv, rows: kept.length, truncated }
}

// --- Retention -----------------------------------------------------------------------------

/** Deletes entries older than the retention period. Returns how many. */
export async function purgeOldActivity(now = new Date()): Promise<number> {
  const { db, t } = await getDatabase()
  const cutoff = new Date(now.getTime() - activityRetentionDays() * 24 * 60 * 60 * 1000)
  const removed = await db.delete(t.activityLog).where(lt(t.activityLog.at, cutoff)).returning({ id: t.activityLog.id })
  return removed.length
}

const PURGE_EVERY_MS = 60 * 60 * 1000
const purgeState = ((globalThis as { __petAdoptActivityPurge?: { last: number } }).__petAdoptActivityPurge ??= { last: 0 })

/** At most once an hour per server process (also at start, in instrumentation). Never throws. */
export async function purgeOldActivitySometimes(): Promise<void> {
  if (Date.now() - purgeState.last < PURGE_EVERY_MS) return
  purgeState.last = Date.now()
  await purgeOldActivity().catch((error) => logError(error, 'could not purge old activity'))
}

// --- Helpers for the actions ---------------------------------------------------------------

/** A page's settings as the settings form shows them (pending ones on a live page). */
type PageLike = {
  title: string
  slug: string
  seo: { description: string | null; image: { id: number } | null }
  draftDetails: { title: string; slug: string; seo: { description: string | null; image: { id: number } | null } } | null
}

export function pageSettings(page: PageLike | null | undefined) {
  if (!page) return null
  const details = page.draftDetails ?? page
  return { title: details.title, address: details.slug, 'search description': details.seo.description, 'share image': details.seo.image?.id ?? null }
}

/** Records something done to a page, named by its title as it is now. */
export async function recordPageActivity(
  actor: Actor,
  pageId: number,
  action: string,
  summary: (title: string) => string,
  extra: { fields?: string[]; title?: string | null } = {},
): Promise<void> {
  let title = extra.title
  if (title == null) {
    const page = await getPageById(pageId).catch(() => null)
    title = page ? (page.draftDetails?.title ?? page.title) : null
  }
  await recordActivity({ actor, action, area: 'pages', summary: summary(quoted(title)), subject: { id: pageId, label: title }, fields: extra.fields })
}

/** A failed sign-in. The typed email is never stored; it only finds the account it was meant for. */
export async function recordFailedSignIn(email: string, client?: string | null): Promise<void> {
  try {
    const { db, t } = await getDatabase()
    const [account] = await db
      .select({ id: t.users.id, name: t.users.name })
      .from(t.users)
      .where(eq(t.users.email, email.trim().toLowerCase().slice(0, 200)))
      .limit(1)
    await recordActivity({
      actor: null,
      action: 'auth.sign-in-failed',
      area: 'sign-in',
      summary: account ? `Failed sign-in to the account ${quoted(account.name)} (wrong password)` : 'Failed sign-in with an email that has no account',
      subject: account ? { id: account.id, label: account.name } : null,
      client,
    })
  } catch (error) {
    logError(error, 'could not record a failed sign-in')
  }
}
