import { asRole } from '@pet-adopt/plugin-sdk'
// The people who sign in. Authorisation (who may call what) is done by the actions; the rules about
// the data itself live here:
//  - the first account is always an admin, whatever role it is given;
//  - the last admin cannot be demoted or deleted, so someone can always manage the site. The check
//    and the write happen in one transaction that holds a lock, so two admins demoting or deleting
//    each other at the same moment cannot both pass the check.
// Accounts are created through Better Auth's internal adapter, so passwords are hashed exactly as
// Better Auth will check them at sign-in.
import { randomUUID } from 'node:crypto'

import { and, count, eq } from 'drizzle-orm'

import { getDatabase, type Db, type Schema } from '@/db/client'
import { ROLES } from '@/lib/options'

import { getAuth, MIN_PASSWORD_LENGTH } from './auth'
import { asRecord, Fields, isUniqueViolation, UserError, ValidationError } from './result'
import type { Role } from './types'

export type UserListItem = { id: string; email: string; name: string; role: Role; banned: boolean; createdAt: Date }

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
  const rows = await db.select().from(t.users).orderBy(t.users.createdAt)
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: asRole(u.role),
    banned: Boolean(u.banned),
    createdAt: u.createdAt,
  }))
}

async function countAdmins(tx: Db, t: Schema) {
  const [row] = await tx.select({ n: count() }).from(t.users).where(eq(t.users.role, 'admin'))
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

async function createAccount(input: { email: string; name: string; password: string; role: Role }) {
  const ctx = await (await getAuth()).$context
  const hash = await ctx.password.hash(input.password)
  const user = await ctx.internalAdapter.createUser(
    { email: input.email, name: input.name, emailVerified: true, role: input.role },
    { method: 'admin' },
  )
  try {
    await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: hash })
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

export async function createUser(raw: unknown): Promise<{ id: string }> {
  const input = asRecord(raw)
  const f = new Fields(input, true)
  const email = f.requiredText('email', 200, { validate: (s) => EMAIL.test(s) || 'Enter a valid email address.' })
  const name = f.requiredText('name', 80)
  const pass = newPassword(f, 'password', input)
  const role = f.oneOf('role', ROLES) ?? 'editor'
  f.done()

  const address = (email as string).toLowerCase()
  const taken = new ValidationError({ email: 'An account with this email already exists.' })
  const ctx = await (await getAuth()).$context
  if (await ctx.internalAdapter.findUserByEmail(address)) throw taken

  const { db, t } = await getDatabase()
  const [{ n }] = await db.select({ n: count() }).from(t.users)
  try {
    const id = await createAccount({
      email: address,
      name: name as string,
      password: pass as string,
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
    const [user] = await tx.select({ id: t.users.id }).from(t.users).where(eq(t.users.id, id)).limit(1)
    if (!user) throw new UserError('User not found.')
    // Also repairs an account that was left without a password. Changing the password and ending
    // every session happen together, so a reset used to evict a stolen session cannot half-apply.
    await writeCredential(tx, t, id, hash)
    await tx.delete(t.sessions).where(eq(t.sessions.userId, id))
  })
}

export async function deleteUser(id: string): Promise<void> {
  const { t, withTransaction } = await getDatabase()
  await withTransaction(
    async (tx) => {
      const [target] = await tx.select().from(t.users).where(eq(t.users.id, id)).limit(1)
      if (!target) throw new UserError('User not found.')
      // The last admin cannot be deleted. (That also means the site always has a user.)
      if (target.role === 'admin' && (await countAdmins(tx, t)) <= 1) throw new UserError('The last admin account cannot be deleted.')
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
