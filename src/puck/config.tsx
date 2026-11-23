import Image from 'next/image'
import Link from 'next/link'
import React from 'react'
import type { Config, Fields } from '@puckeditor/core'

import { PetCard } from '@/components/site/PetCard'
import { SmartLink } from '@/components/site/SmartLink'
import { SocialLinks } from '@/components/site/SocialIcons'
import { WhatsAppButton } from '@/components/site/WhatsAppButton'
import { safeMapEmbed } from '@/lib/links'
import { isPetStatus, normalizeSpecies, PetStatus, STATUSES } from '@/lib/options'
import type { PetCardData } from '@/lib/queries'
import { fillMessage } from '@/lib/whatsapp'

import { MediaPicker } from './media-picker'
import type { MediaValue, PuckSiteMetadata } from './types'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type Background = 'none' | 'tint' | 'dark'
type Spacing = 'sm' | 'md' | 'lg'

const backgroundField = {
  type: 'radio',
  label: 'Background',
  options: [
    { label: 'Plain', value: 'none' },
    { label: 'Tinted', value: 'tint' },
    { label: 'Dark', value: 'dark' },
  ],
} as const

const spacingField = {
  type: 'radio',
  label: 'Spacing',
  options: [
    { label: 'Compact', value: 'sm' },
    { label: 'Normal', value: 'md' },
    { label: 'Roomy', value: 'lg' },
  ],
} as const

const alignField = {
  type: 'radio',
  label: 'Alignment',
  options: [
    { label: 'Left', value: 'left' },
    { label: 'Center', value: 'center' },
  ],
} as const

const mediaField = (label: string) =>
  ({
    type: 'custom',
    label,
    render: ({ value, onChange }: { value: MediaValue; onChange: (v: MediaValue) => void }) => (
      <MediaPicker value={value} onChange={onChange} />
    ),
  }) as const

function Section({
  background = 'none',
  spacing = 'md',
  align = 'left',
  children,
}: {
  background?: Background
  spacing?: Spacing
  align?: 'left' | 'center'
  children: React.ReactNode
}) {
  return (
    <section className={`section section-${background} spacing-${spacing} align-${align}`}>
      <div className="container">{children}</div>
    </section>
  )
}

