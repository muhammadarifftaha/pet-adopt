'use server'

// Two-factor sign-in (rules in ../two-factor.ts, Better Auth's plugin in ../auth.ts). The code step
// of a sign-in, a person's own setup (Account), and the admin's side (Users): who must use it, and
// turning it off for someone who lost their phone and backup codes.
import { asRole, ROLE_INFO } from '@pet-adopt/plugin-sdk'
import { headers } from 'next/headers'
import QRCode from 'qrcode'

import { quoted, recordActivity } from '../activity'
import { getAuth } from '../auth'
import { authErrorCode, isAuthError } from '../auth-errors'
import { asRecord, logError, run, UserError, ValidationError, type ActionResult } from '../result'
import { requirePermission, requireUser } from '../session'
import { getSettings } from '../settings'
import { clearAttempts, guardPasswordChange } from '../throttle'
import {
  backupCodesLeft,
  forgetPendingSignIn,
  forgetTrustedDevices,
  getTwoFactorRoles,
  pendingSignIn,
  resetTwoFactor,
  roleRequiresTwoFactor,
  saveTwoFactorRoles,
} from '../two-factor'
import { normalizeBackupCode, normalizeTotpCode } from '../two-factor-codes'
import type { Role, SessionUser } from '../types'

export type TwoFactorStatus = {
  enabled: boolean
  /** The person's role must use two-factor, so it cannot be turned off. */
  required: boolean
  /** Unused backup codes, or null when two-factor is off. */
  backupCodesLeft: number | null
}

export type TwoFactorSetup = {
  /** The QR code to scan, as an SVG data URL. */
  qrCode: string
  /** The same secret for typing in by hand, in groups of four. */
  manualKey: string
  /** Ten one-time codes, shown now and never again. */
  backupCodes: string[]
}

const CODE_HINT = 'Enter the 6-digit code from your authenticator app, or one of your backup codes.'

