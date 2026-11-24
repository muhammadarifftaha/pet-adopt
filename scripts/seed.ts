/**
 * Adds sample content so a fresh install has something to look at.
 *   pnpm seed
 *
 * - The first owner account comes from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (in .env). The
 *   server creates it on startup, and so does this script, when no user exists.
 * - Every step checks first, so the script is safe to run again and finishes a partial run.
 * - It never touches a real site: if any pet other than the samples exists, no pets are added,
 *   and site settings are only filled in while they are still the defaults.
 * - It refuses to run in production unless SEED_FORCE=1, so demo data and the placeholder
 *   WhatsApp number cannot end up on a live site by accident.
 * - On PostgreSQL run `pnpm migrate` first. SQLite migrates itself.
 */
import { and, count, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import sharp from 'sharp'

import { closeDatabase, getDatabase } from '../src/db/client'
import { PetStatus } from '../src/lib/options'
import { slugify } from '../src/lib/slugify'
import { getSettings, updateSettings } from '../src/server/settings'
import { ensureSystemPages, publishPage, savePageDetails } from '../src/server/pages'
import { savePet } from '../src/server/pets'
import { ensureOwner } from '../src/server/users'
import { removeUpload, saveUpload } from '../src/server/uploads'

const placeholder = (label: string, from: string, to: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
      `<rect width="1200" height="900" fill="url(#g)"/>` +
      `<text x="600" y="520" font-family="Arial, sans-serif" font-size="${Math.min(240, Math.floor(1700 / label.length))}" font-weight="700" text-anchor="middle" fill="#ffffff" fill-opacity="0.92">${label}</text>` +
      `</svg>`,
  )

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
  /** Placeholder picture colours. Pets without them cycle through PALETTE. */
  from?: string
  to?: string
  /** Defaults to available. */
  status?: PetStatus
  unlisted?: boolean
  /** More savePet fields (temperament, health notes ...). */
  extra?: Record<string, unknown>
}

const PALETTE = [
  ['#fb923c', '#f43f5e'],
  ['#60a5fa', '#6366f1'],
  ['#34d399', '#0ea5e9'],
  ['#a78bfa', '#ec4899'],
  ['#facc15', '#f97316'],
  ['#2dd4bf', '#3b82f6'],
] as const

