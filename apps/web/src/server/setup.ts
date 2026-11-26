// First-time setup (agreed with the owner). A new site has no accounts; the first one is made on the
// setup page (/setup), then a guided setup offers the site's basics, a theme, sample content and
// email, each skippable, until it is finished or skipped (`site_settings.setup_done_at`).
//
// Claiming a new site: whoever reaches a fresh deployment first must not become its admin. So the
// setup page only works with a link printed in the server's log: `<site>/setup?key=<32 random
// bytes>`. The key is made once and kept sealed in `site_settings.setup_key_encrypted` (secret-box),
// so every server instance prints the same link; it is deleted when the first account exists.
//
// Unattended installs can still set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (users.ensureOwner): the
// account step is then done already and the guided setup starts at the site's basics.
import { randomBytes, timingSafeEqual } from 'node:crypto'

import { and, count, eq, isNull } from 'drizzle-orm'

import { getDatabase } from '@/db/client'

import { SITE_URL } from './auth'
import { UserError } from './result'
import { open, seal } from './secret-box'
import { createUser } from './users'

const SETTINGS_ID = 1
const KEY_PURPOSE = 'setup-key'
/** 32 random bytes in base64url. */
const KEY = /^[A-Za-z0-9_-]{43}$/

export const setupUrl = (key: string) => `${SITE_URL}/setup?key=${key}`

/** Whether any account exists (then the setup link is gone for good). */
export async function hasAccounts(): Promise<boolean> {
  const { db, t } = await getDatabase()
  const [row] = await db.select({ n: count() }).from(t.users)
  return row.n > 0
}

/** Whether the guided setup was finished or skipped. */
export async function isSetupDone(): Promise<boolean> {
  const { db, t } = await getDatabase()
  const [row] = await db.select({ done: t.siteSettings.setupDoneAt }).from(t.siteSettings).where(eq(t.siteSettings.id, SETTINGS_ID)).limit(1)
  return Boolean(row?.done)
}

/**
 * The setup link while no account exists (null once one does). Made once and stored sealed, so
 * every instance of the site prints the same link; the first one to start makes it.
 */
export async function ensureSetupLink(): Promise<string | null> {
  if (await hasAccounts()) return null
  const { db, t } = await getDatabase()
  await db.insert(t.siteSettings).values({ id: SETTINGS_ID }).onConflictDoNothing()
  // Only fills an empty slot: two instances starting together keep whichever key was written first.
  await db
    .update(t.siteSettings)
    .set({ setupKeyEncrypted: seal(randomBytes(32).toString('base64url'), KEY_PURPOSE) })
    .where(and(eq(t.siteSettings.id, SETTINGS_ID), isNull(t.siteSettings.setupKeyEncrypted)))
  const key = await storedKey()
  if (key) return setupUrl(key)
  // Sealed with another BETTER_AUTH_SECRET: make a new one.
  await db.update(t.siteSettings).set({ setupKeyEncrypted: null }).where(eq(t.siteSettings.id, SETTINGS_ID))
  return ensureSetupLink()
}

async function storedKey(): Promise<string | null> {
  const { db, t } = await getDatabase()
  const [row] = await db.select({ sealed: t.siteSettings.setupKeyEncrypted }).from(t.siteSettings).where(eq(t.siteSettings.id, SETTINGS_ID)).limit(1)
  return open(row?.sealed, KEY_PURPOSE)
}

/** Whether `key` is the setup link's key, while no account exists. Compared in constant time. */
export async function isSetupKeyValid(key: unknown): Promise<boolean> {
  if (typeof key !== 'string' || !KEY.test(key) || (await hasAccounts())) return false
  const stored = await storedKey()
  return Boolean(stored) && timingSafeEqual(Buffer.from(stored as string), Buffer.from(key))
}

/** Prints the setup link to the server log in a box people notice. */
export function announceSetupLink(link: string): void {
  const lines = ['This site has no accounts yet. Open this link to create the first admin account:', link, 'Only someone who can read this log has it. It stops working once the account exists.']
  const width = Math.max(...lines.map((line) => line.length))
  const rule = `+${'-'.repeat(width + 2)}+`
  console.log(['', rule, ...lines.map((line) => `| ${line.padEnd(width)} |`), rule, ''].join('\n'))
}

/**
 * Creates the first account, an admin, with the setup link's key: `{ name, email, password }`.
 * Refused once any account exists; two people at once cannot both succeed (one lock, then the
 * count). The key is deleted with it.
 */
export async function createFirstAdmin(key: unknown, input: unknown): Promise<{ id: string }> {
  if (!(await isSetupKeyValid(key))) throw new UserError('This setup link no longer works. If the site is already set up, sign in instead.')
  const { t, withTransaction } = await getDatabase()
  return withTransaction(
    async (tx) => {
      const [row] = await tx.select({ n: count() }).from(t.users)
      if (row.n > 0) throw new UserError('This site already has an account. Sign in instead.')
      const created = await createUser({ ...(input as object), role: 'admin' })
      await tx.update(t.siteSettings).set({ setupKeyEncrypted: null, updatedAt: new Date() }).where(eq(t.siteSettings.id, SETTINGS_ID))
      return created
    },
    { lock: 'setup:first-account' },
  )
}

/** Ends the guided setup (finished or skipped); it is not shown again. */
export async function finishSetup(): Promise<void> {
  const { db, t } = await getDatabase()
  await db.insert(t.siteSettings).values({ id: SETTINGS_ID }).onConflictDoNothing()
  await db.update(t.siteSettings).set({ setupDoneAt: new Date(), updatedAt: new Date() }).where(eq(t.siteSettings.id, SETTINGS_ID))
}