function text(raw: Record<string, unknown>, key: string): string {
  const value = raw[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Runs a Better Auth call that checks the person's own password, limited like a password change
 * (one counter per person, shared with changePasswordAction). A wrong password is a field error.
 */
async function withPassword<T>(user: SessionUser, password: string, call: () => Promise<T>, what: string): Promise<T> {
  if (!password) throw new ValidationError({ password: 'Enter your password.' })
  const { keys } = await guardPasswordChange(user.id)
  try {
    const result = await call()
    await clearAttempts(keys)
    return result
  } catch (error) {
    if (isAuthError(error) && authErrorCode(error) === 'INVALID_PASSWORD') throw new ValidationError({ password: 'That is not your password.' })
    if (isAuthError(error)) {
      logError(error, `${what} failed`)
      throw new UserError('That did not work right now. Reload the page and try again.')
    }
    throw error
  }
}

// --- Signing in ------------------------------------------------------------------------------

/**
 * The second step of a sign-in: `{ code, trustDevice }`, after signInAction answered
 * `{ twoFactor: true }`. Six digits are checked as an authenticator code, anything else as a backup
 * code. A wrong code is a field error (try again, at most 5 per sign-in); an expired or used-up
 * sign-in is a plain error, and the screen goes back to the password.
 */
export async function verifyTwoFactorAction(input: { code: string; trustDevice?: boolean }): Promise<ActionResult<SessionUser>> {
  return run(async () => {
    const raw = asRecord(input)
    const typed = text(raw, 'code').slice(0, 100)
    const trustDevice = raw.trustDevice === true
    const totp = normalizeTotpCode(typed)
    const backup = totp ? null : normalizeBackupCode(typed)
    if (!totp && !backup) throw new ValidationError({ code: typed.trim() ? CODE_HINT : 'Enter the code.' })

    const auth = await getAuth()
    const requestHeaders = await headers()
    try {
      const result = totp
        ? await auth.api.verifyTOTP({ body: { code: totp, trustDevice }, headers: requestHeaders })
        : await auth.api.verifyBackupCode({ body: { code: backup as string, trustDevice }, headers: requestHeaders })
      await forgetPendingSignIn()
      const user = result.user as { id: string; email: string; name: string; role?: string | null }
      const signedIn: SessionUser = { id: user.id, email: user.email, name: user.name, role: asRole(user.role), twoFactorEnabled: true, signInMethod: 'password' }
      let summary = 'Signed in'
      if (backup) summary = `Signed in with a backup code (${(await backupCodesLeft(user.id)) ?? 0} left)`
      await recordActivity({ actor: signedIn, action: 'auth.sign-in', area: 'sign-in', summary })
      return signedIn
    } catch (error) {
      if (!isAuthError(error)) throw error
      const code = authErrorCode(error)
      if (code === 'INVALID_CODE' || code === 'INVALID_BACKUP_CODE') {
        await recordFailedCode()
        throw new ValidationError({ code: totp ? 'That code is not right. Codes change every 30 seconds: use the one showing now.' : 'That backup code is not right, or was already used.' })
      }
      if (code === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE') {
        await recordFailedCode()
        await forgetPendingSignIn()
        throw new UserError('Too many wrong codes. Sign in again.')
      }
      if (code === 'ACCOUNT_TEMPORARILY_LOCKED') {
        await forgetPendingSignIn()
        throw new UserError('Too many wrong codes for this account. Wait 15 minutes, then sign in again.')
      }
      if (code === 'INVALID_TWO_FACTOR_COOKIE') {
        await forgetPendingSignIn()
        throw new UserError('That sign-in has expired (10 minutes). Sign in again.')
      }
      logError(error, 'two-factor code check failed')
      throw new UserError('Could not check the code right now. Sign in again.')
    }
  })
}

/** A wrong code means the password was right: worth a line in the log, against that account. */
async function recordFailedCode() {
  const account = await pendingSignIn().catch(() => null)
  await recordActivity({
    actor: null,
    action: 'auth.two-factor-failed',
    area: 'sign-in',
    summary: account ? `Wrong two-factor code for the account ${quoted(account.name)} (the password was right)` : 'Wrong two-factor code (the password was right)',
    subject: account ? { id: account.id, label: account.name } : null,
  })
}

// --- Your own account --------------------------------------------------------------------------

/** Whether two-factor is on for you, whether your role requires it, and backup codes left. */
export async function getTwoFactorStatusAction(): Promise<ActionResult<TwoFactorStatus>> {
  return run(async () => {
    const user = await requireUser()
    return {
      enabled: user.twoFactorEnabled,
      required: await roleRequiresTwoFactor(user.role),
      backupCodesLeft: user.twoFactorEnabled ? await backupCodesLeft(user.id) : null,
    }
  })
}

/**
 * Step one of setting up: `{ password }`. Returns the QR code, the key to type by hand and the
 * backup codes. Two-factor is not on yet: confirmTwoFactorSetupAction turns it on once a code from
 * the app checks out. Starting again replaces an unfinished setup.
 */
export async function startTwoFactorSetupAction(input: { password: string }): Promise<ActionResult<TwoFactorSetup>> {
  return run(async () => {
    const user = await requireUser()
    if (user.twoFactorEnabled) throw new UserError('Two-factor sign-in is already on.')
    const password = text(asRecord(input), 'password')
    const [auth, requestHeaders, settings] = await Promise.all([getAuth(), headers(), getSettings()])
    const { totpURI, backupCodes } = await withPassword(
      user,
      password,
      async () => {
        const result = await auth.api.enableTwoFactor({ body: { password, issuer: settings.siteName }, headers: requestHeaders })
        if (!('totpURI' in result) || !result.totpURI || !result.backupCodes) throw new UserError('Could not start the setup. Try again.')
        return { totpURI: result.totpURI, backupCodes: result.backupCodes }
      },
      'two-factor setup',
    )
    const svg = await QRCode.toString(totpURI, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 })
    const secret = new URL(totpURI).searchParams.get('secret') ?? ''
    return {
      qrCode: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      manualKey: secret.match(/.{1,4}/g)?.join(' ') ?? secret,
      backupCodes,
    }
  })
}

/** Step two: `{ code }` from the app. Turns two-factor on; other trusted browsers are forgotten. */
export async function confirmTwoFactorSetupAction(input: { code: string }): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser()
    if (user.twoFactorEnabled) return
    const code = normalizeTotpCode(text(asRecord(input), 'code').slice(0, 100))
    if (!code) throw new ValidationError({ code: 'Enter the 6-digit code your app shows.' })
    const auth = await getAuth()
    try {
      await auth.api.verifyTOTP({ body: { code }, headers: await headers() })
    } catch (error) {
      if (isAuthError(error)) {
        const reason = authErrorCode(error)
        if (reason === 'INVALID_CODE') throw new ValidationError({ code: 'That code is not right. Check the time on your phone, and use the code showing now.' })
        if (reason === 'TOTP_NOT_ENABLED') throw new UserError('Start the setup again: it was not found.')
        logError(error, 'two-factor confirmation failed')
        throw new UserError('Could not turn on two-factor right now. Try again.')
      }
      throw error
    }
    await forgetTrustedDevices(user.id)
    await recordActivity({ actor: user, action: 'account.two-factor-on', area: 'account', summary: 'Turned on two-factor sign-in' })
  })
}

