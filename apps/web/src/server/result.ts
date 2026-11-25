// What every server action returns, the errors the data layer throws, and a small parser that
// collects one message per field so a form can show each problem next to its input.
import { isRichTextEmpty, plainTextToDoc, validateRichText } from '@/lib/rich-text'
import { SLUG_PATTERN } from '@/lib/slugify'

// The error classes and result type live in the plugin SDK, so errors a plugin throws are the same
// classes `toFailure` checks for. Re-exported here for the app.
import { UserError, ValidationError, type ActionResult, type FieldErrors } from '@pet-adopt/plugin-sdk'

export { UserError, ValidationError }
export type { ActionResult, FieldErrors }

// libSQL puts the general code in `code` (SQLITE_CONSTRAINT) and the kind in `extendedCode`
// (SQLITE_CONSTRAINT_UNIQUE); PostgreSQL uses `code` alone.
type WithCode = { code?: unknown; extendedCode?: unknown; cause?: unknown }

function hasCode(error: unknown, test: (code: string) => boolean): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const { code, extendedCode, cause } = current as WithCode
    if (typeof code === 'string' && test(code)) return true
    if (typeof extendedCode === 'string' && test(extendedCode)) return true
    current = cause
  }
  return false
}

export const isUniqueViolation = (error: unknown) =>
  hasCode(error, (c) => c === '23505' || c.startsWith('SQLITE_CONSTRAINT_UNIQUE') || c === 'SQLITE_CONSTRAINT_PRIMARYKEY')

export const isForeignKeyViolation = (error: unknown) =>
  hasCode(error, (c) => c === '23503' || c.startsWith('SQLITE_CONSTRAINT_FOREIGNKEY'))

/**
 * A short, safe description of an error for logs: name, code and the first line of the message,
 * for the error and its causes. Database errors carry the bound parameters after the first line
 * ("params: ..."), which can hold password hashes, emails and whole records, so never log the
 * error object itself.
 */
export function describeError(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 4 && current; depth++) {
    if (current instanceof Error) {
      const { code } = current as { code?: unknown }
      const firstLine = current.message.split('\n')[0].slice(0, 300)
      parts.push(`${current.name}${typeof code === 'string' ? ` [${code}]` : ''}: ${firstLine}`)
      current = (current as { cause?: unknown }).cause
    } else {
      parts.push(String(current).slice(0, 200))
      break
    }
  }
  return parts.join(' <- ') || 'unknown error'
}

export function logError(error: unknown, context?: string) {
  console.error(context ? `${context}: ${describeError(error)}` : describeError(error))
}

export function toFailure(error: unknown): { ok: false; error: string; fieldErrors?: FieldErrors } {
  if (error instanceof ValidationError) return { ok: false, error: error.message, fieldErrors: error.fieldErrors }
  if (error instanceof UserError) return { ok: false, error: error.message }
  logError(error)
  return {
    ok: false,
    // Only a local development server shows the real reason; every other environment, including
    // staging and test, gets the generic message so a database error never reaches a browser.
    error:
      process.env.NODE_ENV === 'development' && error instanceof Error
        ? describeError(error)
        : 'Something went wrong. Please try again.',
  }
}

/** Runs `fn` and turns anything it throws into an `ActionResult`. */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    return toFailure(error)
  }
}

/** Control characters except tab, line feed and carriage return. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** The largest id a 32-bit integer column can hold. Anything above cannot be a real row. */
const MAX_ID = 2_147_483_647

/** A database id: a whole number from 1 up, as a number or a string of digits. Anything else is null. */
function toId(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_ID ? n : null
}

/** For action arguments: an id from the client is untrusted. Throws "not found" for anything that cannot be one. */
export function assertId(value: unknown): number {
  const id = toId(value)
  if (id === null) throw new UserError('Not found.')
  return id
}

export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

type Option = { readonly value: string }

/**
 * Reads typed values out of untrusted input.
 *  - A key that is absent returns `undefined`, meaning "leave this field alone".
 *  - A blank value returns `null` (clear it), except for required fields, which report an error.
 * Call `done()` last: it throws a ValidationError listing every problem found.
 */
export class Fields {
  errors: FieldErrors = {}

  constructor(
    private raw: Record<string, unknown>,
    /** When creating, required fields must be present. When updating they may be left out. */
    private creating = false,
  ) {}

  has(key: string) {
    return this.raw[key] !== undefined
  }

  private fail(key: string, message: string) {
    this.errors[key] ??= message
    return undefined
  }

  private missing(key: string) {
    if (this.creating) this.fail(key, 'This field is required.')
    return undefined
  }

  text(key: string, max: number, opts: { collapse?: boolean; validate?: (value: string) => true | string } = {}) {
    const value = this.raw[key]
    if (value === undefined) return undefined
    if (value === null) return null
    if (typeof value !== 'string') return this.fail(key, 'Must be text.')
    // Control characters (a NUL breaks writes on PostgreSQL) never belong in owner-entered text.
    // Tabs and line breaks are kept: descriptions and addresses use them.
    let text = value.replace(CONTROL_CHARS, '').trim()
    if (opts.collapse) text = text.replace(/\s+/g, ' ')
    if (!text) return null
    if (text.length > max) return this.fail(key, `Use at most ${max} characters.`)
    const check = opts.validate?.(text)
    if (typeof check === 'string') return this.fail(key, check)
    return text
  }

