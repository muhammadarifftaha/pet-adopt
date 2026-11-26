'use server'

import { asRole } from '@pet-adopt/plugin-sdk'

import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'

import { getDatabase } from '@/db/client'

import { recordActivity, recordArchivedSignIn, recordFailedSignIn } from '../activity'
import { ACCOUNT_ARCHIVED, getAuth, MIN_PASSWORD_LENGTH } from '../auth'
import { authErrorCode, isAuthError } from '../auth-errors'
import { removeAvatar, saveAvatar } from '../avatars'
import { asRecord, Fields, logError, run, UserError, ValidationError, type ActionResult } from '../result'
import { getSessionUser, requireUser } from '../session'
import { clearAttempts, guardPasswordChange, guardSignIn } from '../throttle'
import { rememberPendingSignIn } from '../two-factor'
import type { SessionUser, SignInResult } from '../types'
import { listUsers, updateUser } from '../users'

const MAX_PASSWORD_LENGTH = 128

/**
 * Sign in with email and password. Signed in: the session cookie is already set. With two-factor
 * on (and this browser not trusted) the answer is `{ twoFactor: true }` instead: no session yet,
 * and the code goes to verifyTwoFactorAction (actions/two-factor.ts) within 10 minutes.
 */
export async function signInAction(input: { email: string; password: string }): Promise<ActionResult<SignInResult>> {
  return run(async () => {
    const raw = asRecord(input)
    const f = new Fields(raw, true)
    const email = f.requiredText('email', 200)
    const password = typeof raw.password === 'string' && raw.password ? raw.password : f.fail_('password', 'Enter your password.')
    f.done()

    const auth = await getAuth()
    const requestHeaders = await headers()
    const normalized = (email as string).toLowerCase()
    // Counts this attempt before the password is checked (atomically), and refuses it when the
    // client, the email from this client, or the email overall is locked out, so a guess cannot
    // succeed during a lockout.
    const { keys } = await guardSignIn(normalized, requestHeaders)
    try {
      const result = await auth.api.signInEmail({
        body: { email: normalized, password: password as string },
        headers: requestHeaders,
      })
      // The password was right: the lockout counters start again, also when a code is still needed.
      await clearAttempts(keys)
      if ('twoFactorRedirect' in result && result.twoFactorRedirect) {
        // Better Auth set its own cookie for the code step. Ours only says who is at that step, so a
        // wrong code can be logged against the account (never trusted for anything else).
        const { db, t } = await getDatabase()
        const [account] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, normalized)).limit(1)
        if (account) await rememberPendingSignIn(account.id)
        return { twoFactor: true }
      }
      const user = (result as { user: { id: string; email: string; name: string; role?: string | null; twoFactorEnabled?: boolean | null } }).user
      const signedIn: SessionUser = { id: user.id, email: user.email, name: user.name, role: asRole(user.role), twoFactorEnabled: Boolean(user.twoFactorEnabled), signInMethod: 'password' }
      await recordActivity({ actor: signedIn, action: 'auth.sign-in', area: 'sign-in', summary: 'Signed in' })
      return { twoFactor: false, user: signedIn }
    } catch (error) {
      if (isAuthError(error)) {
        // The password was right but the account is archived (the session hook in auth.ts). Only
        // someone who knows the password learns this, so it can say so.
        if (authErrorCode(error) === ACCOUNT_ARCHIVED) {
          await recordArchivedSignIn(normalized)
          throw new UserError('This account is archived. Ask an admin to restore it.')
        }
        // A wrong password and an unknown email look the same.
        if (error.status === 401 || error.status === 'UNAUTHORIZED') {
          await recordFailedSignIn(normalized)
          throw new UserError('Incorrect email or password.')
        }
        // Anything else (a rejected origin, a server error) is not the person's mistake. Say so, and
        // log it, instead of telling them their password is wrong.
        logError(error, 'sign-in failed')
        throw new UserError('Could not sign in right now. Try again, or ask an admin.')
      }
      throw error
    }
  })
}

