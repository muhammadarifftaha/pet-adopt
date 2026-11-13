import { getAuth } from '@/server/auth'
import { UserError } from '@/server/result'
import { clearAttempts, guardPasswordChange, guardSignIn } from '@/server/throttle'

export const dynamic = 'force-dynamic'

const SIGN_IN = '/api/auth/sign-in/email'
const CHANGE_PASSWORD = '/api/auth/change-password'
/** A sign-in body is two short strings. Anything bigger is not a sign-in. */
const MAX_SIGN_IN_BODY = 10_000

// Better Auth's own /admin/* endpoints (set role, remove user, impersonate...) are switched off.
// Everything of that kind goes through src/server/users.ts, which keeps the last admin safe.
// Only email sign-in exists, so other /sign-in/* methods are closed too.
async function handle(request: Request) {
  const { pathname } = new URL(request.url)
  if (pathname.startsWith('/api/auth/admin/') || (pathname.startsWith('/api/auth/sign-in/') && pathname !== SIGN_IN)) {
    return new Response('Not found', { status: 404 })
  }

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
    if (response.ok) await clearAttempts(keys)
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
      if (response.ok) await clearAttempts(keys)
      return response
    }
  }

  return auth.handler(request)
}

export const GET = handle
export const POST = handle
