// The only code that calls Instagram ("Instagram API with Instagram Login", for professional
// accounts; what was checked against Meta's documentation is in .claude/instagram-plugin/api-notes.md).
//
// Rules kept here:
//  - Three fixed hosts and nothing else: www.instagram.com (the address the owner's browser opens
//    to sign in), api.instagram.com (code for a token) and graph.instagram.com (everything else).
//  - 8 seconds per call, and a redirect is never followed.
//  - An access token travels in the query string, so an address, a raw error or Instagram's own
//    error text is NEVER logged or shown. A failure becomes one of the fixed sentences below; the
//    log gets the step's name, the HTTP status and Instagram's numeric error codes only.
//  - An answer of an unexpected shape is a failure with a clear sentence, never a crash.
//  - Calls go out through node:https, never the global `fetch`. Inside Next the global fetch is
//    Next's own wrapper: while `next build` prerenders a page it stores every answer, with the
//    address (and so the token), under .next/cache/fetch-cache; at any time it puts the address
//    into its tracing span and fetch log, and in development into its hot-reload cache. Marking a
//    call `cache: 'no-store'` would keep it out of the cache but makes a `revalidate` page dynamic,
//    and the unpatched fetch Next keeps (`fetch._nextOriginalFetch`) is a private name. node:https
//    is none of Next's business, needs no package, and never follows a redirect.
//  - Nothing is called while the site is being built (`duringBuild`): a build serves what is cached.
import { request } from 'node:https'

import { host, UserError } from '@pet-adopt/plugin-sdk'

const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize'
const TOKEN_URL = 'https://api.instagram.com/oauth/access_token'
const GRAPH = 'https://graph.instagram.com'
/** The Graph API version the calls were written against. */
const GRAPH_VERSION = 'v27.0'
const SCOPE = 'instagram_business_basic'
const TIMEOUT_MS = 8000
/** Instagram's answers are a few kilobytes; one beyond this is cut off and counts as a failure. */
const MAX_ANSWER_BYTES = 2_000_000

/** True while `next build` runs: pages prerendered then must not reach Instagram. */
export const duringBuild = () => process.env.NEXT_PHASE === 'phase-production-build'

const MEDIA_FIELDS = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp'
// `biography` is asked for on its own (fetchBiography): if this login does not offer it, the
// profile itself must still load.
const PROFILE_FIELDS = 'user_id,username,name,account_type,profile_picture_url,followers_count,media_count'

export type InstagramFailure = 'expired' | 'secret' | 'redirect' | 'code' | 'personal' | 'rate' | 'permission' | 'unreachable' | 'unexpected'

/** What the owner is told. Fixed sentences: nothing Instagram sent is ever put into them. */
export const FAILURE_TEXT: Record<InstagramFailure, string> = {
  expired: 'Instagram no longer accepts the saved access token (it expired, or access was removed). Connect the account again.',
  secret: 'Instagram did not accept the app secret. Copy the Instagram app secret again from the Meta app dashboard and save it.',
  redirect: 'Instagram did not accept the redirect address. Add the redirect address shown on this screen, exactly as written, to the Meta app’s OAuth redirect URIs.',
  code: 'Instagram’s sign-in answer could not be used (it may have been used already, or took too long). Start connecting again.',
  personal:
    'Only Business and Creator accounts can be connected. In the Instagram app, open Settings, then “Account type and tools”, and switch to a professional account; then connect again.',
  rate: 'Instagram is limiting requests from this app just now. Try again in a while.',
  permission: 'Instagram refused the request: the app is not allowed to read this account. Check that the account is added to the Meta app and that it granted “instagram_business_basic”.',
  unreachable: 'Instagram could not be reached. Try again in a moment.',
  unexpected: 'Instagram answered in a way this plugin does not understand. Try again later.',
}

/** A failed call. A UserError, so its sentence is safe to show; `kind` lets the rules react. */
export class InstagramError extends UserError {
  constructor(public kind: InstagramFailure) {
    super(FAILURE_TEXT[kind])
    this.name = 'UserError'
  }
}

type FetchInit = { method: 'GET' | 'POST'; body?: URLSearchParams; signal: AbortSignal; redirect: 'manual' }
export type InstagramFetch = (url: string, init: FetchInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/**
 * The real transport: one https request, read to its end (see the notes at the top for why this is
 * not `fetch`). A redirect comes back as its 3xx status, unfollowed. Exported for a check only.
 */
export const instagramHttps: InstagramFetch = (address, init) =>
  new Promise((resolve, reject) => {
    const url = new URL(address)
    if (url.protocol !== 'https:') {
      reject(new TypeError('Instagram is only called over https'))
      return
    }
    const body = init.body?.toString()
    const sent = request(
      url,
      {
        method: init.method,
        signal: init.signal,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) }),
        },
      },
      (answer) => {
        const chunks: Buffer[] = []
        let size = 0
        answer.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_ANSWER_BYTES) sent.destroy(new RangeError('the answer is too large'))
          else chunks.push(chunk)
        })
        answer.on('error', reject)
        answer.on('end', () => {
          const status = answer.statusCode ?? 0
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text) as unknown })
        })
      },
    )
    sent.on('error', reject)
    sent.end(body)
  })
