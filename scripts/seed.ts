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
 */
import { getPayload } from 'payload'
import type { Payload } from 'payload'
import sharp from 'sharp'

import config from '../src/payload.config'
import type { Pet } from '../src/payload-types'
import { slugify } from '../src/lib/slugify'

const placeholder = (label: string, from: string, to: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
      `<rect width="1200" height="900" fill="url(#g)"/>` +
      `<text x="600" y="520" font-family="Arial, sans-serif" font-size="240" font-weight="700" text-anchor="middle" fill="#ffffff" fill-opacity="0.92">${label}</text>` +
      `</svg>`,
  )

const richText = (text: string): NonNullable<Pet['description']> => ({
  root: {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        version: 1,
        children: [{ type: 'text', version: 1, text, detail: 0, format: 0, mode: 'normal', style: '' }],
        direction: 'ltr' as const,
        format: '' as const,
        indent: 0,
        textFormat: 0,
      },
    ],
    direction: 'ltr' as const,
    format: '' as const,
    indent: 0,
    version: 1,
  },
})

const samples = [
  { name: 'Mochi', species: 'cat', breed: 'Domestic shorthair', sex: 'female', ageGroup: 'baby', ageDescription: 'about 3 months', size: 'small', location: 'Petaling Jaya, Selangor', featured: true, from: '#fb923c', to: '#f43f5e', about: 'Playful and curious, Mochi loves feather toys and following you from room to room.' },
  { name: 'Biscuit', species: 'dog', breed: 'Mixed breed', sex: 'male', ageGroup: 'young', ageDescription: '1 year', size: 'medium', location: 'Kuala Lumpur', featured: true, from: '#60a5fa', to: '#6366f1', about: 'Biscuit is friendly, house-trained and great with children. He needs a family who enjoys long walks.' },
  { name: 'Clover', species: 'rabbit', breed: 'Holland lop', sex: 'female', ageGroup: 'adult', ageDescription: '2 years', size: 'small', location: 'Shah Alam, Selangor', featured: false, from: '#34d399', to: '#0ea5e9', about: 'Calm and gentle, Clover is happiest with a quiet home and plenty of fresh greens.' },
  { name: 'Luna', species: 'cat', breed: 'Persian mix', sex: 'female', ageGroup: 'senior', ageDescription: '9 years', size: 'medium', location: 'Subang Jaya, Selangor', featured: false, from: '#a78bfa', to: '#ec4899', about: 'Luna is a lap cat who wants a peaceful retirement home. Fully vaccinated and spayed.' },
] as const

async function seedPets(payload: Payload) {
  const sampleSlugs = samples.map((s) => slugify(s.name))

  // Any pet that is not one of our samples means this is a real site: leave its pets alone.
  const others = await payload.count({ collection: 'pets', where: { slug: { not_in: sampleSlugs } } })
  if (others.totalDocs > 0) {
    payload.logger.info('Real pets exist, skipping sample pets.')
    return
  }

  const existing = await payload.find({
    collection: 'pets',
    where: { slug: { in: sampleSlugs } },
    limit: samples.length,
    depth: 0,
    select: { slug: true },
  })
  const have = new Set(existing.docs.map((d) => d.slug))

  for (const sample of samples) {
    if (have.has(slugify(sample.name))) continue

    // Uploads must be raster images (SVG is blocked), so render the placeholder to PNG.
    const buffer = await sharp(placeholder(sample.name, sample.from, sample.to)).png().toBuffer()
    const media = await payload.create({
      collection: 'media',
      data: { alt: `Placeholder picture for ${sample.name}` },
      file: { data: buffer, mimetype: 'image/png', name: `${sample.name.toLowerCase()}.png`, size: buffer.length },
    })

    const pet: Omit<Pet, 'id' | 'createdAt' | 'updatedAt'> = {
      name: sample.name,
      status: 'available',
      species: sample.species,
      breed: sample.breed,
      sex: sample.sex,
      ageGroup: sample.ageGroup,
      ageDescription: sample.ageDescription,
      size: sample.size,
      location: sample.location,
      featured: sample.featured,
      vaccinated: true,
      neutered: sample.ageGroup !== 'baby',
      photos: [media.id],
      description: richText(sample.about),
    }
    try {
      await payload.create({ collection: 'pets', data: pet })
      payload.logger.info(`Added sample pet ${sample.name}`)
    } catch (error) {
      // Don't leave an orphaned picture behind.
      await payload.delete({ collection: 'media', id: media.id })
      throw error
    }
  }
}

async function seedSettings(payload: Payload) {
  // Settings that were never saved still hold the defaults. Anything else is the owners' work.
  const current = await payload.findGlobal({ slug: 'site-settings', depth: 0 })
  if (current.siteName !== 'Pet Adopt' || current.whatsappNumber) {
    payload.logger.info('Site settings already customised, leaving them alone.')
    return
  }

  await payload.updateGlobal({
    slug: 'site-settings',
    data: {
      siteName: 'Happy Tails Rescue',
      tagline: 'Every pet deserves a loving home',
      primaryColor: '#e8590c',
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
    },
  })
  payload.logger.info('Filled in sample site settings')
}

async function seedAboutPage(payload: Payload) {
  const existing = await payload.count({ collection: 'pages', where: { slug: { equals: 'about' } } })
  if (existing.totalDocs > 0) {
    payload.logger.info('An "about" page already exists, skipping.')
    return
  }

  await payload.create({
    collection: 'pages',
    data: {
      title: 'About',
      slug: 'about',
      _status: 'published',
      puckData: {
        root: { props: {} },
        zones: {},
        content: [
          { type: 'TextSection', props: { id: 'about-text', heading: 'About us', body: 'We are a small rescue helping cats, dogs and rabbits find loving homes.\n\nEvery pet is vaccinated, checked by a vet and matched with the right family.', align: 'left', background: 'none', spacing: 'md' } },
          { type: 'Testimonials', props: { id: 'about-stories', heading: 'Happy tails', background: 'tint', items: [{ quote: 'Adopting Mochi was the best decision we ever made.', name: 'The Tan family', detail: 'Adopted Mochi' }] } },
          { type: 'Faq', props: { id: 'about-faq', heading: 'Frequently asked questions', background: 'none', items: [{ question: 'How does adoption work?', answer: 'Message us on WhatsApp, meet the pet, and we will guide you through the next steps.' }, { question: 'Is there an adoption fee?', answer: 'We ask for a small contribution towards vet costs. Ask us for details.' }] } },
          { type: 'ContactInfo', props: { id: 'about-contact', heading: 'Visit us', showAddress: true, showHours: true, showWhatsApp: true, mapEmbedUrl: '', background: 'none' } },
        ],
      },
    },
  })
  payload.logger.info('Created the About page')
}

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_FORCE) {
    console.error('Refusing to add sample content in production. Set SEED_FORCE=1 if you really mean it.')
    process.exit(1)
  }

  const payload = await getPayload({ config })

  // The owner account from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD is created by
  // `onInit` in payload.config.ts (src/lib/ensureOwner.ts), which getPayload() just ran.

  await seedPets(payload)
  await seedSettings(payload)
  await seedAboutPage(payload)

  payload.logger.info('Sample content is in place. Open /admin to continue.')
}

// `payload run` exits once the module has finished evaluating, so await at the top level.
try {
  await main()
  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
}
