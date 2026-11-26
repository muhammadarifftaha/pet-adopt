// Email templates (Settings > Email templates, the builder at /edit/email/…) and the one place that
// turns a purpose into a sent email. The format, the blocks and the rules (placeholders per purpose,
// no answers in visitor confirmations) are in src/lib/email-template.ts. Agreed with the owner:
//  - The site's own emails (password reset, test; SYSTEM_PURPOSES) have no library: the built-in
//    template is edited in place (one row per purpose, `is_default` true, created on the first
//    save) and "Restore the original" deletes that row.
//  - Form emails keep a library: named templates, one of them the default, and a form may pick one.
//
// Which template an email uses: the one asked for (forms) if it exists and has that purpose, else
// the purpose's default (for a system email: its edited copy), else the built-in one. So deleting a
// template never stops an email; it falls back.
import { foldText } from '@pet-adopt/plugin-sdk'
import { and, asc, eq, inArray, ne } from 'drizzle-orm'

import { getDatabase } from '@/db/client'
import {
  DEFAULT_TEMPLATES,
  EMAIL_PURPOSES,
  emailThemeFrom,
  isEmailPurpose,
  isSystemPurpose,
  LIBRARY_PURPOSES,
  PURPOSE_INFO,
  renderEmail,
  TEMPLATE_LIMITS,
  validateTemplate,
  type EmailPurpose,
  type RenderContext,
  type RenderedEmail,
  type SystemPurpose,
  type TemplateData,
} from '@/lib/email-template'
import { resolveTheme } from '@/lib/theme'

import { SITE_URL } from './auth'
import { getEmailSender } from './email'
import { asRecord, Fields, UserError, ValidationError } from './result'
import { getSettings } from './settings'

export type EmailTemplateSummary = { id: number; name: string; purpose: EmailPurpose; isDefault: boolean; updatedAt: Date }
export type EmailTemplateRecord = EmailTemplateSummary & { data: TemplateData }

const DEFAULT_LOCK = 'email-templates:default'
const PURPOSE_OPTIONS = LIBRARY_PURPOSES.map((value) => ({ value }))

function toRecord(row: { id: number; name: string; purpose: string; data: unknown; isDefault: boolean; updatedAt: Date }): EmailTemplateRecord | null {
  if (!isEmailPurpose(row.purpose)) return null
  // Stored data was checked on save; a template that no longer passes (the rules changed) falls back.
  const check = validateTemplate(row.data, row.purpose)
  return { id: row.id, name: row.name, purpose: row.purpose, isDefault: row.isDefault, updatedAt: row.updatedAt, data: check.ok ? check.data : DEFAULT_TEMPLATES[row.purpose] }
}

export async function listEmailTemplates(purpose?: EmailPurpose): Promise<EmailTemplateSummary[]> {
  const { db, t } = await getDatabase()
  const rows = await db
    .select({ id: t.emailTemplates.id, name: t.emailTemplates.name, purpose: t.emailTemplates.purpose, isDefault: t.emailTemplates.isDefault, updatedAt: t.emailTemplates.updatedAt })
    .from(t.emailTemplates)
    .where(purpose ? eq(t.emailTemplates.purpose, purpose) : undefined)
    .orderBy(asc(t.emailTemplates.id))
  return rows
    .filter((row): row is typeof row & { purpose: EmailPurpose } => isEmailPurpose(row.purpose))
    .sort((a, b) => EMAIL_PURPOSES.indexOf(a.purpose) - EMAIL_PURPOSES.indexOf(b.purpose) || foldText(a.name).localeCompare(foldText(b.name)))
}

export async function getEmailTemplate(id: number): Promise<EmailTemplateRecord | null> {
  const { db, t } = await getDatabase()
  const [row] = await db.select().from(t.emailTemplates).where(eq(t.emailTemplates.id, id)).limit(1)
  return row ? toRecord(row) : null
}

async function assertNameFree(name: string, exceptId?: number) {
  const folded = foldText(name)
  // Only the library has names people choose; the site's own emails are not in it.
  const others = (await listEmailTemplates()).filter((other) => !isSystemPurpose(other.purpose))
  if (others.some((other) => other.id !== exceptId && foldText(other.name) === folded)) throw new ValidationError({ name: 'Another template already has this name.' })
}

