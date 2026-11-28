// Changing the email someone signs in with (agreed with the owner). The email matters for password
// sign-in, reset links and invites; whoever controls it can reset the password. Sign-in providers
// are linked by the provider's account id, not by email, so a change never affects them.
//
//  - Yourself (Account page): your current password, then a one-time link to the NEW address
//    (system email "Confirm new email", valid EMAIL_CHANGE_TTL_MS); the change happens when it is
//    confirmed on /admin/confirm-email (a button, so a mail scanner opening the link changes nothing).
//    The OLD address gets the "Email change notice" at once. A new request cancels the older one.
//    Only when the site can send email; otherwise an admin changes it.
//  - An admin (Users > Edit): at once; both addresses get the notice, a pending self-service change
//    is cancelled, and a pending invite is sent again to the new address (actions/users.ts).
//  - Confirming your email (agreed with the owner): every account must have confirmed its address
//    before it can change anything (requirePermission refuses `:edit` and `:export`), while the site
//    can send email. The same link and page carry the current address then ("Confirm your email");
//    accepting an invite or confirming a change also confirms. Accounts from before the rule stayed
//    confirmed. Without email on the site the rule is paused (nobody could confirm).
//  - Stored like reset links: only sha256(token), in `verifications` (identifier
//    `email-change:<hash>`, value = JSON { userId, email }).
import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type { EmailSender } from '@pet-adopt/plugin-sdk'
import type { SessionUser } from './types'
import { and, eq, gt, like, lt } from 'drizzle-orm'
import { cache } from 'react'

import { getDatabase } from '@/db/client'

import { getAuth, SITE_URL } from './auth'
import { getEmailSender } from './email'
import { renderPurposeEmail } from './email-templates'
import { cancelPendingLinks } from './pending-links'
import { asRecord, Fields, logError, UserError, ValidationError } from './result'
import { clearAttempts, consumeAttempt, guardPasswordChange } from './throttle'

export const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000
const PREFIX = 'email-change:'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** 32 random bytes in base64url. Anything else is not a token we made. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/
const EXPIRED = 'This link has expired or was already used. Ask for the change again on your Account page.'
/** Confirmation emails one person can have sent per hour (each goes to an address they typed). */
const REQUEST_RULE = { max: 5, windowMs: 60 * 60 * 1000 }

const identifierFor = (token: string) => PREFIX + createHash('sha256').update(token).digest('hex')
export const confirmEmailUrl = (token: string) => `${SITE_URL}/admin/confirm-email?token=${token}`

type Pending = { userId: string; email: string }
const parse = (value: string): Pending | null => {
  try {
    const parsed = JSON.parse(value) as Partial<Pending>
    return typeof parsed.userId === 'string' && typeof parsed.email === 'string' ? { userId: parsed.userId, email: parsed.email } : null
  } catch {
    return null
  }
}

/** Emails the "Email change notice" to each address. Best effort: never throws. */
export async function sendEmailChangeNotice(
  user: { name: string },
  change: { from: string; to: string },
  changedBy: string,
  to: string[],
  sender?: EmailSender | null,
): Promise<number> {
  const via = sender === undefined ? await getEmailSender() : sender
  if (!via) return 0
  let sent = 0
  try {
    const email = await renderPurposeEmail({ purpose: 'email-changed', values: { name: user.name, oldEmail: change.from, newEmail: change.to, changedBy } })
    for (const address of to) {
      try {
        await via.send({ to: address, subject: email.subject, text: email.text, html: email.html })
        sent++
      } catch (error) {
        logError(error, 'email change notice failed')
      }
    }
  } catch (error) {
    logError(error, 'email change notice failed')
  }
  return sent
}

/**
 * `{ email, password }` from the Account page: checks the password and the address, then emails a
 * confirmation link to the new address and a notice to the old one. `sender` is for the checks.
 */
