'use server'


import { recordActivity } from '../activity'
import { renderPurposeEmail } from '../email-templates'
import { getEmailSender, getEmailSettingsView, sendsToLocalServer, saveEmailSettings, type EmailSettingsView } from '../email'
import { describeError, run, UserError, ValidationError, type ActionResult } from '../result'
import { requirePermission } from '../session'
import { consumeAttempt } from '../throttle'

// "Send a test email" (Email > Sending, and an email plugin's page). Whoever can change the settings
// (admins and developers), a few per person at a time (the same counter table as sign-in; no limit
// when the SMTP server is on this machine, such as Mailpit), and the message names nothing private.

const TEST_EMAIL_RULE = { max: 5, windowMs: 15 * 60 * 1000 }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function sendTestEmailAction(to: string): Promise<ActionResult<{ to: string }>> {
  return run(async () => {
    const user = await requirePermission('settings:edit', { unconfirmed: true })
    const address = typeof to === 'string' ? to.trim() : ''
    if (!address || address.length > 254 || !EMAIL.test(address)) throw new ValidationError({ to: 'Enter an email address, like name@example.com.' })

    const sender = await getEmailSender()
    if (!sender) throw new UserError('Email is not set up yet, so nothing can be sent. Save the email settings first.')
    // A mail server on this machine (Mailpit) sends nothing anywhere: no limit there.
    if (!(await sendsToLocalServer())) await consumeAttempt(`emailtest:${user.id}`, TEST_EMAIL_RULE)

    try {
      // Email > Templates: the default "Test email" template, or the built-in one.
      const email = await renderPurposeEmail({ purpose: 'test', values: { senderName: user.name } })
      await sender.send({ to: address, subject: email.subject, text: email.text, html: email.html })
    } catch (error) {
      // The provider's own explanation (unverified domain, bad key...) helps the admin fix it.
      throw new UserError(`The email was not sent. ${describeError(error)}`)
    }
    return { to: address }
  })
}

/** Email > Sending: the SMTP settings in effect, which fields the environment sets, and whether it is ready. Never the password. */
export async function getEmailSettingsAction(): Promise<ActionResult<EmailSettingsView>> {
  return run(async () => {
    await requirePermission('settings:view')
    return getEmailSettingsView()
  })
}

/**
 * `{ host, port, security, username, password?, clearPassword?, fromName, fromAddress, replyTo }`.
 * Leave `password` out (or empty) to keep the saved one. Logged with the names of the fields that
 * changed, never their values.
 */
export async function saveEmailSettingsAction(input: unknown): Promise<ActionResult<EmailSettingsView>> {
  return run(async () => {
    const user = await requirePermission('settings:edit', { unconfirmed: true })
    const { changed } = await saveEmailSettings(input)
    if (changed.length) await recordActivity({ actor: user, action: 'settings.email', area: 'settings', summary: 'Changed the email settings', fields: changed })
    return getEmailSettingsView()
  })
}