// The first four are the original samples. The rest fill the catalog to three pages (12 per page):
// 28 are available and listed, plus 2 pending, 2 adopted and 1 unlisted, and some custom species.
const samples: Sample[] = [
  { name: 'Mochi', species: 'cat', breed: 'Domestic shorthair', sex: 'female', ageGroup: 'baby', ageDescription: 'about 3 months', size: 'small', city: 'Petaling Jaya', state: 'Selangor', featured: true, from: '#fb923c', to: '#f43f5e', about: 'Playful and curious, Mochi loves feather toys and following you from room to room.' },
  { name: 'Biscuit', species: 'dog', breed: 'Mixed breed', sex: 'male', ageGroup: 'young', ageDescription: '1 year', size: 'medium', city: 'Kuala Lumpur', state: 'Kuala Lumpur', featured: true, from: '#60a5fa', to: '#6366f1', about: 'Biscuit is friendly, house-trained and great with children. He needs a family who enjoys long walks.' },
  { name: 'Clover', species: 'rabbit', breed: 'Holland lop', sex: 'female', ageGroup: 'adult', ageDescription: '2 years', size: 'small', city: 'Shah Alam', state: 'Selangor', featured: false, from: '#34d399', to: '#0ea5e9', about: 'Calm and gentle, Clover is happiest with a quiet home and plenty of fresh greens.' },
  { name: 'Luna', species: 'cat', breed: 'Persian mix', sex: 'female', ageGroup: 'senior', ageDescription: '9 years', size: 'medium', city: 'Subang Jaya', state: 'Selangor', featured: false, from: '#a78bfa', to: '#ec4899', about: 'Luna is a lap cat who wants a peaceful retirement home. Fully vaccinated and spayed.' },
  { name: 'Whiskers', species: 'cat', breed: 'Siamese mix', sex: 'male', ageGroup: 'adult', ageDescription: '4 years', size: 'medium', city: 'Georgetown', state: 'Penang', featured: false, status: PetStatus.Adopted, about: 'Whiskers has found his forever home. He stays here so you can see what an adopted pet looks like.' },
  { name: 'Pumpkin', species: 'cat', breed: 'Domestic shorthair', sex: 'female', ageGroup: 'young', ageDescription: '8 months', size: 'small', city: 'Ipoh', state: 'Perak', featured: true, about: 'Pumpkin chases anything that moves and purrs the moment you pick her up.', extra: { temperament: ['playful', 'energetic'], goodWith: ['kids'], houseTrained: true, color: 'Ginger and white' } },
  { name: 'Shadow', species: 'cat', breed: 'Black domestic', sex: 'male', ageGroup: 'adult', ageDescription: '3 years', size: 'medium', city: 'Johor Bahru', state: 'Johor', featured: false, unlisted: true, about: 'Shadow is link-only: he does not appear in the catalog, but his page opens for anyone with the link.' },
  { name: 'Ginger', species: 'cat', breed: 'Orange tabby', sex: 'male', ageGroup: 'baby', ageDescription: '2 months', size: 'small', city: 'Klang', state: 'Selangor', featured: false, about: 'Ginger was found in a car park and is learning that laps are for sitting on.' },
  { name: 'Oreo', species: 'cat', breed: 'Tuxedo', sex: 'female', ageGroup: 'young', ageDescription: '1 year', size: 'small', city: 'Kuala Lumpur', state: 'Kuala Lumpur', featured: false, about: 'Oreo is chatty, curious and always first to the door when someone comes home.' },
  { name: 'Tiger', species: 'cat', breed: 'Bengal mix', sex: 'male', ageGroup: 'adult', ageDescription: '5 years', size: 'large', city: 'Shah Alam', state: 'Selangor', featured: false, about: 'Tiger is a big, athletic cat who loves climbing and needs plenty of space to explore.' },
  { name: 'Maple', species: 'cat', breed: 'Domestic longhair', sex: 'female', ageGroup: 'senior', ageDescription: '11 years', size: 'medium', city: 'Melaka', state: 'Melaka', featured: false, about: 'Maple has spent most of her life in a shelter and would love a quiet window to nap by.', extra: { temperament: ['calm', 'affectionate'], goodWith: ['cats'], houseTrained: true, urgent: true, color: 'Cream and brown' } },
  { name: 'Ember', species: 'cat', breed: 'Calico', sex: 'female', ageGroup: 'baby', ageDescription: '10 weeks', size: 'small', city: 'Seremban', state: 'Negeri Sembilan', featured: false, about: 'Ember and her siblings were rescued together. She is the boldest of the litter.' },
  { name: 'Rocky', species: 'dog', breed: 'Rottweiler mix', sex: 'male', ageGroup: 'adult', ageDescription: '4 years', size: 'large', city: 'Petaling Jaya', state: 'Selangor', featured: false, status: PetStatus.Pending, about: 'Rocky is a gentle giant. An adopter is already meeting him, so he is marked as pending.' },
  { name: 'Daisy', species: 'dog', breed: 'Beagle', sex: 'female', ageGroup: 'young', ageDescription: '2 years', size: 'medium', city: 'Cyberjaya', state: 'Selangor', featured: true, about: 'Daisy follows her nose everywhere and is happiest on a long walk with a treat at the end.', extra: { temperament: ['energetic', 'affectionate'], goodWith: ['kids', 'dogs'], houseTrained: true, microchipped: true, color: 'Tricolour' } },
  { name: 'Bruno', species: 'dog', breed: 'Labrador mix', sex: 'male', ageGroup: 'adult', ageDescription: '6 years', size: 'large', city: 'Bayan Lepas', state: 'Penang', featured: false, about: 'Bruno is calm indoors, loves the water and gets along with everyone he meets.' },
  { name: 'Coco', species: 'dog', breed: 'Poodle mix', sex: 'female', ageGroup: 'senior', ageDescription: '10 years', size: 'small', city: 'Kuala Lumpur', state: 'Kuala Lumpur', featured: false, about: 'Coco is a sweet senior who needs a calm home and her daily heart tablet.', extra: { temperament: ['calm', 'independent'], goodWith: ['dogs'], specialNeeds: true, healthNotes: 'Takes one tablet a day for her heart.', color: 'Apricot' } },
  { name: 'Max', species: 'dog', breed: 'German shepherd mix', sex: 'male', ageGroup: 'young', ageDescription: '18 months', size: 'large', city: 'Johor Bahru', state: 'Johor', featured: false, about: 'Max is clever, loyal and eager to learn. He would thrive with an active family.' },
  { name: 'Bella', species: 'dog', breed: 'Local breed', sex: 'female', ageGroup: 'adult', ageDescription: '3 years', size: 'medium', city: 'Ipoh', state: 'Perak', featured: false, status: PetStatus.Pending, about: 'Bella is shy at first and then very loyal. Her adoption is in progress.' },
  { name: 'Lucky', species: 'dog', breed: 'Mixed breed', sex: 'male', ageGroup: 'adult', ageDescription: '5 years', size: 'medium', city: 'Kajang', state: 'Selangor', featured: false, status: PetStatus.Adopted, about: 'Lucky went home last week. He is here so the adopted badge has something to show.' },
  { name: 'Simba', species: 'dog', breed: 'Golden retriever mix', sex: 'male', ageGroup: 'baby', ageDescription: '4 months', size: 'medium', city: 'Putrajaya', state: 'Putrajaya', featured: false, about: 'Simba is a bundle of puppy energy who is already learning to sit for treats.', extra: { temperament: ['playful', 'energetic'], goodWith: ['kids', 'dogs', 'cats'], color: 'Golden' } },
  { name: 'Ziggy', species: 'dog', breed: 'Jack Russell mix', sex: 'male', ageGroup: 'young', ageDescription: '1 year', size: 'small', city: 'Subang Jaya', state: 'Selangor', featured: false, about: 'Ziggy never stops moving. He needs a garden, a ball and someone who can keep up.' },
  { name: 'Rusty', species: 'dog', breed: 'Irish setter mix', sex: 'male', ageGroup: 'senior', ageDescription: '9 years', size: 'large', city: 'Alor Setar', state: 'Kedah', featured: false, about: 'Rusty is a gentle old soul with stiff joints who just wants a soft bed and company.', extra: { temperament: ['calm'], urgent: true, specialNeeds: true, healthNotes: 'Stiff joints: no stairs, short walks.', color: 'Red' } },
  { name: 'Snowball', species: 'rabbit', breed: 'Netherland dwarf', sex: 'female', ageGroup: 'baby', ageDescription: '3 months', size: 'small', city: 'Shah Alam', state: 'Selangor', featured: false, about: 'Snowball is tiny, fluffy and loves being offered a piece of carrot.' },
  { name: 'Thumper', species: 'rabbit', breed: 'Lionhead', sex: 'male', ageGroup: 'adult', ageDescription: '2 years', size: 'small', city: 'Georgetown', state: 'Penang', featured: false, about: 'Thumper thumps when he is excited, which is most of the time.' },
  { name: 'Olive', species: 'rabbit', breed: 'Rex', sex: 'female', ageGroup: 'young', ageDescription: '1 year', size: 'small', city: 'Kuala Lumpur', state: 'Kuala Lumpur', featured: false, about: 'Olive has velvet fur and a calm temperament. She is already litter trained.' },
  { name: 'Kiwi', species: 'bird', breed: 'Cockatiel', sex: 'male', ageGroup: 'adult', ageDescription: '3 years', size: 'small', city: 'Petaling Jaya', state: 'Selangor', featured: false, about: 'Kiwi whistles a few tunes and likes to sit on a shoulder.' },
  { name: 'Sunny', species: 'bird', breed: 'Budgerigar', sex: 'female', ageGroup: 'young', ageDescription: '1 year', size: 'small', city: 'Ipoh', state: 'Perak', featured: false, about: 'Sunny is bright, chatty and does best with a friend of her own kind.' },
  { name: 'Pip', species: 'bird', breed: 'African grey', sex: 'male', ageGroup: 'adult', ageDescription: '7 years', size: 'medium', city: 'Melaka', state: 'Melaka', featured: false, about: 'Pip is a clever talker who needs daily attention and a home that can keep him busy.' },
  { name: 'Nibbles', species: 'guinea pig', breed: 'Abyssinian', sex: 'female', ageGroup: 'young', ageDescription: '9 months', size: 'small', city: 'Klang', state: 'Selangor', featured: false, about: 'Nibbles squeaks happily whenever she hears the fridge door open.' },
  { name: 'Pebbles', species: 'guinea pig', breed: 'Peruvian', sex: 'male', ageGroup: 'adult', ageDescription: '2 years', size: 'small', city: 'Kuala Lumpur', state: 'Kuala Lumpur', featured: false, about: 'Pebbles has long silky hair and a gentle nature. He likes company, so a pair would be ideal.' },
  { name: 'Peanut', species: 'hamster', breed: 'Syrian', sex: 'male', ageGroup: 'baby', ageDescription: '2 months', size: 'small', city: 'Shah Alam', state: 'Selangor', featured: false, about: 'Peanut is nocturnal and spends his nights on the wheel. Best for a home with a quiet evening routine.' },
  { name: 'Hazel', species: 'hedgehog', breed: 'African pygmy', sex: 'female', ageGroup: 'adult', ageDescription: '1 year', size: 'small', city: 'Petaling Jaya', state: 'Selangor', featured: false, about: 'Hazel curls into a ball when she is startled and unrolls once she knows you.' },
  { name: 'Shelly', species: 'tortoise', breed: 'Red-footed', sex: 'female', ageGroup: 'senior', ageDescription: '20 years', size: 'medium', city: 'Seremban', state: 'Negeri Sembilan', featured: false, about: 'Shelly has lived with three families already and will outlive many more. A long-term commitment.' },
]

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

