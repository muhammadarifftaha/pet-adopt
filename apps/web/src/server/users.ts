import { asRole } from '@pet-adopt/plugin-sdk'
// The people who sign in. Authorisation (who may call what) is done by the actions; the rules about
// the data itself live here:
//  - the first account is always an admin, whatever role it is given;
//  - the last admin cannot be demoted or archived, so someone can always manage the site. Only
//    active (not archived) admins count. The check and the write happen in one transaction that
//    holds a lock, so two admins demoting or archiving each other at the same moment cannot both
//    pass the check;
//  - removing someone is two steps, like pages (agreed with the owner): archive (cannot sign in,
//    signed out everywhere, pending reset, invite and email-change links cancelled, name kept on what they made; restorable),
//    then delete, which is only possible for an archived account. Nobody archives themselves.
// Accounts are created through Better Auth's internal adapter, so passwords are hashed exactly as
// Better Auth will check them at sign-in.
import { randomUUID } from 'node:crypto'

import { and, count, eq, isNotNull, isNull, like, lt, lte } from 'drizzle-orm'

import { getDatabase, type Db, type Schema } from '@/db/client'
import { ROLES } from '@/lib/options'

import { getAuth, MIN_PASSWORD_LENGTH } from './auth'
import { deleteAvatarFile } from './avatars'
import { cancelPendingLinks } from './pending-links'
import { asRecord, Fields, isUniqueViolation, logError, UserError, ValidationError } from './result'
import type { Role } from './types'

export type UserListItem = {
  id: string
  email: string
  name: string
  role: Role
  /** When the account was archived, or null for an active account. */
  archivedAt: Date | null
  /** The person confirmed they read this email (an invite, a confirmation link). */
  emailVerified: boolean
  /** The person asked to delete their account: it is deleted then (null otherwise). */
  deleteAfter: Date | null
  /** Profile picture address (/media/avatar-….webp), or null for initials. */
  image: string | null
  /** Invited and not accepted yet: the account has no password (src/server/invites.ts). */
  invited: boolean
  /** When the pending invite link stops working (null: none, or it was used or cancelled). */
  inviteExpiresAt: Date | null
  /** The pending invite link still works (worked out when the list was read). */
  inviteActive: boolean
  /** Two-factor sign-in is set up. */
  twoFactorEnabled: boolean
  createdAt: Date
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Every change that could remove an admin takes this lock first. */
const ADMIN_LOCK = 'users:admins'

/** The new-password rule, shared by every place that sets one. */
export function newPassword(f: Fields, key: string, raw: Record<string, unknown>) {
  const value = raw[key]
  if (typeof value !== 'string' || !value) return f.fail_(key, 'Enter a password.')
  if (value.length < MIN_PASSWORD_LENGTH) return f.fail_(key, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  if (value.length > 128) return f.fail_(key, 'Use at most 128 characters.')
  return value
}

export async function listUsers(): Promise<UserListItem[]> {
  const { db, t } = await getDatabase()
  const [rows, passwords, invites] = await Promise.all([
    db.select().from(t.users).orderBy(t.users.createdAt),
    db.select({ userId: t.accounts.userId }).from(t.accounts).where(eq(t.accounts.providerId, 'credential')),
    // Invite links (src/server/invites.ts): `invite:<hash>`, valued with the user id.
    db.select({ userId: t.verifications.value, expiresAt: t.verifications.expiresAt }).from(t.verifications).where(like(t.verifications.identifier, 'invite:%')),
  ])
  const withPassword = new Set(passwords.map((row) => row.userId))
  const now = Date.now()
  const inviteExpiry = new Map(invites.map((row) => [row.userId, row.expiresAt]))
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: asRole(u.role),
    archivedAt: u.archivedAt ?? null,
    deleteAfter: u.deleteAfter ?? null,
    emailVerified: u.emailVerified,
    image: u.image ?? null,
    invited: !withPassword.has(u.id),
    inviteExpiresAt: withPassword.has(u.id) ? null : (inviteExpiry.get(u.id) ?? null),
    inviteActive: !withPassword.has(u.id) && (inviteExpiry.get(u.id)?.getTime() ?? 0) > now,
    twoFactorEnabled: Boolean(u.twoFactorEnabled),
    createdAt: u.createdAt,
  }))
}

