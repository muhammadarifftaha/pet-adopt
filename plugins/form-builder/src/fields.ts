// The form builder's field model: what a form is made of, and the one check that every stored form
// passes. Pure (no database, no Node APIs), so the admin editor's zod schema can reuse it and the two
// cannot drift; the server stays the authority. Part of the plugin, so it imports nothing from the app.
//
// Like validateRichText, `validateFormFields` REBUILDS each field from the allowed props only, so an
// unknown key or a value of the wrong type never reaches the database or the public page.

export const FORM_FIELD_TYPES = [
  { value: 'text', label: 'Short answer' },
  { value: 'textarea', label: 'Long answer' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone number' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'choice', label: 'One choice' },
  { value: 'checkboxes', label: 'Several choices' },
  { value: 'checkbox', label: 'Tick box' },
  { value: 'source', label: 'Choice from site data' },
] as const

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number]['value']

/** The lists a `source` question can offer, filled in when the form is shown (see host().choices). */
export const FORM_SOURCES = [{ value: 'pets', label: 'Pets up for adoption' }] as const
export type FormSource = (typeof FORM_SOURCES)[number]['value']

/** Types whose answer is picked from `options`. */
export const OPTION_TYPES: readonly FormFieldType[] = ['choice', 'checkboxes']

export type FormField = {
  /** Stable key for the answers: survives renaming the label. */
  id: string
  type: FormFieldType
  label: string
  /** Shown under the label. */
  hint?: string
  required: boolean
  /** `choice` and `checkboxes` only. */
  options?: string[]
  /** `choice` only: radio buttons (default) or a dropdown. */
  display?: 'radio' | 'dropdown'
  /** `source` only: which list of site data fills the dropdown. */
  source?: FormSource
}

/** One option of a `source` question, as the site shows it. */
export type SourceChoice = { value: string; label: string }

/** A field as the public site draws it: a `source` question carries its current choices. */
export type PublicField = FormField & { choices?: SourceChoice[] }

/** Per-form options that are not fields. All optional; missing means the default. */
export type FormSettings = {
  /** The submit button's text. Default "Send". */
  submitLabel?: string
  /** Shown in place of the form after sending. */
  successMessage?: string
  /** Where to email each new response, when the site can send email. */
  notifyEmail?: string
  /** The site's email template for that notification (Email > Templates); missing: the default. */
  notifyTemplateId?: number
  /**
   * Email the visitor a confirmation, to the address they gave in this Email question (opt-in).
   * It never repeats their answers: anyone can type any address into a public form.
   */
  confirmationFieldId?: string
  /** The template for the confirmation; missing: the default. */
  confirmationTemplateId?: number
}

export const FORM_LIMITS = {
  name: 80,
  description: 1000,
  fields: 50,
  label: 200,
  hint: 300,
  options: 30,
  option: 100,
  submitLabel: 40,
  successMessage: 500,
  /** Longest answer to a short-answer field (and email). */
  text: 300,
  /** Longest answer to a long-answer field. */
  textarea: 5000,
} as const

export const DEFAULT_SUBMIT_LABEL = 'Send'
export const DEFAULT_SUCCESS_MESSAGE = 'Thank you. We have received your answers and will be in touch.'

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FIELD_ID = /^[A-Za-z0-9_-]{1,40}$/
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** Trimmed, control characters removed, runs of whitespace collapsed to one space. */
export function cleanLine(value: unknown): string {
  return typeof value === 'string' ? value.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim() : ''
}

