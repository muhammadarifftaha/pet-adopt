import { notFound, redirect } from 'next/navigation'

import type { ActionResult } from '@/server/result'
import { getSessionUser } from '@/server/session'
import type { SessionUser } from '@/server/types'

/**
 * For server components: the data of a successful action, or throw so the nearest `error.tsx`
 * shows the message. (Client components handle `ok: false` themselves, with toasts and field errors.)
 */
export function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.data
}

/** Like `unwrap`, for a lookup by id: a missing record becomes the 404 page. */
export function unwrapOrNotFound<T>(result: ActionResult<T | null>): T {
  const data = unwrap(result)
  if (data == null) notFound()
  return data
}

/** Page ids come from the URL. Anything that is not a whole number is a 404. */
export function parseId(value: string): number {
  if (!/^\d{1,10}$/.test(value)) notFound()
  return Number(value)
}

/** Admin-only screens (Settings, Users). Editors are sent back to the dashboard. */
export async function requireAdminPage(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/admin/login')
  if (user.role !== 'admin') redirect('/admin')
  return user
}
