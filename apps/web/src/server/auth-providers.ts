// Sign-in providers: "bring your own" OAuth 2 / OpenID Connect (agreed with the owner). Admins add
// any number on Authentication > Sign-in providers; Better Auth's genericOAuth plugin is built from
// the enabled ones (src/server/auth.ts). Rules:
//  - a provider never creates an account and never links one by matching email: each person
//    connects it to their own account first, while signed in (Account page); after that it signs
//    them in. So a provider that lets its users pick any email cannot take an account over;
//  - a provider sign-in counts as two-factor (the provider does its own checks);
//  - the client secret is stored only encrypted (secret-box) and never sent to a browser;
//  - endpoints must be https (http only for a loopback host outside production, for local testing);
//  - the slug (Better Auth's provider id, in the callback address) is fixed once created;
//  - deleting a provider removes everyone's connection to it.
import { foldText } from '@pet-adopt/plugin-sdk'
import { and, count, eq, inArray, max } from 'drizzle-orm'

import { getDatabase } from '@/db/client'

import { getAuth, SITE_URL } from './auth'
import { DISCOVERY_UNREADABLE, discoveryProblem, endpointProblem } from './provider-endpoints'
import { isLoopbackHost } from './email'
import { asRecord, Fields, logError, UserError } from './result'
import { open, seal } from './secret-box'

export type ProviderKind = 'oidc' | 'oauth2'
export const PROVIDER_KINDS = [
  { value: 'oidc', label: 'OpenID Connect (discovery URL)' },
  { value: 'oauth2', label: 'OAuth 2 (endpoints by hand)' },
] as const satisfies readonly { value: ProviderKind; label: string }[]

export const DEFAULT_SCOPES: Record<ProviderKind, string> = { oidc: 'openid email profile', oauth2: 'email profile' }

/** What the admin screen sees. Never the secret. */
export type AuthProviderView = {
  id: number
  slug: string
  name: string
  kind: ProviderKind
  discoveryUrl: string | null
  authorizationUrl: string | null
  tokenUrl: string | null
  userInfoUrl: string | null
  clientId: string
  secretSet: boolean
  scopes: string
  enabled: boolean
  /** The address to register at the provider. */
  redirectUri: string
  /** How many accounts have connected it. */
  connected: number
  updatedAt: Date
}

/** What the sign-in page and the Account page need: no endpoints, no client id. */
export type PublicProvider = { slug: string; name: string }

const SECRET_PURPOSE = 'auth-provider-secret'
/** Better Auth's own account kinds: a provider slug must not collide with them. */
const RESERVED_SLUGS = ['credential', 'email', 'password', 'email-password', 'anonymous']
const SCOPE = /^[\x21\x23-\x5b\x5d-\x7e]+$/

/** The callback address Better Auth uses for a provider. */
export function redirectUriFor(slug: string): string {
  return `${SITE_URL}/api/auth/callback/${slug}`
}

/**
 * An endpoint the server will call: https (http only on a loopback host outside production). Where
 * it points is checked separately, because that needs a lookup (provider-endpoints.ts).
 */
export function validateEndpoint(value: string): true | string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'Enter a full address, starting with https://.'
  }
  if (url.username || url.password) return 'The address must not contain a user name or password.'
  if (url.hash) return 'Remove the # part.'
  const local = isLoopbackHost(url.hostname) && process.env.NODE_ENV !== 'production'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return 'Use an https:// address.'
  return true
}

function slugFrom(name: string): string {
  const base = foldText(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return base && !RESERVED_SLUGS.includes(base) ? base : 'provider'
}

type Row = typeof import('@/db/schema/sqlite').authProviders.$inferSelect

function view(row: Row, connected: number): AuthProviderView {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind === 'oauth2' ? 'oauth2' : 'oidc',
    discoveryUrl: row.discoveryUrl,
    authorizationUrl: row.authorizationUrl,
    tokenUrl: row.tokenUrl,
    userInfoUrl: row.userInfoUrl,
    clientId: row.clientId,
    secretSet: Boolean(row.clientSecretEncrypted),
    scopes: row.scopes,
    enabled: row.enabled,
    redirectUri: redirectUriFor(row.slug),
    connected,
    updatedAt: row.updatedAt,
  }
}

