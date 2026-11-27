// One-time links waiting in the `verifications` table, and cancelling them for one account.
// Whenever an account's credentials are recovered (a password reset or change, an admin's new
// password, a two-factor reset) or its address is changed by an admin, links made before that
// moment must stop working: whoever asked for them may be the person being locked out.
//
// Kept apart from the modules that make the links (password-reset.ts, invites.ts, email-change.ts)
// so the recovery code can call it without importing them (email-change reaches the plugin registry).
import { and, eq, like, or, type SQL } from 'drizzle-orm'

import { getDatabase, type Db, type Schema } from '@/db/client'

import { logError } from './result'

/**
 * `email-change`: a pending change of the sign-in email, or a "confirm your email" link (value is
 * JSON starting with the user id). `password-reset` and `invite`: the value is the user id.
 */
export type PendingLink = 'email-change' | 'password-reset' | 'invite'

/** Deletes the account's pending links of these kinds. Pass the open transaction to join it. */
export async function cancelPendingLinks(tx: Db, t: Schema, userId: string, kinds: readonly PendingLink[]): Promise<void> {
  const matches: SQL[] = []
  for (const kind of kinds) {
    const match =
      kind === 'email-change'
        ? and(like(t.verifications.identifier, 'email-change:%'), like(t.verifications.value, `{"userId":${JSON.stringify(userId)},%`))
        : and(like(t.verifications.identifier, kind === 'invite' ? 'invite:%' : 'pwreset:%'), eq(t.verifications.value, userId))
    if (match) matches.push(match)
  }
  if (matches.length) await tx.delete(t.verifications).where(or(...matches))
}

/**
 * After someone changed their own password: an email change asked for with the old one stops
 * working, and so does a reset link made before the change. Never throws (the password is already
 * changed); a failure is logged.
 */
export async function forgetEmailChange(userId: string): Promise<void> {
  try {
    const { db, t } = await getDatabase()
    await cancelPendingLinks(db, t, userId, ['email-change', 'password-reset'])
  } catch (error) {
    logError(error, 'could not cancel a pending email change after a password change')
  }
}
