import { definePlugin, type EmailMessage } from '@pet-adopt/plugin-sdk'

// Sends the site's email through Resend (https://resend.com) with one HTTP call, so no extra
// package is needed. Register it in `pet-adopt.config.ts`:
//
//   resendEmail({ from: 'Pet Adopt <no-reply@adopt.example.com>' })
//
// The API key comes from `apiKey` or the RESEND_API_KEY environment variable. The `from` address
// must be on a domain you verified in Resend. Any other provider (SMTP, SES, Postmark...) can be
// added the same way: a plugin with `email: { send }`.

export type ResendOptions = {
  /** Sender, e.g. `Pet Adopt <no-reply@adopt.example.com>`. Defaults to EMAIL_FROM. */
  from?: string
  /** Defaults to RESEND_API_KEY. */
  apiKey?: string
  /** Where replies go, if not the sender. */
  replyTo?: string
}

const ENDPOINT = 'https://api.resend.com/emails'
const TIMEOUT_MS = 10_000

export const resendEmail = definePlugin<ResendOptions | void>((options) => ({
  name: 'resend-email',
  title: 'Email (Resend)',
  description: 'Sends the site’s email, such as password reset links, through Resend.',
  email: {
    // Shown on the plugin's admin page. The key itself is never shown, only whether it is set.
    status() {
      const apiKey = (options?.apiKey ?? process.env.RESEND_API_KEY ?? '').trim()
      const from = (options?.from ?? process.env.EMAIL_FROM ?? '').trim()
      return {
        provider: 'Resend',
        ready: Boolean(apiKey && from),
        details: [
          { label: 'Sender', value: from || 'Not set' },
          { label: 'API key', value: apiKey ? 'Set' : 'Not set' },
          ...(options?.replyTo ? [{ label: 'Replies go to', value: options.replyTo }] : []),
        ],
        setup:
          'Set RESEND_API_KEY and EMAIL_FROM (for example "Pet Adopt <no-reply@adopt.example.com>") in the server’s environment, then restart it. The sender’s domain must be verified in Resend.',
      }
    },
    async send(message: EmailMessage) {
      // Read when sending, not when the config loads, so `next build` works without the secrets.
      const apiKey = (options?.apiKey ?? process.env.RESEND_API_KEY ?? '').trim()
      const from = (options?.from ?? process.env.EMAIL_FROM ?? '').trim()
      if (!apiKey) throw new Error('Resend: set RESEND_API_KEY (or pass apiKey).')
      if (!from) throw new Error('Resend: set EMAIL_FROM (or pass from).')

      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          ...(options?.replyTo ? { reply_to: options.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) {
        // Resend explains the problem in `message` (unverified domain, bad key...). The recipient
        // and the email itself are left out of the error, which ends up in the server log.
        const detail = await response
          .json()
          .then((body: { message?: unknown }) => (typeof body?.message === 'string' ? body.message : ''))
          .catch(() => '')
        throw new Error(`Resend refused the email (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`)
      }
    },
  },
}))