/** Like cleanLine, but line breaks are kept (descriptions, long answers). */
export function cleanText(value: unknown): string {
  return typeof value === 'string'
    ? value
        .replace(CONTROL_CHARS, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : ''
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** A short random id for a new field (the editor may also send its own). */
export function newFieldId(): string {
  return `f${Math.random().toString(36).slice(2, 10)}`
}

export type FieldsResult = { ok: true; fields: FormField[] } | { ok: false; errors: Record<string, string> }

/**
 * Checks and rebuilds a form's field list. Errors are keyed like the settings form's
 * (`fields.2.label`, `fields.2.options.1`), so the editor can put each one next to its input.
 * A field without an id gets a new one; ids must be unique within the form.
 */
export function validateFormFields(raw: unknown): FieldsResult {
  const errors: Record<string, string> = {}
  if (!Array.isArray(raw)) return { ok: false, errors: { fields: 'Must be a list of fields.' } }
  if (raw.length > FORM_LIMITS.fields) return { ok: false, errors: { fields: `A form can have at most ${FORM_LIMITS.fields} fields.` } }

  const types = new Set<string>(FORM_FIELD_TYPES.map((t) => t.value))
  const seenIds = new Set<string>()
  const fields: FormField[] = []

  raw.forEach((item, i) => {
    const at = `fields.${i}`
    if (!isRecord(item)) {
      errors[at] = 'Not a valid field.'
      return
    }

    let id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id) id = newFieldId()
    if (!FIELD_ID.test(id)) errors[`${at}.id`] = 'Not a valid field id.'
    else if (seenIds.has(id)) errors[`${at}.id`] = 'Two fields have the same id.'
    seenIds.add(id)

    const type = item.type
    if (typeof type !== 'string' || !types.has(type)) {
      errors[`${at}.type`] = 'Pick one of the listed field types.'
      return
    }

    const label = cleanLine(item.label)
    if (!label) errors[`${at}.label`] = 'Write the question.'
    else if (label.length > FORM_LIMITS.label) errors[`${at}.label`] = `Use at most ${FORM_LIMITS.label} characters.`

    const hint = cleanLine(item.hint)
    if (hint.length > FORM_LIMITS.hint) errors[`${at}.hint`] = `Use at most ${FORM_LIMITS.hint} characters.`

    if (item.required !== undefined && typeof item.required !== 'boolean') errors[`${at}.required`] = 'Must be true or false.'

    const field: FormField = { id, type: type as FormFieldType, label, required: item.required === true }
    if (hint) field.hint = hint

    if (OPTION_TYPES.includes(field.type)) {
      const options = Array.isArray(item.options) ? item.options : null
      if (!options) {
        errors[`${at}.options`] = 'Add at least one option.'
      } else {
        const cleaned = options.map(cleanLine)
        const seen = new Set<string>()
        cleaned.forEach((option, j) => {
          if (!option) errors[`${at}.options.${j}`] ??= 'An option cannot be blank.'
          else if (option.length > FORM_LIMITS.option) errors[`${at}.options.${j}`] ??= `Use at most ${FORM_LIMITS.option} characters.`
          else if (seen.has(option.toLowerCase())) errors[`${at}.options.${j}`] ??= 'This option is listed twice.'
          seen.add(option.toLowerCase())
        })
        if (!cleaned.length) errors[`${at}.options`] = 'Add at least one option.'
        else if (cleaned.length > FORM_LIMITS.options) errors[`${at}.options`] = `Use at most ${FORM_LIMITS.options} options.`
        field.options = cleaned
      }
      if (field.type === 'choice') {
        if (item.display === 'dropdown') field.display = 'dropdown'
        else if (item.display !== undefined && item.display !== 'radio') errors[`${at}.display`] = 'Pick radio buttons or a dropdown.'
      }
    }

    if (field.type === 'source') {
      const source = FORM_SOURCES.find((s) => s.value === item.source)
      if (!source) errors[`${at}.source`] = 'Pick which list to offer.'
      else field.source = source.value
    }

    fields.push(field)
  })

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, fields }
}

/** One stored answer. The label and type are copied in, so later edits to the form never change it. */
export type FormAnswer = {
  id: string
  label: string
  type: FormFieldType
  /** Text for most types, the picked options for `checkboxes`, true/false for `checkbox`; null when left blank. */
  value: string | string[] | boolean | null
  /** `source` questions: what was picked, as `<source>:<id>` ("pets:12"). `value` keeps its name then. */
  ref?: string
}

/** An answer as one line of text (lists, CSV, email). */
export function answerToText(answer: Pick<FormAnswer, 'value'>): string {
  const { value } = answer
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.join(', ')
  return value
}

export type SettingsResult = { ok: true; settings: FormSettings } | { ok: false; errors: Record<string, string> }

/** Checks and rebuilds a form's settings. Blank values are dropped (the defaults apply). Errors: `settings.<key>`. */
export function validateFormSettings(raw: unknown): SettingsResult {
  if (raw === null || raw === undefined) return { ok: true, settings: {} }
  if (!isRecord(raw)) return { ok: false, errors: { settings: 'Not valid settings.' } }
  const errors: Record<string, string> = {}
  const settings: FormSettings = {}

  const submitLabel = cleanLine(raw.submitLabel)
  if (submitLabel.length > FORM_LIMITS.submitLabel) errors['settings.submitLabel'] = `Use at most ${FORM_LIMITS.submitLabel} characters.`
  else if (submitLabel) settings.submitLabel = submitLabel

  const successMessage = cleanText(raw.successMessage)
  if (successMessage.length > FORM_LIMITS.successMessage) errors['settings.successMessage'] = `Use at most ${FORM_LIMITS.successMessage} characters.`
  else if (successMessage) settings.successMessage = successMessage

  const notifyEmail = cleanLine(raw.notifyEmail).toLowerCase()
  if (notifyEmail && (notifyEmail.length > 254 || !EMAIL_PATTERN.test(notifyEmail))) errors['settings.notifyEmail'] = 'Enter a valid email address.'
  else if (notifyEmail) settings.notifyEmail = notifyEmail

  const templateId = (key: 'notifyTemplateId' | 'confirmationTemplateId') => {
    const value = raw[key]
    if (value === undefined || value === null || value === '') return
    const n = Number(value)
    if (Number.isSafeInteger(n) && n > 0 && n <= 2147483647) settings[key] = n
    else errors[`settings.${key}`] = 'Pick one of the listed templates.'
  }
  templateId('notifyTemplateId')
  templateId('confirmationTemplateId')
  const confirmationFieldId = raw.confirmationFieldId
  if (confirmationFieldId !== undefined && confirmationFieldId !== null && confirmationFieldId !== '') {
    if (typeof confirmationFieldId === 'string' && /^[\w-]{1,40}$/.test(confirmationFieldId)) settings.confirmationFieldId = confirmationFieldId
    else errors['settings.confirmationFieldId'] = 'Pick one of the form’s Email questions.'
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, settings }
}