/** `{ password }`. Not possible while your role requires two-factor. Forgets trusted browsers. */
export async function disableTwoFactorAction(input: { password: string }): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser()
    if (!user.twoFactorEnabled) return
    if (await roleRequiresTwoFactor(user.role)) {
      throw new UserError(`Your role (${ROLE_INFO[user.role].label}) must use two-factor sign-in, so it cannot be turned off.`)
    }
    const password = text(asRecord(input), 'password')
    const [auth, requestHeaders] = await Promise.all([getAuth(), headers()])
    await withPassword(user, password, () => auth.api.disableTwoFactor({ body: { password }, headers: requestHeaders }), 'turning off two-factor')
    await forgetTrustedDevices(user.id)
    await recordActivity({ actor: user, action: 'account.two-factor-off', area: 'account', summary: 'Turned off two-factor sign-in' })
  })
}

/** `{ password }`. Ten new backup codes; the old ones stop working. */
export async function regenerateBackupCodesAction(input: { password: string }): Promise<ActionResult<{ backupCodes: string[] }>> {
  return run(async () => {
    const user = await requireUser()
    if (!user.twoFactorEnabled) throw new UserError('Turn on two-factor sign-in first.')
    const password = text(asRecord(input), 'password')
    const [auth, requestHeaders] = await Promise.all([getAuth(), headers()])
    const { backupCodes } = await withPassword(user, password, () => auth.api.generateBackupCodes({ body: { password }, headers: requestHeaders }), 'new backup codes')
    await recordActivity({ actor: user, action: 'account.backup-codes', area: 'account', summary: 'Made new two-factor backup codes (the old ones stopped working)' })
    return { backupCodes }
  })
}

// --- Admins ------------------------------------------------------------------------------------

/** The roles that must use two-factor (Users screen). */
export async function getTwoFactorRolesAction(): Promise<ActionResult<Role[]>> {
  return run(async () => {
    await requirePermission('users:view')
    return getTwoFactorRoles()
  })
}

/**
 * `{ roles }`: which roles must use two-factor. People in those roles who have not set it up are
 * asked to at once, including the admin saving this.
 */
export async function saveTwoFactorRolesAction(input: { roles: string[] }): Promise<ActionResult<Role[]>> {
  return run(async () => {
    const actor = await requirePermission('users:edit')
    const { before, after } = await saveTwoFactorRoles(asRecord(input).roles)
    if (before.join() !== after.join()) {
      const list = (roles: Role[]) => (roles.length ? roles.map((role) => ROLE_INFO[role].label).join(', ') : 'none')
      await recordActivity({
        actor,
        action: 'user.two-factor-roles',
        area: 'users',
        summary: `Changed who must use two-factor sign-in (${list(before)} to ${list(after)})`,
        fields: ['twoFactorRoles'],
      })
    }
    return after
  })
}

/**
 * Turns two-factor off for someone else (a lost phone and lost backup codes). Not for yourself:
 * use your Account page, which asks for your password.
 */
export async function resetUserTwoFactorAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const actor = await requirePermission('users:edit')
    if (typeof id !== 'string' || !id || id.length > 64) throw new UserError('User not found.')
    if (id === actor.id) throw new UserError('Turn off your own two-factor sign-in on your Account page.')
    const user = await resetTwoFactor(id)
    if (!user.wasEnabled) return
    await recordActivity({
      actor,
      action: 'user.two-factor-reset',
      area: 'users',
      summary: `Turned off two-factor sign-in for ${quoted(user.name)}`,
      subject: { id: user.id, label: user.name },
    })
  })
}