async function seedPets() {
  const { db, t } = await getDatabase()
  const sampleSlugs = samples.map((s) => slugify(s.name))

  // Any pet that is not one of our samples means this is a real site: leave its pets alone.
  const [others] = await db.select({ n: count() }).from(t.pets).where(notInArray(t.pets.slug, sampleSlugs))
  if (others.n > 0) {
    console.log('Real pets exist, skipping sample pets.')
    return
  }

  const existing = await db.select({ slug: t.pets.slug }).from(t.pets).where(inArray(t.pets.slug, sampleSlugs))
  const have = new Set(existing.map((d) => d.slug))

  for (const [index, sample] of samples.entries()) {
    if (have.has(slugify(sample.name))) continue

    const [defaultFrom, defaultTo] = PALETTE[index % PALETTE.length]
    // Uploads must be raster images (SVG is blocked), so render the placeholder to PNG.
    const buffer = await sharp(placeholder(sample.name, sample.from ?? defaultFrom, sample.to ?? defaultTo)).png().toBuffer()
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
        description: sample.about,
        ...extras[sample.name],
        ...sample.extra,
      })
      console.log(`Added sample pet ${sample.name}`)
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
    .where(and(inArray(t.pets.slug, sampleSlugs), isNull(t.pets.birthDate)))
  for (const pet of undated) {
    const sample = samples.find((s) => slugify(s.name) === pet.slug)
    if (!sample) continue
    await savePet(pet.id, ageFrom(sample.ageDescription))
    console.log(`Gave ${sample.name} a birth date`)
  }
}

