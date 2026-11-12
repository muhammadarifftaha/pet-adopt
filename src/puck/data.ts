import type { Data } from '@puckeditor/core'

export const EMPTY_DATA: Data = { content: [], root: { props: {} }, zones: {} }

/** Props that are filled in at render time and must never be saved into the page JSON. */
const TRANSIENT_PROPS = ['pets']

export function stripTransient(data: Data): Data {
  return {
    ...data,
    content: (data.content ?? []).map((item) => {
      const props = { ...(item.props as Record<string, unknown>) }
      for (const key of TRANSIENT_PROPS) delete props[key]
      return { ...item, props } as (typeof data.content)[number]
    }),
  }
}

export function isPuckData(value: unknown): value is Data {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { content?: unknown }).content) &&
    (value as { content: unknown[] }).content.every(
      (item) => typeof item === 'object' && item !== null && typeof (item as { type?: unknown }).type === 'string',
    )
  )
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