  requiredText(key: string, max: number, opts: { validate?: (value: string) => true | string } = {}) {
    if (this.raw[key] === undefined) return this.missing(key)
    const text = this.text(key, max, opts)
    if (text === null) return this.fail(key, 'This field is required.')
    return text
  }

  // Generic so the result is typed as the allowed values (`PetStatus` for STATUSES), not just `string`.
  oneOf<T extends string>(key: string, options: readonly { value: T }[], opts: { required?: boolean } = {}) {
    const value = this.raw[key]
    if (value === undefined) return opts.required ? this.missing(key) : undefined
    if (value === null || value === '') return opts.required ? this.fail(key, 'This field is required.') : null
    if (typeof value !== 'string' || !options.some((o) => o.value === value)) return this.fail(key, 'Pick one of the listed options.')
    return value as T
  }

  /** A true/false switch. Only real booleans, or the words "true" and "false", are accepted: "false" must not become true. */
  flag(key: string) {
    const value = this.raw[key]
    if (value === undefined) return undefined
    if (typeof value === 'boolean') return value
    if (value === 'true') return true
    if (value === 'false') return false
    return this.fail(key, 'Must be true or false.')
  }

  list(key: string, options: readonly Option[]) {
    const value = this.raw[key]
    if (value === undefined) return undefined
    if (value === null) return []
    if (!Array.isArray(value)) return this.fail(key, 'Must be a list.')
    const allowed = new Set(options.map((o) => o.value))
    if (!value.every((v) => typeof v === 'string' && allowed.has(v))) return this.fail(key, 'Pick from the listed options.')
    return [...new Set(value as string[])]
  }

  /**
   * The health notes: a rich-text document (see src/lib/rich-text.ts) or plain text (one paragraph
   * per line). Blank or with nothing visible clears it. Returns a clean copy built from the allowed
   * parts only; a node, mark or link outside them is a field error.
   */
  richText(key: string, opts: { maxChars?: number } = {}) {
    const value = this.raw[key]
    if (value === undefined) return undefined
    if (value === null || value === '') return null
    const candidate = typeof value === 'string' ? plainTextToDoc(value) : value
    if (candidate === null) return null
    const result = validateRichText(candidate, opts)
    if (!result.ok) return this.fail(key, result.error)
    return isRichTextEmpty(result.doc) ? null : result.doc
  }

  /** A plain decimal number. Blank clears it. Hex, exponents, arrays and booleans are not numbers. */
  number(key: string, opts: { min?: number; max?: number } = {}) {
    const value = this.raw[key]
    if (value === undefined) return undefined
    if (value === null) return null
    let n: number
    if (typeof value === 'number') {
      n = value
    } else if (typeof value === 'string') {
      const text = value.trim()
      if (!text) return null // whitespace-only is blank, not zero
      if (!/^-?\d+(\.\d+)?$/.test(text)) return this.fail(key, 'Enter a number.')
      n = Number(text)
    } else {
      return this.fail(key, 'Enter a number.')
    }
    if (!Number.isFinite(n)) return this.fail(key, 'Enter a number.')
    if (opts.min !== undefined && n < opts.min) return this.fail(key, `Must be ${opts.min} or more.`)
    const max = opts.max ?? 1_000_000_000
    if (n > max) return this.fail(key, `Must be ${max} or less.`)
    return n === 0 ? 0 : n // no negative zero
  }

  /** A calendar date as YYYY-MM-DD. */
  date(key: string) {
    const value = this.raw[key]
    if (value === undefined) return undefined
    if (value === null || value === '') return null
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
      return this.fail(key, 'Use the format YYYY-MM-DD.')
    }
    // Date.parse rolls 2026-02-31 over to March; require that the date survives a round trip.
    if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) return this.fail(key, 'That date does not exist.')
    return value
  }

  /** A database id, or null to clear a link. */
  id(key: string) {
    const value = this.raw[key]
    if (value === undefined) return undefined
    if (value === null || value === '') return null
    const id = toId(value)
    return id === null ? this.fail(key, 'Not a valid id.') : id
  }

  ids(key: string, opts: { min?: number; max?: number } = {}) {
    const value = this.raw[key]
    if (value === undefined) return opts.min ? this.missing(key) : undefined
    if (!Array.isArray(value)) return this.fail(key, 'Must be a list.')
    const parsed = value.map(toId)
    if (parsed.some((id) => id === null)) return this.fail(key, 'Not a valid list of ids.')
    const ids = parsed as number[]
    const unique = [...new Set(ids)]
    if (opts.min !== undefined && unique.length < opts.min) return this.fail(key, `Add at least ${opts.min}.`)
    if (opts.max !== undefined && unique.length > opts.max) return this.fail(key, `Add at most ${opts.max}.`)
    return unique
  }

  slug(key: string, opts: { required?: boolean; reserved?: readonly string[] } = {}) {
    const value = opts.required ? this.requiredText(key, 80) : this.text(key, 80)
    if (!value) return value
    if (!SLUG_PATTERN.test(value)) return this.fail(key, 'Use lowercase letters, numbers and single dashes only.')
    if (opts.reserved?.includes(value)) return this.fail(key, `"${value}" is used by the site itself. Pick another address.`)
    return value
  }

  fail_(key: string, message: string) {
    this.fail(key, message)
  }

  done() {
    if (Object.keys(this.errors).length) throw new ValidationError(this.errors)
  }
}