// On globalThis: server actions, routes and scripts can each hold their own copy of this module.
const FETCH_SLOT = Symbol.for('pet-adopt.instagram-feed.fetch')
const slot = globalThis as unknown as Record<symbol, InstagramFetch | undefined>

/** check:backend only: answers Instagram's calls without the network. Pass null to undo. */
export function setInstagramFetchForChecks(fn: InstagramFetch | null): void {
  slot[FETCH_SLOT] = fn ?? undefined
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): string | null => (typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : null)

/** Some answers come as `{ data: [ {...} ] }`, some as the object itself. */
function unwrap(json: unknown): Json | null {
  if (!isObject(json)) return null
  if (Array.isArray(json.data)) return isObject(json.data[0]) ? json.data[0] : null
  return json
}

const RATE_CODES = new Set([4, 17, 32, 341, 613])

/** Which failure an error answer is. Instagram's words are read here and go no further. */
function failureOf(status: number, json: unknown, step: Step): InstagramFailure {
  if (status === 429) return 'rate'
  const body = isObject(json) ? json : {}
  // The Graph API answers { error: { message, type, code, error_subcode } }; the sign-in endpoint
  // answers { error_type, code, error_message }.
  const error = isObject(body.error) ? body.error : body
  const code = typeof error.code === 'number' ? error.code : Number(error.code)
  const words = `${text(error.message) ?? ''} ${text(error.error_message) ?? ''}`.toLowerCase()
  if (step === 'code') {
    if (words.includes('redirect')) return 'redirect'
    if (words.includes('secret') || words.includes('client')) return 'secret'
    return 'code'
  }
  if (code === 190 || code === 102 || status === 401) return 'expired'
  if (RATE_CODES.has(code)) return 'rate'
  if (step === 'long-lived' && (words.includes('secret') || words.includes('client'))) return 'secret'
  if (code === 10 || (code >= 200 && code <= 299) || status === 403) return 'permission'
  if (status >= 500 || code === 1 || code === 2) return 'unreachable'
  if (step === 'long-lived') return 'secret'
  return 'unexpected'
}

type Step = 'code' | 'long-lived' | 'refresh' | 'profile' | 'biography' | 'media' | 'post'

/** What may be logged about a failure: the step, the status and Instagram's numeric codes. */
function logFailure(step: Step, status: number | null, json: unknown, thrown?: unknown): void {
  const body = isObject(json) ? json : {}
  const error = isObject(body.error) ? body.error : body
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : '-')
  // The name of what was thrown (TimeoutError, TypeError) says enough; its message may hold the address.
  const name = thrown instanceof Error ? thrown.name.replace(/[^A-Za-z]/g, '').slice(0, 40) : thrown === undefined ? '-' : 'unknown'
  host().logError(
    new Error(`status ${status ?? '-'}, code ${number(error.code)}, subcode ${number(error.error_subcode)}, thrown ${name}`),
    `instagram-feed: the "${step}" call to Instagram failed`,
  )
}

