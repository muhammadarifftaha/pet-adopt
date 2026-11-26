// The Pet page template's blocks (agreed with the owner): one layout, edited like any page, that
// draws every pet's page at /pets/<slug>. Its own block set: the pet blocks below only make sense
// where there is a pet, and they read it from Puck's metadata (`metadata.pet`: the pet in the
// address on the site, the "Preview with" pet in the editor). Around them, a curated few of the
// ordinary blocks (Text, Adoption steps, FAQ, Cost table, Call to action, Form, Divider, Spacer).
//
// Same rules as src/puck/config.tsx: no hooks or browser-only code (blocks render on the server and
// in the editor), headings through the heading helpers, and resolved props listed in
// TRANSIENT_PROPS (`similar`).
import Image from 'next/image'
import React from 'react'
import type { Config, Fields } from '@puckeditor/core'

import { PetCard } from '@/components/site/PetCard'
import { PetGallery } from '@/components/site/PetGallery'
import { RichText } from '@/components/site/RichText'
import { WhatsAppButton } from '@/components/site/WhatsAppButton'
import type { PetCardData, PetPageData } from '@/lib/queries'
import { fillMessage } from '@/lib/whatsapp'

import { config as siteConfig, headingClass, headingStyleField, Section, type HeadingStyle, type Level, type PuckComponents } from './config'
import { withPadding } from './padding'
import type { PuckSiteMetadata } from './types'

type Meta = { metadata: Record<string, unknown>; isEditing?: boolean }
const petOf = (puck: Meta) => (puck.metadata as Partial<PuckSiteMetadata>).pet ?? null
const siteOf = (puck: Meta) => (puck.metadata as Partial<PuckSiteMetadata>).site

/** In the editor before a pet is picked: says what the block will show. */
function NoPet({ what }: { what: string }) {
  return (
    <Section>
      <p className="muted">{what} appears here. Pick a pet in “Preview with” to see it.</p>
    </Section>
  )
}

type PetGalleryProps = { thumbnails?: 'below' | 'above' }
type PetSummaryProps = Level & {
  headingStyle?: HeadingStyle
  /** The pet's main photo beside the summary. Missing means none (the original look). */
  photo?: 'none' | 'left' | 'right'
  showStatus?: boolean
  showFacts?: boolean
}
/** How the two sections of Pet health / Pet personality sit: side by side or one under the other. */
type ListsLayout = { layout?: 'columns' | 'rows'; rowGap?: 'default' | 'sm' | 'md' | 'lg' }
type PetHealthProps = Level & ListsLayout & {
  heading?: string
  showChecks?: boolean
  showNotes?: boolean
}
type PetPersonalityProps = Level & ListsLayout & {
  heading?: string
  showTemperament?: boolean
  showGoodWith?: boolean
  showNotes?: boolean
}
type PetDescriptionProps = { showButton?: boolean; buttonLabel?: string }
type MorePetsProps = Level & {
  heading?: string
  count?: number
  /** Resolved at render (metadata.fetchSimilarPets); never saved (TRANSIENT_PROPS). */
  similar?: PetCardData[]
}

type PetPageComponents = Pick<PuckComponents, 'TextSection' | 'AdoptionSteps' | 'Faq' | 'CostTable' | 'CallToAction' | 'FormBlock' | 'Divider' | 'Spacer'> & {
  PetGallery: PetGalleryProps
  PetSummary: PetSummaryProps
  PetHealth: PetHealthProps
  PetPersonality: PetPersonalityProps
  PetDescription: PetDescriptionProps
  MorePets: MorePetsProps
}

const toggle = (label: string) =>
  ({
    type: 'radio',
    label,
    options: [
      { label: 'Show', value: true },
      { label: 'Hide', value: false },
    ],
  }) as const

