// Sign-in throttling. Better Auth rate-limits requests that arrive through its HTTP handler, but
// server actions call its API directly and skip that layer, so failed sign-ins are counted here.
// Counts live in Better Auth's own `rate_limits` table, so they are shared across instances.
// Keyed by the typed email (whether or not the account exists, so it cannot be used to probe
// for accounts) and by client IP.
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { getDatabase } from '@/db/client'

import { UserError } from './result'

export type Throttle = { max: number; windowMs: number }

/** Five wrong passwords lock that email for ten minutes, like the old Payload setup. */
export const ACCOUNT_RULE: Throttle = { max: 5, windowMs: 10 * 60 * 1000 }
/** A wider net per client, so one address cannot try many different accounts. */
export const CLIENT_RULE: Throttle = { max: 20, windowMs: 10 * 60 * 1000 }

/** Throws a UserError while `key` is locked out. */
export async function assertNotThrottled(key: string, rule: Throttle): Promise<void> {
  const { db, t } = await getDatabase()
  const [row] = await db.select().from(t.rateLimits).where(eq(t.rateLimits.key, key)).limit(1)
  if (!row) return
  const elapsed = Date.now() - row.lastRequest
  if (row.count >= rule.max && elapsed < rule.windowMs) {
    const minutes = Math.max(Math.ceil((rule.windowMs - elapsed) / 60_000), 1)
    throw new UserError(`Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`)
  }
}

/** Counts one failed attempt. The window restarts from the last failure, so a lockout lasts the full time. */
export async function recordFailure(key: string, rule: Throttle): Promise<void> {
  const { db, t } = await getDatabase()
  const now = Date.now()
  const [row] = await db.select().from(t.rateLimits).where(eq(t.rateLimits.key, key)).limit(1)
  if (!row) {
    await db.insert(t.rateLimits).values({ id: randomUUID(), key, count: 1, lastRequest: now }).onConflictDoNothing()
    return
  }
  const count = now - row.lastRequest >= rule.windowMs ? 1 : row.count + 1
  await db.update(t.rateLimits).set({ count, lastRequest: now }).where(eq(t.rateLimits.key, key))
}

export async function clearFailures(key: string): Promise<void> {
  const { db, t } = await getDatabase()
  await db.delete(t.rateLimits).where(eq(t.rateLimits.key, key))
}

/** Best guess at the client address behind a proxy. Only used to slow guessing down. */
export function clientAddress(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown'
}
