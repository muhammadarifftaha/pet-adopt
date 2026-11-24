// One-time password reset links, for someone who cannot sign in.
//
//  - An admin makes a link for a person (Users screen) and shares it however they like, or, when an
//    email plugin is registered, the person asks for one on /admin/reset-password and it is emailed.
//  - A link is `<site>/admin/reset-password?token=<43 random characters>`, valid for RESET_TTL_MS
//    and usable once. Making a new link for someone cancels their older ones.
//  - Only the SHA-256 of the token is stored (in Better Auth's `verifications` table, identifier
//    `pwreset:<hash>`, value = user id), so a copy of the database holds no working links.
//  - Using a link sets the password and ends every session of that person in one transaction, and
//    lifts their sign-in lockouts.
//  - Asking for an email answers the same way whether or not the account exists, and does the
//    lookup and the sending after the response (see the action), so timing does not tell either.
import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { and, eq, gt, like, lt } from 'drizzle-orm'

import type { EmailSender } from '@/plugins/define'

import { getDatabase } from '@/db/client'

import { getAuth, SITE_URL } from './auth'
import { asRecord, Fields, logError, UserError } from './result'
import { getSettings } from './settings'
import { clearLockoutsFor, guardResetRequest } from './throttle'
import { newPassword, writeCredential } from './users'

export const RESET_TTL_MS = 60 * 60 * 1000
const PREFIX = 'pwreset:'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** 32 random bytes in base64url. Anything else is not a token we made. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/

const identifierFor = (token: string) => PREFIX + createHash('sha256').update(token).digest('hex')

export const resetUrl = (token: string) => `${SITE_URL}/admin/reset-password?token=${token}`

/** Makes a reset link for one person and cancels their earlier ones. */
export async function createResetLink(userId: string): Promise<{ url: string; expiresAt: Date }> {
  const { t, withTransaction } = await getDatabase()
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + RESET_TTL_MS)
  await withTransaction(async (tx) => {
    const [user] = await tx.select({ id: t.users.id, banned: t.users.banned }).from(t.users).where(eq(t.users.id, userId)).limit(1)
    if (!user) throw new UserError('User not found.')
    if (user.banned) throw new UserError('This account is blocked, so it cannot get a reset link.')
    await tx
      .delete(t.verifications)
      .where(and(like(t.verifications.identifier, `${PREFIX}%`), eq(t.verifications.value, userId)))
    await tx
      .insert(t.verifications)
      .values({ id: randomUUID(), identifier: identifierFor(token), value: userId, expiresAt, createdAt: now, updatedAt: now })
  })
  void purgeExpired().catch(() => undefined)
  return { url: resetUrl(token), expiresAt }
}

/** Whether a token from a link is still usable, so the page can say so before asking for a password. */
export async function isResetTokenValid(token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || !TOKEN.test(token)) return false
  const { db, t } = await getDatabase()
  const [row] = await db
    .select({ id: t.verifications.id })
    .from(t.verifications)
    .where(and(eq(t.verifications.identifier, identifierFor(token)), gt(t.verifications.expiresAt, new Date())))
    .limit(1)
  return Boolean(row)
}

const EXPIRED = 'This reset link has expired or was already used. Ask for a new one.'

/** `{ token, password }`. Sets the new password, ends every session, and uses up the link. */
export async function resetPasswordWithToken(raw: unknown): Promise<void> {
  const input = asRecord(raw)
  const token = typeof input.token === 'string' ? input.token : ''
  if (!TOKEN.test(token)) throw new UserError(EXPIRED)
  const f = new Fields(input)
  const pass = newPassword(f, 'password', input)
  f.done()

  // Hashing is slow on purpose, so it happens before the transaction (SQLite has one connection).
  const ctx = await (await getAuth()).$context
  const hash = await ctx.password.hash(pass as string)
  const { t, withTransaction } = await getDatabase()
  const email = await withTransaction(async (tx) => {
    // Deleting the row is what claims the link: two requests with the same token cannot both get it.
    const [claimed] = await tx
      .delete(t.verifications)
      .where(and(eq(t.verifications.identifier, identifierFor(token)), gt(t.verifications.expiresAt, new Date())))
      .returning({ userId: t.verifications.value })
    if (!claimed) throw new UserError(EXPIRED)
    const [user] = await tx
      .select({ id: t.users.id, email: t.users.email, banned: t.users.banned })
      .from(t.users)
      .where(eq(t.users.id, claimed.userId))
      .limit(1)
    if (!user || user.banned) throw new UserError(EXPIRED)
    await writeCredential(tx, t, user.id, hash)
    await tx.delete(t.sessions).where(eq(t.sessions.userId, user.id))
    return user.email
  })
  // They proved who they are, so earlier wrong guesses should not keep them out.
  await clearLockoutsFor(email).catch((error) => logError(error, 'could not clear sign-in lockouts after a reset'))
}

/**
 * "Email me a reset link". Checks the address and the request limits now (they throw), and returns
 * the rest as a job to run after the response: find the account and send the email. The job never
 * throws; a failure is logged, because the person must get the same answer either way.
 */
export async function prepareResetEmail(
  rawEmail: unknown,
  headers: Headers,
  sender: EmailSender,
): Promise<() => Promise<void>> {
  const f = new Fields({ email: rawEmail }, true)
  const email = f.requiredText('email', 200, { validate: (s) => EMAIL.test(s) || 'Enter a valid email address.' })
  f.done()
  const address = (email as string).toLowerCase()
  await guardResetRequest(address, headers)

  return async () => {
    try {
      const { db, t } = await getDatabase()
      const [user] = await db
        .select({ id: t.users.id, name: t.users.name, banned: t.users.banned })
        .from(t.users)
        .where(eq(t.users.email, address))
        .limit(1)
      if (!user || user.banned) return
      const { url } = await createResetLink(user.id)
      const { siteName } = await getSettings()
      await sender.send(resetEmail({ to: address, name: user.name, siteName, url }))
    } catch (error) {
      logError(error, 'password reset email failed')
    }
  }
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

export function resetEmail(input: { to: string; name: string; siteName: string; url: string }) {
  const minutes = Math.round(RESET_TTL_MS / 60_000)
  const site = input.siteName || 'Pet Adopt'
  const text = [
    `Hello ${input.name},`,
    '',
    `Someone asked to reset the password of your ${site} account. To choose a new one, open this link within ${minutes} minutes:`,
    '',
    input.url,
    '',
    'The link works once. If you did not ask for this, ignore this email: your password stays the same.',
  ].join('\n')
  const html = `<p>Hello ${escapeHtml(input.name)},</p>
<p>Someone asked to reset the password of your ${escapeHtml(site)} account. To choose a new one, open this link within ${minutes} minutes:</p>
<p><a href="${escapeHtml(input.url)}">Choose a new password</a></p>
<p>The link works once. If you did not ask for this, ignore this email: your password stays the same.</p>`
  return { to: input.to, subject: `Reset your ${site} password`, text, html }
}

/** Now and then, remove links that can no longer be used. */
async function purgeExpired(): Promise<void> {
  if (Math.random() > 0.05) return
  const { db, t } = await getDatabase()
  await db
    .delete(t.verifications)
    .where(and(like(t.verifications.identifier, `${PREFIX}%`), lt(t.verifications.expiresAt, new Date())))
}
