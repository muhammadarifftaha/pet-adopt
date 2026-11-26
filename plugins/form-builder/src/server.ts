// The form builder's data rules. Server-only: everything opens the plugin's own tables through
// `openFormsDatabase()` and reaches the app only through `host()` from the SDK. The screens call
// these through ./actions.ts; check:backend calls them directly.
import { csvCell, foldText, host, UserError, ValidationError } from '@pet-adopt/plugin-sdk'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import {
  answerToText,
  cleanLine,
  cleanText,
  DEFAULT_SUBMIT_LABEL,
  DEFAULT_SUCCESS_MESSAGE,
  FORM_LIMITS,
  validateAnswers,
  validateFormFields,
  validateFormSettings,
  type FormAnswer,
  type FormField,
  type FormSettings,
  type FormSource,
  type PublicField,
  type SourceChoice,
} from './fields'
import { openFormsDatabase } from './storage'

export const MAX_FORMS = 100
/** Past this a form stops accepting responses, so a flood cannot fill the disk. */
export const MAX_RESPONSES_PER_FORM = 10_000
/** Per visitor address, across all forms. */
export const SUBMIT_CLIENT_RULE = { max: 10, windowMs: 10 * 60 * 1000 }
/** Per form, from everyone: caps a flood spread over many addresses. */
export const SUBMIT_FORM_RULE = { max: 200, windowMs: 60 * 60 * 1000 }

export type FormRecord = {
  id: number
  name: string
  description: string | null
  fields: FormField[]
  settings: FormSettings
  isOpen: boolean
  createdAt: Date
  updatedAt: Date
}

export type FormSummary = Pick<FormRecord, 'id' | 'name' | 'isOpen' | 'updatedAt'> & {
  fieldCount: number
  responses: number
  unread: number
  lastResponseAt: Date | null
}

/** What the public site needs to draw a form. Nothing private (no notify address). */
export type PublicForm = Pick<FormRecord, 'id' | 'name' | 'description' | 'isOpen'> & { fields: PublicField[]; submitLabel: string }

/** The current choices for every list the form's `source` questions use, each fetched once. */
async function choicesFor(fields: readonly FormField[]): Promise<Partial<Record<FormSource, SourceChoice[]>>> {
  const sources = [...new Set(fields.flatMap((field) => (field.type === 'source' && field.source ? [field.source] : [])))]
  const lists = await Promise.all(sources.map((source) => host().choices(source)))
  return Object.fromEntries(sources.map((source, i) => [source, lists[i]]))
}

export type FormResponse = { id: number; answers: FormAnswer[]; readAt: Date | null; createdAt: Date }

const MAX_ID = 2_147_483_647
/** An id from a client is untrusted: a whole number in range, or "not found". */
export function toFormId(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_ID) throw new UserError('Not found.')
  return n
}

function toIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 500) throw new UserError('Pick up to 500 responses.')
  return [...new Set(value.map(toFormId))]
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** SQLite gives numbers (ms), PostgreSQL a Date or a string, for an aggregate over a timestamp. */
function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(typeof value === 'number' ? value : String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

type FormRow = { id: number; name: string; description: string | null; fields: unknown; settings: unknown; isOpen: boolean; createdAt: Date; updatedAt: Date }

function toForm(row: FormRow): FormRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    fields: (Array.isArray(row.fields) ? row.fields : []) as FormField[],
    settings: (isRecord(row.settings) ? row.settings : {}) as FormSettings,
    isOpen: row.isOpen,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// --- Forms -----------------------------------------------------------------------------------

export async function listForms(): Promise<FormSummary[]> {
  const { db, t } = await openFormsDatabase()
  const r = t.responses
  // One join with GROUP BY, not correlated subqueries: in a single-table select Drizzle writes
  // columns unqualified, so `forms.id` inside a subquery on responses would mean responses.id.
  const rows = await db
    .select({
      id: t.forms.id,
      name: t.forms.name,
      isOpen: t.forms.isOpen,
      fields: t.forms.fields,
      updatedAt: t.forms.updatedAt,
      responses: sql<number>`count(${r.id})`,
      unread: sql<number>`coalesce(sum(case when ${r.id} is not null and ${r.readAt} is null then 1 else 0 end), 0)`,
      lastResponseAt: sql<unknown>`max(${r.createdAt})`,
    })
    .from(t.forms)
    .leftJoin(r, eq(r.formId, t.forms.id))
    .groupBy(t.forms.id)
  // At most MAX_FORMS: sorted here, folded, so case and accents order the same on every database.
  rows.sort((a, b) => foldText(a.name).localeCompare(foldText(b.name)) || a.id - b.id)
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    isOpen: row.isOpen,
    updatedAt: row.updatedAt,
    fieldCount: Array.isArray(row.fields) ? row.fields.length : 0,
    responses: Number(row.responses),
    unread: Number(row.unread),
    lastResponseAt: toDate(row.lastResponseAt),
  }))
}

