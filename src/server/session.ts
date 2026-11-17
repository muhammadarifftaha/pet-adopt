// Who is signed in. Every server action starts with requireUser() or requireAdmin().
import { headers } from 'next/headers'
import { cache } from 'react'

import { getAuth } from './auth'
import { UserError } from './result'
import type { SessionUser } from './types'

/** The signed-in person, or null. Looked up once per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // Read the request headers FIRST. That tells Next this render depends on the request, so during
  // `next build` the page is skipped instead of prerendered. Opening the database before this line
  // made a build with a missing SQLite file fail with SQLITE_CANTOPEN.
  const requestHeaders = await headers()
  const auth = await getAuth()
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session?.user) return null
  const { id, email, name, role } = session.user as { id: string; email: string; name: string; role?: string | null }
  return { id, email, name, role: role === 'admin' ? 'admin' : 'editor' }
})

/** Any signed-in team member (admin or editor): pets, pages and media. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) throw new UserError('You need to be signed in.')
  return user
}

/** Admins only: users and site settings. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser()
  if (user.role !== 'admin') throw new UserError('Only admins can do this.')
  return user
}
