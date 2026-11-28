/**
 * Adds sample content so a fresh install has something to look at.
 *   pnpm seed
 *
 * - Without SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD, the first account is made on the setup page
 *   (the link is in the server's log). With them, this script and the server create it (for
 *   unattended installs). The pets and the About page come from src/server/sample-content.ts.
 * - Every step checks first, so the script is safe to run again and finishes a partial run.
 * - It never touches a real site: if any pet other than the samples exists, no pets are added,
 *   and site settings are only filled in while they are still the defaults.
 * - It refuses to run in production unless SEED_FORCE=1, so demo data and the placeholder
 *   WhatsApp number cannot end up on a live site by accident.
 * - On PostgreSQL run `pnpm migrate` first. SQLite migrates itself.
 */
import { closeDatabase } from '../src/db/client'
import { getSettings, updateSettings } from '../src/server/settings'
import { ensureSystemPages } from '../src/server/pages'
import { describeError } from '../src/server/result'
import { addSampleAboutPage, addSamplePets } from '../src/server/sample-content'
import { ensureOwner } from '../src/server/users'

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

/** True for a database server that is not on this machine (a local file and localhost are fine). */
function isRemoteDatabase(url: string | undefined): boolean {
  if (!url || url.startsWith('file:')) return false
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
    return !(host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host))
  } catch {
    return true
  }
}

async function main() {
  // NODE_ENV is often unset in a shell on the server, so a database on another machine counts as
  // production too.
  if ((process.env.NODE_ENV === 'production' || isRemoteDatabase(process.env.DATABASE_URL)) && !process.env.SEED_FORCE) {
    console.error('Refusing to add sample content: this looks like a production site (NODE_ENV=production, or a database on another machine). Set SEED_FORCE=1 if you really mean it.')
    process.exit(1)
  }

  await ensureOwner()
  await addSamplePets(console.log)
  await seedSettings()
  await addSampleAboutPage(console.log)
  await ensureSystemPages()
  console.log('The homepage and the Pets page are in place.')

  console.log('Sample content is in place. Open /admin to continue.')
}

try {
  await main()
  await closeDatabase()
  process.exit(0)
} catch (error) {
  // Never the error object: a failed query carries its parameters (the owner's email, a password hash).
  console.error(`Seeding failed: ${describeError(error)}`)
  process.exit(1)
}
