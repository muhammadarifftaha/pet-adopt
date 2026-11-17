import type { Data } from '@puckeditor/core'

export const EMPTY_DATA: Data = { content: [], root: { props: {} }, zones: {} }

/** Props that are filled in at render time and must never be saved into the page JSON. */
const TRANSIENT_PROPS = ['pets']

/** A saved layout is a few kilobytes. Anything near this size is a mistake or an attack. */
const MAX_BYTES = 1_000_000
const MAX_DEPTH = 30

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type Block = Data['content'][number]

function stripBlock(item: Block): Block {
  const props = { ...(item.props as Record<string, unknown>) }
  for (const key of TRANSIENT_PROPS) delete props[key]
  return { ...item, props } as Block
}

export function stripTransient(data: Data): Data {
  const zones = isObject(data.zones)
    ? Object.fromEntries(
        Object.entries(data.zones).map(([name, items]) => [name, Array.isArray(items) ? (items as Block[]).map(stripBlock) : items]),
      )
    : data.zones
  return { ...data, content: (data.content ?? []).map(stripBlock), ...(zones !== undefined ? { zones } : {}) } as Data
}

/** Control characters except tab and line breaks. PostgreSQL refuses a NUL inside JSON text. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** The same value with control characters removed from every string and every key. */
export function stripControlChars<T>(value: T): T {
  if (typeof value === 'string') return value.replace(CONTROL_CHARS, '') as T
  if (Array.isArray(value)) return value.map(stripControlChars) as T
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(CONTROL_CHARS, ''), stripControlChars(item)])) as T
  }
  return value
}

function withinDepth(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false
  if (Array.isArray(value)) return value.every((item) => withinDepth(item, depth + 1))
  if (isObject(value)) return Object.values(value).every((item) => withinDepth(item, depth + 1))
  return true
}

// A block needs a type and a props object: the renderer reads both of them for every block, so a
// missing or non-object `props` would crash the public page that shows it.
const isBlock = (item: unknown): boolean =>
  isObject(item) && typeof item.type === 'string' && item.type.length > 0 && item.type.length <= 60 && isObject(item.props)

export function isPuckData(value: unknown): value is Data {
  if (!isObject(value) || !Array.isArray(value.content) || !value.content.every(isBlock)) return false
  if (value.root !== undefined && !(isObject(value.root) && (value.root.props === undefined || isObject(value.root.props)))) return false
  if (value.zones !== undefined && !(isObject(value.zones) && Object.values(value.zones).every((zone) => Array.isArray(zone) && zone.every(isBlock)))) {
    return false
  }
  try {
    return withinDepth(value) && JSON.stringify(value).length <= MAX_BYTES
  } catch {
    return false
  }
}

/** Shown on "/" until the owners publish a page with the slug "home". */
export const DEFAULT_HOME_DATA: Data = {
  root: { props: {} },
  zones: {},
  content: [
    {
      type: 'Hero',
      props: {
        id: 'default-hero',
        heading: 'Find your new best friend',
        subheading: 'Meet the pets looking for a loving home. Message us on WhatsApp to arrange a visit.',
        image: null,
        ctaLabel: 'Meet the pets',
        ctaHref: '/pets',
        showWhatsApp: true,
        align: 'center',
        height: 'md',
      },
    },
    {
      type: 'PetGrid',
      props: {
        id: 'default-grid',
        heading: 'Ready for adoption',
        species: '',
        status: 'available',
        featuredOnly: false,
        limit: 8,
        showViewAll: true,
        background: 'none',
      },
    },
    {
      type: 'CallToAction',
      props: {
        id: 'default-cta',
        heading: 'Have questions about adopting?',
        text: 'Send us a message and we will walk you through the process.',
        action: 'whatsapp',
        buttonLabel: 'Chat on WhatsApp',
        href: '',
        background: 'tint',
      },
    },
  ],
} as Data
