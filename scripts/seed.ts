/**
 * Adds sample content so a fresh install has something to look at.
 *   npm run seed
 * The first owner account comes from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (in .env or the
 * command line). The server creates it on startup, and so does this script, when no user exists.
 * Safe to run twice: it does nothing if pets already exist.
 */
import { getPayload } from 'payload'
import sharp from 'sharp'

import config from '../src/payload.config'
import type { Pet } from '../src/payload-types'

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

async function main() {
  const payload = await getPayload({ config })

  // The owner account from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD is created by
  // `onInit` in payload.config.ts (src/lib/ensureOwner.ts), which getPayload() just ran.

  const { totalDocs } = await payload.count({ collection: 'pets' })
  if (totalDocs > 0) {
    payload.logger.info('Pets already exist, skipping sample content.')
    process.exit(0)
  }

  for (const sample of samples) {
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
    await payload.create({ collection: 'pets', data: pet })
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

  payload.logger.info('Sample content created. Open /admin to continue.')
  process.exit(0)
}

// `payload run` exits once the module has finished evaluating, so await at the top level.
try {
  await main()
} catch (error) {
  console.error(error)
  process.exit(1)
}
