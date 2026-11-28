import type { Config, Data } from '@puckeditor/core'

// Makes a saved layout safe to draw. A layout is JSON that a browser sent, so a block's options can
// hold anything: an object where the block expects text (React refuses to draw it, and the whole
// page fails), or a made-up value for a choice (which the blocks put into class names). This checks
// every block against the fields its config declares and REMOVES what does not fit, so the block
// falls back to its usual look. Nothing is added or reordered, and blocks the config does not know
// are left as they are (the renderer skips them).
//
// Pure, and used twice: when a layout is saved (src/server/pages.ts) and again when it is drawn
// (BuilderContent), so a layout stored before this check existed cannot break a page either.

type Json = Record<string, unknown>
type Field = {
  type?: string
  options?: ReadonlyArray<{ value: unknown }>
  /** A custom field whose value is one plain id (a plugin block's `choice` option): never an object. */
  plainValue?: boolean
  arrayFields?: Record<string, Field>
  objectFields?: Record<string, Field>
}
type Block = { type: string; props: Json }

const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isBlock = (value: unknown): value is Block => isObject(value) && typeof value.type === 'string' && isObject(value.props)
const isText = (value: unknown) => typeof value === 'string' || typeof value === 'number'
/** A missing value is always fine: every block option is optional. */
const missing = (value: unknown) => value === undefined || value === null

/** Inside a picker's value (an image is `{ id, url, alt }`), these are drawn as text or addresses. */
const TEXT_KEYS = new Set(['url', 'src', 'href', 'alt', 'name', 'label', 'title', 'thumbnailUrl'])

/** A picker's value: a plain value, or one flat object of plain values with its text keys as text. */
function cleanPicked(value: unknown): unknown {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (!isObject(value)) return undefined
  const out: Json = {}
  for (const [key, entry] of Object.entries(value)) {
    if (TEXT_KEYS.has(key) ? typeof entry === 'string' : entry === null || ['string', 'number', 'boolean'].includes(typeof entry)) out[key] = entry
  }
  return out
}

function cleanValue(value: unknown, field: Field, config: Config): unknown {
  if (missing(value)) return value
  switch (field.type) {
    case 'text':
    case 'textarea':
      return isText(value) ? value : undefined
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined
    case 'select':
    case 'radio':
      // Only a value the field offers. Without a list of options there is nothing to check against.
      return !field.options || field.options.some((option) => option.value === value) ? (isObject(value) || Array.isArray(value) ? undefined : value) : undefined
    case 'array':
      if (!Array.isArray(value)) return undefined
      return value.filter(isObject).map((item) => cleanProps(item, field.arrayFields ?? {}, config))
    case 'object':
      return isObject(value) ? cleanProps(value, field.objectFields ?? {}, config) : undefined
    case 'slot':
      return Array.isArray(value) ? value.filter(isBlock).map((block) => cleanBlock(block, config)) : undefined
    case 'custom':
    case 'external':
      if (field.plainValue) return (typeof value === 'string' && value.length <= 200) || (typeof value === 'number' && Number.isFinite(value)) ? value : undefined
      return cleanPicked(value)
    default:
      return value
  }
}

function cleanProps(props: Json, fields: Record<string, Field>, config: Config): Json {
  const out: Json = {}
  for (const [key, value] of Object.entries(props)) {
    const field = Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : undefined
    // A prop no field declares (the block's id, an option the editor no longer shows) is kept only
    // as a plain value: nothing a block could try to draw as an element.
    const cleaned = field ? cleanValue(value, field, config) : missing(value) || ['string', 'number', 'boolean'].includes(typeof value) ? value : undefined
    if (cleaned !== undefined) out[key] = cleaned
  }
  return out
}

function cleanBlock(block: Block, config: Config): Block {
  const component = (config.components as Record<string, { fields?: Record<string, Field> } | undefined>)[block.type]
  if (!component) return block
  return { ...block, props: cleanProps(block.props, component.fields ?? {}, config) }
}

/** The layout with every block's options checked against `config` (see the notes above). */
export function sanitizeLayout<T extends Data>(data: T, config: Config): T {
  const blocks = (list: unknown) => (Array.isArray(list) ? list.map((item) => (isBlock(item) ? cleanBlock(item, config) : item)) : list)
  const zones = isObject(data.zones) ? Object.fromEntries(Object.entries(data.zones).map(([zone, list]) => [zone, blocks(list)])) : data.zones
  return { ...data, content: blocks(data.content), ...(data.zones === undefined ? {} : { zones }) } as T
}

/**
 * One word for a class name ("section-<this>"): letters, digits and dashes only, so a stored value
 * can never add classes of its own. Anything else becomes `fallback`.
 */
export function classToken(value: unknown, fallback = 'default'): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : fallback
}
