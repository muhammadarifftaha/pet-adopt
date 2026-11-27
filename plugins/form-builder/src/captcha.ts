// Spam protection for public forms (agreed with the owner): a captcha from one of four services, with
// the owner's own keys, checked on the server before an answer is stored. Settings live in the
// plugin's own table (schema: `settings`, one row). Forms are only protected while it is switched
// on AND the saved keys passed "Check these keys" (a typo must not break every form); changing a
// key clears that check. When the service cannot be reached, the answer is refused with an
// explanation (agreed: safest against spam).
import { host, UserError, ValidationError } from '@pet-adopt/plugin-sdk'
import { eq } from 'drizzle-orm'

import { CAPTCHA_INFO, isCaptchaProvider, type CaptchaProvider, type PublicCaptcha } from './captcha-providers'
import { openFormsDatabase } from './storage'

const SETTINGS_ID = 1
const SECRET_PURPOSE = 'form-builder:captcha'
/** Keys are short printable strings; anything else is a paste mistake. */
const KEY_PATTERN = /^[A-Za-z0-9_\-.]{10,200}$/
/** Tokens are long but bounded (Turnstile: 2048). */
const MAX_TOKEN = 8192
const VERIFY_TIMEOUT_MS = 8000
export const MIN_SCORES = [30, 50, 70] as const

const VERIFY_URL: Record<CaptchaProvider, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  'recaptcha-v3': 'https://www.google.com/recaptcha/api/siteverify',
  'recaptcha-v2': 'https://www.google.com/recaptcha/api/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
}

/** For the settings screen. The secret never leaves the server: only whether one is saved. */
export type CaptchaSettingsView = {
  provider: CaptchaProvider | null
  siteKey: string
  secretSet: boolean
  /** Saved but cannot be opened (the site's secret changed): it must be typed again. */
  secretUnreadable: boolean
  minScore: number
  enabled: boolean
  checkedAt: Date | null
  /** Forms are protected right now. */
  active: boolean
}

async function readRow() {
  const { db, t } = await openFormsDatabase()
  const [row] = await db.select().from(t.settings).where(eq(t.settings.id, SETTINGS_ID)).limit(1)
  return row ?? null
}

export async function getCaptchaSettings(): Promise<CaptchaSettingsView> {
  const row = await readRow()
  const provider = isCaptchaProvider(row?.captchaProvider) ? row.captchaProvider : null
  const secret = row?.captchaSecretEncrypted ? host().secrets.open(row.captchaSecretEncrypted, SECRET_PURPOSE) : null
  const view = {
    provider,
    siteKey: row?.captchaSiteKey ?? '',
    secretSet: Boolean(row?.captchaSecretEncrypted),
    secretUnreadable: Boolean(row?.captchaSecretEncrypted) && secret === null,
    minScore: row?.captchaMinScore ?? 50,
    enabled: row?.captchaEnabled ?? false,
    checkedAt: row?.captchaCheckedAt ?? null,
  }
  return { ...view, active: Boolean(view.enabled && view.checkedAt && provider && view.siteKey && secret) }
}

/** What visitors' browsers need, or null while forms are not protected. */
export async function publicCaptcha(): Promise<PublicCaptcha | null> {
  const view = await getCaptchaSettings()
  return view.active && view.provider ? { provider: view.provider, siteKey: view.siteKey } : null
}

/**
 * Saves the settings. A blank secret keeps the saved one; `clearSecret` removes it. A new provider,
 * site key or secret clears the check (and so turns protection off until the keys are checked).
 * Switching it on needs checked keys.
 */
export async function saveCaptchaSettings(raw: unknown): Promise<CaptchaSettingsView> {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const errors: Record<string, string> = {}
  const provider = input.provider === null || input.provider === '' ? null : isCaptchaProvider(input.provider) ? input.provider : undefined
  if (provider === undefined) errors.provider = 'Choose one of the listed services.'
  const siteKey = typeof input.siteKey === 'string' ? input.siteKey.trim() : ''
  const secret = typeof input.secret === 'string' ? input.secret.trim() : ''
  const clearSecret = input.clearSecret === true
  const minScore = MIN_SCORES.includes(input.minScore as (typeof MIN_SCORES)[number]) ? (input.minScore as number) : 50
  if (provider && !KEY_PATTERN.test(siteKey)) errors.siteKey = siteKey ? 'That does not look like a site key: copy it again from the service.' : 'Enter the site key.'
  if (secret && !KEY_PATTERN.test(secret)) errors.secret = 'That does not look like a secret key: copy it again from the service.'

  const before = await readRow()
  const hasSecret = secret ? true : clearSecret ? false : Boolean(before?.captchaSecretEncrypted)
  if (provider && !hasSecret) errors.secret = 'Enter the secret key.'
  if (Object.keys(errors).length) throw new ValidationError(errors)

  const keysChanged = provider !== (before?.captchaProvider ?? null) || siteKey !== (before?.captchaSiteKey ?? '') || Boolean(secret) || clearSecret
  const checkedAt = keysChanged ? null : (before?.captchaCheckedAt ?? null)
  // New keys always switch protection off until they are checked; unchanged keys can only be
  // switched on once they were.
  const enabled = provider && !keysChanged ? input.enabled === true : false
  if (enabled && !checkedAt) throw new ValidationError({ enabled: 'Check the keys first: forms are only protected with keys that work.' })

  const values = {
    captchaProvider: provider,
    captchaSiteKey: provider ? siteKey : null,
    captchaSecretEncrypted: !provider || clearSecret ? null : secret ? host().secrets.seal(secret, SECRET_PURPOSE) : (before?.captchaSecretEncrypted ?? null),
    captchaMinScore: minScore,
    captchaEnabled: enabled,
    captchaCheckedAt: checkedAt,
    updatedAt: new Date(),
  }
  const { db, t } = await openFormsDatabase()
  await db.insert(t.settings).values({ id: SETTINGS_ID, ...values }).onConflictDoUpdate({ target: t.settings.id, set: values })
  return getCaptchaSettings()
}

