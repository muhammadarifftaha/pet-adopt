// Sample content: example pets (with pictures made from a cat silhouette in the site's colours) and
// an About page, so a fresh site has
// something to look at. Used by `pnpm seed` and by the first-time setup's "Sample content" step
// (src/server/setup.ts). Every step checks first, so running it again is safe; it never adds sample
// pets next to real ones. removeSampleContent takes them out again.
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { and, count, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import sharp from 'sharp'

import { getDatabase } from '@/db/client'
import { PetStatus } from '@/lib/options'
import { slugify } from '@/lib/slugify'
import { mix, resolveTheme } from '@/lib/theme'

import { deletePage, publishPage, savePageDetails, archivePage } from './pages'
import { deletePet, savePet } from './pets'
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

/** The slugs of every sample pet, current and retired. */
const sampleSlugs = () => [...samples.map((s) => s.name), ...RETIRED_SAMPLES].map((name) => slugify(name))

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
  const currentSlugs = samples.map((s) => slugify(s.name))

  // Any pet that is not one of our samples (current or retired) means this is a real site: leave its
  // pets alone.
  const [others] = await db.select({ n: count() }).from(t.pets).where(notInArray(t.pets.slug, sampleSlugs()))
  if (others.n > 0) {
    log('Real pets exist, skipping sample pets.')
    return 0
  }

  const existing = await db.select({ slug: t.pets.slug }).from(t.pets).where(inArray(t.pets.slug, currentSlugs))
  // The pictures take the site's colours as they are now (the setup's theme step comes first).
  const light = resolveTheme(await getSettings()).light
  const colors = { primary: light['--primary'] ?? '#e8590c', bg: light['--bg'] ?? '#ffffff' }
  const have = new Set(existing.map((d) => d.slug))

  for (const [index, sample] of samples.entries()) {
    if (have.has(slugify(sample.name))) continue

    const buffer = await samplePicture(index, colors)
    const media = await saveUpload({ data: buffer, alt: `Placeholder picture for ${sample.name}` })
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
  const undated = await db
    .select({ id: t.pets.id, slug: t.pets.slug })
    .from(t.pets)
    .where(and(inArray(t.pets.slug, currentSlugs), isNull(t.pets.birthDate)))
  for (const pet of undated) {
    const sample = samples.find((s) => slugify(s.name) === pet.slug)
    if (!sample) continue
    await savePet(pet.id, ageFrom(sample.ageDescription))
    log(`Gave ${sample.name} a birth date`)
  }
  return added
}

/** Creates and publishes the sample About page, unless a page at /about exists. */
export async function addSampleAboutPage(log: (line: string) => void = () => {}): Promise<boolean> {
  const { db, t } = await getDatabase()
  const [existing] = await db.select({ n: count() }).from(t.pages).where(eq(t.pages.slug, 'about'))
  if (existing.n > 0) {
    log('An "about" page already exists, skipping.')
    return false
  }

  const { id } = await savePageDetails(null, { title: 'About', slug: 'about' })
  await publishPage(id, {
    root: { props: {} },
    zones: {},
    content: [
      { type: 'TextSection', props: { id: 'about-text', heading: 'About us', body: 'We are a small rescue helping cats, dogs and rabbits find loving homes.\n\nEvery pet is vaccinated, checked by a vet and matched with the right family.', align: 'left', background: 'none', spacing: 'md' } },
      { type: 'Testimonials', props: { id: 'about-stories', heading: 'Happy tails', background: 'tint', items: [{ quote: 'Adopting Mochi was the best decision we ever made.', name: 'The Tan family', detail: 'Adopted Mochi' }] } },
      { type: 'Faq', props: { id: 'about-faq', heading: 'Frequently asked questions', background: 'none', items: [{ question: 'How does adoption work?', answer: 'Message us on WhatsApp, meet the pet, and we will guide you through the next steps.' }, { question: 'Is there an adoption fee?', answer: 'We ask for a small contribution towards vet costs. Ask us for details.' }] } },
      { type: 'ContactInfo', props: { id: 'about-contact', heading: 'Visit us', showAddress: true, showHours: true, showWhatsApp: true, mapEmbedUrl: '', background: 'none' } },
    ],
  })
  log('Created the About page')
  return true
}

/** Whether any sample pet (current or retired) is on the site. */
export async function hasSampleContent(): Promise<boolean> {
  const { db, t } = await getDatabase()
  const [row] = await db.select({ n: count() }).from(t.pets).where(inArray(t.pets.slug, sampleSlugs()))
  return row.n > 0
}

/**
 * Takes the sample content out again: the sample pets, retired ones included (and their placeholder
 * pictures), and the
 * sample About page while it is still the one this file made. Returns how many pets went.
 */
export async function removeSampleContent(): Promise<number> {
  const { db, t } = await getDatabase()
  const pets = await db.select({ id: t.pets.id }).from(t.pets).where(inArray(t.pets.slug, sampleSlugs()))
  for (const pet of pets) {
    const photos = await db.select({ mediaId: t.petPhotos.mediaId }).from(t.petPhotos).where(eq(t.petPhotos.petId, pet.id))
    await deletePet(pet.id)
    for (const photo of photos) await removeUpload(photo.mediaId).catch(() => undefined)
  }
  const [about] = await db.select({ id: t.pages.id, title: t.pages.title }).from(t.pages).where(eq(t.pages.slug, 'about')).limit(1)
  if (about && about.title === 'About') {
    await archivePage(about.id).catch(() => undefined)
    await deletePage(about.id).catch(() => undefined)
  }
  return pets.length
}