/** The facts list: only what the pet has. */
function facts(pet: PetPageData): Array<[string, string]> {
  const rows: Array<[string, string | null]> = [
    ['Species', pet.speciesLabel],
    ['Breed', pet.breed],
    ['Sex', pet.sexLabel],
    ['Age', pet.ageLabel],
    ['Size', pet.sizeLabel],
    ['Colour', pet.color],
    ['Location', pet.location],
  ]
  return rows.filter((row): row is [string, string] => Boolean(row[1]))
}

/**
 * The Health and Personality blocks: an optional heading, then up to two short sections side by
 * side. Section titles sit one level below the block's heading (or at block level without one).
 */
const listsLayoutFields = {
  layout: {
    type: 'radio',
    label: 'Layout',
    options: [
      { label: 'Side by side', value: 'columns' },
      { label: 'Stacked', value: 'rows' },
    ],
  },
  rowGap: {
    type: 'select',
    label: 'Gap between rows',
    options: [
      { label: 'Default', value: 'default' },
      { label: 'Small', value: 'sm' },
      { label: 'Medium', value: 'md' },
      { label: 'Large', value: 'lg' },
    ],
  },
} as const

function ListsBlock({
  heading,
  headingLevel,
  sections,
  empty,
  isEditing,
  layout,
  rowGap,
}: Level & ListsLayout & {
  heading?: string
  sections: Array<{ title: string; items?: string[]; notes?: PetPageData['healthNotes'] }>
  empty: string
  isEditing?: boolean
}) {
  const shown = sections.filter((section) => section.items?.length || section.notes)
  if (!shown.length) return isEditing ? <NoPet what={empty} /> : <></>
  const title = heading?.trim()
  const Title = headingLevel === 1 ? 'h1' : 'h2'
  const Sub = title ? (headingLevel === 1 ? 'h2' : 'h3') : 'h2'
  return (
    <Section>
      {title ? <Title className="block-heading">{title}</Title> : null}
      {/* Stacked, or side by side (which also stacks when there is no room): the row gap applies to both. */}
      <div className={layout === 'rows' ? 'pet-page-lists pet-page-lists-rows' : 'pet-page-lists'} data-row-gap={rowGap && rowGap !== 'default' ? rowGap : undefined}>
        {shown.map((section) => (
          <section key={section.title} className="pet-profile-list">
            <Sub className="minor-heading">{section.title}</Sub>
            {section.items?.length ? (
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            {section.notes ? <RichText doc={section.notes} className="pet-notes" /> : null}
          </section>
        ))}
      </div>
    </Section>
  )
}

const shared = siteConfig.components

const petBlocks: Config<PetPageComponents> = {
  root: { fields: {} },
  categories: {
    pet: { title: 'This pet', components: ['PetGallery', 'PetSummary', 'PetHealth', 'PetPersonality', 'PetDescription', 'MorePets'] },
    sections: { title: 'Sections', components: ['TextSection', 'AdoptionSteps', 'Faq', 'CostTable', 'CallToAction', 'FormBlock'] },
    helpers: { title: 'Layout helpers', components: ['Spacer', 'Divider'] },
  },
  components: {
    PetGallery: {
      label: 'Pet gallery',
      fields: {
        thumbnails: {
          type: 'radio',
          label: 'Thumbnails',
          options: [
            { label: 'Below the photo', value: 'below' },
            { label: 'Above the photo', value: 'above' },
          ],
        },
      } as Fields<PetGalleryProps>,
      defaultProps: { thumbnails: 'below' },
      // A large photo plus thumbnails that swap it (a client component; blocks stay hook-free).
      render: ({ thumbnails, puck }) => {
        const pet = petOf(puck)
        if (!pet) return puck.isEditing ? <NoPet what="The pet’s photos" /> : <></>
        if (!pet.photos.length) return <></>
        return (
          <Section>
            <PetGallery key={pet.id} photos={pet.photos} name={pet.name} thumbnails={thumbnails === 'above' ? 'above' : 'below'} />
          </Section>
        )
      },
    },

    PetSummary: {
      label: 'Pet summary',
      fields: {
        headingStyle: headingStyleField,
        photo: {
          type: 'radio',
          label: 'Main photo',
          options: [
            { label: 'Hidden', value: 'none' },
            { label: 'Left', value: 'left' },
            { label: 'Right', value: 'right' },
          ],
        },
        showStatus: toggle('Status badge'),
        showFacts: toggle('Facts (species, breed, sex, age, size, colour, location)'),
      } as Fields<PetSummaryProps>,
      defaultProps: { headingStyle: 'normal', photo: 'none', showStatus: true, showFacts: true },
      render: ({ headingLevel, headingStyle, photo, showStatus, showFacts, puck }) => {
        const pet = petOf(puck)
        if (!pet) return puck.isEditing ? <NoPet what="The pet’s name, status and facts" /> : <></>
        // The pet's name is the page's heading: <h1> on the site (the first heading of the page).
        const Name = headingLevel === 2 ? 'h2' : 'h1'
        const rows = showFacts === false ? [] : facts(pet)
        const main = photo === 'left' || photo === 'right' ? pet.photos[0] : undefined
        const summary = (
          <>
            <div className="pet-title">
              <Name className={headingClass(headingStyle, 'block-heading')}>{pet.name}</Name>
              {showStatus !== false ? <span className={`badge badge-${pet.status}`}>{pet.statusLabel}</span> : null}
            </div>
            {rows.length ? (
              <dl className="facts">
                {rows.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </>
        )
        if (!main) return <Section>{summary}</Section>
        // The photo comes first in the markup either way (it stacks on top on narrow screens);
        // `data-photo="right"` only moves it visually.
        return (
          <Section>
            <div className="pet-summary-media" data-photo={photo}>
              <div className="pet-photo pet-summary-photo">
                <Image src={main.url} alt={main.alt || pet.name} fill priority sizes="(max-width: 800px) 100vw, 45vw" />
              </div>
              <div className="pet-summary-text">{summary}</div>
            </div>
          </Section>
        )
      },
    },

    PetHealth: {
      label: 'Pet health',
      fields: {
        heading: { type: 'text', label: 'Heading (optional)' },
        showChecks: toggle('Medical history (vaccinated, microchipped, neutered…)'),
        showNotes: toggle('Health notes'),
        ...listsLayoutFields,
      } as Fields<PetHealthProps>,
      defaultProps: { heading: 'Health', showChecks: true, showNotes: true, layout: 'columns', rowGap: 'default' },
      // Hidden on the site when the pet has nothing to show here.
      render: ({ headingLevel, heading, showChecks, showNotes, layout, rowGap, puck }) => {
        const pet = petOf(puck)
        if (!pet) return puck.isEditing ? <NoPet what="The pet’s medical history and health notes" /> : <></>
        return (
          <ListsBlock
            heading={heading}
            headingLevel={headingLevel}
            layout={layout}
            rowGap={rowGap}
            isEditing={puck.isEditing}
            empty={`Health details (${pet.name} has none yet)`}
            sections={[
              { title: 'Medical history', items: showChecks === false ? [] : [...pet.healthChecks, ...(pet.neutered ? ['Neutered / spayed'] : [])] },
              { title: 'Health notes', notes: showNotes === false ? null : pet.healthNotes },
            ]}
          />
        )
      },
    },

    PetPersonality: {
      label: 'Pet personality',
      fields: {
        heading: { type: 'text', label: 'Heading (optional)' },
        showTemperament: toggle('Traits (playful, calm…)'),
        showGoodWith: toggle('Good with'),
        showNotes: toggle('Personality notes'),
        ...listsLayoutFields,
      } as Fields<PetPersonalityProps>,
      defaultProps: { heading: 'Personality', showTemperament: true, showGoodWith: true, showNotes: true, layout: 'columns', rowGap: 'default' },
      render: ({ headingLevel, heading, showTemperament, showGoodWith, showNotes, layout, rowGap, puck }) => {
        const pet = petOf(puck)
        if (!pet) return puck.isEditing ? <NoPet what="The pet’s personality and who they are good with" /> : <></>
        return (
          <ListsBlock
            heading={heading}
            headingLevel={headingLevel}
            layout={layout}
            rowGap={rowGap}
            isEditing={puck.isEditing}
            empty={`Personality details (${pet.name} has none yet)`}
            sections={[
              { title: 'Traits', items: showTemperament === false ? [] : pet.temperament },
              { title: 'Good with', items: showGoodWith === false ? [] : pet.goodWith },
              { title: 'Personality notes', notes: showNotes === false ? null : pet.personalityNotes },
            ]}
          />
        )
      },
    },

    PetDescription: {
      label: 'Pet description',
      fields: {
        showButton: toggle('WhatsApp button (hidden for adopted pets)'),
        buttonLabel: { type: 'text', label: 'Button text (blank: “Ask about <name> on WhatsApp”)' },
      } as Fields<PetDescriptionProps>,
      defaultProps: { showButton: true, buttonLabel: '' },
      render: ({ showButton, buttonLabel, puck }) => {
        const pet = petOf(puck)
        if (!pet) return puck.isEditing ? <NoPet what="The pet’s description and WhatsApp button" /> : <></>
        const site = siteOf(puck)
        const adopted = pet.status === 'adopted'
        return (
          <Section>
            {/* A rich-text document drawn as React elements (never HTML), so it cannot inject markup. */}
            {pet.description ? <RichText doc={pet.description} className="prose" /> : null}
            {showButton !== false && !adopted ? (
              <div className="pet-page-button">
                <WhatsAppButton phone={site?.whatsappNumber} message={fillMessage(site?.whatsappMessage, pet.name)} label={buttonLabel?.trim() || `Ask about ${pet.name} on WhatsApp`} />
              </div>
            ) : null}
          </Section>
        )
      },
    },

    MorePets: {
      label: 'More pets like this',
      fields: {
        heading: { type: 'text', label: 'Heading' },
        count: {
          type: 'radio',
          label: 'How many',
          options: [
            { label: '3', value: 3 },
            { label: '4', value: 4 },
            { label: '6', value: 6 },
          ],
        },
      } as Fields<MorePetsProps>,
      defaultProps: { heading: 'More pets like this', count: 3 },
      // Available, listed pets: the same species first, then the same state (rankSimilarPets).
      resolveData: async ({ props }, { metadata }) => {
        const meta = metadata as Partial<PuckSiteMetadata>
        if (!meta.pet || !meta.fetchSimilarPets) return { props: { ...props, similar: [] } }
        const similar = await meta.fetchSimilarPets({ id: meta.pet.id, species: meta.pet.species, state: meta.pet.state }, props.count ?? 3)
        return { props: { ...props, similar } }
      },
      render: ({ headingLevel, heading, similar, puck }) => {
        if (!similar?.length) return puck.isEditing ? <NoPet what="Other available pets like this one" /> : <></>
        const Title = headingLevel === 1 ? 'h1' : 'h2'
        return (
          <Section>
            {heading ? <Title className="block-heading">{heading}</Title> : null}
            <div className="pet-grid">
              {similar.map((pet) => (
                <PetCard key={pet.id} pet={pet} headingLevel={headingLevel === 1 ? 'h2' : 'h3'} />
              ))}
            </div>
          </Section>
        )
      },
    },

    TextSection: shared.TextSection,
    AdoptionSteps: shared.AdoptionSteps,
    Faq: shared.Faq,
    CostTable: shared.CostTable,
    CallToAction: shared.CallToAction,
    FormBlock: shared.FormBlock,
    Divider: shared.Divider,
    Spacer: shared.Spacer,
  },
}

/** The pet blocks get the Padding option too (the shared ones already have it). */
export const petPageConfig: Config<PetPageComponents> = withPadding(petBlocks)
