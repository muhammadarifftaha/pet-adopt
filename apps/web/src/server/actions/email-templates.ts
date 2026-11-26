'use server'

import { isEmailPurpose, PURPOSE_INFO, type EmailPurpose } from '@/lib/email-template'

import { quoted, recordActivity, type Actor } from '../activity'
import { getEmailSender } from '../email'
import {
  createEmailTemplate,
  deleteEmailTemplate,
  getEmailTemplate,
  listEmailTemplates,
  renderTemplatePreview,
  saveEmailTemplate,
  setDefaultEmailTemplate,
  type EmailTemplateRecord,
  type EmailTemplateSummary,
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

/** Makes the template its purpose's default (or stops it being one: the built-in template is used). */
export async function setDefaultEmailTemplateAction(id: number, isDefault: boolean): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePermission('settings:edit')
    const templateId = assertId(id)
    await setDefaultEmailTemplate(templateId, isDefault === true)
    const template = await getEmailTemplate(templateId)
    const purpose = template ? PURPOSE_INFO[template.purpose].label : ''
    await record(
      user,
      'email-template.default',
      template,
      templateId,
      isDefault === true ? `Made ${quoted(template?.name)} the template for “${purpose}” emails` : `Stopped using ${quoted(template?.name)} for “${purpose}” emails (the built-in one is used)`,
    )
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
