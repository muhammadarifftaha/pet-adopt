// Email invites (agreed with the owner): when an admin adds someone with "Email an invite" (the
// default), the account is made without a password and the person gets a one-time link to choose
// their own. Setting a password for them is still possible instead.
//
//  - A link is `<site>/admin/invite?token=<43 random characters>`, valid INVITE_TTL_MS (7 days) and
//    usable once; a new invite (Resend) cancels the older one. Only the SHA-256 of the token is
//    stored (`verifications`, identifier `invite:<hash>`, value = user id), like reset links.
//  - The email is the system email "Invitation" (Email > Templates). When the site cannot send email,
//    or sending fails, the account is still made and the admin gets the link to copy (agreed).
//  - Accepting sets the password; it does not sign the person in (they sign in next, which also
//    runs the two-factor rules). An account whose password was set another way (an admin's "New
//    password") has its invites cancelled, and archiving cancels them too (users.ts).
import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { ROLE_INFO, asRole, type EmailSender, type Role } from '@pet-adopt/plugin-sdk'
import { and, eq, gt, like, lt } from 'drizzle-orm'

import { getDatabase } from '@/db/client'

import { getAuth, SITE_URL } from './auth'
import { getEmailSender } from './email'
import { renderPurposeEmail } from './email-templates'
import { asRecord, Fields, logError, UserError } from './result'
import { newPassword, writeCredential } from './users'

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const INVITE_PREFIX = 'invite:'
/** 32 random bytes in base64url. Anything else is not a token we made. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/
const EXPIRED = 'This invite link has expired or was already used. Ask the admin who invited you for a new one.'

const identifierFor = (token: string) => INVITE_PREFIX + createHash('sha256').update(token).digest('hex')

export const inviteUrl = (token: string) => `${SITE_URL}/admin/invite?token=${token}`

/** What the admin sees after inviting: whether the email went out, and the link either way. */
export type InviteResult = { sent: boolean; url: string; expiresAt: Date; problem?: string }

/** Makes an invite link for an account without a password, cancelling its earlier ones. */
export async function createInvite(userId: string): Promise<{ url: string; expiresAt: Date; user: { id: string; name: string; email: string; role: Role } }> {
  const { t, withTransaction } = await getDatabase()
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS)
  const user = await withTransaction(async (tx) => {
    const [user] = await tx
      .select({ id: t.users.id, name: t.users.name, email: t.users.email, role: t.users.role, archivedAt: t.users.archivedAt })
      .from(t.users)
      .where(eq(t.users.id, userId))
      .limit(1)
    if (!user) throw new UserError('User not found.')
    if (user.archivedAt) throw new UserError('This account is archived. Restore it first.')
    const [credential] = await tx
      .select({ id: t.accounts.id })
      .from(t.accounts)
      .where(and(eq(t.accounts.userId, userId), eq(t.accounts.providerId, 'credential')))
      .limit(1)
    if (credential) throw new UserError('They already have a password. Use Reset link instead.')
    await tx.delete(t.verifications).where(and(like(t.verifications.identifier, `${INVITE_PREFIX}%`), eq(t.verifications.value, userId)))
    await tx.insert(t.verifications).values({ id: randomUUID(), identifier: identifierFor(token), value: userId, expiresAt, createdAt: now, updatedAt: now })
    return { id: user.id, name: user.name, email: user.email, role: asRole(user.role) }
  })
  void purgeExpired().catch(() => undefined)
  return { url: inviteUrl(token), expiresAt, user }
}

/**
 * Makes an invite and emails it. Never throws for a sending problem: `sent` is false and `problem`
 * says why, and the admin gets the link to copy. `sender` is for the checks; normally the site's.
 */
export async function sendInvite(userId: string, inviterName: string, sender?: EmailSender | null): Promise<InviteResult> {
  const { url, expiresAt, user } = await createInvite(userId)
  const via = sender === undefined ? await getEmailSender() : sender
  if (!via) return { sent: false, url, expiresAt, problem: 'This site cannot send email yet (Settings > Email).' }
  try {
    const email = await renderPurposeEmail({
      purpose: 'invite',
      values: { name: user.name, inviteLink: url, inviterName, role: ROLE_INFO[user.role].label, days: String(Math.round(INVITE_TTL_MS / 86_400_000)) },
    })
    await via.send({ to: user.email, subject: email.subject, text: email.text, html: email.html })
    return { sent: true, url, expiresAt }
  } catch (error) {
    logError(error, 'invite email failed')
    return { sent: false, url, expiresAt, problem: 'The email could not be sent.' }
  }
}

/** Whether an invite token is still usable, so the page can say so before asking for a password. */
export async function isInviteTokenValid(token: unknown): Promise<{ name: string } | null> {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null
  const { db, t } = await getDatabase()
  const [row] = await db
    .select({ name: t.users.name, archivedAt: t.users.archivedAt })
    .from(t.verifications)
    .innerJoin(t.users, eq(t.users.id, t.verifications.value))
    .where(and(eq(t.verifications.identifier, identifierFor(token)), gt(t.verifications.expiresAt, new Date())))
    .limit(1)
  return row && !row.archivedAt ? { name: row.name } : null
}

/** `{ token, password }`: sets the invited person's password and uses up the link. */
export async function acceptInvite(raw: unknown): Promise<{ id: string; name: string; role: Role }> {
  const input = asRecord(raw)
  const token = typeof input.token === 'string' ? input.token : ''
  if (!TOKEN.test(token)) throw new UserError(EXPIRED)
  const f = new Fields(input)
  const pass = newPassword(f, 'password', input)
  f.done()
  // A made-up or used link stops here, before the slow hash (signed out, anyone can call this).
  // The transaction below still claims the link; this only reads.
  if (!(await isInviteTokenValid(token))) throw new UserError(EXPIRED)

  // Hashing is slow on purpose, so it happens before the transaction (SQLite has one connection).
  const hash = await (await getAuth()).$context.then((ctx) => ctx.password.hash(pass as string))
  const { t, withTransaction } = await getDatabase()
  return withTransaction(async (tx) => {
    // Deleting the row is what claims the link: two requests with the same token cannot both get it.
    const [claimed] = await tx
      .delete(t.verifications)
      .where(and(eq(t.verifications.identifier, identifierFor(token)), gt(t.verifications.expiresAt, new Date())))
      .returning({ userId: t.verifications.value })
    if (!claimed) throw new UserError(EXPIRED)
    const [user] = await tx
      .select({ id: t.users.id, name: t.users.name, role: t.users.role, archivedAt: t.users.archivedAt })
      .from(t.users)
      .where(eq(t.users.id, claimed.userId))
      .limit(1)
    if (!user || user.archivedAt) throw new UserError(EXPIRED)
    await writeCredential(tx, t, user.id, hash)
    // The invite reached them: that confirms the address.
    await tx.update(t.users).set({ emailVerified: true, updatedAt: new Date() }).where(eq(t.users.id, user.id))
    return { id: user.id, name: user.name, role: asRole(user.role) }
  })
}

/** Now and then, remove invites that can no longer be used. */
async function purgeExpired(): Promise<void> {
  if (Math.random() > 0.05) return
  const { db, t } = await getDatabase()
  await db.delete(t.verifications).where(and(like(t.verifications.identifier, `${INVITE_PREFIX}%`), lt(t.verifications.expiresAt, new Date())))
}
