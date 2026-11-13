'use server'

import { APIError } from 'better-auth/api'
import { headers } from 'next/headers'

import { getAuth, MIN_PASSWORD_LENGTH } from '../auth'
import { asRecord, Fields, run, UserError, ValidationError, type ActionResult } from '../result'
import { getSessionUser, requireUser } from '../session'
import { ACCOUNT_RULE, assertNotThrottled, clearFailures, clientAddress, CLIENT_RULE, recordFailure } from '../throttle'
import type { SessionUser } from '../types'
import { updateUser } from '../users'

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
    const accountKey = `login:email:${normalized}`
    const clientKey = `login:ip:${clientAddress(requestHeaders)}`
    // Locked out? Say so before checking the password, so a guess cannot succeed during the lockout.
    await assertNotThrottled(accountKey, ACCOUNT_RULE)
    await assertNotThrottled(clientKey, CLIENT_RULE)
    try {
      const result = await auth.api.signInEmail({
        body: { email: normalized, password: password as string },
        headers: requestHeaders,
      })
      await clearFailures(accountKey)
      const user = result.user as { id: string; email: string; name: string; role?: string | null }
      return { id: user.id, email: user.email, name: user.name, role: user.role === 'admin' ? 'admin' : 'editor' } as SessionUser
    } catch (error) {
      if (error instanceof APIError) {
        await Promise.all([recordFailure(accountKey, ACCOUNT_RULE), recordFailure(clientKey, CLIENT_RULE)])
        // Same message for a wrong password, an unknown email and a disabled account.
        throw new UserError('Incorrect email or password.')
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
  return getSessionUser()
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
    await requireUser()
    const raw = asRecord(input)
    const current = typeof raw.currentPassword === 'string' ? raw.currentPassword : ''
    const next = typeof raw.newPassword === 'string' ? raw.newPassword : ''
    const errors: Record<string, string> = {}
    if (!current) errors.currentPassword = 'Enter your current password.'
    if (next.length < MIN_PASSWORD_LENGTH) errors.newPassword = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
    if (Object.keys(errors).length) throw new ValidationError(errors)

    const auth = await getAuth()
    try {
      await auth.api.changePassword({
        body: { currentPassword: current, newPassword: next, revokeOtherSessions: true },
        headers: await headers(),
      })
    } catch (error) {
      if (error instanceof APIError) throw new ValidationError({ currentPassword: 'That is not your current password.' })
      throw error
    }
  })
}