const paragraphs = (text?: string) =>
  (text ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

const siteOf = (puck: { metadata: Record<string, unknown> }) => (puck.metadata as Partial<PuckSiteMetadata>).site

// ---------------------------------------------------------------------------
// Block prop types
// ---------------------------------------------------------------------------

type HeroProps = {
  heading: string
  subheading: string
  image: MediaValue
  ctaLabel: string
  ctaHref: string
  showWhatsApp: boolean
  align: 'left' | 'center'
  height: 'md' | 'lg'
}

type TextSectionProps = { heading: string; body: string; align: 'left' | 'center'; background: Background; spacing: Spacing }

type ImageGalleryProps = {
  heading: string
  columns: 2 | 3 | 4
  items: { image: MediaValue; caption: string }[]
  background: Background
  spacing: Spacing
}

type PetGridProps = {
  heading: string
  species: string
  status: string
  featuredOnly: boolean
  limit: number
  showViewAll: boolean
  background: Background
  pets?: PetCardData[]
}

type CallToActionProps = {
  heading: string
  text: string
  action: 'whatsapp' | 'link'
  buttonLabel: string
  href: string
  background: Background
}

type TestimonialsProps = {
  heading: string
  items: { quote: string; name: string; detail: string }[]
  background: Background
}

type FaqProps = { heading: string; items: { question: string; answer: string }[]; background: Background }

type ContactInfoProps = {
  heading: string
  showAddress: boolean
  showHours: boolean
  showWhatsApp: boolean
  mapEmbedUrl: string
  background: Background
}

type SocialLinksBlockProps = { heading: string; align: 'left' | 'center'; background: Background }

export type PuckComponents = {
  Hero: HeroProps
  TextSection: TextSectionProps
  ImageGallery: ImageGalleryProps
  PetGrid: PetGridProps
  CallToAction: CallToActionProps
  Testimonials: TestimonialsProps
  Faq: FaqProps
  ContactInfo: ContactInfoProps
  SocialLinksBlock: SocialLinksBlockProps
}

// ---------------------------------------------------------------------------
// Config. Shared by the editor (client) and the public site (server).
// Blocks are plain presentational components, with no hooks or client-only code.
// ---------------------------------------------------------------------------

export const config: Config<PuckComponents> = {
  categories: {
    layout: { title: 'Sections', components: ['Hero', 'TextSection', 'ImageGallery', 'CallToAction'] },
    pets: { title: 'Pets', components: ['PetGrid'] },
    trust: { title: 'Trust & contact', components: ['Testimonials', 'Faq', 'ContactInfo', 'SocialLinksBlock'] },
  },
  components: {
    Hero: {
      label: 'Hero banner',
      defaultProps: {
        heading: 'Welcome',
        subheading: 'Tell visitors what makes your adoption service special.',
        image: null,
        ctaLabel: 'Meet the pets',
        ctaHref: '/pets',
        showWhatsApp: true,
        align: 'center',
        height: 'md',
      },
      fields: {
        heading: { type: 'text', label: 'Heading' },
        subheading: { type: 'textarea', label: 'Subheading' },
        image: mediaField('Background image'),
        ctaLabel: { type: 'text', label: 'Button text' },
        ctaHref: { type: 'text', label: 'Button link (e.g. /pets)' },
        showWhatsApp: {
          type: 'radio',
          label: 'WhatsApp button',
          options: [
            { label: 'Show', value: true },
            { label: 'Hide', value: false },
          ],
        },
        align: alignField,
        height: {
          type: 'radio',
          label: 'Height',
          options: [
            { label: 'Medium', value: 'md' },
            { label: 'Tall', value: 'lg' },
          ],
        },
      } as Fields<HeroProps>,
      render: ({ heading, subheading, image, ctaLabel, ctaHref, showWhatsApp, align, height, puck }) => {
        const site = siteOf(puck)
        return (
          <section className={`hero hero-${height} align-${align}${image ? ' hero-has-image' : ''}`}>
            {image && <Image src={image.url} alt={image.alt || ''} fill priority sizes="100vw" className="hero-image" />}
            <div className="container hero-content">
              {heading && <h1>{heading}</h1>}
              {subheading && <p className="hero-sub">{subheading}</p>}
              <div className="hero-actions">
                {ctaLabel && (
                  <SmartLink href={ctaHref} className="btn btn-primary">
                    {ctaLabel}
                  </SmartLink>
                )}
                {showWhatsApp && (
                  <WhatsAppButton
                    phone={site?.whatsappNumber}
                    message={fillMessage(site?.whatsappMessage, null)}
                    variant="outline"
                    className="btn-on-hero"
                  />
                )}
              </div>
            </div>
          </section>
        )
      },
    },

    TextSection: {
      label: 'Text',
      defaultProps: { heading: 'About us', body: 'Write a few paragraphs here.\n\nLeave a blank line to start a new paragraph.', align: 'left', background: 'none', spacing: 'md' },
      fields: {
        heading: { type: 'text' },
        body: { type: 'textarea', label: 'Text (blank line = new paragraph)' },
        align: alignField,
        background: backgroundField,
        spacing: spacingField,
      } as Fields<TextSectionProps>,
      render: ({ heading, body, align, background, spacing }) => (
        <Section background={background} spacing={spacing} align={align}>
          <div className="prose">
            {heading && <h2>{heading}</h2>}
            {paragraphs(body).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </Section>
      ),
    },

    ImageGallery: {
      label: 'Image gallery',
      defaultProps: { heading: '', columns: 3, items: [], background: 'none', spacing: 'md' },
      fields: {
        heading: { type: 'text' },
        columns: {
          type: 'radio',
          label: 'Columns',
          options: [
            { label: '2', value: 2 },
            { label: '3', value: 3 },
            { label: '4', value: 4 },
          ],
        },
        items: {
          type: 'array',
          label: 'Images',
          getItemSummary: (item) => item.caption || 'Image',
          defaultItemProps: { image: null, caption: '' },
          arrayFields: { image: mediaField('Image'), caption: { type: 'text' } },
        },
        background: backgroundField,
        spacing: spacingField,
      } as Fields<ImageGalleryProps>,
      render: ({ heading, columns, items, background, spacing }) => (
        <Section background={background} spacing={spacing}>
          {heading && <h2 className="section-title">{heading}</h2>}
          <div className={`gallery gallery-${columns}`}>
            {items
              .filter((item) => item.image)
              .map((item, i) => (
                <figure key={i}>
                  <div className="gallery-image">
                    <Image src={item.image!.url} alt={item.image!.alt || item.caption || ''} fill sizes="(max-width: 640px) 100vw, 33vw" />
                  </div>
                  {item.caption && <figcaption>{item.caption}</figcaption>}
                </figure>
              ))}
          </div>
        </Section>
      ),
    },

    PetGrid: {
      label: 'Pet grid',
      defaultProps: { heading: 'Ready for adoption', species: '', status: PetStatus.Available, featuredOnly: false, limit: 8, showViewAll: true, background: 'none' },
      fields: {
        heading: { type: 'text' },
        // Free text, because species is too: "cat", "guinea pig"... Leave empty for every species.
        species: { type: 'text', label: 'Species (empty for all)' },
        status: { type: 'select', label: 'Status', options: [{ label: 'Any status', value: '' }, ...STATUSES] },
        featuredOnly: {
          type: 'radio',
          label: 'Which pets',
          options: [
            { label: 'Latest', value: false },
            { label: 'Featured only', value: true },
          ],
        },
        limit: { type: 'number', label: 'How many (1-24)', min: 1, max: 24 },
        showViewAll: {
          type: 'radio',
          label: '"View all" link',
          options: [
            { label: 'Show', value: true },
            { label: 'Hide', value: false },
          ],
        },
        background: backgroundField,
      } as Fields<PetGridProps>,
      // Live data. Runs in the editor (via a server action) and on the server when rendering.
      // The result is never saved into the page JSON (see stripTransient).
      resolveData: async ({ props }, { metadata }) => {
        const fetchPets = (metadata as Partial<PuckSiteMetadata>).fetchPets
        if (!fetchPets) return { props }
        const pets = await fetchPets({
          species: normalizeSpecies(props.species) || undefined,
          status: isPetStatus(props.status) ? props.status : undefined,
          featuredOnly: props.featuredOnly,
          limit: Math.min(Math.max(Number(props.limit) || 8, 1), 24),
        })
        return { props: { ...props, pets } }
      },
      render: ({ heading, pets, showViewAll, background }) => (
        <Section background={background}>
          <div className="section-head">
            {heading && <h2 className="section-title">{heading}</h2>}
            {showViewAll && (
              <Link href="/pets" className="link-more">
                View all pets
              </Link>
            )}
          </div>
          {pets?.length ? (
            <div className="pet-grid">
              {pets.map((pet) => (
                <PetCard key={pet.id} pet={pet} />
              ))}
            </div>
          ) : (
            <p className="muted">No pets to show yet.</p>
          )}
        </Section>
      ),
    },

    CallToAction: {
      label: 'Call to action',
      defaultProps: { heading: 'Ready to meet them?', text: 'Send us a message and we will arrange a visit.', action: 'whatsapp', buttonLabel: 'Chat on WhatsApp', href: '', background: 'tint' },
      fields: {
        heading: { type: 'text' },
        text: { type: 'textarea' },
        action: {
          type: 'radio',
          label: 'Button opens',
          options: [
            { label: 'WhatsApp', value: 'whatsapp' },
            { label: 'A link', value: 'link' },
          ],
        },
        buttonLabel: { type: 'text', label: 'Button text' },
        href: { type: 'text', label: 'Link (only for "A link")' },
        background: backgroundField,
      } as Fields<CallToActionProps>,
      render: ({ heading, text, action, buttonLabel, href, background, puck }) => {
        const site = siteOf(puck)
        return (
          <Section background={background} align="center" spacing="lg">
            <div className="prose">
              {heading && <h2>{heading}</h2>}
              {text && <p>{text}</p>}
              {action === 'whatsapp' ? (
                <WhatsAppButton phone={site?.whatsappNumber} message={fillMessage(site?.whatsappMessage, null)} label={buttonLabel || 'Chat on WhatsApp'} />
              ) : (
                <SmartLink href={href} className="btn btn-primary">
                  {buttonLabel || 'Learn more'}
                </SmartLink>
              )}
            </div>
          </Section>
        )
      },
    },

    Testimonials: {
      label: 'Adopter stories',
      defaultProps: { heading: 'Happy tails', items: [{ quote: 'Adopting Mochi was the best decision we ever made.', name: 'The Tan family', detail: 'Adopted Mochi' }], background: 'tint' },
      fields: {
        heading: { type: 'text' },
        items: {
          type: 'array',
          label: 'Stories',
          getItemSummary: (item) => item.name || 'Story',
          defaultItemProps: { quote: '', name: '', detail: '' },
          arrayFields: { quote: { type: 'textarea' }, name: { type: 'text' }, detail: { type: 'text' } },
        },
        background: backgroundField,
      } as Fields<TestimonialsProps>,
      render: ({ heading, items, background }) => (
        <Section background={background}>
          {heading && <h2 className="section-title">{heading}</h2>}
          <div className="testimonials">
            {items.map((item, i) => (
              <blockquote key={i}>
                <p>{item.quote}</p>
                <footer>
                  <strong>{item.name}</strong>
                  {item.detail && <span> · {item.detail}</span>}
                </footer>
              </blockquote>
            ))}
          </div>
        </Section>
      ),
    },

    Faq: {
      label: 'FAQ',
      defaultProps: { heading: 'Frequently asked questions', items: [{ question: 'How does adoption work?', answer: 'Message us, meet the pet, and we will guide you through the next steps.' }], background: 'none' },
      fields: {
        heading: { type: 'text' },
        items: {
          type: 'array',
          label: 'Questions',
          getItemSummary: (item) => item.question || 'Question',
          defaultItemProps: { question: '', answer: '' },
          arrayFields: { question: { type: 'text' }, answer: { type: 'textarea' } },
        },
        background: backgroundField,
      } as Fields<FaqProps>,
      render: ({ heading, items, background }) => (
        <Section background={background}>
          <div className="prose">
            {heading && <h2>{heading}</h2>}
            <div className="faq">
              {items.map((item, i) => (
                <details key={i}>
                  <summary>{item.question}</summary>
                  {paragraphs(item.answer).map((p, j) => (
                    <p key={j}>{p}</p>
                  ))}
                </details>
              ))}
            </div>
          </div>
        </Section>
      ),
    },

    ContactInfo: {
      label: 'Contact & map',
      defaultProps: { heading: 'Visit us', showAddress: true, showHours: true, showWhatsApp: true, mapEmbedUrl: '', background: 'none' },
      fields: {
        heading: { type: 'text' },
        showAddress: { type: 'radio', label: 'Address', options: [{ label: 'Show', value: true }, { label: 'Hide', value: false }] },
        showHours: { type: 'radio', label: 'Opening hours', options: [{ label: 'Show', value: true }, { label: 'Hide', value: false }] },
        showWhatsApp: { type: 'radio', label: 'WhatsApp button', options: [{ label: 'Show', value: true }, { label: 'Hide', value: false }] },
        mapEmbedUrl: { type: 'text', label: 'Google Maps embed link (Share > Embed a map > copy src)' },
        background: backgroundField,
      } as Fields<ContactInfoProps>,
      render: ({ heading, showAddress, showHours, showWhatsApp, mapEmbedUrl, background, puck }) => {
        const site = siteOf(puck)
        const map = safeMapEmbed(mapEmbedUrl)
        return (
          <Section background={background}>
            <div className="contact-grid">
              <div className="prose">
                {heading && <h2>{heading}</h2>}
                {showAddress && site?.address && <p className="pre-line">{site.address}</p>}
                {showHours && site?.openingHours && <p className="pre-line">{site.openingHours}</p>}
                {showWhatsApp && <WhatsAppButton phone={site?.whatsappNumber} message={fillMessage(site?.whatsappMessage, null)} />}
              </div>
              {map && <iframe className="map" src={map} title="Map" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />}
            </div>
          </Section>
        )
      },
    },

    SocialLinksBlock: {
      label: 'Social links',
      defaultProps: { heading: 'Follow our rescues', align: 'center', background: 'none' },
      fields: { heading: { type: 'text' }, align: alignField, background: backgroundField } as Fields<SocialLinksBlockProps>,
      render: ({ heading, align, background, puck }) => (
        <Section background={background} align={align}>
          {heading && <h2 className="section-title">{heading}</h2>}
          <SocialLinks items={siteOf(puck)?.socials} className="social-links-large" />
        </Section>
      ),
    },
  },
}

