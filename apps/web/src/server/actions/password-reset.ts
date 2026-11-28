'use server'

import { headers } from 'next/headers'
import { after } from 'next/server'


import { acceptInvite } from '../invites'
import { createResetLink, prepareResetEmail, resetPasswordWithToken } from '../password-reset'
import { quoted, recordActivity } from '../activity'
import { getEmailSender } from '../email'
import { run, UserError, type ActionResult } from '../result'
import { requirePermission } from '../session'
import { guardLinkUse } from '../throttle'
import { listUsers } from '../users'

// The first three are for people who are signed out, so they check nothing about a session. Their
// protection is in ../password-reset.ts and ../invites.ts: request limits, one-time hashed tokens
// checked before any password is hashed, a per-client limit on using links (guardLinkUse), and the
// same answer whether or not an account exists.

/**
 * `{ email }`. Emails a reset link when that address has an account. Always answers the same way,
 * so it cannot be used to find out who has an account.
 */
export async function requestPasswordResetAction(input: { email: string }): Promise<ActionResult> {
  return run(async () => {
    const sender = await getEmailSender()
    if (!sender) throw new UserError('This site cannot send email. Ask an admin for a reset link.')
    const job = await prepareResetEmail(input?.email, await headers(), sender)
    // After the response: finding the account and sending take time only when it exists.
    after(job)
  })
}

/** `{ token, password }` from the reset page. Signs that person out everywhere. */
export async function resetPasswordWithTokenAction(input: { token: string; password: string }): Promise<ActionResult> {
  return run(async () => {
    await guardLinkUse(await headers())
    const user = await resetPasswordWithToken(input)
    // Nobody is signed in: the link proved who they are, so the entry is theirs.
    await recordActivity({
      actor: user,
      action: 'auth.password-reset',
      area: 'account',
      summary: 'Set a new password with a reset link (signed out everywhere)',
      subject: { id: user.id, label: user.name },
    })
  })
}

/** `{ token, password }` from an invite link (/admin/invite): they choose their first password. */
export async function acceptInviteAction(input: { token: string; password: string }): Promise<ActionResult> {
  return run(async () => {
    await guardLinkUse(await headers())
    const user = await acceptInvite(input)
    // Nobody is signed in: the link proved who they are, so the entry is theirs.
    await recordActivity({ actor: user, action: 'auth.invite-accepted', area: 'account', summary: 'Accepted the invite and chose a password', subject: { id: user.id, label: user.name } })
  })
}

/** Admins: a one-time link for someone who cannot sign in, to share with them however you like. */
export async function createResetLinkAction(userId: string): Promise<ActionResult<{ url: string; expiresAt: Date }>> {
  return run(async () => {
    const actor = await requirePermission('users:edit')
    if (typeof userId !== 'string' || !userId || userId.length > 64) throw new UserError('User not found.')
    const link = await createResetLink(userId)
    const user = (await listUsers()).find((item) => item.id === userId)
    await recordActivity({
      actor,
      action: 'user.reset-link',
      area: 'users',
      summary: `Created a password reset link for ${quoted(user?.name)}`,
      subject: { id: userId, label: user?.name ?? null },
    })
    return link
  })
}
