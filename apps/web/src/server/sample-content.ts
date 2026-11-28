// Sample content: example pets (with pictures made from a cat silhouette in the site's colours) and
// an About page, so a fresh site has
// something to look at. Used by `pnpm seed` and by the first-time setup's "Sample content" step
// (src/server/setup.ts). Every step checks first, so running it again is safe; it never adds sample
// pets next to real ones. removeSampleContent takes them out again.
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { count, eq, inArray, max } from 'drizzle-orm'
import { isEqual } from 'es-toolkit'
import sharp from 'sharp'

import { getDatabase } from '@/db/client'
import { PetStatus } from '@/lib/options'
import { slugify } from '@/lib/slugify'
import { mix, resolveTheme } from '@/lib/theme'

import { deletePage, publishPage, savePageDetails, archivePage } from './pages'
import { deletePet, savePet } from './pets'
import { logError, UserError } from './result'
import { getSettings } from './settings'
import { removeUpload, saveUpload } from './uploads'

/**
 * The sample pets' picture: a cat silhouette (a black shape on transparent, read only here, never
 * served). Read from the project folder at runtime, like the migrations.
 */
const SILHOUETTE = path.resolve(/* turbopackIgnore: true */ process.cwd(), 'assets', 'sample-pet.png')

/** Credit for the silhouette (Flaticon's free licence asks for it wherever the picture is used). */
const PICTURE_CREDIT = { text: 'Kitty icons created by Boris farias - Flaticon', href: 'https://www.flaticon.com/free-icons/kitty' }

/** A sample pet's description: its text, then the picture's credit as a link (rich text, not HTML). */
function describe(about: string) {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: about }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Picture: ' },
          { type: 'text', text: PICTURE_CREDIT.text, marks: [{ type: 'link', attrs: { href: PICTURE_CREDIT.href } }] },
        ],
      },
    ],
  }
}

/**
 * A sample pet's picture: the silhouette in the theme's primary colour on a soft shade of it, a
 * slightly different shade per pet and every other one facing the other way, so the grid is not
 * six identical tiles. 1200 x 900, like a landscape photo.
 */
async function samplePicture(index: number, colors: { primary: string; bg: string }): Promise<Buffer> {
  const width = 1200
  const height = 900
  const size = 560
  const shape = await sharp(await readFile(SILHOUETTE)).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().toBuffer()
  // Fill: a block of the primary colour, kept only where the silhouette is (its alpha).
  let cat = sharp({ create: { width: size, height: size, channels: 4, background: colors.primary } }).composite([{ input: shape, blend: 'dest-in' }])
  if (index % 2) cat = sharp(await cat.png().toBuffer()).flop()
  const shade = mix(colors.primary, colors.bg, [0.9, 0.84, 0.78][index % 3])
  return sharp({ create: { width, height, channels: 4, background: shade } })
    .composite([{ input: await cat.png().toBuffer(), left: (width - size) / 2, top: (height - size) / 2 }])
    .png()
    .toBuffer()
}

type Sample = {
  name: string
  species: string
  breed: string
  sex: string
  ageGroup: string
  ageDescription: string
  size: string
  city: string
  state: string
  featured: boolean
  about: string
  /** Defaults to available. */
  status?: PetStatus
  unlisted?: boolean
  /** More savePet fields (temperament, health notes ...). */
  extra?: Record<string, unknown>
}


/**
 * Six example pets, enough to show the catalog without filling it: cats, dogs and a rabbit, every
 * age group, two featured, one urgent, one with special needs, and one each pending and adopted.
 */