/** `{ name, purpose, fromId? }`: a new template, starting from the built-in one or a copy of `fromId` (same purpose). */
export async function createEmailTemplate(raw: unknown, by: string | null): Promise<{ id: number }> {
  const input = asRecord(raw)
  const f = new Fields(input, true)
  const name = f.requiredText('name', TEMPLATE_LIMITS.name)
  const purpose = f.oneOf('purpose', PURPOSE_OPTIONS, { required: true })
  const fromId = input.fromId === undefined || input.fromId === null ? null : f.id('fromId')
  if (isSystemPurpose(input.purpose)) f.fail_('purpose', 'This email has no library: edit its built-in template instead.')
  f.done()
  await assertNameFree(name as string)
  let data: TemplateData = DEFAULT_TEMPLATES[purpose as EmailPurpose]
  if (fromId) {
    const source = await getEmailTemplate(fromId)
    if (!source) throw new UserError('The template to copy no longer exists.')
    if (source.purpose !== purpose) throw new ValidationError({ purpose: 'A copy keeps the purpose of the template it copies.' })
    data = source.data
  }
  const { db, t } = await getDatabase()
  const [row] = await db
    .insert(t.emailTemplates)
    .values({ name: name as string, purpose: purpose as EmailPurpose, data, isDefault: false, createdBy: by })
    .returning({ id: t.emailTemplates.id })
  return { id: row.id }
}

/** One field error per problem in a layout: `template.0`, `template.1`… */
const layoutErrors = (errors: string[]) => new ValidationError(Object.fromEntries(errors.map((error, index) => [`template.${index}`, error])))

/** Saves the builder: `{ name?, data? }`. The data is checked for the template's purpose and stored as the clean copy. */
export async function saveEmailTemplate(id: number, raw: unknown): Promise<EmailTemplateRecord> {
  const input = asRecord(raw)
  const current = await getEmailTemplate(id)
  if (!current || isSystemPurpose(current.purpose)) throw new UserError('This template no longer exists.')
  const f = new Fields(input)
  const name = f.text('name', TEMPLATE_LIMITS.name)
  if (name === null) f.fail_('name', 'Give the template a name.')
  f.done()
  if (name) await assertNameFree(name, id)
  const update: { name?: string; data?: TemplateData; updatedAt: Date } = { updatedAt: new Date() }
  if (name) update.name = name
  if (input.data !== undefined) {
    const check = validateTemplate(input.data, current.purpose)
    if (!check.ok) throw layoutErrors(check.errors)
    update.data = check.data
  }
  const { db, t } = await getDatabase()
  await db.update(t.emailTemplates).set(update).where(eq(t.emailTemplates.id, id))
  return (await getEmailTemplate(id)) as EmailTemplateRecord
}

/** Makes this template its purpose's default (`true`), or stops it being one (`false`: the built-in one is used). */
export async function setDefaultEmailTemplate(id: number, isDefault: boolean): Promise<void> {
  const { t, withTransaction } = await getDatabase()
  await withTransaction(
    async (tx) => {
      const [row] = await tx.select({ purpose: t.emailTemplates.purpose }).from(t.emailTemplates).where(eq(t.emailTemplates.id, id)).limit(1)
      if (!row || isSystemPurpose(row.purpose)) throw new UserError('This template no longer exists.')
      if (isDefault) await tx.update(t.emailTemplates).set({ isDefault: false }).where(and(eq(t.emailTemplates.purpose, row.purpose), ne(t.emailTemplates.id, id)))
      await tx.update(t.emailTemplates).set({ isDefault }).where(eq(t.emailTemplates.id, id))
    },
    { lock: DEFAULT_LOCK },
  )
}

/** Deletes a template. Emails and forms that used it fall back to the default, then the built-in one. */
export async function deleteEmailTemplate(id: number): Promise<void> {
  const { db, t } = await getDatabase()
  const removed = await db
    .delete(t.emailTemplates)
    .where(and(eq(t.emailTemplates.id, id), inArray(t.emailTemplates.purpose, [...LIBRARY_PURPOSES])))
    .returning({ id: t.emailTemplates.id })
  if (!removed.length) throw new UserError('This template no longer exists.')
}

// --- The site's own emails (edited in place) -----------------------------------------------------

export type SystemEmail = { purpose: SystemPurpose; data: TemplateData; customised: boolean; updatedAt: Date | null }

async function systemRow(purpose: SystemPurpose) {
  const { db, t } = await getDatabase()
  const [row] = await db.select().from(t.emailTemplates).where(eq(t.emailTemplates.purpose, purpose)).orderBy(asc(t.emailTemplates.id)).limit(1)
  return row ?? null
}

/** The email as it is sent now: the edited copy, or the built-in template. */
export async function getSystemEmail(purpose: SystemPurpose): Promise<SystemEmail> {
  const row = await systemRow(purpose)
  const record = row ? toRecord(row) : null
  return record ? { purpose, data: record.data, customised: true, updatedAt: record.updatedAt } : { purpose, data: DEFAULT_TEMPLATES[purpose], customised: false, updatedAt: null }
}