export type VerifyOutcome = 'ok' | 'failed' | 'unavailable'
type FetchLike = (url: string, init: { method: string; body: URLSearchParams; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>

let fetchImpl: FetchLike = (url, init) => fetch(url, init)
/** check:backend only: answers the services' verify calls without the network. */
export function setCaptchaFetchForChecks(fn: FetchLike | null): void {
  fetchImpl = fn ?? ((url, init) => fetch(url, init))
}

/**
 * Asks the service whether `token` (from the visitor's widget) is good. reCAPTCHA v3 also needs the
 * `submit` action and a score at or above the minimum. `unavailable`: the service could not be
 * reached or answered nonsense.
 */
export async function verifyCaptchaToken(
  settings: { provider: CaptchaProvider; siteKey: string; secret: string; minScore: number },
  token: unknown,
  client: string | null,
): Promise<VerifyOutcome> {
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN) return 'failed'
  const body = new URLSearchParams({ secret: settings.secret, response: token })
  if (client) body.set('remoteip', client)
  if (settings.provider === 'hcaptcha') body.set('sitekey', settings.siteKey)
  let answer: Record<string, unknown>
  try {
    const response = await fetchImpl(VERIFY_URL[settings.provider], { method: 'POST', body, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) })
    if (!response.ok) return 'unavailable'
    const json = await response.json()
    if (!json || typeof json !== 'object') return 'unavailable'
    answer = json as Record<string, unknown>
  } catch (error) {
    host().logError(error, `captcha: ${CAPTCHA_INFO[settings.provider].label} could not be reached`)
    return 'unavailable'
  }
  if (answer.success !== true) return 'failed'
  if (settings.provider === 'recaptcha-v3') {
    const score = typeof answer.score === 'number' ? answer.score : -1
    if (answer.action !== 'submit' || score * 100 < settings.minScore) return 'failed'
  }
  return 'ok'
}

/** The saved keys, opened, or null when they are incomplete or cannot be opened. */
async function savedKeys() {
  const row = await readRow()
  if (!row || !isCaptchaProvider(row.captchaProvider) || !row.captchaSiteKey) return null
  const secret = row.captchaSecretEncrypted ? host().secrets.open(row.captchaSecretEncrypted, SECRET_PURPOSE) : null
  if (!secret) return null
  return { row, keys: { provider: row.captchaProvider, siteKey: row.captchaSiteKey, secret, minScore: row.captchaMinScore } }
}

/** "Check these keys": a token from the widget on the settings screen, verified with the saved secret. */
export async function checkCaptchaKeys(token: unknown, client: string | null): Promise<CaptchaSettingsView> {
  const saved = await savedKeys()
  if (!saved) throw new UserError('Save a service, its site key and its secret key first.')
  const outcome = await verifyCaptchaToken(saved.keys, token, client)
  if (outcome === 'unavailable') throw new UserError(`${CAPTCHA_INFO[saved.keys.provider].label} could not be reached. Try again in a moment.`)
  if (outcome === 'failed')
    throw new UserError('The keys did not pass: check that the secret key belongs to this site key, and that this site’s domain is allowed in the service’s settings.')
  const { db, t } = await openFormsDatabase()
  await db.update(t.settings).set({ captchaCheckedAt: new Date(), updatedAt: new Date() }).where(eq(t.settings.id, SETTINGS_ID))
  return getCaptchaSettings()
}

export const CAPTCHA_FAILED = 'The spam check did not pass. Please try it again, then send the form.'
export const CAPTCHA_UNAVAILABLE =
  'We could not check that you are not a robot just now, so nothing was sent. Please try again in a moment, or contact us another way.'

/**
 * For a visitor's answer: nothing to do while forms are not protected; otherwise the token must
 * pass. Throws a UserError the visitor sees when it does not.
 */
export async function requireCaptcha(token: unknown, client: string | null): Promise<void> {
  const view = await getCaptchaSettings()
  // Switched on and checked, yet not usable (the saved secret no longer opens, for example after
  // the site's own secret was changed): refuse, like an unreachable service, instead of quietly
  // letting everything through. The Spam protection screen says what to do.
  const broken = view.enabled && Boolean(view.checkedAt) && !view.active
  if (broken) throw new UserError(CAPTCHA_UNAVAILABLE)
  if (!view.active) return
  const saved = await savedKeys()
  if (!saved) throw new UserError(CAPTCHA_UNAVAILABLE)
  const outcome = await verifyCaptchaToken(saved.keys, token, client)
  if (outcome === 'unavailable') throw new UserError(CAPTCHA_UNAVAILABLE)
  if (outcome === 'failed') throw new UserError(CAPTCHA_FAILED)
}