export async function requestEmailChange(userId: string, raw: unknown, sender?: EmailSender | null): Promise<{ email: string; expiresAt: Date }> {
  const via = sender === undefined ? await getEmailSender() : sender
  if (!via) throw new UserError('This site cannot send email, so an admin has to change your email. Ask one on the Users screen.')
  const input = asRecord(raw)
  const f = new Fields(input, true)
  const email = f.requiredText('email', 200, { validate: (s) => EMAIL.test(s) || 'Enter a valid email address.' })
  const password = typeof input.password === 'string' ? input.password : ''
  if (!password) f.fail_('password', 'Enter your current password.')
  f.done()
  const address = (email as string).toLowerCase()

  const { db, t } = await getDatabase()
  const [user] = await db.select({ id: t.users.id, name: t.users.name, email: t.users.email }).from(t.users).where(eq(t.users.id, userId)).limit(1)
  if (!user) throw new UserError('You need to be signed in.')
  if (address === user.email) throw new ValidationError({ email: 'That is already your email.' })

  // The password check is a guessing oracle for a stolen session: limited like a password change.
  const { keys } = await guardPasswordChange(userId)
  const [credential] = await db
    .select({ hash: t.accounts.password })
    .from(t.accounts)
    .where(and(eq(t.accounts.userId, userId), eq(t.accounts.providerId, 'credential')))
    .limit(1)
  const ctx = await (await getAuth()).$context
  if (!credential?.hash || !(await ctx.password.verify({ hash: credential.hash, password }))) throw new ValidationError({ password: 'That is not your password.' })
  await clearAttempts(keys)

  const [taken] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, address)).limit(1)
  if (taken) throw new ValidationError({ email: 'Another account already uses this email.' })
  await consumeAttempt(`emailchange:${userId}`, REQUEST_RULE)

  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + EMAIL_CHANGE_TTL_MS)
  const { withTransaction } = await getDatabase()
  await withTransaction(async (tx) => {
    await tx.delete(t.verifications).where(and(like(t.verifications.identifier, `${PREFIX}%`), like(t.verifications.value, `{"userId":${JSON.stringify(userId)},%`)))
    await tx.insert(t.verifications).values({
      id: randomUUID(),
      identifier: identifierFor(token),
      value: JSON.stringify({ userId, email: address } satisfies Pending),
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
  })
  void purgeExpired().catch(() => undefined)

  const confirm = await renderPurposeEmail({
    purpose: 'email-change',
    values: { name: user.name, confirmLink: confirmEmailUrl(token), newEmail: address, hours: String(Math.round(EMAIL_CHANGE_TTL_MS / 3_600_000)) },
  })
  try {
    await via.send({ to: address, subject: confirm.subject, text: confirm.text, html: confirm.html })
  } catch (error) {
    logError(error, 'email change confirmation failed')
    await cancelEmailChange(userId)
    throw new UserError('The confirmation email could not be sent. Check the address, or try again later.')
  }
  await sendEmailChangeNotice(user, { from: user.email, to: address }, 'you', [user.email], via)
  return { email: address, expiresAt }
}

/** Whether the site can send email now, read once per request (the confirmation rule needs it). */
const canSendEmail = cache(async (): Promise<boolean> => (await getEmailSender()) !== null)

/**
 * True when this person must confirm their email before changing anything: their address is not
 * confirmed and the site can send the link. `sendable` is for the checks.
 */
export async function needsEmailConfirmation(user: Pick<SessionUser, 'emailVerified'>, sendable?: boolean): Promise<boolean> {
  // Only an explicit false waits: a user built without the field (older code paths) is not blocked.
  if (user.emailVerified !== false) return false
  return sendable ?? (await canSendEmail())
}

/** Emails a link to confirm the person's current address ("Confirm your email"). */
export async function requestEmailVerification(userId: string, sender?: EmailSender | null): Promise<{ email: string; expiresAt: Date }> {
  const via = sender === undefined ? await getEmailSender() : sender
  if (!via) throw new UserError('This site cannot send email yet, so there is nothing to confirm with.')
  const { db, t, withTransaction } = await getDatabase()
  const [user] = await db.select({ name: t.users.name, email: t.users.email, emailVerified: t.users.emailVerified }).from(t.users).where(eq(t.users.id, userId)).limit(1)
  if (!user) throw new UserError('You need to be signed in.')
  if (user.emailVerified) throw new UserError('Your email is already confirmed.')
  await consumeAttempt(`emailchange:${userId}`, REQUEST_RULE)

  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + EMAIL_CHANGE_TTL_MS)
  await withTransaction(async (tx) => {
    await tx.delete(t.verifications).where(and(like(t.verifications.identifier, `${PREFIX}%`), like(t.verifications.value, `{"userId":${JSON.stringify(userId)},%`)))
    await tx.insert(t.verifications).values({
      id: randomUUID(),
      identifier: identifierFor(token),
      value: JSON.stringify({ userId, email: user.email } satisfies Pending),
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
  })
  const message = await renderPurposeEmail({
    purpose: 'email-verify',
    values: { name: user.name, confirmLink: confirmEmailUrl(token), hours: String(Math.round(EMAIL_CHANGE_TTL_MS / 3_600_000)) },
  })
  try {
    await via.send({ to: user.email, subject: message.subject, text: message.text, html: message.html })
  } catch (error) {
    logError(error, 'email confirmation failed')
    await cancelEmailChange(userId)
    throw new UserError('The confirmation email could not be sent. Try again later, or ask an admin to check Email > Sending.')
  }
  return { email: user.email, expiresAt }
}

/** The pending change of this account, if any: the new address and when the link stops working. */
export async function pendingEmailChange(userId: string): Promise<{ email: string; expiresAt: Date } | null> {
  const { db, t } = await getDatabase()
  const rows = await db
    .select({ value: t.verifications.value, expiresAt: t.verifications.expiresAt })
    .from(t.verifications)
    .where(and(like(t.verifications.identifier, `${PREFIX}%`), gt(t.verifications.expiresAt, new Date())))
  for (const row of rows) {
    const pending = parse(row.value)
    if (pending?.userId === userId) return { email: pending.email, expiresAt: row.expiresAt }
  }
  return null
}

/** Cancels this account's pending change (its link stops working). */
export async function cancelEmailChange(userId: string): Promise<void> {
  const { db, t } = await getDatabase()
  await db.delete(t.verifications).where(and(like(t.verifications.identifier, `${PREFIX}%`), like(t.verifications.value, `{"userId":${JSON.stringify(userId)},%`)))
}

/** Whether a confirmation token still works, for the page: whose account and which address. */
export async function emailChangeFor(token: unknown): Promise<{ name: string; email: string; isChange: boolean } | null> {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null
  const { db, t } = await getDatabase()
  const [row] = await db
    .select({ value: t.verifications.value })
    .from(t.verifications)
    .where(and(eq(t.verifications.identifier, identifierFor(token)), gt(t.verifications.expiresAt, new Date())))
    .limit(1)
  const pending = row ? parse(row.value) : null
  if (!pending) return null
  const [user] = await db.select({ name: t.users.name, email: t.users.email, archivedAt: t.users.archivedAt }).from(t.users).where(eq(t.users.id, pending.userId)).limit(1)
  return user && !user.archivedAt ? { name: user.name, email: pending.email, isChange: pending.email !== user.email } : null
}

/** Confirms a change: the account signs in with the new address from now on. Works once. */
export async function confirmEmailChange(token: unknown): Promise<{ id: string; name: string; role: string | null; from: string; to: string }> {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new UserError(EXPIRED)
  const { t, withTransaction } = await getDatabase()
  try {
    return await withTransaction(
      async (tx) => {
        // Deleting the row is what claims the link: two requests with the same token cannot both get it.
        const [claimed] = await tx
          .delete(t.verifications)
          .where(and(eq(t.verifications.identifier, identifierFor(token)), gt(t.verifications.expiresAt, new Date())))
          .returning({ value: t.verifications.value })
        const pending = claimed ? parse(claimed.value) : null
        if (!pending) throw new UserError(EXPIRED)
        const [user] = await tx.select().from(t.users).where(eq(t.users.id, pending.userId)).limit(1)
        if (!user || user.archivedAt) throw new UserError(EXPIRED)
        // The link proves they read this address: it is confirmed, and becomes theirs if it is new.
        if (pending.email !== user.email) {
          const [taken] = await tx.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, pending.email)).limit(1)
          if (taken) throw new UserError('Another account started using that email in the meantime. Ask an admin.')
        }
        await tx.update(t.users).set({ email: pending.email, emailVerified: true, updatedAt: new Date() }).where(eq(t.users.id, user.id))
        // Reset links already sent to the old address must not outlive it (as with an admin's
        // change, users.ts): the old mailbox may be why the address is changing.
        if (pending.email !== user.email) await cancelPendingLinks(tx, t, user.id, ['password-reset'])
        return { id: user.id, name: user.name, role: user.role, from: user.email, to: pending.email }
      },
      { lock: 'users:admins' },
    )
  } catch (error) {
    const { isUniqueViolation } = await import('./result')
    if (isUniqueViolation(error)) throw new UserError('Another account started using that email in the meantime. Ask an admin.')
    throw error
  }
}

/** Now and then, remove confirmation links that can no longer be used. */
async function purgeExpired(): Promise<void> {
  if (Math.random() > 0.05) return
  const { db, t } = await getDatabase()
  await db.delete(t.verifications).where(and(like(t.verifications.identifier, `${PREFIX}%`), lt(t.verifications.expiresAt, new Date())))
}
