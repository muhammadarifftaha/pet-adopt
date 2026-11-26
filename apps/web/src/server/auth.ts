// Authentication with Better Auth, on this app's own Drizzle database.
//
//  - Only the owners sign in; there is no public sign-up. Accounts are created by an admin
//    (src/server/users.ts) or from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD on first start.
//  - Roles (admin, editor, developer, audit) are our own: a `role` column Better Auth only carries
//    (additionalFields below), and the permission table in the plugin SDK (`can`). No admin plugin.
//  - Archived accounts (src/server/users.ts) cannot sign in: the session hook below refuses them,
//    on every way in (password, two-factor code), and getSessionUser ignores them.
//  - Sessions last 2 hours; five sign-in attempts per 10 minutes per client.
//  - Two-factor sign-in (authenticator app plus backup codes) with Better Auth's twoFactor plugin,
//    driven by the server actions in src/server/actions/two-factor.ts; its HTTP endpoints stay closed
//    (see the route handler). Rules around it (who must use it, admin reset) are in two-factor.ts.
//  - Sign-in providers (OAuth 2 / OIDC, src/server/auth-providers.ts) through the genericOAuth
//    plugin, built from the enabled providers in the database and rebuilt when they change
//    (getAuth). A provider only signs in an account that connected it first; it never creates or
//    links one by email. Each session records how it signed in (`sign_in_method`).
//  - Every role change goes through src/server/users.ts and its last-admin protection; the route
//    handler opens only the endpoints this app uses.
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { APIError } from 'better-auth/api'
import { genericOAuth, twoFactor, type GenericOAuthConfig } from 'better-auth/plugins'

import { eq } from 'drizzle-orm'

import { getDatabase, type Database } from '@/db/client'

import { CLIENT_IP_HEADER } from './throttle'
import { generateBackupCodes } from './two-factor-codes'

const production = process.env.NODE_ENV === 'production'
// `next build` loads this too (often in CI with no secrets), so it is exempt from the checks.
const enforce = production && process.env.NEXT_PHASE !== 'phase-production-build'

// Only used when BETTER_AUTH_SECRET is empty during local development.
const DEV_SECRET = 'insecure-development-secret-do-not-deploy'

function resolveSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? ''
  if (enforce && (secret.length < 32 || secret === 'change-me')) {
    throw new Error('BETTER_AUTH_SECRET must be a random string of at least 32 characters. Generate one with: openssl rand -hex 32')
  }
  return secret || DEV_SECRET
}

/**
 * Throws, in production, when the signing secret is missing or weak. Called at server start
 * (src/instrumentation.ts) so a bad deploy fails loudly there instead of answering every sign-in
 * with an error. The site URL is checked when this module loads.
 */
export function assertAuthConfig() {
  resolveSecret()
}

/** The signing secret (the development fallback when unset outside production). Server-only. */
export function authSecret(): string {
  return resolveSecret()
}

// Public URL of the site. Browsers may only send cookie-authenticated requests from here.
const siteURL = (process.env.NEXT_PUBLIC_SERVER_URL ?? '').trim().replace(/\/+$/, '')
if (enforce && !siteURL) {
  throw new Error('NEXT_PUBLIC_SERVER_URL must be set in production, for example https://adopt.example.com')
}

/** How long "Trust this device" skips the code step on that browser. */
export const TRUST_DEVICE_DAYS = 30

export const MIN_PASSWORD_LENGTH = production ? 12 : 8

/** The site's own address, for links that leave the site (reset emails). Never taken from a request. */
export const SITE_URL = siteURL || 'http://localhost:3000'

/** Better Auth's error for a sign-in to an archived account (actions/auth.ts shows it). */
export const ACCOUNT_ARCHIVED = 'ACCOUNT_ARCHIVED'

/** How often a server checks whether the sign-in providers changed (another server may have saved). */
const PROVIDER_RECHECK_MS = 30_000

/** The provider of a session made by a provider's callback (`/callback/<id>`), else null. */
function providerOf(ctx: { path?: string; params?: Record<string, unknown> } | null | undefined): string | null {
  if (!ctx?.path?.startsWith('/callback/')) return null
  const id = ctx.params?.id
  return typeof id === 'string' ? id : null
}

