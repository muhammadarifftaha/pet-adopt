import type { Data } from '@puckeditor/core'

export const EMPTY_DATA: Data = { content: [], root: { props: {} }, zones: {} }

/** Props that are filled in at render time and must never be saved into the page JSON. */
const TRANSIENT_PROPS = ['pets', 'spotlight', 'profiles', 'catalog', 'form', 'headingLevel', 'similar', 'empty']

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

/** Whether a block will show a main heading (after its live data has been resolved). */
function showsHeading(item: Block): boolean {
  const props = item.props as Record<string, unknown>
  if (item.type === 'PetSpotlight') return Boolean(props.spotlight)
  // The Form block's heading falls back to the form's name, so it shows one whenever the form exists.
  if (item.type === 'FormBlock') return Boolean(props.form)
  // Pet page template: the Pet summary block's heading is the pet's name, always there.
  if (item.type === 'PetSummary') return true
  // A pet block that has nothing to show for this pet (resolveData sets `empty`) draws no heading.
  if (props.empty === true) return false
  return typeof props.heading === 'string' && props.heading.trim() !== ''
}

/**
 * Gives every top-level block a `headingLevel` for the live page: the first block that shows a
 * heading gets 1 (the page's only <h1>), every other block 2 (its heading is an <h2>, its item
 * headings <h3>). Size comes from CSS classes, not tags, so this changes structure, never looks.
 * `hasH1` is false when no block has a heading, so the page can add a hidden <h1> with its title.
 */
export function assignHeadingLevels(data: Data): { data: Data; hasH1: boolean } {
  let hasH1 = false
  const content = (data.content ?? []).map((item) => {
    const level = !hasH1 && showsHeading(item) ? 1 : 2
    if (level === 1) hasH1 = true
    return { ...item, props: { ...(item.props as Record<string, unknown>), headingLevel: level } } as Block
  })
  return { data: { ...data, content } as Data, hasH1 }
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

/**
 * Pages the site always has, listed with the other pages but fixed in place: they keep their address
 * and id and cannot be archived or deleted (see ensureSystemPages in src/server/pages.ts).
 */
export const SYSTEM_PAGE_SLUGS = ['home', 'pets', 'pet-page'] as const

/**
 * The Pet page template (system page, id 3): one layout, built with the pet blocks
 * (src/puck/pet-page-config.tsx), that draws every pet's page at /pets/<slug>. It has no address
 * of its own: /pet-page is a 404.
 */
export const PET_PAGE_SLUG = 'pet-page'

/** Every pet's page until the owners publish their own template: what the page used to show. */
export const DEFAULT_PET_PAGE_DATA: Data = {
  root: { props: {} },
  zones: {},
  content: [
    { type: 'PetGallery', props: { id: 'pet-gallery', thumbnails: 'below' } },
    { type: 'PetSummary', props: { id: 'pet-summary', headingStyle: 'normal', photo: 'none', photoShape: 'rounded', showStatus: true, showFacts: true } },
    { type: 'PetDescription', props: { id: 'pet-description', showButton: true, buttonLabel: '' } },
    { type: 'PetHealth', props: { id: 'pet-health', heading: 'Health', showChecks: true, showNotes: true, layout: 'columns', rowGap: 'default' } },
    { type: 'PetPersonality', props: { id: 'pet-personality', heading: 'Personality', showTemperament: true, showGoodWith: true, showNotes: true, layout: 'columns', rowGap: 'default' } },
    { type: 'PetTimeline', props: { id: 'pet-timeline', heading: 'Timeline', align: 'left', order: 'newest', limit: 5, showPhotos: true, showTime: true } },
    { type: 'MorePets', props: { id: 'more-pets', heading: 'More pets like this', count: 3 } },
  ],
}
export const isSystemPageSlug = (slug: string) => (SYSTEM_PAGE_SLUGS as readonly string[]).includes(slug)

/** The Pets page (/pets) until the owners publish their own: just the catalogue. */
export const DEFAULT_PETS_DATA: Data = {
  root: { props: {} },
  zones: {},
  content: [
    {
      type: 'PetCatalog',
      props: { id: 'pet-catalog', heading: 'Adoptable pets', headingStyle: 'normal', intro: '', showFilters: true, background: 'none' },
    },
  ],
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
