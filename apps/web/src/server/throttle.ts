// Sign-in and password-change throttling.
//
// Better Auth rate-limits requests that arrive through its HTTP handler by address, but it knows
// nothing about accounts, and server actions skip that layer entirely. So every sign-in path (the
// server action and the HTTP route) goes through `guardSignIn`.
//
// How a sign-in attempt is limited (all counted BEFORE the password is checked, in one atomic
// upsert each, so a burst of parallel guesses cannot slip past a check-then-record gap):
//   1. per client address            30 per 10 minutes   (stops one machine trying many accounts)
//   2. per email + client address     5 per 10 minutes   (the everyday lockout for fumbled passwords)
//   3. per email, from anywhere     100 per hour         (caps guessing spread over many addresses)
// The pair key is what makes a lockout hard to abuse: someone typing an owner's email from their own
// machine locks only themselves out, not the owner. The per-email ceiling is high enough that this
// stays impractical without making a distributed attack free; `pnpm admin:reset-password` exists
// for the rare case where an owner is locked out anyway.
//
// A lockout does not extend while it is active: it ends `windowMs` after the attempt that reached
// the limit. Emails are hashed before they become keys, so the table never holds an attacker-sized
// string and no address list is stored in clear. A success clears that email's counters.
// Counts live in Better Auth's own `rate_limits` table, so they are shared across instances.
import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'

import { and, lt, like, or, sql } from 'drizzle-orm'
import { eq } from 'drizzle-orm'

import { getDatabase } from '@/db/client'

import { UserError } from './result'

export type Throttle = { max: number; windowMs: number }

export const PAIR_RULE: Throttle = { max: 5, windowMs: 10 * 60 * 1000 }
export const EMAIL_RULE: Throttle = { max: 100, windowMs: 60 * 60 * 1000 }
export const CLIENT_RULE: Throttle = { max: 30, windowMs: 10 * 60 * 1000 }
/** Guessing the current password through "change password" with a stolen session. */
export const PASSWORD_CHANGE_RULE: Throttle = { max: 5, windowMs: 10 * 60 * 1000 }
/** "Email me a reset link": per client, and per email overall so nobody can flood an inbox. */
export const RESET_CLIENT_RULE: Throttle = { max: 10, windowMs: 15 * 60 * 1000 }
export const RESET_EMAIL_RULE: Throttle = { max: 3, windowMs: 60 * 60 * 1000 }

/**
 * The header your reverse proxy sets to the real client address (default `x-forwarded-for`, or for
 * example `cf-connecting-ip` behind Cloudflare). Only run the site behind a proxy you control: a
 * client can send any header it likes when nothing in front overwrites it.
 */
export const CLIENT_IP_HEADER = (process.env.CLIENT_IP_HEADER || 'x-forwarded-for').trim().toLowerCase()

/**
 * How many proxies between the internet and this app each append to the header. With one proxy
 * (the usual case) the client address is the last entry; with a CDN in front of a proxy it is the
 * second to last, and so on. Entries to the left of that are whatever the client sent.
 */
export const TRUSTED_PROXY_HOPS = Math.max(Math.floor(Number(process.env.TRUSTED_PROXY_HOPS)) || 1, 1)

/**
 * Whoever holds an IPv6 network usually holds a whole /64 (about 18 quintillion addresses) and can
 * hop between them freely, so one address is the wrong unit to limit. IPv6 clients are counted by
 * their /64 prefix instead. IPv4 addresses, and IPv4 written as IPv6 (`::ffff:1.2.3.4`), are
 * counted individually.
 */
export function ipv6Prefix64(address: string): string {
  const withoutZone = address.split('%')[0]
  const mapped = withoutZone.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mapped) return mapped[1]
  const [head, tail] = withoutZone.split('::')
  const front = head ? head.split(':') : []
  const back = tail ? tail.split(':') : []
  // "::" stands for as many zero groups as it takes to make eight.
  const groups = withoutZone.includes('::') ? [...front, ...Array(Math.max(8 - front.length - back.length, 0)).fill('0'), ...back] : front
  return `${groups
    .slice(0, 4)
    .map((group) => group.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')}::/64`
}

/** The client address, or null when it cannot be determined (no header, or not an IP address). */
export function clientAddress(headers: Headers): string | null {
  const value = headers.get(CLIENT_IP_HEADER)
  if (!value) return null
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const candidate = entries[Math.max(entries.length - TRUSTED_PROXY_HOPS, 0)]
  const version = candidate ? isIP(candidate) : 0
  if (version === 4) return candidate
  if (version === 6) return ipv6Prefix64(candidate)
  return null
}

let warnedAboutMissingAddress = false

/**
 * Counts one attempt on `key` and throws a UserError once the limit is passed. The window restarts
 * once it has fully elapsed. While a key is over the limit its timestamp is left alone, so
 * hammering a locked key cannot keep it locked beyond `windowMs` after the limit was reached.
 */