export async function signOutAction(): Promise<ActionResult> {
  return run(async () => {
    const user = await getSessionUser()
    const auth = await getAuth()
    await auth.api.signOut({ headers: await headers() })
    if (user) await recordActivity({ actor: user, action: 'auth.sign-out', area: 'sign-in', summary: 'Signed out' })
  })
}

/** The signed-in person, or null. Handy for a client-side header. */
export async function getCurrentUserAction(): Promise<SessionUser | null> {
  try {
    return await getSessionUser()
  } catch (error) {
    logError(error, 'could not read the session')
    return null
  }
}

/** Changes your own name. */
export async function updateProfileAction(input: { name: string }): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser()
    await updateUser(user.id, { name: asRecord(input).name }, { canChangeRole: false })
    // Not getSessionUser(): it is cached for the request and still has the old name.
    const after = (await listUsers()).find((item) => item.id === user.id)
    if (after && after.name !== user.name) {
      await recordActivity({ actor: { ...user, name: after.name }, action: 'account.update', area: 'account', summary: 'Changed their own name', fields: ['name'] })
    }
  })
}

/** Changes your own password and signs you out on every other device. */
export async function changePasswordAction(input: { currentPassword: string; newPassword: string }): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser()
    const raw = asRecord(input)
    const current = typeof raw.currentPassword === 'string' ? raw.currentPassword : ''
    const next = typeof raw.newPassword === 'string' ? raw.newPassword : ''
    const errors: Record<string, string> = {}
    if (!current) errors.currentPassword = 'Enter your current password.'
    if (next.length < MIN_PASSWORD_LENGTH) errors.newPassword = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
    else if (next.length > MAX_PASSWORD_LENGTH) errors.newPassword = `Use at most ${MAX_PASSWORD_LENGTH} characters.`
    if (Object.keys(errors).length) throw new ValidationError(errors)

    // Checking the current password is a guessing oracle for anyone holding a stolen or unattended
    // session, so it is limited like a sign-in.
    const { keys } = await guardPasswordChange(user.id)
    const auth = await getAuth()
    try {
      await auth.api.changePassword({
        body: { currentPassword: current, newPassword: next, revokeOtherSessions: true },
        headers: await headers(),
      })
      await clearAttempts(keys)
      await recordActivity({ actor: user, action: 'account.password', area: 'account', summary: 'Changed their own password (signed out on other devices)' })
    } catch (error) {
      if (isAuthError(error)) {
        // Only a wrong current password is the person's mistake; an expired session or a server
        // error is not.
        if (error.status === 400 || error.status === 'BAD_REQUEST' || error.status === 401 || error.status === 'UNAUTHORIZED') {
          const code = (error.body as { code?: string } | undefined)?.code
          if (!code || code === 'INVALID_PASSWORD') {
            throw new ValidationError({ currentPassword: 'That is not your current password.' })
          }
        }
        logError(error, 'change password failed')
        throw new UserError('Could not change the password right now. Sign in again and retry.')
      }
      throw error
    }
  })
}

/**
 * Your profile picture: FormData with `file` and the square to keep (`x`, `y`, `size`, in pixels of
 * the upright picture, from the crop tool). Only the 256 px square is kept.
 */
export async function uploadAvatarAction(form: FormData): Promise<ActionResult<{ image: string }>> {
  return run(async () => {
    const user = await requireUser()
    const file = form.get('file')
    if (!(file instanceof Blob)) throw new ValidationError({ file: 'Choose a picture.' })
    const crop = { x: Number(form.get('x')), y: Number(form.get('y')), size: Number(form.get('size')) }
    const image = await saveAvatar(user.id, Buffer.from(await file.arrayBuffer()), crop)
    await recordActivity({ actor: user, action: 'account.avatar', area: 'account', summary: 'Changed their profile picture' })
    return { image }
  })
}

/** Removes your profile picture (back to your initials). */
export async function removeAvatarAction(): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser()
    if (await removeAvatar(user.id)) await recordActivity({ actor: user, action: 'account.avatar', area: 'account', summary: 'Removed their profile picture' })
  })
}
