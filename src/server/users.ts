// The people who sign in. Authorisation (who may call what) is done by the actions; the rules about
// the data itself live here:
//  - the first account is always an admin, whatever role it is given;
//  - the last admin cannot be demoted or deleted, so someone can always manage the site.
// Accounts are created through Better Auth's internal adapter, so passwords are hashed exactly as
// Better Auth will check them at sign-in.
import { and, count, eq } from 'drizzle-orm'

import { getDatabase } from '@/db/client'
import { ROLES } from '@/lib/options'

import { getAuth, MIN_PASSWORD_LENGTH } from './auth'
import { asRecord, Fields, UserError, ValidationError, isUniqueViolation } from './result'
import type { Role } from './types'

export type UserListItem = { id: string; email: string; name: string; role: Role; banned: boolean; createdAt: Date }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const asRole = (value: string | null): Role => (value === 'admin' ? 'admin' : 'editor')

function password(f: Fields, key: string, raw: Record<string, unknown>) {
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

async function countAdmins() {
  const { db, t } = await getDatabase()
  const [row] = await db.select({ n: count() }).from(t.users).where(eq(t.users.role, 'admin'))
  return row?.n ?? 0
}

async function createAccount(input: { email: string; name: string; password: string; role: Role }) {
  const ctx = await (await getAuth()).$context
  const hash = await ctx.password.hash(input.password)
  const user = await ctx.internalAdapter.createUser(
    { email: input.email, name: input.name, emailVerified: true, role: input.role },
    { method: 'admin' },
  )
  await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: hash })
  return user.id as string
}

export async function createUser(raw: unknown): Promise<{ id: string }> {
  const input = asRecord(raw)
  const f = new Fields(input, true)
  const email = f.requiredText('email', 200, { validate: (s) => EMAIL.test(s) || 'Enter a valid email address.' })
  const name = f.requiredText('name', 80)
  const pass = password(f, 'password', input)
  const role = f.oneOf('role', ROLES) ?? 'editor'
  f.done()

  const { db, t } = await getDatabase()
  const [{ n }] = await db.select({ n: count() }).from(t.users)
  try {
    const id = await createAccount({
      email: (email as string).toLowerCase(),
      name: name as string,
      password: pass as string,
      // The very first account must be an admin, or nobody could manage the site.
      role: n === 0 ? 'admin' : asRole(role),
    })
    return { id }
  } catch (error) {
    if (isUniqueViolation(error) || /exist|unique/i.test(error instanceof Error ? error.message : '')) {
      throw new ValidationError({ email: 'An account with this email already exists.' })
    }
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

  const { db, t } = await getDatabase()
  const [existing] = await db.select().from(t.users).where(eq(t.users.id, id)).limit(1)
  if (!existing) throw new UserError('User not found.')
  if (role && role !== 'admin' && existing.role === 'admin' && (await countAdmins()) <= 1) {
    throw new UserError('The last admin cannot be made an editor.')
  }
  await db
    .update(t.users)
    .set({ ...(name ? { name } : {}), ...(role ? { role } : {}), updatedAt: new Date() })
    .where(eq(t.users.id, id))
}

/** Sets a new password and signs the person out everywhere. */
export async function resetPassword(id: string, raw: unknown): Promise<void> {
  const input = asRecord(raw)
  const f = new Fields(input)
  const pass = password(f, 'password', input)
  f.done()
  const ctx = await (await getAuth()).$context
  const found = await ctx.internalAdapter.findUserById(id)
  if (!found) throw new UserError('User not found.')
  await ctx.internalAdapter.updatePassword(id, await ctx.password.hash(pass as string))
  const { db, t } = await getDatabase()
  await db.delete(t.sessions).where(eq(t.sessions.userId, id))
}

export async function deleteUser(id: string): Promise<void> {
  const { db, t } = await getDatabase()
  const [target] = await db.select().from(t.users).where(eq(t.users.id, id)).limit(1)
  if (!target) throw new UserError('User not found.')
  // The last admin cannot be deleted. (That also means the site always has a user.)
  if (target.role === 'admin' && (await countAdmins()) <= 1) throw new UserError('The last admin account cannot be deleted.')
  await db.delete(t.users).where(and(eq(t.users.id, id)))
}

/**
 * Creates the first owner from SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD.
 *
 * It only acts while there are no users, so it never resets a password or brings back an account
 * that was deleted on purpose. Running it on boot also closes the window where anyone who reaches
 * a brand-new deployment could claim the admin first.
 */
export async function ensureOwner(): Promise<'created' | 'skipped'> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
  const pass = process.env.SEED_ADMIN_PASSWORD
  if (!email || !pass) return 'skipped'
  if (process.env.NEXT_PHASE === 'phase-production-build') return 'skipped'
  if (pass.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }
  const { db, t } = await getDatabase()
  const [{ n }] = await db.select({ n: count() }).from(t.users)
  if (n > 0) return 'skipped'
  await createAccount({ email, name: email.split('@')[0] || 'Owner', password: pass, role: 'admin' })
  console.log(`Created owner account ${email}`)
  return 'created'
}
