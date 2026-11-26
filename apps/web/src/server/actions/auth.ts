'use server'

import { asRole } from '@pet-adopt/plugin-sdk'

import { APIError } from 'better-auth/api'
import { headers } from 'next/headers'

import { getAuth, MIN_PASSWORD_LENGTH } from '../auth'
import { asRecord, Fields, logError, run, UserError, ValidationError, type ActionResult } from '../result'
import { getSessionUser, requireUser } from '../session'
import { clearAttempts, guardPasswordChange, guardSignIn } from '../throttle'
import type { SessionUser } from '../types'
import { updateUser } from '../users'

const MAX_PASSWORD_LENGTH = 128

/** Sign in with email and password. On success the session cookie is already set. */
export async function signInAction(input: { email: string; password: string }): Promise<ActionResult<SessionUser>> {
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
      await clearAttempts(keys)
      const user = result.user as { id: string; email: string; name: string; role?: string | null }
      return { id: user.id, email: user.email, name: user.name, role: asRole(user.role) } as SessionUser
    } catch (error) {
      if (error instanceof APIError) {
        // A wrong password, an unknown email and a disabled account all look the same.
        if (error.status === 401 || error.status === 'UNAUTHORIZED') throw new UserError('Incorrect email or password.')
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
    const auth = await getAuth()
    await auth.api.signOut({ headers: await headers() })
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
    } catch (error) {
      if (error instanceof APIError) {
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