async function seedSettings() {
  // Settings that were never saved still hold the defaults. Anything else is the owners' work.
  const current = await getSettings()
  if (current.siteName !== 'Pet Adopt' || current.whatsappNumber) {
    console.log('Site settings already customised, leaving them alone.')
    return
  }

  await updateSettings({
    siteName: 'Happy Tails Rescue',
    tagline: 'Every pet deserves a loving home',
    theme: 'sunrise',
    // Placeholder number: replace it in Site settings.
    whatsappNumber: '0120000000',
    whatsappMessage: "Hi! I'm interested in adopting {pet}.",
    address: '12 Jalan Contoh\n47400 Petaling Jaya\nSelangor',
    openingHours: 'Sat & Sun, 10am - 5pm\nWeekdays by appointment',
    nav: [
      { label: 'Pets', href: '/pets' },
      { label: 'About', href: '/about' },
    ],
    footerText: 'Adopt, do not shop.',
  })
  console.log('Filled in sample site settings')
}

async function seedAboutPage() {
  const { db, t } = await getDatabase()
  const [existing] = await db.select({ n: count() }).from(t.pages).where(eq(t.pages.slug, 'about'))
  if (existing.n > 0) {
    console.log('An "about" page already exists, skipping.')
    return
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
  console.log('Created the About page')
}

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_FORCE) {
    console.error('Refusing to add sample content in production. Set SEED_FORCE=1 if you really mean it.')
    process.exit(1)
  }

  await ensureOwner()
  await seedPets()
  await seedSettings()
  await seedAboutPage()
  await ensureSystemPages()
  console.log('The homepage and the Pets page are in place.')

  console.log('Sample content is in place. Open /admin to continue.')
}

try {
  await main()
  await closeDatabase()
  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
}
