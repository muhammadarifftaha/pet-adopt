'use server'

import { isEmailPurpose, isSystemPurpose, PURPOSE_INFO, type EmailPurpose } from '@/lib/email-template'

import { quoted, recordActivity, type Actor } from '../activity'
import { getEmailSender } from '../email'
import {
  createEmailTemplate,
  deleteEmailTemplate,
  getEmailTemplate,
  listEmailTemplates,
  renderTemplatePreview,
  restoreSeededTemplate,
  restoreSystemEmail,
  saveEmailTemplate,
  saveSystemEmail,
  type EmailTemplateRecord,
  type EmailTemplateSummary,
  type SystemEmail,
} from '../email-templates'
import { assertId, describeError, run, UserError, ValidationError, type ActionResult } from '../result'
import { requirePermission } from '../session'
import { consumeAttempt } from '../throttle'

// Settings > Templates and the email builder. Whoever can change the settings (admins and
// developers) builds templates; audit can look. Every change is in the activity log.

const TEST_RULE = { max: 5, windowMs: 15 * 60 * 1000 }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function record(actor: Actor, action: string, template: { name: string } | null, id: number, summary: string, fields?: string[]) {
  await recordActivity({ actor, action, area: 'settings', summary, subject: { id, label: template?.name ?? null }, fields })
}

export async function listEmailTemplatesAction(): Promise<ActionResult<EmailTemplateSummary[]>> {
  return run(async () => {
    await requirePermission('settings:view')
    return listEmailTemplates()
  })
}

export async function getEmailTemplateAction(id: number): Promise<ActionResult<EmailTemplateRecord | null>> {
  return run(async () => {
    await requirePermission('settings:view')
    return getEmailTemplate(assertId(id))
  })
}

/** `{ name, purpose, fromId? }`. Starts from the built-in template for the purpose, or a copy. */
export async function createEmailTemplateAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  return run(async () => {
    const user = await requirePermission('settings:edit')
    const created = await createEmailTemplate(input, user.id)
    const template = await getEmailTemplate(created.id)
    await record(user, 'email-template.create', template, created.id, `Created the email template ${quoted(template?.name)}${template ? ` (${PURPOSE_INFO[template.purpose].label})` : ''}`)
    return created
  })
}

/** The builder's Save: `{ name?, data? }`. Layout problems come back as field errors `template.N`. */
export async function saveEmailTemplateAction(id: number, input: unknown): Promise<ActionResult<EmailTemplateRecord>> {
  return run(async () => {
    const user = await requirePermission('settings:edit')
    const templateId = assertId(id)
    const before = await getEmailTemplate(templateId)
    const after = await saveEmailTemplate(templateId, input)
    const withoutSubject = (record: EmailTemplateRecord) => JSON.stringify({ ...record.data, root: { props: { ...record.data.root.props, subject: '' } } })
    const fields = before
      ? [
          before.name !== after.name ? 'name' : null,
          before.data.root.props.subject !== after.data.root.props.subject ? 'subject' : null,
          withoutSubject(before) !== withoutSubject(after) ? 'layout' : null,
        ].filter((field): field is string => Boolean(field))
      : []
    if (fields.length) await record(user, 'email-template.update', after, templateId, `Updated the email template ${quoted(after.name)}`, fields)
    return after
  })
}

export async function deleteEmailTemplateAction(id: number): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePermission('settings:edit')
    const templateId = assertId(id)
    const before = await getEmailTemplate(templateId)
    await deleteEmailTemplate(templateId)
    await record(user, 'email-template.delete', before, templateId, `Deleted the email template ${quoted(before?.name)}`)
  })
}

/** Saves the edited copy of one of the site's own emails (password reset, test email). */
export async function saveSystemEmailAction(purpose: string, data: unknown): Promise<ActionResult<SystemEmail>> {
  return run(async () => {
    const user = await requirePermission('settings:edit')
    if (!isSystemPurpose(purpose)) throw new UserError('Unknown email.')
    const saved = await saveSystemEmail(purpose, data, user.id)
    await recordActivity({ actor: user, action: 'email-template.system', area: 'settings', summary: `Edited the “${PURPOSE_INFO[purpose].label}” email`, subject: { id: purpose, label: PURPOSE_INFO[purpose].label } })
    return saved
  })
}

/** "Restore default": the built-in template is sent again. */
export async function restoreSystemEmailAction(purpose: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePermission('settings:edit')
    if (!isSystemPurpose(purpose)) throw new UserError('Unknown email.')
    if (await restoreSystemEmail(purpose)) {
      await recordActivity({ actor: user, action: 'email-template.restore', area: 'settings', summary: `Restored the default “${PURPOSE_INFO[purpose].label}” email`, subject: { id: purpose, label: PURPOSE_INFO[purpose].label } })
    }
  })
}

/** "Restore default" for a plugin's default template: its original layout comes back. */
export async function restoreSeededTemplateAction(id: number): Promise<ActionResult<EmailTemplateRecord>> {
  return run(async () => {
    const user = await requirePermission('settings:edit')
    const templateId = assertId(id)
    const restored = await restoreSeededTemplate(templateId)
    await record(user, 'email-template.restore', restored, templateId, `Restored the default ${quoted(restored.name)} template`)
    return restored
  })
}

/**
 * The builder's "Send test": the layout as it is now (saved or not), filled with sample values, to
 * `to`. Shares the test-email limit (5 per 15 minutes per person).
 */
export async function sendEmailTemplateTestAction(purpose: EmailPurpose, data: unknown, to: string): Promise<ActionResult<{ to: string }>> {
  return run(async () => {
    const user = await requirePermission('settings:edit')
    if (!isEmailPurpose(purpose)) throw new UserError('Unknown kind of email.')
    const address = typeof to === 'string' ? to.trim() : ''
    if (!address || address.length > 254 || !EMAIL.test(address)) throw new ValidationError({ to: 'Enter an email address, like name@example.com.' })
    const email = await renderTemplatePreview(purpose, data)
    const sender = await getEmailSender()
    if (!sender) throw new UserError('Email is not set up yet, so nothing can be sent. Set it up in Settings, Email.')
    await consumeAttempt(`emailtest:${user.id}`, TEST_RULE)
    try {
      await sender.send({ to: address, subject: `[Test] ${email.subject}`, text: email.text, html: email.html })
    } catch (error) {
      throw new UserError(`The email was not sent. ${describeError(error)}`)
    }
    return { to: address }
  })
}
