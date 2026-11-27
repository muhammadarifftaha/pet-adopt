import { asRole } from '@pet-adopt/plugin-sdk'

import { recordActivity, recordArchivedSignIn, recordFailedSignIn } from '@/server/activity'
import { ACCOUNT_ARCHIVED, getAuth } from '@/server/auth'
import { forgetEmailChange } from '@/server/pending-links'
import { UserError } from '@/server/result'
import { clearAttempts, guardPasswordChange, guardSignIn } from '@/server/throttle'

export const dynamic = 'force-dynamic'

const SIGN_IN = '/api/auth/sign-in/email'
const CHANGE_PASSWORD = '/api/auth/change-password'
/** A sign-in body is two short strings. Anything bigger is not a sign-in. */
const MAX_SIGN_IN_BODY = 10_000

// Only the endpoints this app uses are open. Better Auth ships many more (update-user, two-factor,
// list or revoke sessions, change email, password reset...), and several of them would skip the
// validation and the rules in src/server/users.ts. A list of what is closed would miss the next one
// a Better Auth upgrade or plugin adds; a list of what is open cannot. Everything else is done
// through server actions.
const ALLOWED = new Set([SIGN_IN, CHANGE_PASSWORD, '/api/auth/sign-out', '/api/auth/get-session'])
/**
 * Sign-in providers' callbacks (src/server/auth-providers.ts): the provider sends the browser back
 * here. Starting a sign-in, connecting and disconnecting go through server actions.
 */
const PROVIDER_CALLBACK = /^\/api\/auth\/callback\/[a-z0-9-]{1,60}$/

async function handle(request: Request) {
  const { pathname } = new URL(request.url)
  if (!ALLOWED.has(pathname) && !PROVIDER_CALLBACK.test(pathname)) return new Response('Not found', { status: 404 })

  const auth = await getAuth()

  // Email sign-in gets the same lockouts as the server action, so the HTTP route cannot be used to
  // guess passwords around them. The body must be JSON (the only thing Better Auth accepts here)
  // with an email, so the email we count is always the one Better Auth will check.
  if (request.method === 'POST' && pathname === SIGN_IN) {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return Response.json({ message: 'Send the sign-in as JSON.' }, { status: 415 })
    }
    if (Number(request.headers.get('content-length') ?? 0) > MAX_SIGN_IN_BODY) {
      return Response.json({ message: 'Request too large.' }, { status: 413 })
    }
    let email: unknown
    try {
      email = ((await request.clone().json()) as { email?: unknown } | null)?.email
    } catch {
      return Response.json({ message: 'Invalid JSON.' }, { status: 400 })
    }
    if (typeof email !== 'string' || !email.trim()) {
      return Response.json({ message: 'An email is required.' }, { status: 400 })
    }

    let keys: string[]
    try {
      ;({ keys } = await guardSignIn(email, request.headers))
    } catch (error) {
      if (error instanceof UserError) return Response.json({ message: error.message }, { status: 429 })
      throw error
    }
    const response = await auth.handler(request)
    if (response.ok) {
      await clearAttempts(keys)
      const user = ((await response.clone().json().catch(() => null)) as { user?: { id: string; name: string; role?: string | null } } | null)?.user
      if (user) await recordActivity({ actor: { id: user.id, name: user.name, role: asRole(user.role) }, action: 'auth.sign-in', area: 'sign-in', summary: 'Signed in' })
    } else if (response.status === 401) {
      await recordFailedSignIn(email)
    } else if (response.status === 403) {
      // Also 403: a rejected origin. Only our code means the account is archived (auth.ts).
      const code = ((await response.clone().json().catch(() => null)) as { code?: unknown } | null)?.code
      if (code === ACCOUNT_ARCHIVED) await recordArchivedSignIn(email)
    }
    return response
  }

  // "Change password" checks the current password, which makes it a guessing oracle for anyone
  // holding a stolen or unattended session. It shares one counter per user with
  // changePasswordAction, so the HTTP route cannot be used to get around that limit.
  if (request.method === 'POST' && pathname === CHANGE_PASSWORD) {
    const session = await auth.api.getSession({ headers: request.headers })
    // No session: Better Auth answers 401 itself, and there is no user to count against.
    if (session?.user) {
      let keys: string[]
      try {
        ;({ keys } = await guardPasswordChange(session.user.id))
      } catch (error) {
        if (error instanceof UserError) return Response.json({ message: error.message }, { status: 429 })
        throw error
      }
      const response = await auth.handler(request)
      if (response.ok) {
        await clearAttempts(keys)
        const { id, name, role } = session.user as { id: string; name: string; role?: string | null }
        await forgetEmailChange(id)
        await recordActivity({ actor: { id, name, role: asRole(role) }, action: 'account.password', area: 'account', summary: 'Changed their own password' })
      }
      return response
    }
  }

  if (request.method === 'POST' && pathname === '/api/auth/sign-out') {
    const session = await auth.api.getSession({ headers: request.headers })
    const response = await auth.handler(request)
    if (response.ok && session?.user) {
      const { id, name, role } = session.user as { id: string; name: string; role?: string | null }
      await recordActivity({ actor: { id, name, role: asRole(role) }, action: 'auth.sign-out', area: 'sign-in', summary: 'Signed out' })
    }
    return response
  }

  return auth.handler(request)
}

export const GET = handle
export const POST = handle
