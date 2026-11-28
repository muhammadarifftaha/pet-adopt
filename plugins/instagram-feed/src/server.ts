// The Instagram feed plugin's rules: the Meta app's keys, connecting an account (Instagram's
// sign-in, or a pasted access token), the cached feed and the team's pinned posts. Server-only.
// The actions in ./actions.ts check who is calling; `loadInstagramFeed` is the public block loader.
// Every call to Instagram goes through ./instagram-api.ts.
//
// Decisions worth knowing:
//  - Only Business and Creator accounts connect (ALLOWED_ACCOUNT_TYPES); an account whose type
//    Instagram does not name is refused too.
//  - An account connected through Instagram's sign-in belongs to the Meta app it was made with:
//    while it is connected the app ID cannot be changed (disconnect first). The app secret can be
//    replaced or removed (a rotated secret is the same app, and renewing a token needs no secret).
//    A pasted token does not depend on the saved keys, so they can change freely then.
//  - Pins are the plugin's own (Instagram's API does not say which posts are pinned on a profile).
//    They belong to the account: disconnecting, or connecting another account, clears them.
//  - The feed is served from the plugin's cache. Older than an hour, it is read again first, one
//    read at a time per process; a failed read keeps the old feed, records why, and is not tried
//    again for five minutes. A visitor's page waits at most a few seconds for it, and nothing is
//    read while the site is being built.
//  - A read belongs to the connection it started with. The sealed token names that connection (it
//    is sealed anew on every connect and every renewal, so no two are alike): each thing a read
//    writes to the settings row is written only while the row still holds it, and a read that
//    finds it gone stops there. So a disconnect, or another account connected meanwhile, is never
//    overwritten by a read that was under way.
//  - A token, a secret or an address with one in it never reaches a log, an error or a browser.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { accessPermission, can, host, UserError, ValidationError, type PluginUser } from '@pet-adopt/plugin-sdk'
import { and, eq } from 'drizzle-orm'

import {
  authorizeUrl,
  duringBuild,
  exchangeCode,
  exchangeLongLived,
  fetchBiography,
  fetchMedia,
  fetchMediaById,
  fetchProfile,
  InstagramError,
  refreshToken,
  type RawMedia,
  type RawProfile,
} from './instagram-api'
import { openInstagramDatabase, type StoredPost } from './storage'
import {
  ALLOWED_ACCOUNT_TYPES,
  clampWhole,
  DEFAULT_POSTS,
  INSTAGRAM_FEED,
  MAX_PINNED,
  MAX_POSTS,
  MIN_POSTS,
  type ConnectionView,
  type FeedPost,
  type FeedProfile,
  type InstagramFeedData,
} from './types'

export { instagramHttps, setInstagramFetchForChecks, type InstagramFetch } from './instagram-api'
export { instagramFeedStorage } from './storage'

const ROW_ID = 1
const SECRET_PURPOSE = 'instagram-feed:app-secret'
const TOKEN_PURPOSE = 'instagram-feed:access-token'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** How long a started sign-in may take. */
const STATE_TTL_MS = 10 * MINUTE
/** The cached feed is read again when older than this (Instagram's picture addresses expire). */
export const FEED_MAX_AGE_MS = HOUR
/** After a read was started, the next automatic one waits this long (so a failing one is not hammered). */
export const RETRY_AFTER_MS = 5 * MINUTE
/** How long a visitor's page waits for a new read, whether or not it has an older feed to show. */
const PAGE_WAIT_MS = 2500
/** How many of the latest posts are kept (pins are chosen from them). */
export const LATEST_POSTS = 25
const TOKEN_MIN_AGE_MS = DAY
const TOKEN_RENEW_BEFORE_MS = 10 * DAY
const TOKEN_RENEW_AGE_MS = 7 * DAY

const APP_ID = /^\d{5,25}$/
const APP_SECRET = /^[A-Za-z0-9]{16,128}$/
const ACCESS_TOKEN = /^[\x21-\x7E]{20,1000}$/
const POST_ID = /^\d{1,32}$/
const USERNAME = /^[A-Za-z0-9._]{1,30}$/
const STATE = /^[A-Za-z0-9_-]{43}$/

const NOT_CONNECTED = 'Connect an Instagram account first.'
const TOKEN_UNREADABLE = 'The saved access token can no longer be read (the site’s secret changed). Connect the account again.'
const TOKEN_NOT_RENEWED = 'The access token could not be renewed; it will be tried again tomorrow. If this message stays, connect the account again before the token expires.'
const SIGN_IN_REFUSED = 'That sign-in could not be finished: it was not started here, was used already, or took longer than 10 minutes. Start connecting again.'

type Row = Awaited<ReturnType<typeof readSettings>>
type SettingsRow = NonNullable<Row>

// --- Storage ------------------------------------------------------------------------------------

