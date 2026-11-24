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
] as const

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number]['value']

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
}

/** Per-form options that are not fields. All optional; missing means the default. */
export type FormSettings = {
  /** The submit button's text. Default "Send". */
  submitLabel?: string
  /** Shown in place of the form after sending. */
  successMessage?: string
  /** Where to email each new response, when the site can send email. */
  notifyEmail?: string
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
    if (!label) errors[`${at}.label`] = 'Give this field a label.'
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
}

/** An answer as one line of text (lists, CSV, email). */
export function answerToText(answer: Pick<FormAnswer, 'value'>): string {
  const { value } = answer
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.join(', ')
  return value
}