async function countAdmins(tx: Db, t: Schema) {
  const [row] = await tx.select({ n: count() }).from(t.users).where(and(eq(t.users.role, 'admin'), isNull(t.users.archivedAt)))
  return row?.n ?? 0
}

/** Sets the password of an account, creating the credential record if the account has none. */
export async function writeCredential(tx: Db, t: Schema, userId: string, hash: string) {
  const now = new Date()
  const updated = await tx
    .update(t.accounts)
    .set({ password: hash, updatedAt: now })
    .where(and(eq(t.accounts.userId, userId), eq(t.accounts.providerId, 'credential')))
    .returning({ id: t.accounts.id })
  if (!updated.length) {
    await tx
      .insert(t.accounts)
      .values({ id: randomUUID(), accountId: userId, providerId: 'credential', userId, password: hash, createdAt: now, updatedAt: now })
  }
}

/** Makes the user and, unless invited (`password` null), their password. */
async function createAccount(input: { email: string; name: string; password: string | null; role: Role }) {
  const ctx = await (await getAuth()).$context
  const hash = input.password === null ? null : await ctx.password.hash(input.password)
  const user = await ctx.internalAdapter.createUser(
    // Not confirmed until the person proves they read it: accepting an invite or the confirmation
    // link (src/server/email-change.ts). Accounts from before this rule were left confirmed.
    { email: input.email, name: input.name, emailVerified: false, role: input.role },
    { method: 'admin' },
  )
  try {
    // Invited: no password yet; accepting the invite writes it (writeCredential).
    if (hash !== null) await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: hash })
  } catch (error) {
    // Don't leave a user nobody can sign in as: the email would then count as taken forever.
    try {
      const { db, t } = await getDatabase()
      await db.delete(t.users).where(eq(t.users.id, user.id))
    } catch (cleanupError) {
      // Left as an account without a password: ensureOwner repairs a sole owner on the next start;
      // any other is fixed by an admin (New password, or archive and delete).
      logError(cleanupError, `could not remove the half-created account ${user.id}`)
    }
    throw error
  }
  return user.id as string
}

/**
 * `{ email, name, role, password }`, or `{ email, name, role, invite: true }` for an account without
 * a password whose owner chooses one through an invite link (src/server/invites.ts sends it).
 */
export async function createUser(raw: unknown): Promise<{ id: string }> {
  const input = asRecord(raw)
  const f = new Fields(input, true)
  const email = f.requiredText('email', 200, { validate: (s) => EMAIL.test(s) || 'Enter a valid email address.' })
  const name = f.requiredText('name', 80)
  const invite = input.invite === true
  const pass = invite ? null : newPassword(f, 'password', input)
  const role = f.oneOf('role', ROLES) ?? 'editor'
  f.done()

  const address = (email as string).toLowerCase()
  const taken = new ValidationError({ email: 'An account with this email already exists.' })
  const ctx = await (await getAuth()).$context
  const existing = await ctx.internalAdapter.findUserByEmail(address)
  if (existing) {
    if ((existing.user as { archivedAt?: Date | null }).archivedAt) {
      throw new ValidationError({ email: 'An archived account has this email. Restore it from the archived accounts instead.' })
    }
    throw taken
  }

  const { db, t } = await getDatabase()
  const [{ n }] = await db.select({ n: count() }).from(t.users)
  try {
    const id = await createAccount({
      email: address,
      name: name as string,
      password: invite ? null : (pass as string),
      // The very first account must be an admin, or nobody could manage the site.
      role: n === 0 ? 'admin' : asRole(role),
    })
    return { id }
  } catch (error) {
    // Two requests with the same email at once: the database's unique index decides.
    if (isUniqueViolation(error)) throw taken
    throw error
  }
}

