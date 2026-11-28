'use server'

import { ROLE_INFO } from '@pet-adopt/plugin-sdk'

import { quoted, recordActivity, type Actor } from '../activity'
import { removeAvatar } from '../avatars'
import { cancelEmailChange, sendEmailChangeNotice } from '../email-change'
import { sendInvite, type InviteResult } from '../invites'
import { run, UserError, type ActionResult } from '../result'
import { requirePermission } from '../session'
import { archiveUser, createUser, deleteUser, listUsers, resetPassword, restoreUser, updateUser, type UserListItem } from '../users'

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

/**
 * `{ email, name, role, invite: true }` (the default on the screen: an email invite, the person
 * chooses their password) or `{ email, name, role, password }`. The very first account is always
 * made an admin. With an invite, `invite` says whether the email went out and carries the link to
 * copy when it did not.
 */
export async function createUserAction(input: unknown): Promise<ActionResult<{ id: string; invite: InviteResult | null }>> {
  return run(async () => {
    const actor = await requirePermission('users:edit')
    const created = await createUser(input)
    const user = await findUser(created.id)
    await record(actor, 'user.create', user, created.id, `Added the account ${quoted(user?.name)} as ${user ? ROLE_INFO[user.role].label : 'unknown role'}`)
    if (!user?.invited) return { id: created.id, invite: null }
    const invite = await sendInvite(created.id, actor.name)
    await record(actor, 'user.invite', user, created.id, inviteSummary(user.name, invite))
    return { id: created.id, invite }
  })
}

const inviteSummary = (name: string, invite: InviteResult) =>
  invite.sent ? `Emailed an invite to ${quoted(name)}` : `Made an invite link for ${quoted(name)} (not emailed: ${invite.problem ?? 'no email'})`

/** A new invite for someone who has not accepted yet; the older link stops working. */
export async function resendInviteAction(id: string): Promise<ActionResult<InviteResult>> {
  return run(async () => {
    const actor = await requirePermission('users:edit')
    const target = userId(id)
    const user = await findUser(target)
    if (!user) throw new UserError('User not found.')
    if (!user.invited) throw new UserError('They already have a password. Use Reset link instead.')
    const invite = await sendInvite(target, actor.name)
    await record(actor, 'user.invite', user, target, inviteSummary(user.name, invite))
    return invite
  })
}

/**
 * `{ name, role, email }`. Refuses to demote the last admin. A new email takes effect at once (agreed
 * with the owner): both addresses get a notice, a pending change the person asked for is cancelled,
 * and a pending invite goes to the new address.
 *
 * After an email change, `noticesSent` says how many of the two notices went out, and `invite` is
 * the new invite of an account still waiting for one: when it was not emailed, its link is the only
 * one that works (the old one was cancelled), so the screen shows it to copy, as after Add user.
 */
export async function updateUserAction(id: string, input: unknown): Promise<ActionResult<UpdateUserOutcome>> {
  return run(async () => {
    const actor = await requirePermission('users:edit')
    const target = userId(id)
    const before = await findUser(target)
    const { email } = await updateUser(target, input, { canChangeRole: true })
    const after = await findUser(target)
    const outcome: UpdateUserOutcome = { invite: null, noticesSent: null }
    const fields = [before?.name !== after?.name && 'name', before?.role !== after?.role && 'role', email && 'email'].filter((field): field is string => Boolean(field))
    if (!fields.length) return outcome
    // Roles are not personal data, and who was given which role is what an audit looks for. Email
    // addresses are personal data: the entry names the field only.
    const role = before && after && before.role !== after.role ? ` (role: ${ROLE_INFO[before.role].label} to ${ROLE_INFO[after.role].label})` : ''
    await record(actor, 'user.update', after, target, `Updated the account ${quoted(after?.name)}${role}`, fields)
    if (email && after) {
      await cancelEmailChange(target)
      outcome.noticesSent = await sendEmailChangeNotice(after, email, actor.name, [email.from, email.to])
      if (after.invited) {
        outcome.invite = await sendInvite(target, actor.name)
        await record(actor, 'user.invite', after, target, inviteSummary(after.name, outcome.invite))
      }
    }
    return outcome
  })
}

/** What Edit tells the screen: see updateUserAction. `noticesSent` is null when the email stayed. */
export type UpdateUserOutcome = { invite: InviteResult | null; noticesSent: number | null }

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

/**
 * Archives an account: it cannot sign in and is signed out everywhere; its name stays on what it
 * made. Not your own account, and not the last active admin.
 */
export async function archiveUserAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const actor = await requirePermission('users:edit')
    const target = userId(id)
    await archiveUser(target, { by: actor.id })
    const user = await findUser(target)
    await record(actor, 'user.archive', user, target, `Archived the account ${quoted(user?.name)} (signed out everywhere, cannot sign in)`)
  })
}

/** Brings an archived account back as it was. */
export async function restoreUserAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const actor = await requirePermission('users:edit')
    const target = userId(id)
    await restoreUser(target)
    const user = await findUser(target)
    await record(actor, 'user.restore', user, target, `Restored the archived account ${quoted(user?.name)}`)
  })
}

/**
 * Deletes an archived account for good (archive it first). Its activity entries are anonymised, so
 * this entry names the anonymous label, not the person.
 */
export async function deleteUserAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const actor = await requirePermission('users:edit')
    const target = userId(id)
    const ghost = await deleteUser(target)
    await recordActivity({ actor, action: 'user.delete', area: 'users', summary: `Deleted the account ${quoted(ghost.label)} and anonymised its history`, subject: ghost })
  })
}

/** Removes someone's profile picture (for example an unsuitable one). Admins cannot upload one for them. */
export async function removeUserAvatarAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const actor = await requirePermission('users:edit')
    const target = userId(id)
    const user = await findUser(target)
    if (!user) throw new UserError('User not found.')
    if (await removeAvatar(target)) await record(actor, 'user.avatar', user, target, `Removed the profile picture of ${quoted(user.name)}`)
  })
}