export async function consumeAttempt(key: string, rule: Throttle): Promise<void> {
  const { db, t } = await getDatabase()
  const now = Date.now()
  const cutoff = now - rule.windowMs
  const [row] = await db
    .insert(t.rateLimits)
    .values({ id: randomUUID(), key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: t.rateLimits.key,
      set: {
        // One statement, so concurrent attempts cannot interleave. Every expression reads the OLD
        // row: an expired window restarts at 1; otherwise the count goes up by 1, and the
        // timestamp only moves while the key is still under the limit.
        count: sql`CASE WHEN ${t.rateLimits.lastRequest} < ${cutoff} THEN 1 ELSE ${t.rateLimits.count} + 1 END`,
        lastRequest: sql`CASE WHEN ${t.rateLimits.lastRequest} < ${cutoff} THEN ${now} WHEN ${t.rateLimits.count} >= ${rule.max} THEN ${t.rateLimits.lastRequest} ELSE ${now} END`,
      },
    })
    .returning({ count: t.rateLimits.count, lastRequest: t.rateLimits.lastRequest })

  if (row.count > rule.max) {
    const minutes = Math.max(Math.ceil((row.lastRequest + rule.windowMs - now) / 60_000), 1)
    throw new UserError(`Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`)
  }
  void purgeExpired().catch(() => undefined)
}

/** Now and then, remove counters nobody will read again, so the table cannot grow without bound. */
async function purgeExpired(): Promise<void> {
  if (Math.random() > 0.02) return
  const { db, t } = await getDatabase()
  // Our keys only. Better Auth's own rows ("<ip>|<path>") are not ours to delete.
  await db
    .delete(t.rateLimits)
    .where(
      and(
        or(like(t.rateLimits.key, 'login:%'), like(t.rateLimits.key, 'chpw:%'), like(t.rateLimits.key, 'pwreset:%')),
        lt(t.rateLimits.lastRequest, Date.now() - 2 * 60 * 60 * 1000),
      ),
    )
}

export async function clearAttempts(keys: string | string[]): Promise<void> {
  const { db, t } = await getDatabase()
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    await db.delete(t.rateLimits).where(eq(t.rateLimits.key, key))
  }
}

/** Lifts every lockout on an email, for every client. Used by `pnpm admin:reset-password`. */
export async function clearLockoutsFor(email: string): Promise<void> {
  const { db, t } = await getDatabase()
  const digest = emailDigest(email)
  await db
    .delete(t.rateLimits)
    .where(or(eq(t.rateLimits.key, `login:email:${digest}`), like(t.rateLimits.key, `login:pair:${digest}|%`)))
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

/** Lower-cased and bounded, so any input becomes one short fixed-size key. */
function emailDigest(email: unknown): string {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : ''
  return sha256(normalized && normalized.length <= 254 ? normalized : 'invalid')
}

/**
 * Call before checking a password. Throws a UserError when the client, or the email from this
 * client, or the email overall, is locked out. Returns the keys to pass to `clearAttempts` after a
 * successful sign-in.
 */
export async function guardSignIn(email: unknown, headers: Headers): Promise<{ keys: string[] }> {
  const digest = emailDigest(email)
  const address = clientAddress(headers)
  if (address) {
    // First, so junk requests are stopped by the client limit before they can add more rows.
    await consumeAttempt(`login:ip:${address}`, CLIENT_RULE)
  } else if (process.env.NODE_ENV === 'production' && !warnedAboutMissingAddress) {
    warnedAboutMissingAddress = true
    console.warn(
      `Sign-in throttling cannot tell clients apart: no valid address in the "${CLIENT_IP_HEADER}" header. ` +
        'Run the site behind a reverse proxy and set CLIENT_IP_HEADER / TRUSTED_PROXY_HOPS to match it.',
    )
  }
  const pairKey = `login:pair:${digest}|${address ?? 'none'}`
  const emailKey = `login:email:${digest}`
  await consumeAttempt(pairKey, PAIR_RULE)
  await consumeAttempt(emailKey, EMAIL_RULE)
  return { keys: [pairKey, emailKey] }
}

/** Call before checking the current password in "change password". Returns the key to clear on success. */
export async function guardPasswordChange(userId: string): Promise<{ keys: string[] }> {
  const key = `chpw:${userId}`
  await consumeAttempt(key, PASSWORD_CHANGE_RULE)
  return { keys: [key] }
}

/**
 * Call before sending a reset email. Throws a UserError when this client, or this email from anyone,
 * asked too often. Counted whether or not the account exists, so the limit says nothing about that.
 */
export async function guardResetRequest(email: unknown, headers: Headers): Promise<void> {
  const address = clientAddress(headers)
  if (address) await consumeAttempt(`pwreset:ip:${address}`, RESET_CLIENT_RULE)
  await consumeAttempt(`pwreset:email:${emailDigest(email)}`, RESET_EMAIL_RULE)
}