/**
 * Name and, for admins, role and email (`canChangeRole` is decided by the caller). Returns the old
 * and new email when it changed, so the caller can tell both addresses (src/server/email-change.ts).
 */
export async function updateUser(id: string, raw: unknown, opts: { canChangeRole: boolean }): Promise<{ email: { from: string; to: string } | null }> {
  const input = asRecord(raw)
  const f = new Fields(input)
  const name = f.requiredText('name', 80)
  const role = opts.canChangeRole ? f.oneOf('role', ROLES) : undefined
  const email = opts.canChangeRole ? f.text('email', 200, { validate: (s) => EMAIL.test(s) || 'Enter a valid email address.' }) : undefined
  if (email === null) f.fail_('email', 'Enter an email address.')
  f.done()

  const address = email ? email.toLowerCase() : null
  const { t, withTransaction } = await getDatabase()
  try {
    return await withTransaction(
      async (tx) => {
        const [existing] = await tx.select().from(t.users).where(eq(t.users.id, id)).limit(1)
        if (!existing) throw new UserError('User not found.')
        if (existing.archivedAt) throw new UserError('This account is archived. Restore it before changing it.')
        if (role && role !== 'admin' && existing.role === 'admin' && (await countAdmins(tx, t)) <= 1) {
          throw new UserError('The last admin cannot be made an editor.')
        }
        const changesEmail = address !== null && address !== existing.email
        if (changesEmail) {
          const [taken] = await tx.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, address)).limit(1)
          if (taken) throw new ValidationError({ email: 'Another account (maybe an archived one) already uses this email.' })
        }
        await tx
          .update(t.users)
          // A new address from an admin is not confirmed: the person confirms it themselves.
          .set({ ...(name ? { name } : {}), ...(role ? { role } : {}), ...(changesEmail ? { email: address, emailVerified: false } : {}), updatedAt: new Date() })
          .where(eq(t.users.id, id))
        // Links already sent to the old address must not outlive it: a reset link, and a pending
        // change or confirmation. (A pending invite is sent again to the new address by the action.)
        if (changesEmail) await cancelPendingLinks(tx, t, id, ['password-reset', 'email-change', 'invite'])
        return { email: changesEmail ? { from: existing.email, to: address } : null }
      },
      { lock: ADMIN_LOCK },
    )
  } catch (error) {
    // Two changes to the same address at once: the unique index decides.
    if (isUniqueViolation(error)) throw new ValidationError({ email: 'Another account (maybe an archived one) already uses this email.' })
    throw error
  }
}

/** Sets a new password and signs the person out everywhere, in one step. */
export async function resetPassword(id: string, raw: unknown): Promise<void> {
  const input = asRecord(raw)
  const f = new Fields(input)
  const pass = newPassword(f, 'password', input)
  f.done()

  const ctx = await (await getAuth()).$context
  const hash = await ctx.password.hash(pass as string)
  const { t, withTransaction } = await getDatabase()
  await withTransaction(async (tx) => {
    const [user] = await tx.select({ id: t.users.id, archivedAt: t.users.archivedAt }).from(t.users).where(eq(t.users.id, id)).limit(1)
    if (!user) throw new UserError('User not found.')
    if (user.archivedAt) throw new UserError('This account is archived. Restore it before setting a password.')
    // Also repairs an account that was left without a password. Changing the password and ending
    // every session happen together, so a reset used to evict a stolen session cannot half-apply.
    await writeCredential(tx, t, id, hash)
    await tx.delete(t.sessions).where(eq(t.sessions.userId, id))
    // They have a password now: a pending invite (src/server/invites.ts) is no longer needed.
    // So are an email change asked for with the old password (it may be why the password is reset)
    // and a reset link made earlier, which could otherwise replace this password within its hour.
    await cancelPendingLinks(tx, t, id, ['invite', 'email-change', 'password-reset'])
  })
}