/** Saves the edited email (checked like any template). The first save creates its row. */
export async function saveSystemEmail(purpose: SystemPurpose, raw: unknown, by: string | null): Promise<SystemEmail> {
  const check = validateTemplate(raw, purpose)
  if (!check.ok) throw layoutErrors(check.errors)
  const { t, withTransaction } = await getDatabase()
  await withTransaction(
    async (tx) => {
      const [row] = await tx.select({ id: t.emailTemplates.id }).from(t.emailTemplates).where(eq(t.emailTemplates.purpose, purpose)).limit(1)
      if (row) await tx.update(t.emailTemplates).set({ data: check.data, isDefault: true, updatedAt: new Date() }).where(eq(t.emailTemplates.id, row.id))
      else await tx.insert(t.emailTemplates).values({ name: PURPOSE_INFO[purpose].label, purpose, data: check.data, isDefault: true, createdBy: by })
    },
    { lock: DEFAULT_LOCK },
  )
  return getSystemEmail(purpose)
}

/** "Restore the original": forgets the edits, so the built-in template is sent again. Returns whether there were edits. */
export async function restoreSystemEmail(purpose: SystemPurpose): Promise<boolean> {
  const { db, t } = await getDatabase()
  const removed = await db.delete(t.emailTemplates).where(eq(t.emailTemplates.purpose, purpose)).returning({ id: t.emailTemplates.id })
  return removed.length > 0
}

// --- Rendering and sending ----------------------------------------------------------------------

/** The template an email of `purpose` uses (see the top of this file). */
export async function pickTemplate(purpose: EmailPurpose, templateId?: number | null): Promise<{ data: TemplateData; templateId: number | null }> {
  if (templateId) {
    const chosen = await getEmailTemplate(templateId)
    if (chosen && chosen.purpose === purpose) return { data: chosen.data, templateId: chosen.id }
  }
  const { db, t } = await getDatabase()
  const [row] = await db
    .select()
    .from(t.emailTemplates)
    .where(and(eq(t.emailTemplates.purpose, purpose), eq(t.emailTemplates.isDefault, true)))
    .limit(1)
  const record = row ? toRecord(row) : null
  return record ? { data: record.data, templateId: record.id } : { data: DEFAULT_TEMPLATES[purpose], templateId: null }
}

/** Theme, logo, site name and address for rendering. `values` are the purpose's own placeholders. */
export async function emailContext(values: Record<string, string>, extra: Partial<RenderContext> = {}): Promise<RenderContext> {
  const settings = await getSettings()
  const theme = resolveTheme(settings)
  return {
    values: { siteName: settings.siteName || 'Pet Adopt', siteUrl: SITE_URL, ...values },
    theme: emailThemeFrom(theme.light, theme.shared),
    origin: SITE_URL,
    logo: settings.logo ? { url: settings.logo.url, alt: settings.logo.alt } : null,
    ...extra,
  }
}

/** An email of `purpose`, rendered from its template. Answers are only ever used for team notifications. */
export async function renderPurposeEmail(input: {
  purpose: EmailPurpose
  templateId?: number | null
  values: Record<string, string>
  answers?: Array<{ label: string; value: string }>
}): Promise<RenderedEmail> {
  const { data } = await pickTemplate(input.purpose, input.templateId)
  const answers = PURPOSE_INFO[input.purpose].answers ? input.answers : undefined
  return renderEmail(data, await emailContext(input.values, { answers }))
}

/** Renders and sends. False when the site cannot send email (nothing set up). Throws when sending fails. */
export async function sendPurposeEmail(input: Parameters<typeof renderPurposeEmail>[0] & { to: string }): Promise<boolean> {
  const sender = await getEmailSender()
  if (!sender) return false
  const email = await renderPurposeEmail(input)
  await sender.send({ to: input.to, subject: email.subject, text: email.text, html: email.html })
  return true
}

/** The builder's "Send test": the unsaved layout, checked, filled with sample values. */
export async function renderTemplatePreview(purpose: EmailPurpose, raw: unknown): Promise<RenderedEmail> {
  const check = validateTemplate(raw, purpose)
  if (!check.ok) throw layoutErrors(check.errors)
  const answers = PURPOSE_INFO[purpose].answers
    ? [
        { label: 'Your name', value: 'Sam Lee' },
        { label: 'Message', value: 'This is a sample answer, so you can see how answers look.' },
      ]
    : undefined
  return renderEmail(check.data, await emailContext(PURPOSE_INFO[purpose].sample, { answers }))
}