/** Every provider, in name order, with how many accounts connected it. */
export async function listAuthProviders(): Promise<AuthProviderView[]> {
  const { db, t } = await getDatabase()
  const rows = await db.select().from(t.authProviders)
  const counts = rows.length
    ? await db
        .select({ providerId: t.accounts.providerId, n: count() })
        .from(t.accounts)
        .where(inArray(t.accounts.providerId, rows.map((row) => row.slug)))
        .groupBy(t.accounts.providerId)
    : []
  const connected = new Map(counts.map((c) => [c.providerId, c.n]))
  return rows.map((row) => view(row, connected.get(row.slug) ?? 0)).sort((a, b) => foldText(a.name).localeCompare(foldText(b.name)))
}

/**
 * The enabled providers this server's Better Auth was built with, for the sign-in and Account pages.
 * One providerConfigs left out (see `skipped`) is not offered: it could not sign anyone in.
 */
export async function listEnabledProviders(): Promise<PublicProvider[]> {
  // Built first, so `skipped` describes the instance that would handle the sign-in.
  await getAuth()
  return (await listAuthProviders()).filter((p) => p.enabled && !skipped.has(p.slug)).map(({ slug, name }) => ({ slug, name }))
}

/** Which providers this account has connected (Better Auth account rows, by provider id). */
export async function connectedProviders(userId: string): Promise<Set<string>> {
  const { db, t } = await getDatabase()
  const rows = await db.select({ providerId: t.accounts.providerId }).from(t.accounts).where(eq(t.accounts.userId, userId))
  return new Set(rows.map((row) => row.providerId))
}

/** Removes one account's connection to a provider (its Better Auth account row). */
export async function disconnectProvider(userId: string, slug: string): Promise<void> {
  if (slug === 'credential') throw new UserError('That provider is not connected.')
  const { db, t } = await getDatabase()
  await db.delete(t.accounts).where(and(eq(t.accounts.userId, userId), eq(t.accounts.providerId, slug)))
}

/**
 * Creates (`id` null) or updates a provider: `{ name, kind, discoveryUrl | authorizationUrl,
 * tokenUrl, userInfoUrl, clientId, clientSecret, clearSecret, scopes, enabled }`. A blank client
 * secret keeps the stored one. Returns the provider and the names of the fields that changed.
 */