/**
 * Archives an account: it cannot sign in (the session hook in auth.ts), is signed out everywhere,
 * and its pending reset, invite and email-change links stop working. Its name stays on everything it made. `by` is the admin
 * doing it: nobody archives themselves, and the last active admin stays.
 */
export async function archiveUser(id: string, opts: { by: string }): Promise<void> {
  if (id === opts.by) throw new UserError('You cannot archive your own account. Ask another admin.')
  await archive(id, null)
}

/** Whether this account is the only active admin (it then cannot be demoted, archived or deleted). */
export async function isLastActiveAdmin(userId: string): Promise<boolean> {
  const { db, t } = await getDatabase()
  const [user] = await db.select({ role: t.users.role, archivedAt: t.users.archivedAt }).from(t.users).where(eq(t.users.id, userId)).limit(1)
  if (user?.role !== 'admin' || user.archivedAt) return false
  return (await countAdmins(db, t)) <= 1
}

/** Days between asking to delete your own account and its deletion (agreed with the owner). */
export const DELETION_GRACE_DAYS = 30

/** Archives an account; `deleteAfter` set when the person asked to delete it themselves. */
async function archive(id: string, deleteAfter: Date | null): Promise<void> {
  const { t, withTransaction } = await getDatabase()
  await withTransaction(
    async (tx) => {
      const [target] = await tx.select().from(t.users).where(eq(t.users.id, id)).limit(1)
      if (!target) throw new UserError('User not found.')
      if (target.archivedAt) throw new UserError('This account is already archived.')
      if (target.role === 'admin' && (await countAdmins(tx, t)) <= 1) {
        throw new UserError(
          deleteAfter
            ? 'You are the last admin, so your account cannot be deleted. Make someone else an admin first.'
            : 'The last admin account cannot be archived. Make someone else an admin first.',
        )
      }
      await tx.update(t.users).set({ archivedAt: new Date(), deleteAfter, updatedAt: new Date() }).where(eq(t.users.id, id))
      await tx.delete(t.sessions).where(eq(t.sessions.userId, id))
      // Reset links are `pwreset:<hash>` valued with the user id (src/server/password-reset.ts).
      await tx.delete(t.verifications).where(and(like(t.verifications.identifier, 'pwreset:%'), eq(t.verifications.value, id)))
      await tx.delete(t.verifications).where(and(like(t.verifications.identifier, 'invite:%'), eq(t.verifications.value, id)))
      // A pending email change (src/server/email-change.ts) is JSON starting with the user id.
      await tx.delete(t.verifications).where(and(like(t.verifications.identifier, 'email-change:%'), like(t.verifications.value, `{"userId":${JSON.stringify(id)},%`)))
    },
    { lock: ADMIN_LOCK },
  )
}

/**
 * The person asks to delete their own account (agreed with the owner): `{ password }`. The account
 * is archived at once (signed out everywhere, cannot sign in) and deleted DELETION_GRACE_DAYS later
 * by purgeDueDeletions; until then an admin can restore it, or delete it at once. Not for the last
 * active admin. Returns when it will be deleted.
 */
export async function requestOwnDeletion(userId: string, raw: unknown): Promise<{ deleteAfter: Date; name: string; email: string }> {
  const password = asRecord(raw).password
  if (typeof password !== 'string' || !password) throw new ValidationError({ password: 'Enter your password.' })
  const { db, t } = await getDatabase()
  const [user] = await db.select({ name: t.users.name, email: t.users.email }).from(t.users).where(eq(t.users.id, userId)).limit(1)
  if (!user) throw new UserError('You need to be signed in.')
  // A guessing oracle for a stolen session: limited like a password change.
  const { clearAttempts, guardPasswordChange } = await import('./throttle')
  const { keys } = await guardPasswordChange(userId)
  const [credential] = await db
    .select({ hash: t.accounts.password })
    .from(t.accounts)
    .where(and(eq(t.accounts.userId, userId), eq(t.accounts.providerId, 'credential')))
    .limit(1)
  const ctx = await (await getAuth()).$context
  if (!credential?.hash || !(await ctx.password.verify({ hash: credential.hash, password }))) throw new ValidationError({ password: 'That is not your password.' })
  await clearAttempts(keys)
  const deleteAfter = new Date(Date.now() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000)
  await archive(userId, deleteAfter)
  return { deleteAfter, ...user }
}

