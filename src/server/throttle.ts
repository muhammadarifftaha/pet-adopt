// Sign-in throttling. Better Auth rate-limits requests that arrive through its HTTP handler by
// address, but it knows nothing about accounts, and server actions skip that layer entirely. So
// every sign-in path (the server action and the HTTP route) goes through `guardSignIn`.
//
// Attempts are counted BEFORE the password is checked, in one atomic upsert, so a burst of parallel
// guesses cannot all slip past a check-then-record gap. A success clears the account's counter.
// Counts live in Better Auth's own `rate_limits` table, so they are shared across instances.
// Keyed by the typed email (whether or not the account exists, so it cannot be used to probe for
// accounts) and by client address.
import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'

import { getDatabase } from '@/db/client'

import { UserError } from './result'

export type Throttle = { max: number; windowMs: number }

/** Five attempts per email, then a ten minute lockout (like the old Payload setup). */
export const ACCOUNT_RULE: Throttle = { max: 5, windowMs: 10 * 60 * 1000 }
/** A wider net per client, so one address cannot try many different accounts. */
export const CLIENT_RULE: Throttle = { max: 20, windowMs: 10 * 60 * 1000 }

/**
 * The header your reverse proxy sets to the real client address (default `x-forwarded-for`, or for
 * example `cf-connecting-ip` behind Cloudflare). Only run the site behind a proxy you control: a
 * client can send any header it likes when nothing in front overwrites it.
 */
export const CLIENT_IP_HEADER = (process.env.CLIENT_IP_HEADER || 'x-forwarded-for').trim().toLowerCase()

/**
 * Best guess at the client address. A proxy appends the address it saw to the END of
 * `x-forwarded-for`, so the last entry is the one a client cannot forge; the first entries are
 * whatever the client sent.
 */
export function clientAddress(headers: Headers): string {
  const value = headers.get(CLIENT_IP_HEADER)
  const last = value?.split(',').pop()?.trim()
  return last || 'unknown'
}

/**
 * Counts one attempt on `key` and throws a UserError once the limit is passed. The window restarts
 * from the last attempt, so hammering a locked key keeps it locked for the full time.
 */
export async function consumeAttempt(key: string, rule: Throttle): Promise<void> {
  const { db, t } = await getDatabase()
  const now = Date.now()
  const [row] = await db
    .insert(t.rateLimits)
    .values({ id: randomUUID(), key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: t.rateLimits.key,
      set: {
        // One statement: an expired window restarts at 1, otherwise the stored count goes up by 1.
        count: sql`CASE WHEN ${t.rateLimits.lastRequest} < ${now - rule.windowMs} THEN 1 ELSE ${t.rateLimits.count} + 1 END`,
        lastRequest: now,
      },
    })
    .returning({ count: t.rateLimits.count })
  if (row.count > rule.max) {
    const minutes = Math.max(Math.ceil(rule.windowMs / 60_000), 1)
    throw new UserError(`Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`)
  }
}

export async function clearAttempts(key: string): Promise<void> {
  const { db, t } = await getDatabase()
  await db.delete(t.rateLimits).where(eq(t.rateLimits.key, key))
}

/**
 * Call before checking a password. Throws a UserError when the email or the client is locked out;
 * otherwise returns the account key to pass to `clearAttempts` after a successful sign-in.
 */
export async function guardSignIn(email: string, headers: Headers): Promise<{ accountKey: string }> {
  const accountKey = `login:email:${email.trim().toLowerCase() || 'unknown'}`
  await consumeAttempt(accountKey, ACCOUNT_RULE)
  await consumeAttempt(`login:ip:${clientAddress(headers)}`, CLIENT_RULE)
  return { accountKey }
}
