// Authentication with Better Auth, on this app's own Drizzle database.
//
//  - Only the owners sign in; there is no public sign-up. Accounts are created by an admin
//    (src/server/users.ts) or from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD on first start.
//  - Roles: `admin` (everything, including users and site settings) or `editor` (pets, pages, media).
//  - Sessions last 2 hours; five sign-in attempts per 10 minutes per client.
//  - Better Auth's own /admin/* HTTP endpoints are switched off (see the route handler), so every
//    role change goes through src/server/users.ts and its last-admin protection.
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { admin } from 'better-auth/plugins'

import { getDatabase, type Database } from '@/db/client'

import { CLIENT_IP_HEADER } from './throttle'

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

// Public URL of the site. Browsers may only send cookie-authenticated requests from here.
const siteURL = (process.env.NEXT_PUBLIC_SERVER_URL ?? '').trim().replace(/\/+$/, '')
if (enforce && !siteURL) {
  throw new Error('NEXT_PUBLIC_SERVER_URL must be set in production, for example https://adopt.example.com')
}

export const MIN_PASSWORD_LENGTH = production ? 12 : 8

function createAuth({ db, t, dialect }: Database) {
  const baseURL = siteURL || 'http://localhost:3000'
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
    plugins: [admin({ defaultRole: 'editor', adminRoles: ['admin'] }), nextCookies()],
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