async function readSettings() {
  const { db, t } = await openInstagramDatabase()
  const [row] = await db.select().from(t.settings).where(eq(t.settings.id, ROW_ID)).limit(1)
  return row ?? null
}

async function readCache() {
  const { db, t } = await openInstagramDatabase()
  const [row] = await db.select().from(t.cache).where(eq(t.cache.id, ROW_ID)).limit(1)
  return row ?? null
}

type SettingsPatch = Partial<Omit<SettingsRow, 'id'>>

/** Writes some of the settings row's columns (creating the row on first use). */
async function patchSettings(patch: SettingsPatch): Promise<void> {
  const { db, t } = await openInstagramDatabase()
  const values = { ...patch, updatedAt: new Date() }
  await db.insert(t.settings).values({ id: ROW_ID, ...values }).onConflictDoUpdate({ target: t.settings.id, set: values })
}

/**
 * Writes columns only while the row's `column` still holds `value`. False when it no longer does:
 * nothing was written, and the caller stops.
 */
async function patchSettingsWhile(column: 'accessTokenEncrypted' | 'accountId', value: string, patch: SettingsPatch): Promise<boolean> {
  const { db, t } = await openInstagramDatabase()
  const updated = await db
    .update(t.settings)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(t.settings.id, ROW_ID), eq(t.settings[column], value)))
    .returning({ id: t.settings.id })
  return updated.length > 0
}

async function writeCache(values: { profile: FeedProfile; posts: StoredPost[]; pinnedPosts: StoredPost[]; fetchedAt: Date }): Promise<void> {
  const { db, t } = await openInstagramDatabase()
  await db.insert(t.cache).values({ id: ROW_ID, ...values }).onConflictDoUpdate({ target: t.cache.id, set: values })
}

async function clearCache(): Promise<void> {
  const { db, t } = await openInstagramDatabase()
  await db.delete(t.cache).where(eq(t.cache.id, ROW_ID))
}

const isConnected = (row: Row): row is SettingsRow => Boolean(row?.accessTokenEncrypted && row.accountId && row.accountUsername)
const NO_PENDING_SIGN_IN = { oauthStateHash: null, oauthStateExpiresAt: null, oauthStateUserId: null } satisfies SettingsPatch

// --- Checking what Instagram sent ---------------------------------------------------------------

// Control characters and the characters that reorder text; joiners stay (emoji are made of them).
const UNSAFE_CHARS = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu
const clip = (value: string, max: number) => {
  const chars = Array.from(value)
  return chars.length > max ? chars.slice(0, max).join('') : value
}
/** One line of plain text, or null when nothing is left. */
function cleanLine(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const line = clip(value.replace(/\s+/g, ' ').replace(UNSAFE_CHARS, '').trim(), max)
  return line || null
}

/** An https address on one of the hosts given (exactly, or under a `.suffix`), or null. */
function safeUrl(value: unknown, hosts: { exact?: string[]; suffixes?: string[] }): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  const name = url.hostname.toLowerCase()
  const allowed = hosts.exact?.includes(name) || hosts.suffixes?.some((suffix) => name.endsWith(suffix) && name.length > suffix.length)
  return allowed ? url.toString() : null
}

/** Pictures come from Instagram's own image hosts: the two the site's Content-Security-Policy allows. */
export const safeImageUrl = (value: unknown) => safeUrl(value, { suffixes: ['.cdninstagram.com', '.fbcdn.net'] })
export const safePermalink = (value: unknown) => safeUrl(value, { exact: ['www.instagram.com'] })

/** The start of a caption as a picture's text alternative: its first line, about 120 characters. */
export function captionToAlt(caption: unknown): string {
  if (typeof caption !== 'string') return ''
  const first = caption.split(/[\r\n\u2028\u2029]+/).map((line) => cleanLine(line, 2200)).find(Boolean) ?? ''
  const chars = Array.from(first)
  if (chars.length <= 120) return first
  const cut = chars.slice(0, 119).join('')
  const space = cut.lastIndexOf(' ')
  return `${(space > 60 ? cut.slice(0, space) : cut).trimEnd()}…`
}

const KINDS: Record<string, FeedPost['kind']> = { IMAGE: 'image', VIDEO: 'video', CAROUSEL_ALBUM: 'album' }

