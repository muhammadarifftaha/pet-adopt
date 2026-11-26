'use server'

import { ROLE_INFO } from '@pet-adopt/plugin-sdk'

import { quoted, recordActivity, type Actor } from '../activity'
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

async function findUser(id: string): Promise<UserListItem | null> {
  return (await listUsers()).find((user) => user.id === id) ?? null
}

async function record(actor: Actor, action: string, subject: UserListItem | null, id: string, summary: string, fields?: string[]) {
  await recordActivity({ actor, action, area: 'users', summary, subject: { id, label: subject?.name ?? null }, fields })
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
    const actor = await requirePermission('users:edit')
    const created = await createUser(input)
    const user = await findUser(created.id)
    await record(actor, 'user.create', user, created.id, `Added the account ${quoted(user?.name)} as ${user ? ROLE_INFO[user.role].label : 'unknown role'}`)
    return created
  })
}

/** `{ name, role }`. Refuses to demote the last admin. */
export async function updateUserAction(id: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const actor = await requirePermission('users:edit')
    const target = userId(id)
    const before = await findUser(target)
    await updateUser(target, input, { canChangeRole: true })
    const after = await findUser(target)
    const fields = [before?.name !== after?.name && 'name', before?.role !== after?.role && 'role'].filter((field): field is string => Boolean(field))
    if (!fields.length) return
    // Roles are not personal data, and who was given which role is what an audit looks for.
    const role = before && after && before.role !== after.role ? ` (role: ${ROLE_INFO[before.role].label} to ${ROLE_INFO[after.role].label})` : ''
    await record(actor, 'user.update', after, target, `Updated the account ${quoted(after?.name)}${role}`, fields)
  })
}

/** `{ password }`. Signs that person out everywhere. */
export async function resetUserPasswordAction(id: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const actor = await requirePermission('users:edit')
    const target = userId(id)
    await resetPassword(target, input)
    const user = await findUser(target)
    await record(actor, 'user.password', user, target, `Set a new password for ${quoted(user?.name)} and signed them out everywhere`)
  })
}

/** Refuses to delete the last admin. */
export async function deleteUserAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const actor = await requirePermission('users:edit')
    const target = userId(id)
    const before = await findUser(target)
    await deleteUser(target)
    await record(actor, 'user.delete', before, target, `Deleted the account ${quoted(before?.name)}`)
  })
}