export const samples: Sample[] = [
  { name: 'Mochi', species: 'cat', breed: 'Domestic shorthair', sex: 'female', ageGroup: 'baby', ageDescription: 'about 3 months', size: 'small', city: 'Petaling Jaya', state: 'Selangor', featured: true, about: 'Playful and curious, Mochi loves feather toys and following you from room to room.' },
  { name: 'Biscuit', species: 'dog', breed: 'Mixed breed', sex: 'male', ageGroup: 'young', ageDescription: '1 year', size: 'medium', city: 'Kuala Lumpur', state: 'Kuala Lumpur', featured: true, about: 'Biscuit is friendly, house-trained and great with children. He needs a family who enjoys long walks.' },
  { name: 'Clover', species: 'rabbit', breed: 'Holland lop', sex: 'female', ageGroup: 'adult', ageDescription: '2 years', size: 'small', city: 'Shah Alam', state: 'Selangor', featured: false, about: 'Calm and gentle, Clover is happiest with a quiet home and plenty of fresh greens.' },
  { name: 'Luna', species: 'cat', breed: 'Persian mix', sex: 'female', ageGroup: 'senior', ageDescription: '9 years', size: 'medium', city: 'Subang Jaya', state: 'Selangor', featured: false, about: 'Luna is a lap cat who wants a peaceful retirement home. Fully vaccinated and spayed.' },
  { name: 'Rocky', species: 'dog', breed: 'Rottweiler mix', sex: 'male', ageGroup: 'adult', ageDescription: '4 years', size: 'large', city: 'Petaling Jaya', state: 'Selangor', featured: false, status: PetStatus.Pending, about: 'Rocky is a gentle giant. An adopter is already meeting him, so he is marked as pending.' },
  { name: 'Whiskers', species: 'cat', breed: 'Siamese mix', sex: 'male', ageGroup: 'adult', ageDescription: '4 years', size: 'medium', city: 'Georgetown', state: 'Penang', featured: false, status: PetStatus.Adopted, about: 'Whiskers has found his forever home. He stays here so you can see what an adopted pet looks like.' },
]

/**
 * Sample pets of earlier versions. Not added any more, but still recognised as samples, so sites
 * that have them can remove them, and they never count as real pets.
 */
const RETIRED_SAMPLES = [
  'Pumpkin', 'Shadow', 'Ginger', 'Oreo', 'Tiger', 'Maple', 'Ember', 'Daisy', 'Bruno', 'Coco', 'Max', 'Bella', 'Lucky', 'Simba', 'Ziggy', 'Rusty', 'Snowball', 'Thumper', 'Olive', 'Kiwi', 'Sunny', 'Pip', 'Nibbles', 'Pebbles', 'Peanut', 'Hazel', 'Shelly',
]

/** Every sample pet's name (current and retired) by its slug. */
const sampleNames = () => new Map([...samples.map((s) => s.name), ...RETIRED_SAMPLES].map((name) => [slugify(name), name]))

/** The alt text of a sample pet's placeholder picture (the same in every version of the samples). */
const placeholderAlt = (name: string) => `Placeholder picture for ${name}`

/**
 * The sample pets on the site. A name is not enough: Bella, Max or Luna are common names for real
 * pets. A sample has a sample's slug and every one of its photos is the placeholder picture made for
 * it (its alt text says so). A pet whose photos the owner changed, or whose pictures were described
 * again, counts as theirs and is never touched.
 */
async function findSamplePets(): Promise<Array<{ id: number; slug: string; name: string; photoIds: number[] }>> {
  const { db, t } = await getDatabase()
  const names = sampleNames()
  const candidates = await db.select({ id: t.pets.id, slug: t.pets.slug }).from(t.pets).where(inArray(t.pets.slug, [...names.keys()]))
  if (!candidates.length) return []
  const photos = await db
    .select({ petId: t.petPhotos.petId, mediaId: t.petPhotos.mediaId, alt: t.media.alt })
    .from(t.petPhotos)
    .leftJoin(t.media, eq(t.media.id, t.petPhotos.mediaId))
    .where(inArray(t.petPhotos.petId, candidates.map((pet) => pet.id)))
  const found = []
  for (const pet of candidates) {
    const name = names.get(pet.slug)!
    const own = photos.filter((photo) => photo.petId === pet.id)
    if (own.length && own.every((photo) => photo.alt === placeholderAlt(name))) found.push({ ...pet, name, photoIds: own.map((photo) => photo.mediaId) })
  }
  return found
}

// Behaviour and health details for the samples, so the extra pet fields have something to show.
const extras: Record<string, Record<string, unknown>> = {
  Mochi: { temperament: ['playful', 'affectionate'], goodWith: ['kids', 'cats'], houseTrained: true, microchipped: true, urgent: true, color: 'Orange tabby' },
  Biscuit: { temperament: ['energetic', 'affectionate'], goodWith: ['kids', 'dogs'], houseTrained: true, microchipped: true, color: 'Brown and white' },
  Clover: { temperament: ['calm', 'shy'], goodWith: ['other-pets'], houseTrained: true, color: 'Grey' },
  Luna: { temperament: ['calm', 'independent'], goodWith: ['cats'], houseTrained: true, microchipped: true, specialNeeds: true, healthNotes: 'Needs a soft diet and a yearly dental check.', color: 'Cream' },
}