/** One call. Resolves the parsed answer of a successful one; throws an InstagramError otherwise. */
async function call(step: Step, url: URL, init: { method: 'GET' | 'POST'; body?: URLSearchParams }, quiet = false): Promise<unknown> {
  // The feed's own rules do not ask during a build; this is the last line of defence.
  if (duringBuild()) throw new InstagramError('unreachable')
  let response: Awaited<ReturnType<InstagramFetch>>
  try {
    response = await (slot[FETCH_SLOT] ?? instagramHttps)(url.toString(), { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' })
  } catch (error) {
    if (!quiet) logFailure(step, null, null, error)
    throw new InstagramError('unreachable')
  }
  let json: unknown = null
  try {
    json = await response.json()
  } catch {
    // Not JSON: decided by the status below.
  }
  if (!response.ok) {
    if (!quiet) logFailure(step, response.status, json)
    // A redirect is never followed: Instagram's API does not send one.
    throw new InstagramError(response.status >= 300 && response.status < 400 ? 'unexpected' : failureOf(response.status, json, step))
  }
  if (isObject(json) && (isObject(json.error) || typeof json.error_type === 'string')) {
    if (!quiet) logFailure(step, response.status, json)
    throw new InstagramError(failureOf(response.status, json, step))
  }
  return json
}

function graph(path: string, params: Record<string, string>, versioned = true): URL {
  const url = new URL(`${GRAPH}${versioned ? `/${GRAPH_VERSION}` : ''}${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url
}

/** The address the owner's browser opens to sign in to Instagram and allow the app. */
export function authorizeUrl(input: { appId: string; redirectUri: string; state: string }): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', input.appId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPE)
  url.searchParams.set('state', input.state)
  return url.toString()
}

/** The sign-in's one-time code for a short-lived token (valid about an hour). */
export async function exchangeCode(input: { appId: string; appSecret: string; redirectUri: string; code: string }): Promise<{ token: string }> {
  const body = new URLSearchParams({
    client_id: input.appId,
    client_secret: input.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
    code: input.code,
  })
  const answer = unwrap(await call('code', new URL(TOKEN_URL), { method: 'POST', body }))
  const token = text(answer?.access_token)
  if (!token) throw new InstagramError('unexpected')
  return { token }
}

type Token = { token: string; expiresAt: Date | null }

function toToken(json: unknown): Token {
  const answer = unwrap(json)
  const token = text(answer?.access_token)
  if (!token) throw new InstagramError('unexpected')
  const seconds = typeof answer?.expires_in === 'number' && answer.expires_in > 0 && answer.expires_in < 400 * 86400 ? answer.expires_in : null
  return { token, expiresAt: seconds ? new Date(Date.now() + seconds * 1000) : null }
}

/** A short-lived token for a long-lived one (60 days). Needs the app secret. */
export async function exchangeLongLived(input: { appSecret: string; token: string }): Promise<Token> {
  const url = graph('/access_token', { grant_type: 'ig_exchange_token', client_secret: input.appSecret, access_token: input.token }, false)
  return toToken(await call('long-lived', url, { method: 'GET' }))
}

/** A long-lived token for a fresh one. It must be at least a day old and not expired; no secret needed. */
export async function refreshToken(token: string): Promise<Token> {
  return toToken(await call('refresh', graph('/refresh_access_token', { grant_type: 'ig_refresh_token', access_token: token }, false), { method: 'GET' }))
}

/** The account as Instagram describes it. Nothing here is checked yet: the rules do that. */
export type RawProfile = {
  id: string
  username: string
  name: string | null
  accountType: string
  pictureUrl: string | null
  followers: number | null
  posts: number | null
}

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null)

export async function fetchProfile(token: string): Promise<RawProfile> {
  const answer = unwrap(await call('profile', graph('/me', { fields: PROFILE_FIELDS, access_token: token }), { method: 'GET' }))
  const id = text(answer?.user_id) ?? text(answer?.id)
  const username = text(answer?.username)
  if (!answer || !id || !username) throw new InstagramError('unexpected')
  return {
    id,
    username,
    name: text(answer.name),
    accountType: (text(answer.account_type) ?? '').toUpperCase(),
    pictureUrl: text(answer.profile_picture_url),
    followers: count(answer.followers_count),
    posts: count(answer.media_count),
  }
}

/** The profile's bio, or null when there is none or Instagram does not give it. Never throws. */
export async function fetchBiography(token: string): Promise<string | null> {
  try {
    const answer = unwrap(await call('biography', graph('/me', { fields: 'biography', access_token: token }), { method: 'GET' }, true))
    return text(answer?.biography)
  } catch {
    return null
  }
}

/** One post as Instagram describes it. Unchecked: the rules validate every value before storing. */
export type RawMedia = {
  id: string
  caption: string | null
  mediaType: string
  mediaUrl: string | null
  thumbnailUrl: string | null
  permalink: string | null
  timestamp: string | null
  /** Only on a post read by id. */
  username: string | null
}

function toRawMedia(value: unknown): RawMedia | null {
  if (!isObject(value)) return null
  const id = text(value.id)
  if (!id) return null
  return {
    id,
    caption: text(value.caption),
    mediaType: text(value.media_type) ?? '',
    mediaUrl: text(value.media_url),
    thumbnailUrl: text(value.thumbnail_url),
    permalink: text(value.permalink),
    timestamp: text(value.timestamp),
    username: text(value.username),
  }
}

/** The account's latest posts, newest first as Instagram lists them. */
export async function fetchMedia(token: string, limit: number): Promise<RawMedia[]> {
  const json = await call('media', graph('/me/media', { fields: MEDIA_FIELDS, limit: String(limit), access_token: token }), { method: 'GET' })
  if (!isObject(json) || !Array.isArray(json.data)) throw new InstagramError('unexpected')
  return json.data.map(toRawMedia).filter((media): media is RawMedia => media !== null)
}

/**
 * One post by its id (digits only, checked by the caller and again here), with its owner's
 * username. Null when Instagram has no such post for this account.
 */
export async function fetchMediaById(token: string, id: string): Promise<RawMedia | null> {
  if (!/^\d{1,32}$/.test(id)) return null
  try {
    return toRawMedia(await call('post', graph(`/${id}`, { fields: `${MEDIA_FIELDS},username`, access_token: token }), { method: 'GET' }, true))
  } catch (error) {
    // "No such object" comes back as a plain refusal; anything else (expired, limited, unreachable) is a real failure.
    if (error instanceof InstagramError && (error.kind === 'unexpected' || error.kind === 'permission')) return null
    throw error
  }
}
