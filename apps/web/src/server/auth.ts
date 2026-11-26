// Authentication with Better Auth, on this app's own Drizzle database.
//
//  - Only the owners sign in; there is no public sign-up. Accounts are created by an admin
//    (src/server/users.ts) or from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD on first start.
//  - Roles: `admin` (everything, including users and site settings) or `editor` (pets, pages, media).
//  - Sessions last 2 hours; five sign-in attempts per 10 minutes per client.
//  - Two-factor sign-in (authenticator app plus backup codes) with Better Auth's twoFactor plugin,
//    driven by the server actions in src/server/actions/two-factor.ts; its HTTP endpoints stay closed
//    (see the route handler). Rules around it (who must use it, admin reset) are in two-factor.ts.
//  - Better Auth's own /admin/* HTTP endpoints are switched off (see the route handler), so every
//    role change goes through src/server/users.ts and its last-admin protection.
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { admin, twoFactor } from 'better-auth/plugins'

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

function createAuth({ db, t, dialect }: Database) {
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
    session: { expiresIn: 60 * 60 * 2, updateAge: 60 * 10 },
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
      admin({ defaultRole: 'editor', adminRoles: ['admin'] }),
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

type Holder = { promise?: Promise<Auth> }
const holder = ((globalThis as { __petAdoptAuth?: Holder }).__petAdoptAuth ??= {})

export function getAuth(): Promise<Auth> {
  holder.promise ??= getDatabase().then(createAuth)
  holder.promise.catch(() => {
    holder.promise = undefined
  })
  return holder.promise
}