/** Brings an archived account back as it was: same role, password and two-factor. */
export async function restoreUser(id: string): Promise<void> {
  const { t, withTransaction } = await getDatabase()
  // Under the same lock as deleteUser, so a deletion cannot act on an account restored meanwhile.
  await withTransaction(
    async (tx) => {
      const [target] = await tx.select({ archivedAt: t.users.archivedAt }).from(t.users).where(eq(t.users.id, id)).limit(1)
      if (!target) throw new UserError('User not found.')
      if (!target.archivedAt) throw new UserError('This account is not archived.')
      // Also cancels a deletion the person asked for.
      await tx.update(t.users).set({ archivedAt: null, deleteAfter: null, updatedAt: new Date() }).where(eq(t.users.id, id))
    },
    { lock: ADMIN_LOCK },
  )
}

/**
 * Deletes an archived account for good, and everything about the person (agreed with the owner):
 * the account, its sessions, password, two-factor, provider connections and pending links (by
 * cascade or here), its attempt counters and picture. The activity log keeps what was done and
 * when, anonymised (anonymiseActivity). Page versions and email templates they made show no
 * creator. Returns the anonymous label their entries now carry.
 */
export async function deleteUser(id: string): Promise<{ id: string; label: string }> {
  return (await removeUser(id, null)) as { id: string; label: string }
}

/**
 * deleteUser, or with `dueBy` only while the person's own deletion request is due by then
 * (re-checked under the lock, so an account restored meanwhile is kept): null when it is not.
 */
async function removeUser(id: string, dueBy: Date | null): Promise<{ id: string; label: string } | null> {
  const { t, withTransaction } = await getDatabase()
  const { anonymiseActivity } = await import('./activity')
  const removed = await withTransaction(
    async (tx) => {
      const [target] = await tx.select().from(t.users).where(eq(t.users.id, id)).limit(1)
      if (!target) throw new UserError('User not found.')
      if (dueBy && !(target.archivedAt && target.deleteAfter && target.deleteAfter <= dueBy)) return null
      // Archived accounts are not admins that count, so the last active admin is never deleted.
      if (!target.archivedAt) throw new UserError('Archive the account before deleting it.')
      const ghost = await anonymiseActivity(tx, t, id, target.name)
      await tx.delete(t.verifications).where(eq(t.verifications.value, id))
      await tx.delete(t.verifications).where(and(like(t.verifications.identifier, 'email-change:%'), like(t.verifications.value, `{"userId":${JSON.stringify(id)},%`)))
      await tx.delete(t.users).where(eq(t.users.id, id))
      return { ghost, image: target.image, email: target.email }
    },
    { lock: ADMIN_LOCK },
  )
  if (!removed) return null
  // Outside the transaction: storage and counters.
  await deleteAvatarFile(removed.image)
  const { forgetAttemptsOf } = await import('./throttle')
  await forgetAttemptsOf(id, removed.email).catch((error) => logError(error, 'could not forget the attempt counters of a deleted account'))
  return removed.ghost
}

/**
 * Deletes the accounts whose owners asked for it and whose DELETION_GRACE_DAYS are over. Runs at
 * server start and at most hourly after that (purgeDueDeletionsSometimes). Returns how many.
 */
