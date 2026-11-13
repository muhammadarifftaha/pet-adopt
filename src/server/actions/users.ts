'use server'

import { run, type ActionResult } from '../result'
import { requireAdmin } from '../session'
import { createUser, deleteUser, listUsers, resetPassword, updateUser, type UserListItem } from '../users'

// Everything here is for admins. Editors change only their own name and password
// (updateProfileAction and changePasswordAction in ./auth).

export async function listUsersAction(): Promise<ActionResult<UserListItem[]>> {
  return run(async () => {
    await requireAdmin()
    return listUsers()
  })
}

/** `{ email, name, password, role }`. The very first account is always made an admin. */
export async function createUserAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    await requireAdmin()
    return createUser(input)
  })
}

/** `{ name, role }`. Refuses to demote the last admin. */
export async function updateUserAction(id: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    await requireAdmin()
    await updateUser(id, input, { canChangeRole: true })
  })
}

/** `{ password }`. Signs that person out everywhere. */
export async function resetUserPasswordAction(id: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    await requireAdmin()
    await resetPassword(id, input)
  })
}

/** Refuses to delete the last admin. */
export async function deleteUserAction(id: string): Promise<ActionResult> {
  return run(async () => {
    await requireAdmin()
    await deleteUser(id)
  })
}