// "about 3 months", "10 weeks", "2 years" -> { ageValue: 3, ageUnit: 'months' }. The samples give
// their age as text; savePet stores it as an estimated birth date, so they keep ageing.
function ageFrom(text: string) {
  const match = /(\d+)\s*(week|month|year)s?/.exec(text)
  if (!match) throw new Error(`Cannot read the age "${text}"`)
  return { ageValue: Number(match[1]), ageUnit: `${match[2]}s` }
}

/** Adds the sample pets (with placeholder pictures). Skips when real pets exist. Returns what it did. */
export async function addSamplePets(log: (line: string) => void = () => {}): Promise<number> {
  let added = 0
  const { db, t } = await getDatabase()

  // Any pet that is not one of our samples (current or retired) means this is a real site: leave its
  // pets alone.
  const existing = await findSamplePets()
  const [all] = await db.select({ n: count() }).from(t.pets)
  if (all.n > existing.length) {
    log('Real pets exist, skipping sample pets.')
    return 0
  }

  // The pictures take the site's colours as they are now (the setup's theme step comes first).
  const light = resolveTheme(await getSettings()).light
  const colors = { primary: light['--primary'] ?? '#e8590c', bg: light['--bg'] ?? '#ffffff' }
  const have = new Set(existing.map((d) => d.slug))

  for (const [index, sample] of samples.entries()) {
    if (have.has(slugify(sample.name))) continue

    const buffer = await samplePicture(index, colors)
    const media = await saveUpload({ data: buffer, alt: placeholderAlt(sample.name) })
    try {
      await savePet(null, {
        name: sample.name,
        status: sample.status ?? PetStatus.Available,
        species: sample.species,
        breed: sample.breed,
        sex: sample.sex,
        ...ageFrom(sample.ageDescription),
        size: sample.size,
        city: sample.city,
        state: sample.state,
        featured: sample.featured,
        unlisted: sample.unlisted ?? false,
        vaccinated: true,
        neutered: sample.ageGroup !== 'baby',
        photoIds: [media.id],
        description: describe(sample.about),
        ...extras[sample.name],
        ...sample.extra,
      })
      added++
      log(`Added sample pet ${sample.name}`)
    } catch (error) {
      // Don't leave an orphaned picture behind.
      await removeUpload(media.id)
      throw error
    }
  }

  // Sample pets seeded before ages were birth dates get one now, so they age with the calendar.
  const sampleIds = existing.map((pet) => pet.id)
  const undated = sampleIds.length
    ? (await db.select({ id: t.pets.id, slug: t.pets.slug, birthDate: t.pets.birthDate }).from(t.pets).where(inArray(t.pets.id, sampleIds))).filter((pet) => !pet.birthDate)
    : []
  for (const pet of undated) {
    const sample = samples.find((s) => slugify(s.name) === pet.slug)
    if (!sample) continue
    await savePet(pet.id, ageFrom(sample.ageDescription))
    log(`Gave ${sample.name} a birth date`)
  }
  return added
}

const ABOUT_SLUG = 'about'
const ABOUT_TITLE = 'About'

/** The sample About page's layout. Its block ids are fixed (the page builder makes random ones). */
const ABOUT_LAYOUT = {
  root: { props: {} },
  zones: {},
  content: [
    { type: 'TextSection', props: { id: 'about-text', heading: 'About us', body: 'We are a small rescue helping cats, dogs and rabbits find loving homes.\n\nEvery pet is vaccinated, checked by a vet and matched with the right family.', align: 'left', background: 'none', spacing: 'md' } },
    { type: 'Testimonials', props: { id: 'about-stories', heading: 'Happy tails', background: 'tint', items: [{ quote: 'Adopting Mochi was the best decision we ever made.', name: 'The Tan family', detail: 'Adopted Mochi' }] } },
    { type: 'Faq', props: { id: 'about-faq', heading: 'Frequently asked questions', background: 'none', items: [{ question: 'How does adoption work?', answer: 'Message us on WhatsApp, meet the pet, and we will guide you through the next steps.' }, { question: 'Is there an adoption fee?', answer: 'We ask for a small contribution towards vet costs. Ask us for details.' }] } },
    { type: 'ContactInfo', props: { id: 'about-contact', heading: 'Visit us', showAddress: true, showHours: true, showWhatsApp: true, mapEmbedUrl: '', background: 'none' } },
  ],
}

/**
 * Whether a layout is still the sample About page's: the same blocks with the same ids, in the same
 * order, and the same heading and text in each (only the typed text: the save checks may tidy the
 * choices if a block's options change).
 */
