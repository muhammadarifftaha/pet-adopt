'use server'

import { getSettings } from '@/lib/queries'
import { getEmailSender } from '@/plugins/registry'

import { describeError, run, UserError, ValidationError, type ActionResult } from '../result'
import { requirePermission } from '../session'
import { consumeAttempt } from '../throttle'

// The email plugin page's "Send a test email". Admins only, a few per admin at a time (the same
// counter table as sign-in), and the message names nothing private: just the site and who sent it.

const TEST_EMAIL_RULE = { max: 5, windowMs: 15 * 60 * 1000 }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function sendTestEmailAction(to: string): Promise<ActionResult<{ to: string }>> {
  return run(async () => {
    const user = await requirePermission('plugins:edit')
    const address = typeof to === 'string' ? to.trim() : ''
    if (!address || address.length > 254 || !EMAIL.test(address)) throw new ValidationError({ to: 'Enter an email address, like name@example.com.' })

    const sender = getEmailSender()
    if (!sender) throw new UserError('Email is not set up yet, so nothing can be sent. Finish the setup above first.')
    await consumeAttempt(`emailtest:${user.id}`, TEST_EMAIL_RULE)

    const { siteName } = await getSettings()
    try {
      await sender.send({
        to: address,
        subject: `Test email from ${siteName}`,
        text: `This is a test email from ${siteName}, sent by ${user.name} from the admin. If you can read it, the site can send email (for example password reset links).`,
      })
    } catch (error) {
      // The provider's own explanation (unverified domain, bad key...) helps the admin fix it.
      throw new UserError(`The email was not sent. ${describeError(error)}`)
    }
    return { to: address }
  })
}
