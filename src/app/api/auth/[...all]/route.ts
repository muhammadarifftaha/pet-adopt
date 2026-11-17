import { getAuth } from '@/server/auth'
import { UserError } from '@/server/result'
import { clearAttempts, guardPasswordChange, guardSignIn } from '@/server/throttle'

export const dynamic = 'force-dynamic'

const SIGN_IN = '/api/auth/sign-in/email'
const CHANGE_PASSWORD = '/api/auth/change-password'
/** A sign-in body is two short strings. Anything bigger is not a sign-in. */
const MAX_SIGN_IN_BODY = 10_000

// Only the endpoints this app uses are open. Better Auth ships many more (update-user, set role,
// remove user, impersonate, list or revoke sessions, change email, password reset...), and several
// of them skip the validation and the last-admin protection in src/server/users.ts. A list of what
// is closed would miss the next one a Better Auth upgrade or plugin adds; a list of what is open
// cannot. Everything else is done through server actions.
const ALLOWED = new Set([SIGN_IN, CHANGE_PASSWORD, '/api/auth/sign-out', '/api/auth/get-session'])

async function handle(request: Request) {
  const { pathname } = new URL(request.url)
  if (!ALLOWED.has(pathname)) return new Response('Not found', { status: 404 })

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