export async function saveAuthProvider(id: number | null, raw: unknown): Promise<{ provider: AuthProviderView; fields: string[] }> {
  const input = asRecord(raw)
  const creating = id === null
  const f = new Fields(input, creating)
  const name = f.requiredText('name', 60)
  const kind = f.oneOf('kind', PROVIDER_KINDS, { required: creating })
  const url = (key: string) => f.text(key, 500, { validate: validateEndpoint })
  const discoveryUrl = url('discoveryUrl')
  const authorizationUrl = url('authorizationUrl')
  const tokenUrl = url('tokenUrl')
  const userInfoUrl = url('userInfoUrl')
  const clientId = f.requiredText('clientId', 500)
  const secretRaw = input.clientSecret
  if (secretRaw !== undefined && secretRaw !== null && typeof secretRaw !== 'string') f.fail_('clientSecret', 'Must be text.')
  const clientSecret = typeof secretRaw === 'string' ? secretRaw.trim() : ''
  if (clientSecret.length > 2000) f.fail_('clientSecret', 'Use at most 2000 characters.')
  const clearSecret = f.flag('clearSecret')
  const scopes = f.text('scopes', 500, {
    collapse: true,
    validate: (value) => value.split(' ').every((scope) => SCOPE.test(scope)) || 'Scopes are words separated by spaces.',
  })
  const enabled = f.flag('enabled')

  const { db, t } = await getDatabase()
  const [existing] = creating ? [] : await db.select().from(t.authProviders).where(eq(t.authProviders.id, id)).limit(1)
  if (!creating && !existing) throw new UserError('That sign-in provider no longer exists.')
  const effectiveKind: ProviderKind = (kind ?? existing?.kind) === 'oauth2' ? 'oauth2' : 'oidc'
  const pick = <T,>(value: T | null | undefined, stored: T | null | undefined) => (value === undefined ? (stored ?? null) : value)
  const next = {
    discoveryUrl: pick(discoveryUrl, existing?.discoveryUrl),
    authorizationUrl: pick(authorizationUrl, existing?.authorizationUrl),
    tokenUrl: pick(tokenUrl, existing?.tokenUrl),
    userInfoUrl: pick(userInfoUrl, existing?.userInfoUrl),
  }
  if (effectiveKind === 'oidc' && !next.discoveryUrl) f.fail_('discoveryUrl', 'Enter the discovery URL (it usually ends in /.well-known/openid-configuration).')
  if (effectiveKind === 'oauth2') {
    if (!next.authorizationUrl) f.fail_('authorizationUrl', 'Enter the authorization URL.')
    if (!next.tokenUrl) f.fail_('tokenUrl', 'Enter the token URL.')
    if (!next.userInfoUrl) f.fail_('userInfoUrl', 'Enter the user info URL (it must return an email).')
  }
  // The addresses the server itself will call must be public (see provider-endpoints.ts). The
  // authorization address is only opened by the person's browser.
  if (effectiveKind === 'oidc' && next.discoveryUrl) {
    const problem = await discoveryProblem(next.discoveryUrl)
    if (problem) f.fail_('discoveryUrl', problem)
  }
  if (effectiveKind === 'oauth2') {
    for (const key of ['tokenUrl', 'userInfoUrl'] as const) {
      const problem = next[key] ? await endpointProblem(next[key]) : null
      if (problem) f.fail_(key, problem)
    }
  }
  f.done()

  const secret = clearSecret ? null : clientSecret ? seal(clientSecret, SECRET_PURPOSE) : (existing?.clientSecretEncrypted ?? null)
  const values = {
    name: name ?? existing!.name,
    kind: effectiveKind,
    // Only the fields of the chosen kind are kept, so a switch leaves nothing stale behind.
    discoveryUrl: effectiveKind === 'oidc' ? next.discoveryUrl : null,
    authorizationUrl: effectiveKind === 'oauth2' ? next.authorizationUrl : null,
    tokenUrl: effectiveKind === 'oauth2' ? next.tokenUrl : null,
    userInfoUrl: effectiveKind === 'oauth2' ? next.userInfoUrl : null,
    clientId: clientId ?? existing!.clientId,
    clientSecretEncrypted: secret,
    scopes: scopes ?? existing?.scopes ?? DEFAULT_SCOPES[effectiveKind],
    enabled: enabled ?? existing?.enabled ?? false,
  }

  let rowId = id
  if (creating) {
    // A slug nobody uses yet: "google", then "google-2"...
    const base = slugFrom(values.name)
    const taken = new Set((await db.select({ slug: t.authProviders.slug }).from(t.authProviders)).map((row) => row.slug))
    let slug = base
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`
    const [row] = await db.insert(t.authProviders).values({ ...values, slug }).returning({ id: t.authProviders.id })
    rowId = row.id
  } else {
    await db.update(t.authProviders).set({ ...values, updatedAt: new Date() }).where(eq(t.authProviders.id, id))
  }

  const provider = (await listAuthProviders()).find((p) => p.id === rowId)!
  const fields: string[] = creating
    ? []
    : (Object.keys(values) as (keyof typeof values)[]).filter((key) => key !== 'clientSecretEncrypted' && values[key] !== existing![key])
  if (!creating && secret !== existing!.clientSecretEncrypted) fields.push('clientSecret')
  return { provider, fields }
}

/** Deletes a provider and everyone's connection to it. Returns its name and how many were connected. */
export async function deleteAuthProvider(id: number): Promise<{ name: string; slug: string; disconnected: number }> {
  const { t, withTransaction } = await getDatabase()
  return withTransaction(async (tx) => {
    const [row] = await tx.select().from(t.authProviders).where(eq(t.authProviders.id, id)).limit(1)
    if (!row) throw new UserError('That sign-in provider no longer exists.')
    const links = await tx.delete(t.accounts).where(eq(t.accounts.providerId, row.slug)).returning({ id: t.accounts.id })
    await tx.delete(t.authProviders).where(eq(t.authProviders.id, id))
    return { name: row.name, slug: row.slug, disconnected: links.length }
  })
}

// A provider whose discovery document could not be read (a timeout, an error page, a network blip)
// is left out, but unlike one refused for a private address or a redirect it may work a moment
// later. So while one is left out, the version below changes once each retry falls due, and auth.ts
// rebuilds Better Auth then: first after 30 seconds, then twice as long each time up to 10 minutes,
// so a document that stays unreadable is not fetched on a live request every 30 seconds forever.
const RETRY_FIRST_MS = 30_000
const RETRY_MAX_MS = 10 * 60_000
const retry: { at: number | null; delay: number; round: number } = { at: null, delay: RETRY_FIRST_MS, round: 0 }

/** Enabled providers the last providerConfigs on this server left out, by slug, with the reason. */
const skipped = ((globalThis as { __petAdoptSkippedProviders?: Map<string, string> }).__petAdoptSkippedProviders ??= new Map())

// A skipped provider is logged at most once an hour for the same reason (a rebuild can run often).
const SKIP_LOG_MS = 60 * 60_000
const skipLogged = new Map<string, number>()

function logSkip(slug: string, problem: string): void {
  const key = `${slug}\n${problem}`
  const last = skipLogged.get(key)
  if (last !== undefined && Date.now() - last < SKIP_LOG_MS) return
  skipLogged.set(key, Date.now())
  logError(new Error(problem), `sign-in provider "${slug}" skipped`)
}

/**
 * Changes whenever a provider is added, changed or removed (auth.ts rebuilds Better Auth then), and
 * when a retry of a provider left out for an unreadable discovery document falls due (see above).
 */
export async function providersVersion(): Promise<string> {
  const { db, t } = await getDatabase()
  const [row] = await db.select({ n: count(), latest: max(t.authProviders.updatedAt) }).from(t.authProviders)
  const latest = row?.latest ? new Date(row.latest).getTime() : 0
  // Claimed here, so the rebuild this starts (which reads the version too) sees the same round.
  if (retry.at !== null && Date.now() >= retry.at) {
    retry.round++
    retry.at = Date.now() + retry.delay
  }
  return `${row?.n ?? 0}:${latest}:${retry.round}`
}

/** The enabled providers as Better Auth genericOAuth configs. A secret that cannot be opened skips its provider. */
export async function providerConfigs() {
  const { db, t } = await getDatabase()
  const rows = await db.select().from(t.authProviders).where(eq(t.authProviders.enabled, true))
  const configs = []
  const left = new Map<string, string>()
  let unreadable = false
  for (const row of rows) {
    let clientSecret: string | undefined
    if (row.clientSecretEncrypted) {
      const opened = open(row.clientSecretEncrypted, SECRET_PURPOSE)
      if (opened === null) {
        const problem = 'its client secret cannot be opened (was BETTER_AUTH_SECRET changed?)'
        logSkip(row.slug, problem)
        left.set(row.slug, problem)
        continue
      }
      clientSecret = opened
    }
    // Checked again here, not only when saved: a host name can be pointed somewhere else later.
    const problem =
      row.kind === 'oauth2'
        ? ((row.tokenUrl ? await endpointProblem(row.tokenUrl) : null) ?? (row.userInfoUrl ? await endpointProblem(row.userInfoUrl) : null))
        : row.discoveryUrl
          ? await discoveryProblem(row.discoveryUrl, { strict: true })
          : null
    if (problem) {
      logSkip(row.slug, problem)
      left.set(row.slug, problem)
      // Only a document that could not be read is worth another try; a redirect or a private address is not.
      if (problem === DISCOVERY_UNREADABLE) unreadable = true
      continue
    }
    configs.push({
      providerId: row.slug,
      name: row.name,
      ...(row.kind === 'oauth2'
        ? { authorizationUrl: row.authorizationUrl ?? undefined, tokenUrl: row.tokenUrl ?? undefined, userInfoUrl: row.userInfoUrl ?? undefined }
        : { discoveryUrl: row.discoveryUrl ?? undefined }),
      clientId: row.clientId,
      clientSecret,
      scopes: row.scopes.split(' ').filter(Boolean),
      pkce: true,
      // Never an account from a provider; never a link by matching email (see the top of this file).
      disableSignUp: true,
      disableImplicitSignUp: true,
      overrideUserInfo: false,
    })
  }
  if (unreadable) {
    retry.delay = retry.at === null ? RETRY_FIRST_MS : Math.min(retry.delay * 2, RETRY_MAX_MS)
    retry.at = Date.now() + retry.delay
  } else {
    retry.at = null
    retry.delay = RETRY_FIRST_MS
  }
  skipped.clear()
  for (const [slug, problem] of left) skipped.set(slug, problem)
  return configs
}
