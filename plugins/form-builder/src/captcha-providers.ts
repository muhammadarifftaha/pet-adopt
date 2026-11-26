// The captcha services the form builder supports (agreed with the owner; keys brought by the owner).
// Pure data, shared by the server (src/captcha.ts) and the visitor's widget (src/captcha-widget.tsx).

export const CAPTCHA_PROVIDERS = ['turnstile', 'recaptcha-v3', 'recaptcha-v2', 'hcaptcha'] as const
export type CaptchaProvider = (typeof CAPTCHA_PROVIDERS)[number]

export const isCaptchaProvider = (value: unknown): value is CaptchaProvider => (CAPTCHA_PROVIDERS as readonly unknown[]).includes(value)

/** What a visitor's browser needs: which widget, and the public site key. */
export type PublicCaptcha = { provider: CaptchaProvider; siteKey: string }

export const CAPTCHA_INFO: Record<
  CaptchaProvider,
  {
    label: string
    /** Where an owner makes keys (shown as text on the settings screen). */
    keysAt: string
    /** Shown to the owner: what the visitor sees, and what to know. */
    note: string
    /** Invisible: no widget to fill in; a token is fetched when the form is sent. */
    invisible: boolean
  }
> = {
  turnstile: {
    label: 'Cloudflare Turnstile',
    keysAt: 'https://dash.cloudflare.com/?to=/:account/turnstile',
    note: 'Usually invisible: most visitors see a short check and nothing to solve. No ad tracking. Recommended.',
    invisible: false,
  },
  'recaptcha-v3': {
    label: 'Google reCAPTCHA v3',
    keysAt: 'https://www.google.com/recaptcha/admin',
    note: 'Invisible: Google scores each visitor from 0 (likely a bot) to 1 (likely a person) and forms below your minimum are refused. Shows a small reCAPTCHA badge. Google processes visitors’ data.',
    invisible: true,
  },
  'recaptcha-v2': {
    label: 'Google reCAPTCHA v2 (checkbox)',
    keysAt: 'https://www.google.com/recaptcha/admin',
    note: 'The “I’m not a robot” checkbox, sometimes with picture puzzles, which some disabled visitors find hard. Google processes visitors’ data.',
    invisible: false,
  },
  hcaptcha: {
    label: 'hCaptcha',
    keysAt: 'https://dashboard.hcaptcha.com/sites',
    note: 'A checkbox, sometimes with picture puzzles, which some disabled visitors find hard. Privacy-focused.',
    invisible: false,
  },
}
