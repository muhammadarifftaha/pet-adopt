import Image from 'next/image'
import Link from 'next/link'
import React from 'react'
import type { Config, Fields } from '@puckeditor/core'

import { PetCard } from '@/components/site/PetCard'
import { CopyButton } from '@/components/site/CopyButton'
import { ImageCarousel } from '@/components/site/ImageCarousel'
import { PetCatalog } from '@/components/site/PetCatalog'
import { SmartLink } from '@/components/site/SmartLink'
import { SocialLinks } from '@/components/site/SocialIcons'
import { RichText } from '@/components/site/RichText'
import { WhatsAppButton } from '@/components/site/WhatsAppButton'
import { safeMapEmbed, safeVideoEmbed } from '@/lib/links'
import { isPetStatus, labelFor, normalizeSpecies, PetStatus, SPECIES, STATUSES } from '@/lib/options'
import type { CatalogData, PetCardData, PetSpotlightData } from '@/lib/queries'
import { fillMessage } from '@/lib/whatsapp'

import { BLOCK_ICON_OPTIONS, BlockIcon } from './icons'
import { MediaPicker } from './media-picker'
import { PetPicker } from './pet-picker'
import { FormPicker } from './form-picker'
import { PublicForm } from '@/components/site/PublicForm'
import type { PublicForm as PublicFormData } from './forms'
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

type HeadingStyle = 'normal' | 'display'

const headingStyleField = {
  type: 'radio',
  label: 'Heading size',
  options: [
    { label: 'Normal', value: 'normal' },
    { label: 'Display (very large)', value: 'display' },
  ],
} as const

/** The class for a block heading: the usual size, or the very large display size. */
const headingClass = (style: HeadingStyle | undefined, base = '') => [base, style === 'display' ? 'heading-display' : ''].filter(Boolean).join(' ') || undefined

type ButtonStyle = 'primary' | 'outline' | 'dark'

const buttonStyleField = {
  type: 'radio',
  label: 'Button style',
  options: [
    { label: 'Solid', value: 'primary' },
    { label: 'Outline', value: 'outline' },
    { label: 'Dark', value: 'dark' },
  ],
} as const

const buttonWidthField = {
  type: 'radio',
  label: 'Button width',
  options: [
    { label: 'Fit the text', value: 'auto' },
    { label: 'Full width', value: 'full' },
  ],
} as const

/** Button classes from the style and width options (unset means a solid, fitted button). */
const buttonClass = (style?: ButtonStyle, width?: 'auto' | 'full') =>
  ['btn', style === 'outline' ? 'btn-outline' : style === 'dark' ? 'btn-dark' : 'btn-primary', width === 'full' ? 'btn-block' : '']
    .filter(Boolean)
    .join(' ')

/**
 * Heading levels. On the live page every block gets `headingLevel` (see assignHeadingLevels): 1 for
 * the first block with a heading (the page's only <h1>), 2 for the rest. In the editor it is unset,
 * which reads as 2 (a Hero, as 1). The tag follows the level; the size follows the class
 * (hero-title, block-heading, item-heading, minor-heading), so structure never changes the look.
 */
type Level = { headingLevel?: 1 | 2 }

/** A Hero's heading: <h1>, or <h2> when another heading is already the page's <h1>. */
function HeroTitle({ level, style, children }: { level?: 1 | 2; style?: HeadingStyle; children: React.ReactNode }) {
  const Tag = level === 2 ? 'h2' : 'h1'
  return <Tag className={headingClass(style, 'hero-title')}>{children}</Tag>
}

/** A block's main heading: <h1> for the page's first heading, otherwise <h2>. */
function Title({ level, style, children }: { level?: 1 | 2; style?: HeadingStyle; children: React.ReactNode }) {
  const Tag = level === 1 ? 'h1' : 'h2'
  return <Tag className={headingClass(style, 'block-heading')}>{children}</Tag>
}

/** A card or item title inside a block: one level below the block's heading. */
function ItemTitle({ level, className, children }: { level?: 1 | 2; className?: string; children: React.ReactNode }) {
  const Tag = level === 1 ? 'h2' : 'h3'
  return <Tag className={['item-heading', className].filter(Boolean).join(' ')}>{children}</Tag>
}

