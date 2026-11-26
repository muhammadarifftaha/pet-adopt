import { asRole } from '@pet-adopt/plugin-sdk'
// The people who sign in. Authorisation (who may call what) is done by the actions; the rules about
// the data itself live here:
//  - the first account is always an admin, whatever role it is given;
//  - the last admin cannot be demoted or archived, so someone can always manage the site. Only
//    active (not archived) admins count. The check and the write happen in one transaction that
//    holds a lock, so two admins demoting or archiving each other at the same moment cannot both
//    pass the check;
//  - removing someone is two steps, like pages (agreed with the owner): archive (cannot sign in,
//    signed out everywhere, pending reset and invite links cancelled, name kept on what they made; restorable),
//    then delete, which is only possible for an archived account. Nobody archives themselves.
// Accounts are created through Better Auth's internal adapter, so passwords are hashed exactly as
// Better Auth will check them at sign-in.
import { randomUUID } from 'node:crypto'

import { and, count, eq, isNull, like } from 'drizzle-orm'

import { getDatabase, type Db, type Schema } from '@/db/client'
import { ROLES } from '@/lib/options'

import { getAuth, MIN_PASSWORD_LENGTH } from './auth'
import { asRecord, Fields, isUniqueViolation, UserError, ValidationError } from './result'
import type { Role } from './types'

export type UserListItem = {
  id: string
  email: string
  name: string
  role: Role
  /** When the account was archived, or null for an active account. */
  archivedAt: Date | null
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
    { email: input.email, name: input.name, emailVerified: true, role: input.role },
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
    } catch {
      // The next start repairs a sole owner without a password (see ensureOwner).
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

/** Name and, for admins, role. `canChangeRole` is decided by the caller. */
export async function updateUser(id: string, raw: unknown, opts: { canChangeRole: boolean }): Promise<void> {
  const input = asRecord(raw)
  const f = new Fields(input)
  const name = f.requiredText('name', 80)
  const role = opts.canChangeRole ? f.oneOf('role', ROLES) : undefined
  f.done()

  const { t, withTransaction } = await getDatabase()
  await withTransaction(
    async (tx) => {
      const [existing] = await tx.select().from(t.users).where(eq(t.users.id, id)).limit(1)
      if (!existing) throw new UserError('User not found.')
      if (existing.archivedAt) throw new UserError('This account is archived. Restore it before changing it.')
      if (role && role !== 'admin' && existing.role === 'admin' && (await countAdmins(tx, t)) <= 1) {
        throw new UserError('The last admin cannot be made an editor.')
      }
      await tx
        .update(t.users)
        .set({ ...(name ? { name } : {}), ...(role ? { role } : {}), updatedAt: new Date() })
        .where(eq(t.users.id, id))
    },
    { lock: ADMIN_LOCK },
  )
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
    await tx.delete(t.verifications).where(and(like(t.verifications.identifier, 'invite:%'), eq(t.verifications.value, id)))
  })
}

/**
 * Archives an account: it cannot sign in (the session hook in auth.ts), is signed out everywhere,
 * and its pending reset links stop working. Its name stays on everything it made. `by` is the admin
 * doing it: nobody archives themselves, and the last active admin stays.
 */
export async function archiveUser(id: string, opts: { by: string }): Promise<void> {
  if (id === opts.by) throw new UserError('You cannot archive your own account. Ask another admin.')
  const { t, withTransaction } = await getDatabase()
  await withTransaction(
    async (tx) => {
      const [target] = await tx.select().from(t.users).where(eq(t.users.id, id)).limit(1)
      if (!target) throw new UserError('User not found.')
      if (target.archivedAt) throw new UserError('This account is already archived.')
      if (target.role === 'admin' && (await countAdmins(tx, t)) <= 1) {
        throw new UserError('The last admin account cannot be archived. Make someone else an admin first.')
      }
      await tx.update(t.users).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(t.users.id, id))
      await tx.delete(t.sessions).where(eq(t.sessions.userId, id))
      // Reset links are `pwreset:<hash>` valued with the user id (src/server/password-reset.ts).
      await tx.delete(t.verifications).where(and(like(t.verifications.identifier, 'pwreset:%'), eq(t.verifications.value, id)))
      await tx.delete(t.verifications).where(and(like(t.verifications.identifier, 'invite:%'), eq(t.verifications.value, id)))
    },
    { lock: ADMIN_LOCK },
  )
}

/** Brings an archived account back as it was: same role, password and two-factor. */
export async function restoreUser(id: string): Promise<void> {
  const { t, withTransaction } = await getDatabase()
  await withTransaction(async (tx) => {
    const [target] = await tx.select({ archivedAt: t.users.archivedAt }).from(t.users).where(eq(t.users.id, id)).limit(1)
    if (!target) throw new UserError('User not found.')
    if (!target.archivedAt) throw new UserError('This account is not archived.')
    await tx.update(t.users).set({ archivedAt: null, updatedAt: new Date() }).where(eq(t.users.id, id))
  })
}

/**
 * Deletes an archived account for good. Its activity log entries keep its name; page versions and
 * email templates it made show no creator.
 */
export async function deleteUser(id: string): Promise<void> {
  const { t, withTransaction } = await getDatabase()
  await withTransaction(
    async (tx) => {
      const [target] = await tx.select({ archivedAt: t.users.archivedAt }).from(t.users).where(eq(t.users.id, id)).limit(1)
      if (!target) throw new UserError('User not found.')
      // Archived accounts are not admins that count, so the last active admin is never deleted.
      if (!target.archivedAt) throw new UserError('Archive the account before deleting it.')
      await tx.delete(t.users).where(eq(t.users.id, id))
    },
    { lock: ADMIN_LOCK },
  )
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