/** A post as it may be stored, or null when it has no usable still picture, link or date. */
export function toStoredPost(raw: RawMedia): StoredPost | null {
  const kind = KINDS[raw.mediaType]
  if (!kind || !POST_ID.test(raw.id)) return null
  // A video's still picture is its cover; an album whose first item is a video has none here.
  const imageUrl = safeImageUrl(kind === 'video' ? raw.thumbnailUrl : raw.mediaUrl)
  const permalink = safePermalink(raw.permalink)
  if (!imageUrl || !permalink || /\.(mp4|mov|m4v|webm)$/i.test(new URL(imageUrl).pathname)) return null
  // Instagram writes "+0000"; the standard form is "+00:00".
  const posted = new Date((raw.timestamp ?? '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  if (Number.isNaN(posted.getTime())) return null
  return { id: raw.id, permalink, imageUrl, alt: captionToAlt(raw.caption), kind, postedAt: posted.toISOString() }
}

function toProfile(raw: RawProfile, biography: string | null): FeedProfile {
  if (!USERNAME.test(raw.username)) throw new InstagramError('unexpected')
  const bio = typeof biography === 'string' ? clip(biography.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/[^\P{Cc}\n]/gu, '').replace(/[\u202A-\u202E\u2066-\u2069]/g, '').trim(), 500) : ''
  return {
    username: raw.username,
    name: cleanLine(raw.name, 100),
    biography: bio || null,
    pictureUrl: safeImageUrl(raw.pictureUrl),
    followers: raw.followers,
    posts: raw.posts,
    profileUrl: `https://www.instagram.com/${raw.username}/`,
  }
}

/** A stored post, checked again as it is read (the cache is data, and data is never trusted twice). */
function readStoredPosts(value: unknown): StoredPost[] {
  if (!Array.isArray(value)) return []
  const out: StoredPost[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const post = item as Record<string, unknown>
    const imageUrl = safeImageUrl(post.imageUrl)
    const permalink = safePermalink(post.permalink)
    const kind = post.kind === 'image' || post.kind === 'video' || post.kind === 'album' ? post.kind : null
    if (typeof post.id !== 'string' || !POST_ID.test(post.id) || !imageUrl || !permalink || !kind || typeof post.postedAt !== 'string') continue
    out.push({ id: post.id, permalink, imageUrl, alt: typeof post.alt === 'string' ? post.alt : '', kind, postedAt: post.postedAt })
  }
  return out
}

function readStoredProfile(value: unknown): FeedProfile | null {
  if (!value || typeof value !== 'object') return null
  const profile = value as Record<string, unknown>
  if (typeof profile.username !== 'string' || !USERNAME.test(profile.username)) return null
  const whole = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null)
  return {
    username: profile.username,
    name: typeof profile.name === 'string' ? profile.name : null,
    biography: typeof profile.biography === 'string' ? profile.biography : null,
    pictureUrl: safeImageUrl(profile.pictureUrl),
    followers: whole(profile.followers),
    posts: whole(profile.posts),
    profileUrl: `https://www.instagram.com/${profile.username}/`,
  }
}

const readPinnedIds = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && POST_ID.test(id)))].slice(0, MAX_PINNED) : []

// --- The connection -----------------------------------------------------------------------------

const redirectUri = () => `${host().siteUrl()}/admin/plugins/${INSTAGRAM_FEED}/callback`
const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null)

function toView(row: Row, user: PluginUser): ConnectionView {
  const connected = isConnected(row)
  return {
    appId: row?.appId ?? '',
    appSecretSet: Boolean(row?.appSecretEncrypted),
    redirectUri: redirectUri(),
    connected,
    method: connected && (row.method === 'oauth' || row.method === 'token') ? row.method : null,
    account: connected
      ? { username: row.accountUsername ?? '', name: row.accountName, accountType: row.accountType ?? '', pictureUrl: safeImageUrl(row.accountPictureUrl) }
      : null,
    tokenExpiresAt: connected ? iso(row.tokenExpiresAt) : null,
    connectedAt: connected ? iso(row.connectedAt) : null,
    lastFetchedAt: connected ? iso(row.lastFetchedAt) : null,
    lastError: connected ? row.lastError : null,
    canEdit: can(user.role, accessPermission('admin', 'edit')),
  }
}

/** What the Instagram screen shows. Never a secret or a token. */
export async function getConnection(user: PluginUser): Promise<ConnectionView> {
  return toView(await readSettings(), user)
}

const asRecord = (raw: unknown): Record<string, unknown> => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {})

/**
 * Saves the Meta app's ID and secret. A blank secret keeps the saved one (only while the app ID
 * stays the same: a new ID needs its secret typed, or the saved one removed); `clearSecret` removes
 * it; a blank app ID removes both. While an account is connected through Instagram's sign-in the
 * app ID cannot change (the connection belongs to that app): disconnect first. Any change ends a
 * sign-in that is under way. `changed` names what changed, for the activity log.
 */
