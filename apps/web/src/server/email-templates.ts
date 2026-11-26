// Email templates (Settings > Email templates, the builder at /edit/email/…) and the one place that
// turns a purpose into a sent email. The format, the blocks and the rules (placeholders per purpose,
// nothing a visitor typed in a message to a visitor) are in src/lib/email-template.ts. Agreed with the owner:
//  - The site's own emails (password reset, test; SYSTEM_PURPOSES) have no library: the built-in
//    template is edited in place (one row per purpose, `is_default` true, created on the first
//    save) and "Restore default" deletes that row.
//  - Everything else is a library of templates (team notifications, messages to visitors): as many
//    as people like, used only where something picks one (a form, or any other plugin), so unused
//    templates are fine. Plugins ship default templates (`emailTemplates` on the plugin, seeded at
//    start, `seed_key`): editable and restorable, never deleted, and what that plugin's emails use
//    when nothing else is picked, so its emails always have a template.
//
// Which template an email uses: a system email's edited copy, else the template that was picked (if it
// still exists and has that purpose), else the built-in one. So deleting a template never stops an
// email; it falls back.
import { foldText } from '@pet-adopt/plugin-sdk'
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm'
import { isEqual } from 'es-toolkit'

import { getDatabase } from '@/db/client'
import { getPluginEmailTemplates } from '@/plugins/registry'
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
import { asRecord, Fields, logError, UserError, ValidationError } from './result'
import { getSettings } from './settings'

export type EmailTemplateSummary = {
  id: number
  name: string
  purpose: EmailPurpose
  isDefault: boolean
  updatedAt: Date
  /** A plugin's default template (`<plugin>:<key>`): never deleted, can be restored. */
  seedKey: string | null
  /** Who made it; null for plugin defaults (and accounts deleted since). */
  createdByName: string | null
  /** A plugin default that was changed (so "Restore default" applies). */
  edited: boolean
}
export type EmailTemplateRecord = EmailTemplateSummary & { data: TemplateData }

const SYSTEM_LOCK = 'email-templates:system'
const PURPOSE_OPTIONS = LIBRARY_PURPOSES.map((value) => ({ value }))

/** The layout a plugin default starts from (and Restore default brings back). */
function seedData(seedKey: string): TemplateData | null {
  const seed = getPluginEmailTemplates().find((item) => item.seedKey === seedKey)
  if (!seed) return null
  const check = seed.data === undefined ? null : validateTemplate(seed.data, seed.purpose)
  return check?.ok ? check.data : DEFAULT_TEMPLATES[seed.purpose]
}

type Row = { id: number; name: string; purpose: string; data: unknown; isDefault: boolean; updatedAt: Date; seedKey: string | null; createdByName?: string | null }

function toRecord(row: Row): EmailTemplateRecord | null {
  if (!isEmailPurpose(row.purpose)) return null
  // Stored data was checked on save; a template that no longer passes (the rules changed) falls back.
  const check = validateTemplate(row.data, row.purpose)
  const data = check.ok ? check.data : DEFAULT_TEMPLATES[row.purpose]
  const original = row.seedKey ? seedData(row.seedKey) : null
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    isDefault: row.isDefault,
    updatedAt: row.updatedAt,
    seedKey: row.seedKey,
    createdByName: row.seedKey ? null : (row.createdByName ?? null),
    edited: Boolean(original && !isEqual(original, data)),
    data,
  }
}

async function selectRows(where: SQL | undefined) {
  const { db, t } = await getDatabase()
  return db
    .select({
      id: t.emailTemplates.id,
      name: t.emailTemplates.name,
      purpose: t.emailTemplates.purpose,
      data: t.emailTemplates.data,
      isDefault: t.emailTemplates.isDefault,
      updatedAt: t.emailTemplates.updatedAt,
      seedKey: t.emailTemplates.seedKey,
      createdByName: t.users.name,
    })
    .from(t.emailTemplates)
    .leftJoin(t.users, eq(t.users.id, t.emailTemplates.createdBy))
    .where(where)
    .orderBy(asc(t.emailTemplates.id))
}

/** The library (every template but the system emails), or one purpose of it. Plugin defaults are seeded first. */
export async function listEmailTemplates(purpose?: EmailPurpose): Promise<EmailTemplateSummary[]> {
  await ensurePluginTemplates()
  const { t } = await getDatabase()
  const rows = await selectRows(purpose ? eq(t.emailTemplates.purpose, purpose) : inArray(t.emailTemplates.purpose, [...LIBRARY_PURPOSES]))
  return rows
    .map((row) => toRecord(row as Row))
    .filter((record): record is EmailTemplateRecord => record !== null && !isSystemPurpose(record.purpose))
    .map(({ data: _data, ...summary }) => summary)
    .sort((a, b) => EMAIL_PURPOSES.indexOf(a.purpose) - EMAIL_PURPOSES.indexOf(b.purpose) || foldText(a.name).localeCompare(foldText(b.name)))
}