function createAuth({ db, t, dialect }: Database, providers: GenericOAuthConfig[]) {
  const baseURL = SITE_URL
  return betterAuth({
    appName: 'Pet Adopt',
    baseURL,
    secret: resolveSecret(),
    trustedOrigins: production ? [baseURL] : [baseURL, 'http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000'],
    database: drizzleAdapter(db, { provider: dialect, schema: t, usePlural: true }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 2,
      updateAge: 60 * 10,
      // 'password' or 'provider:<id>': a provider sign-in counts as two-factor (two-factor.ts).
      additionalFields: { signInMethod: { type: 'string', required: false, input: false } },
    },
    account: {
      // Provider tokens are not used by the site; stored encrypted all the same.
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        // Linking happens only when a signed-in person connects a provider (Account page), never by
        // a matching email at sign-in. Their provider email may differ from their email here.
        disableImplicitLinking: true,
        allowDifferentEmails: true,
        // Explicit links need no email check from the provider: the person is signed in here.
        trustedProviders: providers.map((provider) => provider.providerId),
        updateUserInfoOnLink: false,
      },
    },
    // Errors from a provider's callback land on the sign-in page (?error=<code>).
    onAPIError: { errorURL: '/admin/login' },
    // Our own columns on users, so Better Auth reads them into the session user. `input: false`: no
    // Better Auth endpoint may set them; users.ts does.
    user: {
      additionalFields: {
        role: { type: 'string', required: false, input: false },
        archivedAt: { type: 'date', required: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Every new session, whatever the way in (password, two-factor code), checks the account
          // is not archived. Runs after the password was checked, so it tells nothing to a guesser.
          async before(session, ctx) {
            const [user] = await db.select({ archivedAt: t.users.archivedAt }).from(t.users).where(eq(t.users.id, session.userId)).limit(1)
            if (user?.archivedAt) throw new APIError('FORBIDDEN', { message: 'This account is archived.', code: ACCOUNT_ARCHIVED })
            const provider = providerOf(ctx)
            return { data: { ...session, signInMethod: provider ? `provider:${provider}` : 'password' } }
          },
          // A provider sign-in happens in the callback route, not a server action: log it here.
          async after(session, ctx) {
            const provider = providerOf(ctx)
            if (!provider) return
            const { recordProviderActivity } = await import('./activity')
            await recordProviderActivity(session.userId, 'auth.sign-in', provider, (name) => `Signed in with ${name}`)
          },
        },
      },
      account: {
        create: {
          // Connecting a provider (Account page) finishes in the callback route: log it here.
          async after(account) {
            if (account.providerId === 'credential') return
            const { recordProviderActivity } = await import('./activity')
            await recordProviderActivity(account.userId, 'account.provider-connect', account.providerId, (name) => `Connected ${name} for signing in`)
          },
        },
      },
    },
    advanced: {
      cookiePrefix: 'pet-adopt',
      useSecureCookies: production,
      // Better Auth's own address-based limiter must read the same header as our throttle.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER], ipv6Subnet: 64 },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      // Sign-in is limited by src/server/throttle.ts (per email and per client, atomic). Better Auth's
      // own rule keys on one address and would share a single bucket across every owner whenever it
      // cannot read the proxy header, locking everyone out after a few sign-ins.
      // Likewise "change password", which Better Auth would otherwise cap at 3 per 10 seconds per
      // address; it is limited per user by guardPasswordChange (route and action).
      customRules: { '/sign-in/email': false, '/change-password': false },
    },
    plugins: [
      // Sign-in providers; an empty list registers none (the plugin's endpoints then do nothing).
      genericOAuth({ config: providers }),
      twoFactor({
        // Shown in authenticator apps; each setup passes the site's name instead (actions/two-factor.ts).
        issuer: 'Pet Adopt',
        // The code step after the password: 10 minutes to enter it, and "Trust this device" lasts 30 days.
        twoFactorCookieMaxAge: 600,
        trustDeviceMaxAge: TRUST_DEVICE_DAYS * 24 * 60 * 60,
        // Ten one-time backup codes, stored encrypted (Better Auth's default, stated here on purpose).
        // Ours are lower case without look-alikes (BACKUP_CODE_ALPHABET), so they survive paper.
        backupCodeOptions: { storeBackupCodes: 'encrypted', customBackupCodesGenerate: () => generateBackupCodes() },
        // 10 wrong codes in a row lock the code step for 15 minutes, across sign-in attempts.
        accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 15 * 60 },
      }),
      // Last: it copies the cookies the other plugins set into Next's response.
      nextCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

type Holder = { promise?: Promise<Auth>; version?: string; checkedAt?: number }
const holder = ((globalThis as { __petAdoptAuth?: Holder }).__petAdoptAuth ??= {})

async function build(): Promise<Auth> {
  const database = await getDatabase()
  // Imported here: auth-providers.ts reads SITE_URL from this file.
  const { providerConfigs, providersVersion } = await import('./auth-providers')
  const [configs, version] = await Promise.all([providerConfigs(), providersVersion()])
  holder.version = version
  holder.checkedAt = Date.now()
  return createAuth(database, configs as GenericOAuthConfig[])
}

/**
 * Better Auth for this server. Rebuilt when the sign-in providers change: at once on the server
 * that saved them (forgetAuth), within PROVIDER_RECHECK_MS on the others.
 */
export async function getAuth(): Promise<Auth> {
  if (holder.promise && Date.now() - (holder.checkedAt ?? 0) > PROVIDER_RECHECK_MS) {
    holder.checkedAt = Date.now()
    try {
      const { providersVersion } = await import('./auth-providers')
      if ((await providersVersion()) !== holder.version) holder.promise = undefined
    } catch {
      // Keep the current instance; the next check tries again.
    }
  }
  holder.promise ??= build()
  holder.promise.catch(() => {
    holder.promise = undefined
  })
  return holder.promise
}

/** Drops this server's Better Auth so the next getAuth() is built from the current providers. */
export function forgetAuth(): void {
  holder.promise = undefined
}
