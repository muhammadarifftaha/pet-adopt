import { getAuth } from '@/server/auth'
import { UserError } from '@/server/result'
import { clearAttempts, guardSignIn } from '@/server/throttle'

export const dynamic = 'force-dynamic'

const SIGN_IN = '/api/auth/sign-in/email'

// Better Auth's own /admin/* endpoints (set role, remove user, impersonate...) are switched off.
// Everything of that kind goes through src/server/users.ts, which keeps the last admin safe.
// Only email sign-in exists, so other /sign-in/* methods are closed too.
async function handle(request: Request) {
  const { pathname } = new URL(request.url)
  if (pathname.startsWith('/api/auth/admin/') || (pathname.startsWith('/api/auth/sign-in/') && pathname !== SIGN_IN)) {
    return new Response('Not found', { status: 404 })
  }

  const auth = await getAuth()

  // Email sign-in gets the same per-account and per-client lockout as the server action, so the
  // HTTP route cannot be used to guess passwords around it.
  if (request.method === 'POST' && pathname === SIGN_IN) {
    let email = ''
    try {
      const body = (await request.clone().json()) as { email?: unknown }
      if (typeof body.email === 'string') email = body.email
    } catch {
      // Not JSON: Better Auth will reject it. It still counts against this client below.
    }
    let accountKey: string
    try {
      ;({ accountKey } = await guardSignIn(email, request.headers))
    } catch (error) {
      if (error instanceof UserError) return Response.json({ message: error.message }, { status: 429 })
      throw error
    }
    const response = await auth.handler(request)
    if (response.ok) await clearAttempts(accountKey)
    return response
  }

  return auth.handler(request)
}

export const GET = handle
export const POST = handle
