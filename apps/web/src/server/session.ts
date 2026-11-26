// Who is signed in. Every server action starts with requirePermission(...), or requireUser() for a
// person's own account. What each role may do is the table in the plugin SDK (`can`).
import { asRole, can, ROLE_INFO, type Permission } from '@pet-adopt/plugin-sdk'
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
  return { id, email, name, role: asRole(role) }
})

/** Anyone signed in, whatever their role. Only for a person's own account (name, password). */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) throw new UserError('You need to be signed in.')
  return user
}

/** The signed-in person, if their role has `permission`; a UserError that says why otherwise. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser()
  if (can(user.role, permission)) return user
  const role = ROLE_INFO[user.role].label
  if (permission === 'personalData:export' || permission === 'activity:export') throw new UserError(`Your role (${role}) cannot download this.`)
  const [area] = permission.split(':') as [string]
  // Say "view only" when they can see it but not do this, so the message matches the screen.
  const viewOnly = permission !== `${area}:view` && can(user.role, `${area}:view` as Permission)
  throw new UserError(viewOnly ? `Your role (${role}) can view this but not change it.` : `Your role (${role}) does not have access to this.`)
}
