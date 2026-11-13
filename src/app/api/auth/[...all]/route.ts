import { getAuth } from '@/server/auth'

export const dynamic = 'force-dynamic'

// Better Auth's own /admin/* endpoints (set role, remove user, impersonate...) are switched off.
// Everything of that kind goes through src/server/users.ts, which keeps the last admin safe.
async function handle(request: Request) {
  if (new URL(request.url).pathname.startsWith('/api/auth/admin/')) {
    return new Response('Not found', { status: 404 })
  }
  return (await getAuth()).handler(request)
}

export const GET = handle
export const POST = handle