const mediaField = (label: string) =>
  ({
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly }: { value: MediaValue; onChange: (v: MediaValue) => void; readOnly?: boolean }) => (
      <MediaPicker value={value} onChange={onChange} readOnly={readOnly} />
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

type PetButtonAction = 'page' | 'whatsapp'

/**
 * One pet as a full profile: the name over the photo, then the button, two short fact lines and the
 * pet's own lists (health, personality, good with) and texts. Built from the pet's saved details,
 * so it changes when the pet does. Used by the Pet spotlight and the Pet grid's profile layout.
 */
function PetProfile({
  pet,
  site,
  buttonLabel,
  buttonAction,
  headingStyle,
  level = 2,
}: {
  pet: PetSpotlightData
  site: PuckSiteMetadata['site'] | undefined
  buttonLabel?: string
  buttonAction?: PetButtonAction
  headingStyle?: HeadingStyle
  /** The name's heading level: 1 or 2 for a spotlight (it is the block's heading), 3 in a grid. */
  level?: 1 | 2 | 3
}) {
  const facts = [[pet.ageDescription, pet.sexLabel], [pet.breed || pet.speciesLabel, pet.color, pet.neutered ? 'Neutered' : null]]
    // The same separator as the pet cards and pet pages.
    .map((line) => line.filter(Boolean).join(' · '))
    .filter(Boolean)
  const label = buttonLabel || `Meet ${pet.name}`
  // Section titles sit one level below the pet's name, so no heading level is skipped.
  const Heading = (['h1', 'h2', 'h3'] as const)[level - 1]
  const Sub = (['h2', 'h3', 'h4'] as const)[level - 1]
  const lists: Array<[string, string[]]> = [
    ['Medical history', pet.healthChecks],
    ['Personality', pet.temperament],
    ['Good with', pet.goodWith],
  ]
  return (
    <article className="pet-profile" aria-labelledby={`pet-profile-${pet.id}`}>
      {/* Square by default; stretches to the text column's height when the text is longer. */}
      <div className="pet-profile-media">
        <div className="pet-profile-photo">
          {pet.image ? (
            <Image src={pet.image.url} alt={pet.image.alt || pet.name} fill sizes="(max-width: 800px) 100vw, 40vw" />
          ) : (
            <div className="image-text-placeholder" aria-hidden="true" />
          )}
        </div>
      </div>
      <div className="pet-profile-body">
        <Heading
          id={`pet-profile-${pet.id}`}
          className={headingClass(headingStyle ?? 'display', `pet-profile-name ${level === 3 ? 'item-heading' : 'block-heading'}`)}
        >
          {pet.name}
        </Heading>
        {buttonAction === 'whatsapp' ? (
          <WhatsAppButton phone={site?.whatsappNumber} message={fillMessage(site?.whatsappMessage, pet.name)} label={label} className="btn-block" />
        ) : (
          <Link href={`/pets/${pet.slug}`} className="btn btn-primary btn-block">
            {label}
          </Link>
        )}
        {facts.length > 0 && (
          <p className="pet-profile-facts">
            {facts.map((line, i) => (
              <span key={i}>{line}</span>
            ))}
          </p>
        )}
        {lists.map(([title, items]) =>
          items.length ? (
            <section key={title} className="pet-profile-list">
              <Sub className="minor-heading">{title}</Sub>
              <ul>
                {items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null,
        )}
        {pet.healthNotes && (
          <section className="pet-profile-list">
            <Sub className="minor-heading">Health notes</Sub>
            <RichText doc={pet.healthNotes} />
          </section>
        )}
        {pet.description && (
          <section className="pet-profile-list">
            <Sub className="minor-heading">About {pet.name}</Sub>
            <RichText doc={pet.description} />
          </section>
        )}
      </div>
    </article>
  )
}

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
  layout?: 'overlay' | 'stacked'
  headingStyle?: HeadingStyle
  buttonStyle?: ButtonStyle
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
  headingStyle?: HeadingStyle
  display?: 'cards' | 'profiles'
  species: string
  status: string
  featuredOnly: boolean
  limit: number
  showViewAll: boolean
  buttonLabel?: string
  buttonAction?: PetButtonAction
  background: Background
  pets?: PetCardData[]
  /** Filled in at render time for the profile layout, never saved. */
  profiles?: PetSpotlightData[]
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

type ImageTextProps = {
  image: MediaValue
  imageSide: 'left' | 'right'
  heading: string
  headingStyle?: HeadingStyle
  subheading?: string
  body: string
  ctaLabel: string
  ctaHref: string
  buttonStyle?: ButtonStyle
  buttonWidth?: 'auto' | 'full'
  imageWidth?: 'half' | 'wide'
  photoMode?: 'single' | 'pair'
  imageLabel?: string
  secondImage?: MediaValue
  secondImageLabel?: string
  background: Background
  spacing: Spacing
}

type AdoptionStepsProps = { heading: string; intro: string; items: { title: string; text: string }[]; background: Background }

type StatsProps = { heading: string; items: { value: string; label: string }[]; background: Background }

type VideoProps = { heading: string; url: string; caption: string; background: Background }

type ImageCarouselProps = { heading: string; items: { image: MediaValue; caption: string }[]; background: Background; spacing: Spacing }

type SpacerProps = { size: 'sm' | 'md' | 'lg' | 'xl' }

type DividerProps = { width: 'container' | 'narrow'; spacing: Spacing }

type PetCatalogProps = {
  heading: string
  headingStyle?: HeadingStyle
  intro: string
  showFilters: boolean
  background: Background
  /** Filled in at render time from the page's query string, never saved. */
  catalog?: CatalogData
}

type CostTableProps = {
  heading: string
  headingStyle: HeadingStyle
  intro: string
  image: MediaValue
  imageSide: 'left' | 'right'
  itemLabel: string
  valueLabel: string
  rows: { label: string; value: string; highlight: 'none' | 'total' | 'strong' }[]
  note: string
  background: Background
}

type PetSpotlightProps = {
  eyebrow: string
  petId: number | null
  layout?: 'spotlight' | 'profile'
  headingStyle?: HeadingStyle
  imageSide: 'left' | 'right'
  buttonLabel: string
  buttonAction?: PetButtonAction
  showWhatsApp: boolean
  background: Background
  /** Filled in at render time (resolveData), never saved. */
  spotlight?: PetSpotlightData | null
}

type TeamProps = {
  heading: string
  intro: string
  members: { photo: MediaValue; name: string; role: string; bio: string }[]
  background: Background
}

type FeaturesProps = {
  heading: string
  headingStyle?: HeadingStyle
  intro: string
  layout?: 'grid' | 'list'
  columns: 2 | 3 | 4
  items: { icon: string; title: string; text: string }[]
  align: 'left' | 'center'
  background: Background
}

type WaysToHelpProps = {
  heading: string
  intro: string
  items: { icon: string; title: string; text: string; action: 'none' | 'link' | 'whatsapp'; label: string; href: string }[]
  paymentTitle: string
  paymentDetails: string
  background: Background
}

type FormBlockProps = {
  formId: number | null
  /** Blank shows the form's own name. */
  heading: string
  showDescription: boolean
  background: Background
  /** Resolved at render (metadata.fetchForm); never saved (TRANSIENT_PROPS). */
  form?: PublicFormData | null
}

export type PuckComponents = {
  Hero: HeroProps & Level
  TextSection: TextSectionProps & Level
  ImageGallery: ImageGalleryProps & Level
  PetGrid: PetGridProps & Level
  CallToAction: CallToActionProps & Level
  Testimonials: TestimonialsProps & Level
  Faq: FaqProps & Level
  ContactInfo: ContactInfoProps & Level
  SocialLinksBlock: SocialLinksBlockProps & Level
  ImageText: ImageTextProps & Level
  AdoptionSteps: AdoptionStepsProps & Level
  Stats: StatsProps & Level
  Video: VideoProps & Level
  ImageCarousel: ImageCarouselProps & Level
  Spacer: SpacerProps & Level
  Divider: DividerProps & Level
  PetSpotlight: PetSpotlightProps & Level
  Team: TeamProps & Level
  Features: FeaturesProps & Level
  WaysToHelp: WaysToHelpProps & Level
  CostTable: CostTableProps & Level
  PetCatalog: PetCatalogProps & Level
  FormBlock: FormBlockProps & Level
}

// ---------------------------------------------------------------------------
// Config. Shared by the editor (client) and the public site (server).
// Blocks are plain presentational components, with no hooks or client-only code.
// ---------------------------------------------------------------------------

export const config: Config<PuckComponents> = {
  categories: {
    layout: { title: 'Sections', components: ['Hero', 'TextSection', 'ImageText', 'Features', 'CallToAction'] },
    media: { title: 'Media', components: ['ImageGallery', 'ImageCarousel', 'Video'] },
    pets: { title: 'Pets', components: ['PetCatalog', 'PetSpotlight', 'PetGrid', 'AdoptionSteps', 'Stats'] },
    trust: { title: 'Trust & contact', components: ['Testimonials', 'Team', 'WaysToHelp', 'CostTable', 'Faq', 'FormBlock', 'ContactInfo', 'SocialLinksBlock'] },
    helpers: { title: 'Layout helpers', components: ['Spacer', 'Divider'] },
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
        layout: {
          type: 'radio',
          label: 'Layout',
          options: [
            { label: 'Text over the image', value: 'overlay' },
            { label: 'Image above the text', value: 'stacked' },
          ],
        },
        headingStyle: headingStyleField,
        buttonStyle: buttonStyleField,
      } as Fields<HeroProps>,
      render: ({ headingLevel,  heading, subheading, image, ctaLabel, ctaHref, showWhatsApp, align, height, layout, headingStyle, buttonStyle, puck }) => {
        const site = siteOf(puck)
        if (layout === 'stacked') {
          // A rounded photo with the heading, text and buttons under it, on the page's own colours.
          return (
            <section className={`hero-stacked align-${align}`}>
              <div className="container">
                {image && (
                  <div className={`hero-stacked-image hero-stacked-${height}`}>
                    <Image src={image.url} alt={image.alt || ''} fill priority sizes="100vw" />
                  </div>
                )}
                {heading && <HeroTitle level={headingLevel} style={headingStyle}>{heading}</HeroTitle>}
                {subheading && <p className="hero-sub">{subheading}</p>}
                <div className="hero-actions">
                  {ctaLabel && (
                    <SmartLink href={ctaHref} className={buttonClass(buttonStyle)}>
                      {ctaLabel}
                    </SmartLink>
                  )}
                  {showWhatsApp && <WhatsAppButton phone={site?.whatsappNumber} message={fillMessage(site?.whatsappMessage, null)} variant="outline" />}
                </div>
              </div>
            </section>
          )
        }
        return (
          <section className={`hero hero-${height} align-${align}${image ? ' hero-has-image' : ''}`}>
            {image && <Image src={image.url} alt={image.alt || ''} fill priority sizes="100vw" className="hero-image" />}
            <div className="container hero-content">
              {heading && <HeroTitle level={headingLevel} style={headingStyle}>{heading}</HeroTitle>}
              {subheading && <p className="hero-sub">{subheading}</p>}
              <div className="hero-actions">
                {ctaLabel && (
                  <SmartLink href={ctaHref} className={buttonClass(buttonStyle)}>
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
      render: ({ headingLevel,  heading, body, align, background, spacing }) => (
        <Section background={background} spacing={spacing} align={align}>
          <div className="prose">
            {heading && <Title level={headingLevel}>{heading}</Title>}
            {paragraphs(body).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </Section>
      ),
    },

    ImageGallery: {
      // Shown to owners as "Image grid". The type key stays ImageGallery: saved pages refer to it.
      label: 'Image grid',
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
      render: ({ headingLevel,  heading, columns, items, background, spacing }) => (
        <Section background={background} spacing={spacing}>
          {heading && <Title level={headingLevel}>{heading}</Title>}
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
        headingStyle: headingStyleField,
        display: {
          type: 'radio',
          label: 'Show pets as',
          options: [
            { label: 'Cards in a grid', value: 'cards' },
            { label: 'Full profiles, one after another (up to 12)', value: 'profiles' },
          ],
        },
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
        buttonLabel: { type: 'text', label: 'Profile button text (default: Meet <name>)' },
        buttonAction: {
          type: 'radio',
          label: 'Profile button opens',
          options: [
            { label: "The pet's page", value: 'page' },
            { label: 'WhatsApp', value: 'whatsapp' },
          ],
        },
        background: backgroundField,
      } as Fields<PetGridProps>,
      // Live data. Runs in the editor (via a server action) and on the server when rendering.
      // The result is never saved into the page JSON (see stripTransient).
      resolveData: async ({ props }, { metadata }) => {
        const meta = metadata as Partial<PuckSiteMetadata>
        const filters = {
          species: normalizeSpecies(props.species) || undefined,
          status: isPetStatus(props.status) ? props.status : undefined,
          featuredOnly: props.featuredOnly,
        }
        // Only the layout that is shown is fetched.
        if (props.display === 'profiles') {
          if (!meta.fetchPetProfiles) return { props }
          const profiles = await meta.fetchPetProfiles({ ...filters, limit: Math.min(Math.max(Number(props.limit) || 6, 1), 12) })
          return { props: { ...props, profiles, pets: undefined } }
        }
        if (!meta.fetchPets) return { props }
        const pets = await meta.fetchPets({ ...filters, limit: Math.min(Math.max(Number(props.limit) || 8, 1), 24) })
        return { props: { ...props, pets, profiles: undefined } }
      },
      render: ({ headingLevel,  heading, headingStyle, display, pets, profiles, showViewAll, buttonLabel, buttonAction, background, puck }) => (
        <Section background={background}>
          <div className="section-head">
            {heading && <Title level={headingLevel} style={headingStyle}>{heading}</Title>}
            {showViewAll && (
              <Link href="/pets" className="link-more">
                View all pets
              </Link>
            )}
          </div>
          {display === 'profiles' ? (
            profiles?.length ? (
              <div className="pet-profiles">
                {profiles.map((pet) => (
                  <PetProfile
                    key={pet.id}
                    pet={pet}
                    site={siteOf(puck)}
                    buttonLabel={buttonLabel}
                    buttonAction={buttonAction}
                    level={headingLevel === 1 ? 2 : 3}
                  />
                ))}
              </div>
            ) : (
              <p className="muted">No pets to show yet.</p>
            )
          ) : pets?.length ? (
            <div className="pet-grid">
              {pets.map((pet) => (
                <PetCard key={pet.id} pet={pet} headingLevel={headingLevel === 1 ? 'h2' : 'h3'} />
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
      render: ({ headingLevel,  heading, text, action, buttonLabel, href, background, puck }) => {
        const site = siteOf(puck)
        return (
          <Section background={background} align="center" spacing="lg">
            <div className="prose">
              {heading && <Title level={headingLevel}>{heading}</Title>}
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
      render: ({ headingLevel,  heading, items, background }) => (
        <Section background={background}>
          {heading && <Title level={headingLevel}>{heading}</Title>}
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
      render: ({ headingLevel,  heading, items, background }) => (
        <Section background={background}>
          <div className="prose">
            {heading && <Title level={headingLevel}>{heading}</Title>}
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
      render: ({ headingLevel,  heading, showAddress, showHours, showWhatsApp, mapEmbedUrl, background, puck }) => {
        const site = siteOf(puck)
        const map = safeMapEmbed(mapEmbedUrl)
        return (
          <Section background={background}>
            <div className="contact-grid">
              <div className="prose">
                {heading && <Title level={headingLevel}>{heading}</Title>}
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
      render: ({ headingLevel,  heading, align, background, puck }) => (
        <Section background={background} align={align}>
          {heading && <Title level={headingLevel}>{heading}</Title>}
          <SocialLinks items={siteOf(puck)?.socials} className="social-links-large" />
        </Section>
      ),
    },

    ImageText: {
      label: 'Image + text',
      defaultProps: {
        image: null,
        imageSide: 'left',
        heading: 'Our shelter',
        body: 'Tell visitors about your rescue, your volunteers or how you care for the animals.\n\nLeave a blank line to start a new paragraph.',
        ctaLabel: '',
        ctaHref: '',
        background: 'none',
        spacing: 'md',
      },
      fields: {
        image: mediaField('Image'),
        imageSide: {
          type: 'radio',
          label: 'Image side',
          options: [
            { label: 'Left', value: 'left' },
            { label: 'Right', value: 'right' },
          ],
        },
        heading: { type: 'text' },
        headingStyle: headingStyleField,
        subheading: { type: 'text', label: 'Bold line under the heading (optional)' },
        body: { type: 'textarea', label: 'Text (blank line = new paragraph)' },
        ctaLabel: { type: 'text', label: 'Button text (optional)' },
        ctaHref: { type: 'text', label: 'Button link (e.g. /pets)' },
        buttonStyle: buttonStyleField,
        buttonWidth: buttonWidthField,
        imageWidth: {
          type: 'radio',
          label: 'Photo width',
          options: [
            { label: 'Half', value: 'half' },
            { label: 'Wide', value: 'wide' },
          ],
        },
        photoMode: {
          type: 'radio',
          label: 'Photos',
          options: [
            { label: 'One photo', value: 'single' },
            { label: 'Two stacked (e.g. before / after)', value: 'pair' },
          ],
        },
        imageLabel: { type: 'text', label: 'Label on the photo (optional, e.g. Before)' },
        secondImage: mediaField('Second photo (two stacked only)'),
        secondImageLabel: { type: 'text', label: 'Label on the second photo (e.g. After)' },
        background: backgroundField,
        spacing: spacingField,
      } as Fields<ImageTextProps>,
      render: ({
        headingLevel,
        image,
        imageSide,
        heading,
        headingStyle,
        subheading,
        body,
        ctaLabel,
        ctaHref,
        buttonStyle,
        buttonWidth,
        imageWidth,
        photoMode,
        imageLabel,
        secondImage,
        secondImageLabel,
        background,
        spacing,
      }) => {
        const photo = (value: MediaValue, label?: string) => (
          <figure className="image-text-media">
            {value ? (
              <Image src={value.url} alt={value.alt || ''} fill sizes="(max-width: 800px) 100vw, 50vw" />
            ) : (
              <div className="image-text-placeholder" aria-hidden="true" />
            )}
            {/* The label is part of the picture's meaning ("Before"), so it is real text, on a dark chip
                that keeps it readable over any photo. */}
            {label && <figcaption className="photo-label">{label}</figcaption>}
          </figure>
        )
        return (
          <Section background={background} spacing={spacing}>
            <div className={`image-text image-text-${imageSide}${imageWidth === 'wide' ? ' image-text-wide' : ''}`}>
              {photoMode === 'pair' ? (
                <div className="image-text-pair">
                  {photo(image, imageLabel)}
                  {photo(secondImage ?? null, secondImageLabel)}
                </div>
              ) : (
                photo(image, imageLabel)
              )}
              <div className="prose">
                {heading && <Title level={headingLevel} style={headingStyle}>{heading}</Title>}
                {subheading && <p className="image-text-subheading">{subheading}</p>}
                {paragraphs(body).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
                {ctaLabel && (
                  <SmartLink href={ctaHref} className={buttonClass(buttonStyle, buttonWidth)}>
                    {ctaLabel}
                  </SmartLink>
                )}
              </div>
            </div>
          </Section>
        )
      },
    },

    AdoptionSteps: {
      label: 'Adoption steps',
      defaultProps: {
        heading: 'How adoption works',
        intro: '',
        items: [
          { title: 'Browse', text: 'Look through the pets and find one you would love to meet.' },
          { title: 'Message us', text: 'Send us a WhatsApp message and we will answer your questions.' },
          { title: 'Meet', text: 'Visit the pet and see if you are a good match for each other.' },
          { title: 'Take them home', text: 'We help with the paperwork and the first days together.' },
        ],
        background: 'none',
      },
      fields: {
        heading: { type: 'text' },
        intro: { type: 'textarea', label: 'Intro (optional)' },
        items: {
          type: 'array',
          label: 'Steps',
          getItemSummary: (item) => item.title || 'Step',
          defaultItemProps: { title: '', text: '' },
          arrayFields: { title: { type: 'text' }, text: { type: 'textarea' } },
        },
        background: backgroundField,
      } as Fields<AdoptionStepsProps>,
      render: ({ headingLevel,  heading, intro, items, background }) => (
        <Section background={background}>
          {heading && <Title level={headingLevel}>{heading}</Title>}
          {intro && <p className="section-intro">{intro}</p>}
          {/* An ordered list: the order is the point, and screen readers announce "1 of 4". */}
          <ol className="steps">
            {items.map((item, i) => (
              <li key={i}>
                <span className="step-number" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  {item.title && <ItemTitle level={headingLevel}>{item.title}</ItemTitle>}
                  {item.text && <p>{item.text}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      ),
    },

    Stats: {
      label: 'Numbers',
      defaultProps: {
        heading: '',
        items: [
          { value: '120+', label: 'Pets adopted' },
          { value: '8', label: 'Years rescuing' },
          { value: '30', label: 'Volunteers' },
        ],
        background: 'tint',
      },
      fields: {
        heading: { type: 'text', label: 'Heading (optional)' },
        items: {
          type: 'array',
          label: 'Numbers',
          getItemSummary: (item) => [item.value, item.label].filter(Boolean).join(' ') || 'Number',
          defaultItemProps: { value: '', label: '' },
          arrayFields: { value: { type: 'text', label: 'Number (e.g. 120+)' }, label: { type: 'text', label: 'What it counts' } },
        },
        background: backgroundField,
      } as Fields<StatsProps>,
      render: ({ headingLevel,  heading, items, background }) => (
        <Section background={background} align="center">
          {heading && <Title level={headingLevel}>{heading}</Title>}
          {/* A description list keeps each number with its label for screen readers. */}
          <dl className="stats">
            {items.map((item, i) => (
              <div key={i} className="stat">
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ),
    },

    Video: {
      label: 'Video',
      defaultProps: { heading: '', url: '', caption: '', background: 'none' },
      fields: {
        heading: { type: 'text', label: 'Heading (optional)' },
        url: { type: 'text', label: 'YouTube or Vimeo link (https://...)' },
        caption: { type: 'text', label: 'Caption (optional)' },
        background: backgroundField,
      } as Fields<VideoProps>,
      render: ({ headingLevel,  heading, url, caption, background }) => {
        const embed = safeVideoEmbed(url)
        return (
          <Section background={background}>
            {heading && <Title level={headingLevel}>{heading}</Title>}
            {embed ? (
              <figure className="video-block">
                <div className="video-frame">
                  <iframe
                    src={embed}
                    title={caption || heading || 'Video'}
                    loading="lazy"
                    allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                </div>
                {caption && <figcaption>{caption}</figcaption>}
              </figure>
            ) : (
              <p className="muted">{url ? 'Use a YouTube or Vimeo link that starts with https://' : 'Paste a YouTube or Vimeo link.'}</p>
            )}
          </Section>
        )
      },
    },

    ImageCarousel: {
      label: 'Image carousel',
      defaultProps: { heading: '', items: [], background: 'none', spacing: 'md' },
      fields: {
        heading: { type: 'text', label: 'Heading (optional)' },
        items: {
          type: 'array',
          label: 'Slides',
          getItemSummary: (item) => item.caption || item.image?.alt || 'Slide',
          defaultItemProps: { image: null, caption: '' },
          arrayFields: { image: mediaField('Image'), caption: { type: 'text', label: 'Caption (optional)' } },
        },
        background: backgroundField,
        spacing: spacingField,
      } as Fields<ImageCarouselProps>,
      render: ({ headingLevel,  heading, items, background, spacing }) => {
        // Only plain strings cross to the client component.
        const slides = items
          .filter((item) => item.image)
          .map((item) => ({ url: item.image!.url, alt: item.image!.alt || '', caption: item.caption || '' }))
        return (
          <Section background={background} spacing={spacing}>
            {heading && <Title level={headingLevel}>{heading}</Title>}
            {slides.length ? <ImageCarousel items={slides} label={heading} /> : <p className="muted">Add images to the carousel.</p>}
          </Section>
        )
      },
    },

    PetSpotlight: {
      label: 'Pet spotlight',
      defaultProps: { eyebrow: 'Pet of the week', petId: null, imageSide: 'left', buttonLabel: '', showWhatsApp: true, background: 'tint' },
      fields: {
        eyebrow: { type: 'text', label: 'Small heading (e.g. Pet of the week)' },
        petId: {
          type: 'custom',
          label: 'Pet',
          render: ({ id, value, onChange, readOnly }: { id: string; value: number | null; onChange: (value: number | null) => void; readOnly?: boolean }) => (
            <PetPicker id={id} value={value} onChange={onChange} readOnly={readOnly} />
          ),
        },
        layout: {
          type: 'radio',
          label: 'Layout',
          options: [
            { label: 'Spotlight (photo and short story)', value: 'spotlight' },
            { label: 'Full profile (facts and lists)', value: 'profile' },
          ],
        },
        headingStyle: headingStyleField,
        imageSide: {
          type: 'radio',
          label: 'Photo side',
          options: [
            { label: 'Left', value: 'left' },
            { label: 'Right', value: 'right' },
          ],
        },
        buttonLabel: { type: 'text', label: 'Button text (default: Meet <name>)' },
        buttonAction: {
          type: 'radio',
          label: 'Button opens',
          options: [
            { label: "The pet's page", value: 'page' },
            { label: 'WhatsApp', value: 'whatsapp' },
          ],
        },
        showWhatsApp: {
          type: 'radio',
          label: 'WhatsApp button',
          options: [
            { label: 'Show', value: true },
            { label: 'Hide', value: false },
          ],
        },
        background: backgroundField,
      } as Fields<PetSpotlightProps>,
      // Live data, like the pet grid: the pet is looked up when the page renders, so its photo,
      // age and status are always current. Never saved into the page JSON (see stripTransient).
      resolveData: async ({ props }, { metadata }) => {
        const fetchPet = (metadata as Partial<PuckSiteMetadata>).fetchPet
        const id = Number(props.petId)
        if (!fetchPet || !Number.isSafeInteger(id) || id < 1) return { props: { ...props, spotlight: null } }
        return { props: { ...props, spotlight: await fetchPet(id) } }
      },
      render: ({ headingLevel, eyebrow, spotlight, petId, layout, headingStyle, imageSide, buttonLabel, buttonAction, showWhatsApp, background, puck }) => {
        // A pet that is adopted, link-only or gone hides the block on the live site.
        if (!spotlight) {
          return puck.isEditing ? (
            <Section background={background}>
              <p className="muted">
                {petId ? 'This pet is adopted, link-only or deleted, so the spotlight is hidden on the site.' : 'Choose a pet for the spotlight.'}
              </p>
            </Section>
          ) : (
            <></>
          )
        }
        const site = siteOf(puck)
        const pet = spotlight
        if (layout === 'profile') {
          return (
            <Section background={background}>
              {eyebrow && <p className="spotlight-eyebrow">{eyebrow}</p>}
              <PetProfile pet={pet} site={site} buttonLabel={buttonLabel} buttonAction={buttonAction} headingStyle={headingStyle} level={headingLevel ?? 2} />
            </Section>
          )
        }
        const details = [labelFor(SPECIES, pet.species), pet.ageDescription, pet.location].filter(Boolean).join(' · ')
        return (
          <Section background={background}>
            <div className={`spotlight image-text image-text-${imageSide}`}>
              <div className="image-text-media">
                {pet.image ? (
                  <Image src={pet.image.url} alt={pet.image.alt || pet.name} fill sizes="(max-width: 800px) 100vw, 50vw" />
                ) : (
                  <div className="image-text-placeholder" aria-hidden="true" />
                )}
              </div>
              <div className="prose">
                {eyebrow && <p className="spotlight-eyebrow">{eyebrow}</p>}
                <Title level={headingLevel} style={headingStyle}>
                  {pet.name}
                </Title>
                {details && <p className="muted">{details}</p>}
                {pet.story && <p>{pet.story}</p>}
                <div className="hero-actions">
                  {buttonAction === 'whatsapp' ? (
                    <WhatsAppButton phone={site?.whatsappNumber} message={fillMessage(site?.whatsappMessage, pet.name)} label={buttonLabel || `Ask about ${pet.name}`} />
                  ) : (
                    <Link href={`/pets/${pet.slug}`} className="btn btn-primary">
                      {buttonLabel || `Meet ${pet.name}`}
                    </Link>
                  )}
                  {showWhatsApp && buttonAction !== 'whatsapp' && (
                    <WhatsAppButton phone={site?.whatsappNumber} message={fillMessage(site?.whatsappMessage, pet.name)} variant="outline" />
                  )}
                </div>
              </div>
            </div>
          </Section>
        )
      },
    },

    Team: {
      label: 'Team',
      defaultProps: {
        heading: 'Meet the team',
        intro: '',
        members: [{ photo: null, name: 'Your name', role: 'Founder', bio: 'A line about what they do for the animals.' }],
        background: 'none',
      },
      fields: {
        heading: { type: 'text' },
        intro: { type: 'textarea', label: 'Intro (optional)' },
        members: {
          type: 'array',
          label: 'People',
          getItemSummary: (item) => item.name || 'Person',
          defaultItemProps: { photo: null, name: '', role: '', bio: '' },
          arrayFields: {
            photo: mediaField('Photo'),
            name: { type: 'text' },
            role: { type: 'text', label: 'Role (e.g. Volunteer vet)' },
            bio: { type: 'textarea', label: 'Short line (optional)' },
          },
        },
        background: backgroundField,
      } as Fields<TeamProps>,
      render: ({ headingLevel,  heading, intro, members, background }) => (
        <Section background={background}>
          {heading && <Title level={headingLevel}>{heading}</Title>}
          {intro && <p className="section-intro">{intro}</p>}
          <ul className="team">
            {members.map((member, i) => (
              <li key={i} className="team-member">
                <div className="team-photo">
                  {member.photo ? (
                    <Image src={member.photo.url} alt={member.photo.alt || member.name} fill sizes="160px" />
                  ) : (
                    <div className="image-text-placeholder" aria-hidden="true" />
                  )}
                </div>
                {member.name && <ItemTitle level={headingLevel}>{member.name}</ItemTitle>}
                {member.role && <p className="team-role">{member.role}</p>}
                {member.bio && <p className="muted">{member.bio}</p>}
              </li>
            ))}
          </ul>
        </Section>
      ),
    },

    Features: {
      label: 'Features with icons',
      defaultProps: {
        heading: 'Every pet comes',
        intro: '',
        columns: 3,
        items: [
          { icon: 'shield', title: 'Vaccinated', text: 'Up to date on vaccinations before going home.' },
          { icon: 'health', title: 'Vet checked', text: 'Seen by our vet, with health notes you can read.' },
          { icon: 'heart', title: 'Lifetime support', text: 'Questions after adoption? We are a message away.' },
        ],
        align: 'center',
        background: 'none',
      },
      fields: {
        heading: { type: 'text' },
        headingStyle: headingStyleField,
        intro: { type: 'textarea', label: 'Intro (optional)' },
        layout: {
          type: 'radio',
          label: 'Layout',
          options: [
            { label: 'Columns', value: 'grid' },
            { label: 'Heading beside a list', value: 'list' },
          ],
        },
        columns: {
          type: 'radio',
          label: 'Columns (Columns layout)',
          options: [
            { label: '2', value: 2 },
            { label: '3', value: 3 },
            { label: '4', value: 4 },
          ],
        },
        items: {
          type: 'array',
          label: 'Points',
          getItemSummary: (item) => item.title || 'Point',
          defaultItemProps: { icon: 'check', title: '', text: '' },
          arrayFields: {
            icon: { type: 'select', label: 'Icon', options: BLOCK_ICON_OPTIONS },
            title: { type: 'text' },
            text: { type: 'textarea' },
          },
        },
        align: alignField,
        background: backgroundField,
      } as Fields<FeaturesProps>,
      render: ({ headingLevel,  heading, headingStyle, intro, layout, columns, items, align, background }) => {
        if (layout === 'list') {
          // The heading (and intro) on one side, the points stacked on the other: bold title, then text.
          return (
            <Section background={background}>
              <div className="features-split">
                <div>
                  {heading && <Title level={headingLevel} style={headingStyle}>{heading}</Title>}
                  {intro && <p className="section-intro">{intro}</p>}
                </div>
                <ul className="features-list">
                  {items.map((item, i) => (
                    <li key={i}>
                      {item.title && (
                        <ItemTitle level={headingLevel}>
                          {item.icon ? <BlockIcon name={item.icon} className="features-list-icon" /> : null}
                          {item.title}
                        </ItemTitle>
                      )}
                      {item.text && <p>{item.text}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            </Section>
          )
        }
        return (
        <Section background={background} align={align}>
          {heading && <Title level={headingLevel} style={headingStyle}>{heading}</Title>}
          {intro && <p className="section-intro">{intro}</p>}
          <ul className={`features features-${columns}`}>
            {items.map((item, i) => (
              <li key={i}>
                {item.icon ? (
                  <span className="feature-icon">
                    <BlockIcon name={item.icon} />
                  </span>
                ) : null}
                {item.title && <ItemTitle level={headingLevel}>{item.title}</ItemTitle>}
                {item.text && <p>{item.text}</p>}
              </li>
            ))}
          </ul>
        </Section>
        )
      },
    },

    WaysToHelp: {
      label: 'Ways to help',
      defaultProps: {
        heading: 'Ways to help',
        intro: 'Not ready to adopt? There are other ways to make a difference.',
        items: [
          { icon: 'money', title: 'Donate', text: 'Every bit helps with food, vaccines and vet bills.', action: 'none', label: '', href: '' },
          { icon: 'home', title: 'Foster', text: 'Give a pet a temporary home while they wait for a family.', action: 'whatsapp', label: 'Ask about fostering', href: '' },
          { icon: 'users', title: 'Volunteer', text: 'Help at adoption days, with transport or on social media.', action: 'whatsapp', label: 'Volunteer with us', href: '' },
        ],
        paymentTitle: 'Bank details',
        paymentDetails: '',
        background: 'none',
      },
      fields: {
        heading: { type: 'text' },
        intro: { type: 'textarea', label: 'Intro (optional)' },
        items: {
          type: 'array',
          label: 'Ways',
          getItemSummary: (item) => item.title || 'Way to help',
          defaultItemProps: { icon: 'heart', title: '', text: '', action: 'none', label: '', href: '' },
          arrayFields: {
            icon: { type: 'select', label: 'Icon', options: BLOCK_ICON_OPTIONS },
            title: { type: 'text' },
            text: { type: 'textarea' },
            action: {
              type: 'radio',
              label: 'Button',
              options: [
                { label: 'None', value: 'none' },
                { label: 'WhatsApp', value: 'whatsapp' },
                { label: 'A link', value: 'link' },
              ],
            },
            label: { type: 'text', label: 'Button text' },
            href: { type: 'text', label: 'Link (only for "A link")' },
          },
        },
        paymentTitle: { type: 'text', label: 'Payment heading (e.g. Bank details)' },
        paymentDetails: { type: 'textarea', label: 'Payment details, shown with a Copy button (optional)' },
        background: backgroundField,
      } as Fields<WaysToHelpProps>,
      render: ({ headingLevel,  heading, intro, items, paymentTitle, paymentDetails, background, puck }) => {
        const site = siteOf(puck)
        const details = paymentDetails?.trim()
        return (
          <Section background={background}>
            {heading && <Title level={headingLevel}>{heading}</Title>}
            {intro && <p className="section-intro">{intro}</p>}
            <ul className="features features-3 help-ways">
              {items.map((item, i) => (
                <li key={i}>
                  {item.icon ? (
                    <span className="feature-icon">
                      <BlockIcon name={item.icon} />
                    </span>
                  ) : null}
                  {item.title && <ItemTitle level={headingLevel}>{item.title}</ItemTitle>}
                  {item.text && <p>{item.text}</p>}
                  {item.action === 'whatsapp' ? (
                    <WhatsAppButton
                      phone={site?.whatsappNumber}
                      message={item.title ? `Hi! I'd like to help: ${item.title}.` : fillMessage(site?.whatsappMessage, null)}
                      label={item.label || 'Chat on WhatsApp'}
                      variant="outline"
                    />
                  ) : item.action === 'link' && item.href ? (
                    <SmartLink href={item.href} className="btn btn-outline">
                      {item.label || 'Learn more'}
                    </SmartLink>
                  ) : null}
                </li>
              ))}
            </ul>
            {details ? (
              <div className="payment-details">
                {paymentTitle && <ItemTitle level={headingLevel}>{paymentTitle}</ItemTitle>}
                <p className="pre-line">{details}</p>
                <CopyButton text={details} label={`Copy ${paymentTitle ? paymentTitle.toLowerCase() : 'details'}`} />
              </div>
            ) : null}
          </Section>
        )
      },
    },

    PetCatalog: {
      label: 'Pet catalogue',
      defaultProps: { heading: 'Adoptable pets', headingStyle: 'normal', intro: '', showFilters: true, background: 'none' },
      fields: {
        heading: { type: 'text' },
        headingStyle: headingStyleField,
        intro: { type: 'textarea', label: 'Intro (optional)' },
        showFilters: {
          type: 'radio',
          label: 'Filters (they always search the Pets page)',
          options: [
            { label: 'Show', value: true },
            { label: 'Hide', value: false },
          ],
        },
        background: backgroundField,
      } as Fields<PetCatalogProps>,
      // Live data: the filters and page come from the address (/pets?species=cat&page=2). In the
      // editor there is no address to read, so it shows the first page with no filters.
      resolveData: async ({ props }, { metadata }) => {
        const meta = metadata as Partial<PuckSiteMetadata>
        if (!meta.fetchCatalog) return { props }
        return { props: { ...props, catalog: await meta.fetchCatalog(meta.searchParams ?? {}) } }
      },
      render: ({ headingLevel, heading, headingStyle, intro, showFilters, background, catalog }) => (
        <Section background={background}>
          {heading && (
            <Title level={headingLevel} style={headingStyle}>
              {heading}
            </Title>
          )}
          {intro && <p className="section-intro">{intro}</p>}
          {catalog ? (
            <PetCatalog catalog={catalog} showFilters={showFilters} cardHeading={headingLevel === 1 ? 'h2' : 'h3'} />
          ) : (
            <p className="muted">Loading pets…</p>
          )}
        </Section>
      ),
    },

    CostTable: {
      label: 'Cost table',
      defaultProps: {
        heading: 'What does it cost?',
        headingStyle: 'display',
        intro: 'Every rescue is different, but this is roughly what it takes to get one pet ready for a home.',
        image: null,
        imageSide: 'left',
        itemLabel: 'Care',
        valueLabel: 'Average cost',
        rows: [
          { label: 'Deworming and flea treatment', value: 'RM 40 – 60', highlight: 'none' },
          { label: 'Vaccinations', value: 'RM 100 – 140', highlight: 'none' },
          { label: 'Spay or neuter', value: 'RM 180 – 250', highlight: 'none' },
          { label: 'Total for a healthy rescue', value: 'RM 320 – 450', highlight: 'total' },
          { label: 'Emergency and medical cases', value: 'RM 600 – 1,200+', highlight: 'strong' },
        ],
        note: '',
        background: 'none',
      },
      fields: {
        heading: { type: 'text' },
        headingStyle: headingStyleField,
        intro: { type: 'textarea', label: 'Intro (optional)' },
        image: mediaField('Photo (optional)'),
        imageSide: {
          type: 'radio',
          label: 'Heading and photo side',
          options: [
            { label: 'Left', value: 'left' },
            { label: 'Right', value: 'right' },
          ],
        },
        itemLabel: { type: 'text', label: 'First column title' },
        valueLabel: { type: 'text', label: 'Second column title' },
        rows: {
          type: 'array',
          label: 'Rows',
          getItemSummary: (item) => [item.label, item.value].filter(Boolean).join(': ') || 'Row',
          defaultItemProps: { label: '', value: '', highlight: 'none' },
          arrayFields: {
            label: { type: 'text', label: 'Item' },
            value: { type: 'text', label: 'Cost (e.g. RM 40 – 60)' },
            highlight: {
              type: 'radio',
              label: 'Highlight',
              options: [
                { label: 'None', value: 'none' },
                { label: 'Total', value: 'total' },
                { label: 'Strong', value: 'strong' },
              ],
            },
          },
        },
        note: { type: 'textarea', label: 'Note under the table (optional)' },
        background: backgroundField,
      } as Fields<CostTableProps>,
      render: ({ headingLevel,  heading, headingStyle, intro, image, imageSide, itemLabel, valueLabel, rows, note, background }) => (
        <Section background={background}>
          <div className={`cost-table cost-table-${imageSide}`}>
            <div className="cost-table-intro">
              {heading && <Title level={headingLevel} style={headingStyle}>{heading}</Title>}
              {paragraphs(intro).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
              {image && (
                <div className="cost-table-image">
                  <Image src={image.url} alt={image.alt || ''} fill sizes="(max-width: 800px) 100vw, 50vw" />
                </div>
              )}
            </div>
            <div>
              {/* A data table: column headers, a header cell per row, and a caption for screen
                  readers. It scrolls sideways on a narrow screen instead of squashing (WCAG 1.4.10). */}
              <div className="table-scroll">
                <table className="price-table">
                  {heading && <caption className="sr-only">{heading}</caption>}
                  <thead>
                    <tr>
                      <th scope="col">{itemLabel || 'Item'}</th>
                      <th scope="col">{valueLabel || 'Cost'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className={row.highlight !== 'none' ? `price-row-${row.highlight}` : undefined}>
                        <th scope="row">{row.label}</th>
                        <td>{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {note && <p className="muted price-note">{note}</p>}
            </div>
          </div>
        </Section>
      ),
    },

    Spacer: {
      label: 'Spacer',
      defaultProps: { size: 'md' },
      fields: {
        size: {
          type: 'radio',
          label: 'Height',
          options: [
            { label: 'Small', value: 'sm' },
            { label: 'Medium', value: 'md' },
            { label: 'Large', value: 'lg' },
            { label: 'Extra large', value: 'xl' },
          ],
        },
      } as Fields<SpacerProps>,
      render: ({ size }) => <div className={`spacer spacer-${size}`} aria-hidden="true" />,
    },

    FormBlock: {
      label: 'Form',
      defaultProps: { formId: null, heading: '', showDescription: true, background: 'none' },
      fields: {
        formId: {
          type: 'custom',
          label: 'Form',
          render: ({ id, value, onChange, readOnly }: { id: string; value: number | null; onChange: (value: number | null) => void; readOnly?: boolean }) => (
            <FormPicker id={id} value={value} onChange={onChange} readOnly={readOnly} />
          ),
        },
        heading: { type: 'text', label: "Heading (blank uses the form's name)" },
        showDescription: {
          type: 'radio',
          label: "Show the form's description",
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        background: backgroundField,
      } as Fields<FormBlockProps>,
      resolveData: async ({ props }, { metadata }) => {
        const fetchForm = (metadata as Partial<PuckSiteMetadata>).fetchForm
        const id = Number(props.formId)
        if (!fetchForm || !Number.isSafeInteger(id) || id < 1) return { props: { ...props, form: null } }
        return { props: { ...props, form: await fetchForm(id) } }
      },
      render: ({ headingLevel, heading, showDescription, background, form, formId, puck }) => {
        // A deleted form (or a form builder that is not set up) hides the block on the live site.
        if (!form) {
          return puck.isEditing ? (
            <Section background={background}>
              <p className="muted">{formId ? 'This form was deleted, so the block is hidden on the site.' : 'Choose a form. Forms are made under Plugins, Forms.'}</p>
            </Section>
          ) : (
            <></>
          )
        }
        return (
          <Section background={background}>
            <div className="form-section">
              <Title level={headingLevel}>{heading?.trim() || form.name}</Title>
              {showDescription !== false && paragraphs(form.description ?? '').map((p, i) => <p key={i} className="form-intro">{p}</p>)}
              <PublicForm form={form} preview={puck.isEditing} />
            </div>
          </Section>
        )
      },
    },

    Divider: {
      label: 'Divider',
      defaultProps: { width: 'container', spacing: 'sm' },
      fields: {
        width: {
          type: 'radio',
          label: 'Width',
          options: [
            { label: 'Full', value: 'container' },
            { label: 'Short', value: 'narrow' },
          ],
        },
        spacing: spacingField,
      } as Fields<DividerProps>,
      render: ({ width, spacing }) => (
        <div className={`divider-block spacing-${spacing}`}>
          <div className="container">
            <hr className={`divider divider-${width}`} />
          </div>
        </div>
      ),
    },
  },
}