export async function saveAppKeys(user: PluginUser, raw: unknown): Promise<{ view: ConnectionView; changed: string[] }> {
  const input = asRecord(raw)
  const appId = typeof input.appId === 'string' ? input.appId.trim() : ''
  const secret = typeof input.appSecret === 'string' ? input.appSecret.trim() : ''
  const clearSecret = input.clearSecret === true || !appId
  const errors: Record<string, string> = {}
  if (appId && !APP_ID.test(appId)) errors.appId = 'That does not look like an app ID: it is a number, shown as “Instagram app ID” in the Meta app dashboard.'
  if (secret && !appId) errors.appId = 'Enter the app ID that this secret belongs to.'
  if (secret && !APP_SECRET.test(secret)) errors.appSecret = 'That does not look like an app secret: copy the “Instagram app secret” again from the Meta app dashboard.'

  const before = await readSettings()
  const idChanged = appId !== (before?.appId ?? '')
  if (idChanged && isConnected(before) && before.method === 'oauth') {
    errors.appId = 'An Instagram account is connected through this app. Disconnect it before changing the app ID.'
  }
  // A saved secret belongs to the app it was saved for: someone who never saw it cannot move it to
  // another app ID. With a new ID the secret is typed again, or removed.
  if (idChanged && appId && before?.appSecretEncrypted && !secret && !clearSecret && !errors.appId) {
    errors.appSecret = 'The saved app secret belongs to the app ID it was saved with. Enter the secret of this app, or remove the saved one.'
  }
  if (Object.keys(errors).length) throw new ValidationError(errors)

  const sealed = secret ? host().secrets.seal(secret, SECRET_PURPOSE) : clearSecret ? null : (before?.appSecretEncrypted ?? null)
  const secretChanged = Boolean(secret) || (clearSecret && Boolean(before?.appSecretEncrypted))
  const changed = [...(idChanged ? ['app ID'] : []), ...(secretChanged ? ['app secret'] : [])]
  if (changed.length) await patchSettings({ appId: appId || null, appSecretEncrypted: sealed, ...NO_PENDING_SIGN_IN })
  return { view: await getConnection(user), changed }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

/**
 * Starts Instagram's sign-in: makes a one-time `state`, keeps only its sha256 (for 10 minutes, for
 * this person) and returns the address to send the browser to. Starting again ends an earlier one.
 */
export async function startAuthorization(user: PluginUser): Promise<{ url: string }> {
  const row = await readSettings()
  if (!row?.appId || !row.appSecretEncrypted) throw new UserError('Save the app ID and the app secret first.')
  if (!host().secrets.open(row.appSecretEncrypted, SECRET_PURPOSE)) throw new UserError('The saved app secret can no longer be read (the site’s secret changed). Enter it again.')
  const state = randomBytes(32).toString('base64url')
  await patchSettings({ oauthStateHash: sha256(state), oauthStateExpiresAt: new Date(Date.now() + STATE_TTL_MS), oauthStateUserId: user.id })
  return { url: authorizeUrl({ appId: row.appId, redirectUri: redirectUri(), state }) }
}

/**
 * Whether `state` is the pending sign-in that was handed out to `user`, taking it out of the row
 * when it is the one stored, so it works once. A `state` that is not the stored one changes
 * nothing: a made-up callback address cannot end a sign-in someone else has under way. The stored
 * one is spent even when it turns out to be too old or another person's.
 */
async function claimState(user: PluginUser, state: string): Promise<boolean> {
  if (!STATE.test(state)) return false
  const row = await readSettings()
  if (!row?.oauthStateHash) return false
  const given = Buffer.from(sha256(state), 'hex')
  const kept = Buffer.from(row.oauthStateHash, 'hex')
  if (given.length !== kept.length || !timingSafeEqual(given, kept)) return false
  const { db, t } = await openInstagramDatabase()
  // Two callbacks with the same state: only one of them finds the hash still there.
  const claimed = await db.update(t.settings).set(NO_PENDING_SIGN_IN).where(eq(t.settings.oauthStateHash, row.oauthStateHash)).returning({ id: t.settings.id })
  if (!claimed.length) return false
  return row.oauthStateUserId === user.id && Boolean(row.oauthStateExpiresAt) && row.oauthStateExpiresAt!.getTime() > Date.now()
}

/** Finishes Instagram's sign-in with the `code` and `state` it sent back to the callback screen. */
export async function completeAuthorization(user: PluginUser, raw: unknown): Promise<ConnectionView> {
  const input = asRecord(raw)
  const state = typeof input.state === 'string' ? input.state : ''
  // Instagram ends the address with "#_"; a browser keeps that out, a copied address may not.
  const code = typeof input.code === 'string' ? input.code.trim().replace(/#_$/, '') : ''
  // The stored state is spent before anything else is looked at: a second try needs a new sign-in.
  const claimed = await claimState(user, state)
  if (!claimed || !code || code.length > 2000) throw new UserError(SIGN_IN_REFUSED)

  const row = await readSettings()
  const secret = row?.appSecretEncrypted ? host().secrets.open(row.appSecretEncrypted, SECRET_PURPOSE) : null
  if (!row?.appId || !secret) throw new UserError('Save the app ID and the app secret first.')
  const short = await exchangeCode({ appId: row.appId, appSecret: secret, redirectUri: redirectUri(), code })
  const long = await exchangeLongLived({ appSecret: secret, token: short.token })
  return connect(user, 'oauth', long.token, long.expiresAt)
}

/**
 * Connects with an access token made in the Meta app dashboard ("bring your own key"). No app
 * secret is needed: such a token is long-lived already and is renewed without one.
 */
export async function connectWithToken(user: PluginUser, raw: unknown): Promise<ConnectionView> {
  const token = typeof raw === 'string' ? raw.trim() : ''
  if (!ACCESS_TOKEN.test(token)) throw new ValidationError({ token: token ? 'That does not look like an access token: copy it again from the Meta app dashboard.' : 'Paste the access token.' })
  try {
    return await connect(user, 'token', token, null)
  } catch (error) {
    if (error instanceof InstagramError && (error.kind === 'expired' || error.kind === 'unexpected')) {
      throw new ValidationError({ token: 'Instagram did not accept this access token. Generate a new one in the Meta app dashboard and paste it again.' })
    }
    throw error
  }
}

/** The shared end of both ways in: the token must read a Business or Creator profile. */
async function connect(user: PluginUser, method: 'oauth' | 'token', token: string, expiresAt: Date | null): Promise<ConnectionView> {
  const profile = await fetchProfile(token)
  if (!(ALLOWED_ACCOUNT_TYPES as readonly string[]).includes(profile.accountType)) throw new InstagramError('personal')
  if (!USERNAME.test(profile.username) || !POST_ID.test(profile.id)) throw new InstagramError('unexpected')

  const before = await readSettings()
  const sameAccount = isConnected(before) && before.accountId === profile.id
  const now = new Date()
  await patchSettings({
    accessTokenEncrypted: host().secrets.seal(token, TOKEN_PURPOSE),
    // A pasted token is at least as old as this moment: good enough for "at least a day old".
    tokenIssuedAt: now,
    tokenExpiresAt: expiresAt,
    tokenRefreshTriedAt: null,
    method,
    accountId: profile.id,
    accountUsername: profile.username,
    accountName: cleanLine(profile.name, 100),
    accountType: profile.accountType,
    accountPictureUrl: safeImageUrl(profile.pictureUrl),
    connectedAt: now,
    connectedBy: user.id,
    pinnedIds: sameAccount ? readPinnedIds(before.pinnedIds) : [],
    lastAttemptAt: null,
    lastFetchedAt: sameAccount ? before.lastFetchedAt : null,
    lastError: null,
    ...NO_PENDING_SIGN_IN,
  })
  // The new token is in the row first, so a read of the old connection can write nothing more;
  // only then is the other account's feed removed.
  forgetRefresh()
  if (!sameAccount) await clearCache()
  // The first feed. If it fails the account stays connected and the screen says why.
  await refreshOnce()
  return getConnection(user)
}

/** Forgets the token, the account, the feed and the pins. The app's keys stay. */
export async function disconnect(user: PluginUser): Promise<ConnectionView> {
  await patchSettings({
    accessTokenEncrypted: null,
    tokenIssuedAt: null,
    tokenExpiresAt: null,
    tokenRefreshTriedAt: null,
    method: null,
    accountId: null,
    accountUsername: null,
    accountName: null,
    accountType: null,
    accountPictureUrl: null,
    connectedAt: null,
    connectedBy: null,
    pinnedIds: [],
    lastAttemptAt: null,
    lastFetchedAt: null,
    lastError: null,
    ...NO_PENDING_SIGN_IN,
  })
  forgetRefresh()
  await clearCache()
  return getConnection(user)
}

// --- Reading from Instagram ---------------------------------------------------------------------

/** Whether the token is due for renewal: at least a day old, not expired, and close to its end or a week old. */
function tokenIsDue(row: SettingsRow, now: number): boolean {
  const issued = (row.tokenIssuedAt ?? row.connectedAt)?.getTime()
  if (!issued || now - issued < TOKEN_MIN_AGE_MS) return false
  const expires = row.tokenExpiresAt?.getTime() ?? null
  if (expires !== null && expires <= now) return false
  if (row.tokenRefreshTriedAt && now - row.tokenRefreshTriedAt.getTime() < DAY) return false
  return (expires !== null && expires - now < TOKEN_RENEW_BEFORE_MS) || now - issued > TOKEN_RENEW_AGE_MS
}

/**
 * Words for the owner about a failure. A failed call to Instagram arrives here as an InstagramError
 * (a fixed sentence, logged already without its address); anything else is this site's own.
 */
function failureText(error: unknown, context: string): string {
  if (error instanceof InstagramError) return error.message
  host().logError(error, `instagram-feed: ${context}`)
  return 'The feed could not be updated because of a problem on this site. Try again; the server log has the details.'
}

/**
 * One read from Instagram: renews the token when it is due, then the profile, the latest posts and
 * any pinned post that is older than those. True when the cache was replaced. Never throws: a
 * failure keeps the old cache and is recorded as `lastError`.
 *
 * Everything it records goes through `record`, which writes only while the row still holds the
 * sealed token this read holds (see the notes at the top). When that fails the connection was
 * removed or replaced meanwhile, and the read stops without writing anything.
 */
async function runRefresh(): Promise<boolean> {
  try {
    const row = await readSettings()
    if (!isConnected(row) || !row.accessTokenEncrypted) return false
    let held: string = row.accessTokenEncrypted
    const record = (patch: SettingsPatch) => patchSettingsWhile('accessTokenEncrypted', held, patch)
    const started = new Date()
    if (!(await record({ lastAttemptAt: started }))) return false
    let token = host().secrets.open(held, TOKEN_PURPOSE)
    if (!token) {
      await record({ lastError: TOKEN_UNREADABLE })
      return false
    }

    let note: string | null = null
    if (tokenIsDue(row, started.getTime())) {
      let fresh: Awaited<ReturnType<typeof refreshToken>> | null = null
      try {
        fresh = await refreshToken(token)
      } catch (error) {
        // The old token is kept: it works until it expires.
        if (!(error instanceof InstagramError)) host().logError(error, 'instagram-feed: renewing the access token')
        note = TOKEN_NOT_RENEWED
      }
      if (fresh) {
        const renewed = host().secrets.seal(fresh.token, TOKEN_PURPOSE)
        // Disconnected or connected anew while Instagram answered: the renewed token is dropped.
        if (!(await record({ accessTokenEncrypted: renewed, tokenIssuedAt: started, tokenExpiresAt: fresh.expiresAt, tokenRefreshTriedAt: started }))) return false
        token = fresh.token
        held = renewed
      } else if (!(await record({ tokenRefreshTriedAt: started }))) {
        return false
      }
    }

    let profile: FeedProfile
    let posts: StoredPost[]
    // The pins as they were when the read started, each with what Instagram said about it.
    const asked = readPinnedIds(row.pinnedIds)
    const answered = new Map<string, StoredPost>()
    try {
      const [rawProfile, rawMedia] = await Promise.all([fetchProfile(token), fetchMedia(token, LATEST_POSTS)])
      profile = toProfile(rawProfile, await fetchBiography(token))
      posts = rawMedia.map(toStoredPost).filter((post): post is StoredPost => post !== null).slice(0, LATEST_POSTS)
      const kept = readStoredPosts((await readCache())?.pinnedPosts)
      for (const id of asked) {
        if (posts.some((post) => post.id === id)) continue
        let found: StoredPost | null = null
        try {
          const raw = await fetchMediaById(token, id)
          // As when it was pinned: Instagram must say whose post it is.
          found = raw && raw.username === profile.username ? toStoredPost(raw) : null
        } catch {
          // Not readable just now: the copy from the last read stands in.
          found = kept.find((post) => post.id === id) ?? null
        }
        if (found) answered.set(id, found)
      }
    } catch (error) {
      await record({ lastError: failureText(error, 'reading the feed') })
      return false
    }

    // The pins may have changed while Instagram was being read. A post pinned meanwhile was not
    // asked for above: its copy, stored when it was pinned, is carried over, or it would be
    // missing from the feed until the next read.
    const current = await readSettings()
    if (!isConnected(current) || current.accessTokenEncrypted !== held) return false
    const before = await readCache()
    const copies = [...readStoredPosts(before?.pinnedPosts), ...readStoredPosts(before?.posts)]
    const pinnedPosts: StoredPost[] = []
    for (const id of readPinnedIds(current.pinnedIds)) {
      if (posts.some((post) => post.id === id)) continue
      const post = asked.includes(id) ? answered.get(id) : copies.find((copy) => copy.id === id)
      if (post) pinnedPosts.push(post)
    }

    // The settings row first, and only for this connection; the cache only after that worked.
    const fetchedAt = new Date()
    if (!(await record({ accountUsername: profile.username, accountName: profile.name, accountPictureUrl: profile.pictureUrl, lastFetchedAt: fetchedAt, lastError: note }))) return false
    await writeCache({ profile, posts, pinnedPosts, fetchedAt })
    // The cache has no column that names its connection, so the two writes above are not one. If
    // the account was removed or replaced between them, what was just written is taken out again
    // (only that: a feed the new connection wrote meanwhile has another time on it).
    const after = await readSettings()
    if (!isConnected(after) || after.accountId !== row.accountId) {
      const { db, t } = await openInstagramDatabase()
      await db.delete(t.cache).where(and(eq(t.cache.id, ROW_ID), eq(t.cache.fetchedAt, fetchedAt)))
      return false
    }
    return true
  } catch (error) {
    // The database, or the plugin's tables are not set up: nothing can be recorded.
    if (!(error instanceof UserError)) host().logError(error, 'instagram-feed: updating the feed')
    return false
  }
}

// One read at a time per process. On globalThis: actions and pages can hold separate copies of this module.
const REFRESH_SLOT = Symbol.for('pet-adopt.instagram-feed.refresh')
const PAGE_WAIT_SLOT = Symbol.for('pet-adopt.instagram-feed.page-wait')
const slot = globalThis as unknown as { [REFRESH_SLOT]?: Promise<boolean>; [PAGE_WAIT_SLOT]?: number }

/** Starts a read from Instagram, or joins the one under way. Never during a build. */
function refreshOnce(): Promise<boolean> {
  if (duringBuild()) return Promise.resolve(false)
  const running = slot[REFRESH_SLOT]
  if (running) return running
  const started: Promise<boolean> = runRefresh().finally(() => {
    if (slot[REFRESH_SLOT] === started) slot[REFRESH_SLOT] = undefined
  })
  slot[REFRESH_SLOT] = started
  return started
}

/**
 * After a connect or a disconnect: a read that is under way belongs to the connection before it
 * (it will stop at its next write), so the next read is a new one instead of joining that one.
 */
function forgetRefresh(): void {
  slot[REFRESH_SLOT] = undefined
}

/** check:backend only: how long a page waits for a read (null puts PAGE_WAIT_MS back). */
export function setPageWaitForChecks(ms: number | null): void {
  slot[PAGE_WAIT_SLOT] = ms ?? undefined
}

/**
 * Reads again when the cache is older than an hour (or missing) and no read was started in the last
 * five minutes. A page (`wait: 'page'`) waits a few seconds at most, with or without an older feed
 * to show: Instagram being slow must not hold up every visitor, and the read finishes on its own.
 * The team's own screens (`wait: 'full'`) wait for a first feed, so they do not show "nothing" for
 * a feed that is on its way. While the site is being built nothing is read: the cache is served.
 */
async function ensureFresh(row: SettingsRow, cachedAt: Date | null, wait: 'page' | 'full'): Promise<void> {
  if (duringBuild()) return
  const now = Date.now()
  if (cachedAt && now - cachedAt.getTime() < FEED_MAX_AGE_MS) return
  if (row.lastAttemptAt && now - row.lastAttemptAt.getTime() < RETRY_AFTER_MS && !slot[REFRESH_SLOT]) return
  const refresh = refreshOnce()
  if (!cachedAt && wait === 'full') {
    await refresh
    return
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([refresh, new Promise<void>((resolve) => (timer = setTimeout(resolve, slot[PAGE_WAIT_SLOT] ?? PAGE_WAIT_MS)))])
  clearTimeout(timer)
}

/** The settings and the cache, read again first when the cache is old. Null when no account is connected. */
async function freshState(wait: 'page' | 'full') {
  const row = await readSettings()
  if (!isConnected(row)) return null
  const cache = await readCache()
  const fetchedBefore = cache?.fetchedAt ?? null
  await ensureFresh(row, fetchedBefore, wait)
  const after = await readCache()
  // The pins are read again too: a read may have run for a while.
  return { row: (await readSettings()) ?? row, cache: after }
}

type State = NonNullable<Awaited<ReturnType<typeof freshState>>>

/** Every cached post, pinned first in the order pinned, then the latest; no post twice. */
function orderedPosts(state: State, includePinned: boolean): FeedPost[] {
  const latest = readStoredPosts(state.cache?.posts)
  const known = new Map([...readStoredPosts(state.cache?.pinnedPosts), ...latest].map((post) => [post.id, post]))
  const lead = includePinned ? readPinnedIds(state.row.pinnedIds).map((id) => known.get(id)).filter((post): post is StoredPost => Boolean(post)) : []
  const leading = new Set(lead.map((post) => post.id))
  return [...lead.map((post) => ({ ...post, pinned: true })), ...latest.filter((post) => !leading.has(post.id)).map((post) => ({ ...post, pinned: false }))]
}

/**
 * The feed for one block: `count` posts (MIN_POSTS to MAX_POSTS, pinned ones included), pinned
 * first unless `pinned` is 'exclude'. Null when no account is connected or nothing was ever read.
 * `wait` says how long a read from Instagram may hold this up (see ensureFresh); a page is the default.
 */
export async function getFeed(options: { count?: unknown; pinned?: unknown; wait?: 'page' | 'full' } = {}): Promise<InstagramFeedData | null> {
  const state = await freshState(options.wait === 'full' ? 'full' : 'page')
  const profile = readStoredProfile(state?.cache?.profile)
  if (!state?.cache || !profile) return null
  const count = clampWhole(options.count, MIN_POSTS, MAX_POSTS, DEFAULT_POSTS)
  return { profile, posts: orderedPosts(state, options.pinned !== 'exclude').slice(0, count), fetchedAt: state.cache.fetchedAt.toISOString() }
}

/**
 * The page builder block's loader (public). Reads `count` and `pinned` from the block's saved,
 * unchecked options. Never throws: null when no account is connected, the plugin's tables are not
 * set up yet, or nothing is cached (a first read that takes longer than a page waits gives null
 * this time and the feed the next). Only public data: no token, account id or error.
 */
export async function loadInstagramFeed(props: Record<string, unknown>): Promise<InstagramFeedData | null> {
  try {
    const options = asRecord(props)
    return await getFeed({ count: options.count, pinned: options.pinned })
  } catch (error) {
    // A UserError here is "the plugin's tables are not set up": the admin screens say so already.
    if (!(error instanceof UserError)) host().logError(error, 'instagram-feed: loading the feed for a page')
    return null
  }
}

/** The feed as the dashboard card and the plugin's screen show it: the most a block can show, pins first. */
export const getFeedPreview = () => getFeed({ count: MAX_POSTS, pinned: 'include', wait: 'full' })

/** "Refresh now": reads from Instagram whatever the cache's age. Throws, with the reason, when it fails. */
export async function refreshFeed(): Promise<InstagramFeedData | null> {
  if (!isConnected(await readSettings())) return null
  if (!(await refreshOnce())) throw new UserError((await readSettings())?.lastError ?? 'The feed could not be updated. Try again in a moment.')
  return getFeedPreview()
}

/** The cached posts for choosing pins: pinned first (in order), then the latest, newest first. */
export async function listRecentPosts(): Promise<FeedPost[]> {
  const state = await freshState('full')
  return state ? orderedPosts(state, true) : []
}

/**
 * Sets the pinned posts, in order: at most MAX_PINNED ids (digits), each one a post of the
 * connected account: among the cached posts, or confirmed by asking Instagram for it.
 */
export async function setPinnedPosts(raw: unknown): Promise<FeedPost[]> {
  const list = Array.isArray(raw) ? raw : null
  if (!list || list.some((id) => typeof id !== 'string' || !POST_ID.test(id))) throw new ValidationError({ ids: 'Choose posts from the list.' })
  const ids = [...new Set(list as string[])]
  if (ids.length > MAX_PINNED) throw new ValidationError({ ids: `At most ${MAX_PINNED} posts can be pinned.` })

  const row = await readSettings()
  if (!isConnected(row)) throw new UserError(NOT_CONNECTED)
  const cache = await readCache()
  const profile = readStoredProfile(cache?.profile)
  if (!cache || !profile) throw new UserError('The feed has not been read from Instagram yet. Refresh it, then pin posts.')
  const latest = readStoredPosts(cache.posts)
  const kept = readStoredPosts(cache.pinnedPosts)

  const pinnedPosts: StoredPost[] = []
  for (const id of ids) {
    if (latest.some((post) => post.id === id)) continue
    let post = kept.find((candidate) => candidate.id === id) ?? null
    if (!post) {
      const token = host().secrets.open(row.accessTokenEncrypted, TOKEN_PURPOSE)
      if (!token) throw new UserError(TOKEN_UNREADABLE)
      const found = await fetchMediaById(token, id)
      // Instagram must say whose post it is: a post of another account is never pinned.
      post = found && found.username === profile.username ? toStoredPost(found) : null
    }
    if (!post) throw new ValidationError({ ids: 'One of those posts is not a post of the connected account, or has no picture that can be shown.' })
    pinnedPosts.push(post)
  }

  const { db, t } = await openInstagramDatabase()
  // The copies first, so a read that is finishing just now finds them (see runRefresh). The pins
  // only for the account the posts were checked against: it may have been disconnected meanwhile.
  await db.update(t.cache).set({ pinnedPosts }).where(eq(t.cache.id, ROW_ID))
  if (!(await patchSettingsWhile('accountId', row.accountId ?? '', { pinnedIds: ids }))) throw new UserError(NOT_CONNECTED)
  return orderedPosts({ row: { ...row, pinnedIds: ids }, cache: { ...cache, pinnedPosts } }, true)
}

/** The pinned ids as saved (for the activity log's "what changed"). */
export async function getPinnedIds(): Promise<string[]> {
  return readPinnedIds((await readSettings())?.pinnedIds)
}

/**
 * check:backend only: moves the cache, the last attempt and the token's dates back by `ms`, as if
 * that much time had passed, so the hourly read, the retry pause and the token renewal can be checked.
 */
export async function backdateForChecks(ms: number): Promise<void> {
  const back = (value: Date | null | undefined) => (value ? new Date(value.getTime() - ms) : null)
  const row = await readSettings()
  if (row) {
    await patchSettings({
      tokenIssuedAt: back(row.tokenIssuedAt),
      tokenExpiresAt: back(row.tokenExpiresAt),
      tokenRefreshTriedAt: back(row.tokenRefreshTriedAt),
      connectedAt: back(row.connectedAt),
      lastAttemptAt: back(row.lastAttemptAt),
      oauthStateExpiresAt: back(row.oauthStateExpiresAt),
    })
  }
  const cache = await readCache()
  if (cache) {
    const { db, t } = await openInstagramDatabase()
    await db.update(t.cache).set({ fetchedAt: new Date(cache.fetchedAt.getTime() - ms) }).where(eq(t.cache.id, ROW_ID))
  }
}