export async function getForm(id: number): Promise<FormRecord | null> {
  const { db, t } = await openFormsDatabase()
  const [row] = await db.select().from(t.forms).where(eq(t.forms.id, id)).limit(1)
  return row ? toForm(row) : null
}

/** For the public site: null when the form does not exist. A closed form is returned (it shows a note). */
export async function getPublicForm(id: number): Promise<PublicForm | null> {
  const form = await getForm(id)
  if (!form) return null
  const choices = await choicesFor(form.fields)
  return {
    id: form.id,
    name: form.name,
    description: form.description,
    fields: form.fields.map((field) => (field.type === 'source' && field.source ? { ...field, choices: choices[field.source] ?? [] } : field)),
    isOpen: form.isOpen,
    submitLabel: form.settings.submitLabel ?? DEFAULT_SUBMIT_LABEL,
  }
}

type FormInput = { name?: string; description?: string | null; fields?: FormField[]; settings?: FormSettings; isOpen?: boolean }

/** Reads the keys that are present; a missing key means "leave it alone". Throws every problem at once. */
function parseFormInput(raw: unknown, creating: boolean): FormInput {
  const input = isRecord(raw) ? raw : {}
  const errors: Record<string, string> = {}
  const out: FormInput = {}

  if (input.name !== undefined || creating) {
    const name = cleanLine(input.name)
    if (!name) errors.name = 'Give the form a name.'
    else if (name.length > FORM_LIMITS.name) errors.name = `Use at most ${FORM_LIMITS.name} characters.`
    else out.name = name
  }
  if (input.description !== undefined) {
    const description = cleanText(input.description)
    if (description.length > FORM_LIMITS.description) errors.description = `Use at most ${FORM_LIMITS.description} characters.`
    else out.description = description || null
  }
  if (input.fields !== undefined) {
    const result = validateFormFields(input.fields)
    if (result.ok) out.fields = result.fields
    else Object.assign(errors, result.errors)
  }
  if (input.settings !== undefined) {
    const result = validateFormSettings(input.settings)
    if (result.ok) out.settings = result.settings
    else Object.assign(errors, result.errors)
  }
  if (input.isOpen !== undefined) {
    if (typeof input.isOpen !== 'boolean') errors.isOpen = 'Must be true or false.'
    else out.isOpen = input.isOpen
  }
  if (Object.keys(errors).length) throw new ValidationError(errors)
  return out
}