export async function purgeDueDeletions(now = new Date()): Promise<number> {
  const { db, t } = await getDatabase()
  const due = await db
    .select({ id: t.users.id, deleteAfter: t.users.deleteAfter })
    .from(t.users)
    .where(and(isNotNull(t.users.archivedAt), isNotNull(t.users.deleteAfter), lte(t.users.deleteAfter, now)))
  const { quoted, recordActivity } = await import('./activity')
  let deleted = 0
  // One account that cannot be deleted must not keep the others past their date: each is tried on
  // its own, a failure is logged with the account id (no personal data) and tried again next time.
  for (const { id, deleteAfter } of due) {
    let ghost: { id: string; label: string } | null
    try {
      ghost = await removeUser(id, now)
    } catch (error) {
      logError(error, `could not delete account ${id} (due since ${deleteAfter?.toISOString() ?? 'unknown'})`)
      continue
    }
    // Restored since it was read.
    if (!ghost) continue
    deleted++
    await recordActivity({
      actor: null,
      action: 'user.delete',
      area: 'users',
      summary: `Deleted the account ${quoted(ghost.label)}, as its owner asked ${DELETION_GRACE_DAYS} days earlier`,
      subject: ghost,
      client: null,
    })
  }
  return deleted
}

const purgeHolder = ((globalThis as { __petAdoptDeletionPurge?: { at: number } }).__petAdoptDeletionPurge ??= { at: 0 })

/**
 * purgeDueDeletions, and removing expired sessions and links (purgeExpiredSignIns), at most once an
 * hour per server; never throws.
 */
export async function purgeDueDeletionsSometimes(): Promise<void> {
  if (Date.now() - purgeHolder.at < 60 * 60 * 1000) return
  purgeHolder.at = Date.now()
  await purgeDueDeletions().catch((error) => logError(error, 'could not delete accounts that are due'))
  await purgeExpiredSignIns().catch((error) => logError(error, 'could not remove expired sessions and links'))
}

/**
 * Removes sessions that ended more than a day ago, and every expired row of `verifications` (reset,
 * invite and email-change links, trusted browsers, Better Auth's sign-in states). Nothing else
 * deletes them, so without this both tables would only grow.
 */
export async function purgeExpiredSignIns(now = new Date()): Promise<void> {
  const { db, t } = await getDatabase()
  await db.delete(t.sessions).where(lt(t.sessions.expiresAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)))
  await db.delete(t.verifications).where(lt(t.verifications.expiresAt, now))
}

/**
 * Creates the first owner from SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD.
 *
 * It only creates an account while there are no users, so it never resets a password or brings back
 * an account that was deleted on purpose. Running it on boot also closes the window where anyone
 * who reaches a brand-new deployment could claim the admin first.
 *
 * It also repairs one broken state: a lone user, with the owner's email, who has no password
 * (an earlier start was interrupted between creating the user and its password).
 */
export async function ensureOwner(): Promise<'created' | 'repaired' | 'skipped'> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
  const pass = process.env.SEED_ADMIN_PASSWORD
  if (!email || !pass) return 'skipped'
  if (process.env.NEXT_PHASE === 'phase-production-build') return 'skipped'
  if (pass.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }
  const { db, t } = await getDatabase()
  const [{ n }] = await db.select({ n: count() }).from(t.users)

  if (n === 0) {
    try {
      await createAccount({ email, name: email.split('@')[0] || 'Owner', password: pass, role: 'admin' })
      console.log('Created the owner account from SEED_ADMIN_EMAIL.')
      return 'created'
    } catch (error) {
      // Another instance starting at the same moment won the race: that is fine.
      const [{ n: after }] = await db.select({ n: count() }).from(t.users)
      if (isUniqueViolation(error) || after > 0) return 'skipped'
      throw error
    }
  }

  if (n === 1) {
    const [user] = await db.select().from(t.users).limit(1)
    const [credential] = await db
      .select({ id: t.accounts.id })
      .from(t.accounts)
      .where(and(eq(t.accounts.userId, user.id), eq(t.accounts.providerId, 'credential')))
      .limit(1)
    if (!credential && user.email === email) {
      const ctx = await (await getAuth()).$context
      const hash = await ctx.password.hash(pass)
      await getDatabase().then(({ withTransaction }) => withTransaction((tx) => writeCredential(tx, t, user.id, hash)))
      console.log('Repaired the owner account: it had no password.')
      return 'repaired'
    }
  }
  return 'skipped'
}