/** How a phone answer is checked: the cleaned number to store, or why it cannot be used. */
export type PhoneCheck = (raw: string) => { ok: true; value: string } | { ok: false; error: string }

export type AnswersResult = { ok: true; answers: FormAnswer[] } | { ok: false; errors: Record<string, string> }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const NUMBER = /^-?\d+(\.\d+)?$/

/**
 * Checks a visitor's answers against the form's fields and builds the stored snapshot (one answer
 * per field, in field order, with its label and type). `raw` is `{ [fieldId]: value }`; keys that
 * are not fields are ignored. Errors are keyed by field id, so the form can show each one in place.
 */
export function validateAnswers(
  fields: readonly FormField[],
  raw: unknown,
  opts: { phone: PhoneCheck; choices?: Partial<Record<FormSource, readonly SourceChoice[]>> },
): AnswersResult {
  const input = isRecord(raw) ? raw : {}
  const errors: Record<string, string> = {}
  const answers: FormAnswer[] = []
  const required = 'This field is required.'

  for (const field of fields) {
    const value = input[field.id]
    let answer: FormAnswer['value'] = null
    let ref: string | undefined
    const fail = (message: string) => {
      errors[field.id] = message
    }

    switch (field.type) {
      case 'text':
      case 'email':
      case 'phone':
      case 'number':
      case 'date': {
        if (value !== undefined && value !== null && typeof value !== 'string' && typeof value !== 'number') {
          fail('Not a valid answer.')
          break
        }
        const text = cleanLine(typeof value === 'number' ? String(value) : value)
        if (!text) break
        if (text.length > FORM_LIMITS.text) fail(`Use at most ${FORM_LIMITS.text} characters.`)
        else if (field.type === 'email') {
          if (text.length > 254 || !EMAIL_PATTERN.test(text)) fail('Enter a valid email address.')
          else answer = text.toLowerCase()
        } else if (field.type === 'phone') {
          const checked = opts.phone(text)
          if (checked.ok) answer = checked.value
          else fail(checked.error)
        } else if (field.type === 'number') {
          if (!NUMBER.test(text) || Math.abs(Number(text)) > 1_000_000_000) fail('Enter a number.')
          else answer = text
        } else if (field.type === 'date') {
          // Date.parse rolls 2026-02-31 over to March: require a round trip.
          if (!DATE.test(text) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) fail('Enter a real date (YYYY-MM-DD).')
          else answer = text
        } else answer = text
        break
      }
      case 'textarea': {
        if (value !== undefined && value !== null && typeof value !== 'string') {
          fail('Not a valid answer.')
          break
        }
        const text = cleanText(value)
        if (text.length > FORM_LIMITS.textarea) fail(`Use at most ${FORM_LIMITS.textarea} characters.`)
        else if (text) answer = text
        break
      }
      case 'choice': {
        if (value === undefined || value === null || value === '') break
        if (typeof value !== 'string' || !field.options?.includes(value)) fail('Pick one of the listed options.')
        else answer = value
        break
      }
      case 'checkboxes': {
        if (value === undefined || value === null) break
        const picked = Array.isArray(value) ? value : [value]
        if (!picked.every((v) => typeof v === 'string' && field.options?.includes(v))) fail('Pick from the listed options.')
        // Stored in the form's order, each once.
        else if (picked.length) answer = (field.options ?? []).filter((option) => picked.includes(option))
        break
      }
      case 'source': {
        if (value === undefined || value === null || value === '') break
        const picked = typeof value === 'string' || typeof value === 'number' ? String(value) : null
        const choice = field.source ? opts.choices?.[field.source]?.find((c) => c.value === picked) : undefined
        // Usually a pet that was adopted (or hidden) after the page was loaded.
        if (!choice) fail('That choice is no longer available. Pick another one.')
        else {
          answer = choice.label
          ref = `${field.source}:${choice.value}`
        }
        break
      }
      case 'checkbox': {
        // A ticked HTML checkbox sends "on"; JSON callers send booleans.
        answer = value === true || value === 'true' || value === 'on'
        if (!answer && value !== undefined && value !== null && value !== false && value !== 'false' && value !== '') fail('Not a valid answer.')
        break
      }
    }

    const blank = answer === null || answer === false || (Array.isArray(answer) && !answer.length)
    if (field.required && blank && !errors[field.id]) fail(field.type === 'checkbox' ? 'Tick this box to continue.' : required)
    answers.push(ref ? { id: field.id, label: field.label, type: field.type, value: answer, ref } : { id: field.id, label: field.label, type: field.type, value: answer })
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, answers }
}