/** `{ name, description?, fields?, settings?, isOpen? }`. Names are unique, whatever their case. */
export async function createForm(raw: unknown): Promise<{ id: number }> {
  const input = parseFormInput(raw, true)
  const { db, t, withTransaction } = await openFormsDatabase()
  return withTransaction(
    async (tx) => {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)` }).from(t.forms)
      if (Number(n) >= MAX_FORMS) throw new UserError(`You can keep up to ${MAX_FORMS} forms. Delete one first.`)
      await assertNameFree(tx as typeof db, t, input.name!)
      const now = new Date()
      const [row] = await tx
        .insert(t.forms)
        .values({
          name: input.name!,
          description: input.description ?? null,
          fields: input.fields ?? [],
          settings: input.settings ?? {},
          isOpen: input.isOpen ?? true,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: t.forms.id })
      return { id: row.id }
    },
    { lock: 'form-builder:forms' },
  )
}

/** Any of `{ name, description, fields, settings, isOpen }`. `fields` and `settings` replace what is stored. */
export async function updateForm(id: number, raw: unknown): Promise<FormRecord> {
  const input = parseFormInput(raw, false)
  const { db, t, withTransaction } = await openFormsDatabase()
  return withTransaction(
    async (tx) => {
      if (input.name) await assertNameFree(tx as typeof db, t, input.name, id)
      const [row] = await tx
        .update(t.forms)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(t.forms.id, id))
        .returning()
      if (!row) throw new UserError('That form no longer exists.')
      return toForm(row)
    },
    { lock: 'form-builder:forms' },
  )
}

/** Deletes the form and every response to it. */
export async function deleteForm(id: number): Promise<void> {
  const { db, t } = await openFormsDatabase()
  const [row] = await db.delete(t.forms).where(eq(t.forms.id, id)).returning({ id: t.forms.id })
  if (!row) throw new UserError('That form no longer exists.')
}

type Opened = Awaited<ReturnType<typeof openFormsDatabase>>
async function assertNameFree(db: Opened['db'], t: Opened['t'], name: string, exceptId?: number) {
  // At most MAX_FORMS rows: compared here, folded (case and accents), the same on every database.
  const rows = await db.select({ id: t.forms.id, name: t.forms.name }).from(t.forms)
  if (rows.some((row) => row.id !== exceptId && foldText(row.name) === foldText(name))) throw new ValidationError({ name: 'Another form already has this name.' })
}

// --- Responses -------------------------------------------------------------------------------

export type SubmitResult = { message: string }

/**
 * A visitor sends a form. Answers are checked first (so a typo costs nothing), then the visitor's and
 * the form's limits are counted. A filled honeypot gets the same answer but nothing is stored.
 * Returns what to show, plus the stored response for the notification (null when nothing was stored).
 */
export async function submitResponse(
  formId: number,
  raw: unknown,
  opts: { client: string | null; honeypot?: unknown },
): Promise<SubmitResult & { stored: { form: FormRecord; answers: FormAnswer[] } | null }> {
  const form = await getForm(formId)
  if (!form) throw new UserError('This form is no longer available.')
  if (!form.isOpen) throw new UserError('This form is not accepting responses right now.')

  const { phone } = host()
  const result = validateAnswers(form.fields, raw, {
    choices: await choicesFor(form.fields),
    phone: (text) => {
      const problem = phone.validate(text)
      return problem === true ? { ok: true, value: phone.toE164(text) ?? text } : { ok: false, error: problem }
    },
  })
  if (!result.ok) throw new ValidationError(result.errors)

  if (opts.client) await host().consumeAttempt(`form-builder:ip:${opts.client}`, SUBMIT_CLIENT_RULE)
  await host().consumeAttempt(`form-builder:form:${form.id}`, SUBMIT_FORM_RULE)

  const message = form.settings.successMessage ?? DEFAULT_SUCCESS_MESSAGE
  if (typeof opts.honeypot === 'string' ? opts.honeypot.trim() : opts.honeypot) return { message, stored: null }

  const { db, t } = await openFormsDatabase()
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(t.responses).where(eq(t.responses.formId, form.id))
  if (Number(n) >= MAX_RESPONSES_PER_FORM) throw new UserError('This form is not accepting responses right now.')
  await db.insert(t.responses).values({ formId: form.id, answers: result.answers, createdAt: new Date() })
  return { message, stored: { form, answers: result.answers } }
}

/** Emails a new response to the form's notify address, when the site can send email. Never throws. */
export async function notifyNewResponse(form: FormRecord, answers: FormAnswer[]): Promise<void> {
  const to = form.settings.notifyEmail
  const sender = to ? await host().emailSender() : null
  if (!to || !sender) return
  const lines = answers.map((answer) => `${answer.label}: ${answerToText(answer) || '(blank)'}`)
  try {
    await sender.send({ to, subject: `New response: ${form.name}`, text: [`A new response to "${form.name}".`, '', ...lines].join('\n') })
  } catch (error) {
    host().logError(error, `form-builder: could not email a response to form ${form.id}`)
  }
}

export async function listResponses(
  formId: number,
  opts: { page?: unknown; limit?: unknown } = {},
): Promise<{ items: FormResponse[]; total: number; page: number; totalPages: number }> {
  const limit = Math.min(Math.max(Math.trunc(Number(opts.limit)) || 25, 1), 100)
  const requested = Math.min(Math.max(Math.trunc(Number(opts.page)) || 1, 1), 100_000)
  const { db, t } = await openFormsDatabase()
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(t.responses).where(eq(t.responses.formId, formId))
  const total = Number(n)
  const totalPages = Math.max(Math.ceil(total / limit), 1)
  const page = Math.min(requested, totalPages)
  const rows = await db
    .select()
    .from(t.responses)
    .where(eq(t.responses.formId, formId))
    .orderBy(desc(t.responses.createdAt), desc(t.responses.id))
    .limit(limit)
    .offset((page - 1) * limit)
  return {
    items: rows.map((row) => ({ id: row.id, answers: row.answers as FormAnswer[], readAt: row.readAt, createdAt: row.createdAt })),
    total,
    page,
    totalPages,
  }
}

/** Marks these responses (or, with no ids, all of the form's) as read. Returns how many changed. */
export async function markResponsesRead(formId: number, ids?: unknown): Promise<number> {
  const { db, t } = await openFormsDatabase()
  const which = ids === undefined ? undefined : toIds(ids)
  if (which && !which.length) return 0
  const rows = await db
    .update(t.responses)
    .set({ readAt: new Date() })
    .where(and(eq(t.responses.formId, formId), isNull(t.responses.readAt), which ? inArray(t.responses.id, which) : undefined))
    .returning({ id: t.responses.id })
  return rows.length
}

/** Deletes these responses of the form. Ids of other forms' responses are ignored. Returns how many went. */
export async function deleteResponses(formId: number, ids: unknown): Promise<number> {
  const which = toIds(ids)
  if (!which.length) return 0
  const { db, t } = await openFormsDatabase()
  const rows = await db
    .delete(t.responses)
    .where(and(eq(t.responses.formId, formId), inArray(t.responses.id, which)))
    .returning({ id: t.responses.id })
  return rows.length
}

/**
 * Every response as CSV: "Submitted", then one column per current field (in form order), then a
 * column for each field that was removed but still has answers (under its last label). Cells that a
 * spreadsheet would run as a formula are prefixed with an apostrophe.
 */
export async function exportResponsesCsv(formId: number): Promise<{ filename: string; csv: string }> {
  const form = await getForm(formId)
  if (!form) throw new UserError('That form no longer exists.')
  const { db, t } = await openFormsDatabase()
  const rows = await db
    .select({ answers: t.responses.answers, createdAt: t.responses.createdAt })
    .from(t.responses)
    .where(eq(t.responses.formId, formId))
    .orderBy(asc(t.responses.createdAt), asc(t.responses.id))

  const columns = new Map<string, string>(form.fields.map((field) => [field.id, field.label]))
  for (const row of rows) for (const answer of row.answers as FormAnswer[]) if (!columns.has(answer.id)) columns.set(answer.id, answer.label)

  const header = ['Submitted', ...columns.values()]
  const lines = rows.map((row) => {
    const byId = new Map((row.answers as FormAnswer[]).map((answer) => [answer.id, answerToText(answer)]))
    return [row.createdAt.toISOString(), ...[...columns.keys()].map((id) => byId.get(id) ?? '')]
  })
  // BOM so Excel reads UTF-8; CRLF line ends as RFC 4180 has them.
  const csv = '\uFEFF' + [header, ...lines].map((cells) => cells.map(csvCell).join(',')).join('\r\n') + '\r\n'
  const base = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'form'
  return { filename: `${base}-responses-${new Date().toISOString().slice(0, 10)}.csv`, csv }
}
