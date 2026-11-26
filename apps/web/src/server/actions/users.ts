'use server'

import { run, UserError, type ActionResult } from '../result'
import { requirePermission } from '../session'
import { createUser, deleteUser, listUsers, resetPassword, updateUser, type UserListItem } from '../users'

// Everything here is for admins. Editors change only their own name and password
// (updateProfileAction and changePasswordAction in ./auth).

/** User ids are random strings made by Better Auth. Anything that cannot be one is simply not found. */
const userId = (value: unknown): string => {
  if (typeof value !== 'string' || !value || value.length > 64) throw new UserError('User not found.')
  return value
}

export async function listUsersAction(): Promise<ActionResult<UserListItem[]>> {
  return run(async () => {
    await requirePermission('users:view')
    return listUsers()
  })
}

/** `{ email, name, password, role }`. The very first account is always made an admin. */
export async function createUserAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    await requirePermission('users:edit')
    return createUser(input)
  })
}

/** `{ name, role }`. Refuses to demote the last admin. */
export async function updateUserAction(id: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    await requirePermission('users:edit')
    await updateUser(userId(id), input, { canChangeRole: true })
  })
}

/** `{ password }`. Signs that person out everywhere. */
export async function resetUserPasswordAction(id: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    await requirePermission('users:edit')
    await resetPassword(userId(id), input)
  })
}

/** Refuses to delete the last admin. */
export async function deleteUserAction(id: string): Promise<ActionResult> {
  return run(async () => {
    await requirePermission('users:edit')
    await deleteUser(userId(id))
  })
}
