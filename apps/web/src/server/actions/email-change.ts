'use server'

// Changing your own email (rules in ../email-change.ts). An admin changes someone else's on the Users
// screen (updateUserAction).
import { asRole } from '@pet-adopt/plugin-sdk'

import { recordActivity } from '../activity'
import { getEmailSender } from '../email'
import { cancelEmailChange, confirmEmailChange, pendingEmailChange, requestEmailChange } from '../email-change'
import { run, type ActionResult } from '../result'
import { requireUser } from '../session'

export type EmailChangeStatus = {
  /** A change you asked for that waits for its confirmation link. */
  pending: { email: string; expiresAt: Date } | null
  /** False when the site cannot send email: then an admin changes it. */
  canChange: boolean
}

export async function getEmailChangeStatusAction(): Promise<ActionResult<EmailChangeStatus>> {
  return run(async () => {
    const user = await requireUser()
    const [pending, sender] = await Promise.all([pendingEmailChange(user.id), getEmailSender()])
    return { pending, canChange: sender !== null }
  })
}

/** `{ email, password }`: emails a confirmation link to the new address and a notice to the old one. */
export async function requestEmailChangeAction(input: { email: string; password: string }): Promise<ActionResult<{ email: string; expiresAt: Date }>> {
  return run(async () => {
    const user = await requireUser()
    const pending = await requestEmailChange(user.id, input)
    // Addresses are personal data: the entry says what happened, not to which address.
    await recordActivity({ actor: user, action: 'account.email-request', area: 'account', summary: 'Asked to change their email (confirmation link sent to the new address)' })
    return pending
  })
}

/** Cancels the change you asked for; its link stops working. */
export async function cancelEmailChangeAction(): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser()
    await cancelEmailChange(user.id)
  })
}

/** `{ token }` from the confirmation page: the account signs in with the new address from now on. */
export async function confirmEmailChangeAction(input: { token: string }): Promise<ActionResult<{ email: string }>> {
  return run(async () => {
    const changed = await confirmEmailChange(input?.token)
    // Possibly signed out (the link proved who they are), so the entry is theirs.
    await recordActivity({
      actor: { id: changed.id, name: changed.name, role: asRole(changed.role) },
      action: 'account.email',
      area: 'account',
      summary: 'Confirmed a new email for signing in',
      subject: { id: changed.id, label: changed.name },
      fields: ['email'],
    })
    return { email: changed.to }
  })
}
