// Two-factor sign-in: the rules around Better Auth's twoFactor plugin (src/server/auth.ts), which
// itself stores the encrypted secret and backup codes, checks the codes and locks the code step
// after 10 wrong codes in a row. Agreed with the owner:
//  - an authenticator app (TOTP) plus ten one-time backup codes; no email codes;
//  - optional for everyone, and an admin can require it for chosen roles (`two_factor_roles` in
//    site_settings, set on the Users screen). Someone whose role requires it and who has not set it
//    up is shown the setup screen instead of the admin, and every action that needs a permission
//    refuses (requirePermission in session.ts);
//  - "Trust this device" skips the code on that browser for 30 days;
//  - lost phone and codes: an admin turns it off for that account (Users), or, for the last admin,
//    `pnpm admin:reset-2fa <email>`. A password reset does not turn it off (whoever can read the
//    mailbox would get past the second step).
import { asRole, ROLES } from '@pet-adopt/plugin-sdk'
import { and, eq, like } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { cache } from 'react'

import { getDatabase } from '@/db/client'

import { getAuth } from './auth'
import { UserError, ValidationError } from './result'
import { open, seal } from './secret-box'
import type { Role, SessionUser } from './types'

const SETTINGS_ID = 1
/** Same as Better Auth's own code-step cookie (twoFactorCookieMaxAge in auth.ts). */
const PENDING_SECONDS = 600
const PENDING_COOKIE = 'pet-adopt.2fa-pending'
const PENDING_PURPOSE = 'two-factor-pending'
/** Better Auth names each trusted-device record `trust-device-<random>`, valued with the user id. */
const TRUSTED_DEVICE_PREFIX = 'trust-device-'

function cleanRoles(value: unknown): Role[] {
  if (!Array.isArray(value)) return []
  return ROLES.filter((role) => value.includes(role))
}

/** The roles that must use two-factor sign-in, in the usual role order. Read once per request. */
export const getTwoFactorRoles = cache(async (): Promise<Role[]> => {
  const { db, t } = await getDatabase()
  const [row] = await db.select({ roles: t.siteSettings.twoFactorRoles }).from(t.siteSettings).where(eq(t.siteSettings.id, SETTINGS_ID)).limit(1)
  return cleanRoles(row?.roles)
})

/** Whether this role must use two-factor sign-in. */
export async function roleRequiresTwoFactor(role: Role): Promise<boolean> {
  return (await getTwoFactorRoles()).includes(role)
}

/**
 * True when the person's role requires two-factor and they have not set it up yet. A session from a
 * sign-in provider counts as two-factor (agreed with the owner: the provider does its own checks).
 */
export async function needsTwoFactorSetup(user: SessionUser): Promise<boolean> {
  if (user.twoFactorEnabled || user.signInMethod.startsWith('provider:')) return false
  return roleRequiresTwoFactor(user.role)
}

/** Saves which roles must use two-factor. Returns the roles before and after, for the log. */
export async function saveTwoFactorRoles(input: unknown): Promise<{ before: Role[]; after: Role[] }> {
  if (!Array.isArray(input) || input.some((role) => typeof role !== 'string' || !(ROLES as readonly string[]).includes(role))) {
    throw new ValidationError({ roles: 'Pick roles from the list.' })
  }
  const after = cleanRoles(input)
  const { db, t } = await getDatabase()
  // Not getTwoFactorRoles(): it is cached for the request.
  const [row] = await db.select({ roles: t.siteSettings.twoFactorRoles }).from(t.siteSettings).where(eq(t.siteSettings.id, SETTINGS_ID)).limit(1)
  const before = cleanRoles(row?.roles)
  await db.insert(t.siteSettings).values({ id: SETTINGS_ID }).onConflictDoNothing()
  await db.update(t.siteSettings).set({ twoFactorRoles: after, updatedAt: new Date() }).where(eq(t.siteSettings.id, SETTINGS_ID))
  return { before, after }
}

/** Forgets every browser this account marked "Trust this device", so each asks for a code again. */
export async function forgetTrustedDevices(userId: string): Promise<void> {
  const { db, t } = await getDatabase()
  await db.delete(t.verifications).where(and(like(t.verifications.identifier, `${TRUSTED_DEVICE_PREFIX}%`), eq(t.verifications.value, userId)))
}

/**
 * Turns two-factor off for an account (an admin's reset, or the command line): removes the secret
 * and backup codes and every trusted browser. The person keeps their sessions and their password;
 * if their role requires two-factor they are asked to set it up again at once.
 */
export async function resetTwoFactor(userId: string): Promise<{ id: string; name: string; email: string; role: Role; wasEnabled: boolean }> {
  const { t, withTransaction } = await getDatabase()
  return withTransaction(async (tx) => {
    const [user] = await tx
      .select({ id: t.users.id, name: t.users.name, email: t.users.email, role: t.users.role, enabled: t.users.twoFactorEnabled })
      .from(t.users)
      .where(eq(t.users.id, userId))
      .limit(1)
    if (!user) throw new UserError('That account no longer exists.')
    await tx.delete(t.twoFactors).where(eq(t.twoFactors.userId, userId))
    await tx.update(t.users).set({ twoFactorEnabled: false }).where(eq(t.users.id, userId))
    await tx.delete(t.verifications).where(and(like(t.verifications.identifier, `${TRUSTED_DEVICE_PREFIX}%`), eq(t.verifications.value, userId)))
    return { id: user.id, name: user.name, email: user.email, role: asRole(user.role), wasEnabled: Boolean(user.enabled) }
  })
}

/** How many unused backup codes an account has left, or null when two-factor is not set up. */
export async function backupCodesLeft(userId: string): Promise<number | null> {
  const { db, t } = await getDatabase()
  const [row] = await db.select({ verified: t.twoFactors.verified }).from(t.twoFactors).where(eq(t.twoFactors.userId, userId)).limit(1)
  if (!row || row.verified === false) return null
  const auth = await getAuth()
  try {
    const { backupCodes } = await auth.api.viewBackupCodes({ body: { userId } })
    return backupCodes.length
  } catch {
    // Codes that cannot be opened (another BETTER_AUTH_SECRET) count as none left.
    return 0
  }
}

// --- The code step of a sign-in ------------------------------------------------------------
// Better Auth keeps the account of a half-finished sign-in behind its own signed cookie and does not
// tell us who it is. This sealed cookie remembers it, only so a wrong code can be logged against
// that account; it is never used to decide who may sign in.

/** Remembers, for 10 minutes on this browser, which account is at the code step. */
export async function rememberPendingSignIn(userId: string): Promise<void> {
  const value = seal(JSON.stringify({ id: userId, until: Date.now() + PENDING_SECONDS * 1000 }), PENDING_PURPOSE)
  ;(await cookies()).set(PENDING_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: PENDING_SECONDS,
  })
}

/** The account at the code step on this browser, or null (none, expired or tampered with). */
export async function pendingSignIn(): Promise<{ id: string; name: string } | null> {
  const raw = open((await cookies()).get(PENDING_COOKIE)?.value, PENDING_PURPOSE)
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const { id, until } = (parsed ?? {}) as { id?: unknown; until?: unknown }
  if (typeof id !== 'string' || typeof until !== 'number' || until < Date.now()) return null
  const { db, t } = await getDatabase()
  const [user] = await db.select({ id: t.users.id, name: t.users.name }).from(t.users).where(eq(t.users.id, id)).limit(1)
  return user ?? null
}

/** Ends the code step on this browser (signed in, or sent back to the password). */
export async function forgetPendingSignIn(): Promise<void> {
  ;(await cookies()).delete(PENDING_COOKIE)
}