const TYPED_TEXT = ['heading', 'body'] as const

function isSampleAboutLayout(data: unknown): boolean {
  const content = (data as { content?: unknown } | null)?.content
  if (!Array.isArray(content) || content.length !== ABOUT_LAYOUT.content.length) return false
  return ABOUT_LAYOUT.content.every((block, index) => {
    const stored = content[index] as { type?: unknown; props?: Record<string, unknown> } | null
    if (stored?.type !== block.type || !stored.props) return false
    const props: Record<string, unknown> = block.props
    return stored.props.id === props.id && TYPED_TEXT.every((key) => stored.props![key] === props[key])
  })
}

/**
 * The sample About page while nobody has changed it: at /about, titled About, the sample layout both
 * live and in the draft, no settings waiting to be published, and no version after the first (every
 * edit, settings included, opens a new version). Anything else is the owner's page and stays.
 */
async function findSampleAboutPage(): Promise<number | null> {
  const { db, t } = await getDatabase()
  const [page] = await db
    .select({ id: t.pages.id, title: t.pages.title, draft: t.pages.puckDraft, published: t.pages.puckPublished, detailsDraft: t.pages.detailsDraft })
    .from(t.pages)
    .where(eq(t.pages.slug, ABOUT_SLUG))
    .limit(1)
  if (!page || page.title !== ABOUT_TITLE || page.detailsDraft != null) return null
  if (!isSampleAboutLayout(page.published) || !isEqual(page.draft, page.published)) return null
  const [versions] = await db.select({ newest: max(t.pageVersions.number) }).from(t.pageVersions).where(eq(t.pageVersions.pageId, page.id))
  return (versions?.newest ?? 0) <= 1 ? page.id : null
}

/** Creates and publishes the sample About page, unless a page at /about exists. */
export async function addSampleAboutPage(log: (line: string) => void = () => {}): Promise<boolean> {
  const { db, t } = await getDatabase()
  const [existing] = await db.select({ n: count() }).from(t.pages).where(eq(t.pages.slug, ABOUT_SLUG))
  if (existing.n > 0) {
    log('An "about" page already exists, skipping.')
    return false
  }

  const { id } = await savePageDetails(null, { title: ABOUT_TITLE, slug: ABOUT_SLUG })
  await publishPage(id, ABOUT_LAYOUT)
  log('Created the About page')
  return true
}

/** Whether any sample pet (current or retired) is on the site. */
export async function hasSampleContent(): Promise<boolean> {
  return (await findSamplePets()).length > 0
}

/**
 * Takes the sample content out again: the sample pets, retired ones included, and their placeholder
 * pictures (a picture something else now uses stays in the media library), and the sample About page
 * while nobody has changed it. Pets and pages the owner made or edited are never touched (see
 * findSamplePets and findSampleAboutPage). When a part cannot be removed, the rest is still removed and
 * `left` names what stayed, so the caller can log what went and then say what is left
 * (sampleContentLeftMessage).
 */
export async function removeSampleContent(): Promise<{ pets: number; aboutPage: boolean; left: string[] }> {
  const left: string[] = []
  let removed = 0
  let aboutPage = false
  for (const pet of await findSamplePets()) {
    try {
      await deletePet(pet.id)
      removed++
    } catch (error) {
      logError(error, `Could not remove the sample pet ${pet.id}`)
      left.push(`the example pet ${pet.name}`)
      continue
    }
    for (const mediaId of pet.photoIds) {
      try {
        await removeUpload(mediaId)
      } catch (error) {
        // Still in use somewhere else (the owner put it on a page): it stays, as it should.
        if (error instanceof UserError) continue
        logError(error, `Could not remove the placeholder picture ${mediaId}`)
        left.push(`the placeholder picture for ${pet.name}`)
      }
    }
  }
  const aboutId = await findSampleAboutPage()
  if (aboutId !== null) {
    try {
      await archivePage(aboutId)
      await deletePage(aboutId)
      aboutPage = true
    } catch (error) {
      logError(error, 'Could not remove the sample About page')
      left.push('the About page')
    }
  }
  return { pets: removed, aboutPage, left }
}

/** The message for a removal that left something behind (see removeSampleContent). */
export function sampleContentLeftMessage(result: { pets: number; left: string[] }): string {
  const what = `${result.left.join(', ')} could not be removed. Try again.`
  return result.pets ? `Removed ${result.pets} example pet${result.pets === 1 ? '' : 's'}, but ${what}` : what.charAt(0).toUpperCase() + what.slice(1)
}