/** Creates the plugins' default templates that are missing (at start, and before listing). Never throws. */
export async function ensurePluginTemplates(): Promise<void> {
  try {
    const seeds = getPluginEmailTemplates()
    if (!seeds.length) return
    const { db, t } = await getDatabase()
    const existing = new Set((await db.select({ seedKey: t.emailTemplates.seedKey }).from(t.emailTemplates).where(inArray(t.emailTemplates.seedKey, seeds.map((seed) => seed.seedKey)))).map((row) => row.seedKey))
    for (const seed of seeds) {
      if (existing.has(seed.seedKey)) continue
      await db
        .insert(t.emailTemplates)
        .values({ name: seed.name, purpose: seed.purpose, data: seedData(seed.seedKey) as TemplateData, isDefault: false, seedKey: seed.seedKey, createdBy: null })
        .onConflictDoNothing({ target: t.emailTemplates.seedKey })
    }
  } catch (error) {
    logError(error, 'could not create the plugins’ default email templates')
  }
}

export async function getEmailTemplate(id: number): Promise<EmailTemplateRecord | null> {
  const { t } = await getDatabase()
  const [row] = await selectRows(eq(t.emailTemplates.id, id))
  return row ? toRecord(row as Row) : null
}

/** A plugin default by its key (`<plugin>:<key>`), seeding it if it is missing. */
async function getSeededTemplate(seedKey: string): Promise<EmailTemplateRecord | null> {
  const { t } = await getDatabase()
  let [row] = await selectRows(eq(t.emailTemplates.seedKey, seedKey))
  if (!row && seedData(seedKey)) {
    await ensurePluginTemplates()
    ;[row] = await selectRows(eq(t.emailTemplates.seedKey, seedKey))
  }
  return row ? toRecord(row as Row) : null
}

/** "Restore default" for a plugin's default template: its original layout comes back (the name stays). */
export async function restoreSeededTemplate(id: number): Promise<EmailTemplateRecord> {
  const current = await getEmailTemplate(id)
  const original = current?.seedKey ? seedData(current.seedKey) : null
  if (!current || !original) throw new UserError('Only a default template can be restored.')
  const { db, t } = await getDatabase()
  await db.update(t.emailTemplates).set({ data: original, updatedAt: new Date() }).where(eq(t.emailTemplates.id, id))
  return (await getEmailTemplate(id)) as EmailTemplateRecord
}

async function assertNameFree(name: string, exceptId?: number) {
  const folded = foldText(name)
  const others = await listEmailTemplates()
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

/** Deletes a template. Whatever picked it (a form, say) sends the built-in email instead. */
export async function deleteEmailTemplate(id: number): Promise<void> {
  const { db, t } = await getDatabase()
  const [seeded] = await db.select({ seedKey: t.emailTemplates.seedKey }).from(t.emailTemplates).where(eq(t.emailTemplates.id, id)).limit(1)
  // Plugin defaults stay: they are what that plugin's emails fall back to.
  if (seeded?.seedKey) throw new UserError('A default template cannot be deleted. You can edit it, or restore its default.')
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
    { lock: SYSTEM_LOCK },
  )
  return getSystemEmail(purpose)
}

/** "Restore default": forgets the edits, so the built-in template is sent again. Returns whether there were edits. */
export async function restoreSystemEmail(purpose: SystemPurpose): Promise<boolean> {
  const { db, t } = await getDatabase()
  const removed = await db.delete(t.emailTemplates).where(eq(t.emailTemplates.purpose, purpose)).returning({ id: t.emailTemplates.id })
  return removed.length > 0
}

// --- Rendering and sending ----------------------------------------------------------------------

/**
 * The template an email of `purpose` uses (see the top of this file): a system email's edited copy;
 * otherwise the picked template, else the plugin default `fallback` (`<plugin>:<key>`), else the
 * built-in one.
 */
export async function pickTemplate(purpose: EmailPurpose, templateId?: number | null, fallback?: string | null): Promise<{ data: TemplateData; templateId: number | null }> {
  if (isSystemPurpose(purpose)) {
    const row = await systemRow(purpose)
    const record = row ? toRecord({ ...row, createdByName: null }) : null
    return record ? { data: record.data, templateId: record.id } : { data: DEFAULT_TEMPLATES[purpose], templateId: null }
  }
  if (templateId) {
    const chosen = await getEmailTemplate(templateId)
    if (chosen && chosen.purpose === purpose) return { data: chosen.data, templateId: chosen.id }
  }
  if (fallback) {
    const seeded = await getSeededTemplate(fallback)
    if (seeded && seeded.purpose === purpose) return { data: seeded.data, templateId: seeded.id }
  }
  return { data: DEFAULT_TEMPLATES[purpose], templateId: null }
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

/** An email of `purpose`, rendered from its template. Details are only ever used for team notifications. */
export async function renderPurposeEmail(input: {
  purpose: EmailPurpose
  templateId?: number | null
  /** A plugin default (`<plugin>:<key>`) for when `templateId` is missing or deleted. */
  fallback?: string | null
  values: Record<string, string>
  details?: Array<{ label: string; value: string }>
}): Promise<RenderedEmail> {
  const { data } = await pickTemplate(input.purpose, input.templateId, input.fallback)
  const details = PURPOSE_INFO[input.purpose].details ? input.details : undefined
  return renderEmail(data, await emailContext(input.values, { details }))
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
  const details = PURPOSE_INFO[purpose].details
    ? [
        { label: 'Your name', value: 'Sam Lee' },
        { label: 'Message', value: 'A sample detail, so you can see how details look.' },
      ]
    : undefined
  return renderEmail(check.data, await emailContext(PURPOSE_INFO[purpose].sample, { details }))
}
