// End-to-end check of the backend (accounts, auth, uploads, pets, pages, settings) against a
// database you can throw away. Run it on SQLite and on Postgres: the repositories are written once
// and must behave the same on both.
//
//   SQLite:   DATABASE_URL=file:/tmp/check.db UPLOAD_DIR=/tmp/check-uploads \
//             SEED_ADMIN_EMAIL=owner@example.test SEED_ADMIN_PASSWORD=owner-password-123 pnpm check:backend
//   Postgres: run `pnpm migrate` against an empty database first, with the same variables and a
//             postgres:// DATABASE_URL.
//
// It creates accounts, pets and pages, so never point it at a real site.
import { APIError } from 'better-auth/api'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'

import { closeDatabase, getDatabase } from '../src/db/client'
import { getAuth } from '../src/server/auth'
import { getPublishedPage, listPages, publishPage, saveDraft, savePageDetails, unpublishPage } from '../src/server/pages'
import { deletePet, getLocationOptions, getPetById, getPetBySlug, queryPets, savePet } from '../src/server/pets'
import { ValidationError, UserError } from '../src/server/result'
import { getSettings, updateSettings } from '../src/server/settings'
import { ACCOUNT_RULE, clearAttempts, clientAddress, consumeAttempt } from '../src/server/throttle'
import { removeUpload, saveUpload } from '../src/server/uploads'
import { createUser, deleteUser, ensureOwner, listUsers, resetPassword, updateUser } from '../src/server/users'

let failures = 0
async function check(name: string, fn: () => Promise<unknown>) {
  try {
    await fn()
    console.log(`PASS  ${name}`)
  } catch (error) {
    failures++
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}
const ok = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg)
}
async function fieldErrors(p: Promise<unknown>): Promise<Record<string, string>> {
  try {
    await p
  } catch (e) {
    if (e instanceof ValidationError) return e.fieldErrors
    throw e
  }
  throw new Error('expected a ValidationError')
}
async function userError(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof UserError) return e.message
    throw e
  }
  throw new Error('expected a UserError')
}

const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#f60' } }).png().toBuffer()
const ip = (n: number) => new Headers({ 'x-forwarded-for': `10.0.0.${n}` })

const { dialect, db, t } = await getDatabase()
console.log(`Database dialect: ${dialect}`)

// --- accounts and auth -------------------------------------------------------------------
await check('ensureOwner creates the first admin, then does nothing', async () => {
  ok((await ensureOwner()) === 'created', 'first call should create')
  ok((await ensureOwner()) === 'skipped', 'second call should skip')
  const users = await listUsers()
  ok(users.length === 1 && users[0].role === 'admin', 'one admin expected')
})

await check('sign in works, wrong password is refused', async () => {
  const auth = await getAuth()
  const email = process.env.SEED_ADMIN_EMAIL as string
  const res = await auth.api.signInEmail({ body: { email, password: process.env.SEED_ADMIN_PASSWORD as string }, headers: ip(1) })
  ok((res.user as { role?: string }).role === 'admin', 'role should be admin')
  let refused = false
  try {
    await auth.api.signInEmail({ body: { email, password: 'wrong-password-123' }, headers: ip(2) })
  } catch (e) {
    refused = e instanceof APIError
  }
  ok(refused, 'wrong password should throw APIError')
})

await check('sign-in attempts are counted atomically: 12 parallel tries, exactly 5 get through', async () => {
  const key = 'login:email:someone@example.test'
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => consumeAttempt(key, ACCOUNT_RULE)))
  const passed = results.filter((r) => r.status === 'fulfilled').length
  ok(passed === 5, `expected exactly 5 of 12 parallel attempts to pass, got ${passed}`)
  ok(/Too many attempts/.test(await userError(consumeAttempt(key, ACCOUNT_RULE))), 'the next attempt is locked out')
  await consumeAttempt('login:email:other@example.test', ACCOUNT_RULE) // other emails are unaffected
  await clearAttempts(key) // a successful sign-in clears the counter
  await consumeAttempt(key, ACCOUNT_RULE)
  // an old lockout expires and the count restarts
  const { db, t } = await getDatabase()
  await db.update(t.rateLimits).set({ count: 9, lastRequest: Date.now() - 11 * 60 * 1000 }).where(eq(t.rateLimits.key, key))
  await consumeAttempt(key, ACCOUNT_RULE)
  const [row] = await db.select().from(t.rateLimits).where(eq(t.rateLimits.key, key))
  ok(row.count === 1, `count should restart after the window, got ${row.count}`)
  await clearAttempts(key)
})

await check('client address is the last x-forwarded-for entry, which a client cannot forge', async () => {
  ok(clientAddress(new Headers({ 'x-forwarded-for': '6.6.6.6, 10.1.1.1' })) === '10.1.1.1', 'last entry')
  ok(clientAddress(new Headers()) === 'unknown', 'missing header')
})

await check('create an editor; duplicate email refused; sign in as editor', async () => {
  const created = await createUser({ email: 'editor@example.test', name: 'Ed', password: 'editor-password-1', role: 'editor' })
  ok(created.id, 'id expected')
  const errs = await fieldErrors(createUser({ email: 'EDITOR@example.test', name: 'Ed2', password: 'editor-password-1' }))
  ok(errs.email, 'duplicate email should error on email')
  const errs2 = await fieldErrors(createUser({ email: 'short@example.test', name: 'S', password: 'x' }))
  ok(errs2.password, 'short password should error')
  const auth = await getAuth()
  const res = await auth.api.signInEmail({ body: { email: 'editor@example.test', password: 'editor-password-1' }, headers: ip(3) })
  ok((res.user as { role?: string }).role === 'editor', 'role should be editor')
})

await check('last admin cannot be demoted or deleted; can once there are two', async () => {
  const users = await listUsers()
  const admin = users.find((u) => u.role === 'admin')!
  const editor = users.find((u) => u.role === 'editor')!
  await userError(updateUser(admin.id, { name: admin.name, role: 'editor' }, { canChangeRole: true }))
  await userError(deleteUser(admin.id))
  await updateUser(editor.id, { name: 'Ed', role: 'admin' }, { canChangeRole: true })
  await updateUser(admin.id, { name: admin.name, role: 'editor' }, { canChangeRole: true })
  await updateUser(admin.id, { name: admin.name, role: 'admin' }, { canChangeRole: true })
  await updateUser(editor.id, { name: 'Ed', role: 'editor' }, { canChangeRole: true })
})

await check('editors cannot change roles through updateUser', async () => {
  const editor = (await listUsers()).find((u) => u.role === 'editor')!
  await updateUser(editor.id, { name: 'Ed Two', role: 'admin' }, { canChangeRole: false })
  const after = (await listUsers()).find((u) => u.id === editor.id)!
  ok(after.role === 'editor' && after.name === 'Ed Two', 'role must stay editor, name changes')
})

await check('reset password signs the person out and the new password works', async () => {
  const editor = (await listUsers()).find((u) => u.role === 'editor')!
  await resetPassword(editor.id, { password: 'brand-new-password-9' })
  const auth = await getAuth()
  await auth.api.signInEmail({ body: { email: 'editor@example.test', password: 'brand-new-password-9' }, headers: ip(4) })
})

// --- media --------------------------------------------------------------------------------
let mediaA = 0
await check('upload accepts a PNG and rejects SVG, junk and missing alt', async () => {
  const media = await saveUpload({ data: png, alt: 'Orange square' })
  mediaA = media.id
  ok(media.url.startsWith('/media/') && media.url.endsWith('.png'), `bad url ${media.url}`)
  ok(media.width === 40 && media.height === 30, 'dimensions expected')
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>')
  ok((await fieldErrors(saveUpload({ data: svg, alt: 'x' }))).file, 'SVG must be refused')
  ok((await fieldErrors(saveUpload({ data: Buffer.from('not an image'), alt: 'x' }))).file, 'junk must be refused')
  ok((await fieldErrors(saveUpload({ data: png, alt: '  ' }))).alt, 'alt required')
})

// --- pets ---------------------------------------------------------------------------------
let mochi = { id: 0, slug: '' }
await check('savePet validates required fields with per-field errors', async () => {
  const errs = await fieldErrors(savePet(null, { species: 'robot', videoUrl: 'javascript:alert(1)', adoptionFee: -5 }))
  ok(errs.name && errs.photoIds && errs.species && errs.videoUrl && errs.adoptionFee, `got ${JSON.stringify(errs)}`)
})

await check('savePet creates a pet: slug, location from city/state, defaults', async () => {
  mochi = await savePet(null, { name: 'Mochi', species: 'cat', city: ' Petaling  Jaya ', state: 'Selangor', photoIds: [mediaA], description: 'Hello\n\nWorld', temperament: ['playful'] })
  ok(mochi.slug === 'mochi', `slug ${mochi.slug}`)
  const pet = (await getPetById(mochi.id))!
  ok(pet.location === 'Petaling Jaya, Selangor', `location ${pet.location}`)
  ok(pet.photos.length === 1 && pet.status === 'available' && pet.temperament[0] === 'playful', 'defaults')
})

await check('same name gets a numbered slug; explicit duplicate slug is a field error', async () => {
  const second = await savePet(null, { name: 'Mochi', photoIds: [mediaA] })
  ok(second.slug === 'mochi-2', `slug ${second.slug}`)
  ok((await fieldErrors(savePet(second.id, { slug: 'mochi' }))).slug, 'duplicate slug should error')
  await deletePet(second.id)
})

await check('adopted stamps adoptedAt; reopening clears it; slug survives partial update', async () => {
  await savePet(mochi.id, { status: 'adopted' })
  ok((await getPetById(mochi.id))!.adoptedAt instanceof Date, 'adoptedAt set')
  await savePet(mochi.id, { status: 'available', breed: 'Domestic shorthair' })
  const pet = (await getPetById(mochi.id))!
  ok(pet.adoptedAt === null && pet.slug === 'mochi' && pet.breed === 'Domestic shorthair', 'cleared, slug kept')
})

await check('unlisted pets are hidden from listings but open by link', async () => {
  const hidden = await savePet(null, { name: 'Secret', species: 'dog', unlisted: true, photoIds: [mediaA], city: 'Ipoh', state: 'Perak' })
  const listed = await queryPets({})
  ok(!listed.docs.some((p) => p.slug === 'secret'), 'must not be listed')
  ok(listed.docs.some((p) => p.slug === 'mochi'), 'mochi listed')
  ok((await getPetBySlug('secret'))?.unlisted === true, 'opens by link')
  ok((await queryPets({ includeUnlisted: true })).docs.some((p) => p.slug === 'secret'), 'admin sees it')
  const options = await getLocationOptions()
  ok(!options.cities.includes('Ipoh') && options.cities.includes('Petaling Jaya'), `options ${JSON.stringify(options)}`)
  await deletePet(hidden.id)
})

await check('filters, location search (wildcards stripped) and paging', async () => {
  await savePet(null, { name: 'Biscuit', species: 'dog', photoIds: [mediaA], location: 'Kuala Lumpur' })
  ok((await queryPets({ species: 'dog' })).docs.length === 1, 'species filter')
  ok((await queryPets({ location: 'petaling' })).docs.length === 1, 'location contains, case-insensitive')
  ok((await queryPets({ location: '%' })).docs.length === 2, 'a lone % must not become a wildcard')
  const page = await queryPets({ limit: 1 })
  ok(page.totalDocs === 2 && page.totalPages === 2 && page.hasNextPage && page.docs[0].photos.length === 1, 'paging and cover photo')
})

await check('an image in use cannot be deleted; it can once nothing uses it', async () => {
  const msg = await userError(removeUpload(mediaA))
  ok(/still used/.test(msg), msg)
  for (const p of (await queryPets({ includeUnlisted: true })).docs) await deletePet(p.id)
  await removeUpload(mediaA)
})

// --- pages --------------------------------------------------------------------------------
await check('pages: reserved slug refused; draft stays private until published', async () => {
  ok((await fieldErrors(savePageDetails(null, { title: 'X', slug: 'pets' }))).slug, 'reserved')
  ok((await fieldErrors(savePageDetails(null, { title: 'X', slug: 'media' }))).slug, 'media reserved')
  const page = await savePageDetails(null, { title: 'About', slug: 'about' })
  const layout = { root: { props: {} }, zones: {}, content: [{ type: 'TextSection', props: { id: 'a', heading: 'Hi' } }, { type: 'PetGrid', props: { id: 'g', pets: [{ id: 1 }] } }] }
  await saveDraft(page.id, layout)
  ok((await getPublishedPage('about')) === null, 'a draft must not be public')
  await publishPage(page.id)
  const live = (await getPublishedPage('about'))!
  const grid = (live.puckData as { content: Array<{ props: Record<string, unknown> }> }).content[1]
  ok(!('pets' in grid.props), 'transient pets prop must be stripped')
  await saveDraft(page.id, { ...layout, content: [] })
  ok(((await getPublishedPage('about'))!.puckData as { content: unknown[] }).content.length === 2, 'editing a draft must not change the live page')
  ok((await listPages())[0].hasUnpublishedChanges, 'unpublished changes flagged')
  await unpublishPage(page.id)
  ok((await getPublishedPage('about')) === null, 'unpublished')
  ok((await fieldErrors(savePageDetails(null, { title: 'Dup', slug: 'about' }))).slug, 'duplicate page slug')
})

// --- settings -----------------------------------------------------------------------------
await check('settings: invalid values give nested field errors; valid update is saved', async () => {
  const errs = await fieldErrors(
    updateSettings({
      siteName: '',
      primaryColor: 'orange',
      whatsappNumber: 'abc',
      theme: 'neon',
      nav: [{ label: 'Pets', href: 'javascript:alert(1)' }],
      socials: [{ platform: 'instagram', url: 'ftp://x' }],
      customTheme: { light: { background: '#ffffff', text: '#fafafa' } },
    }),
  )
  for (const key of ['siteName', 'primaryColor', 'whatsappNumber', 'theme', 'nav.0.href', 'socials.0.url']) ok(errs[key], `missing error for ${key}: ${JSON.stringify(errs)}`)
  const saved = await updateSettings({
    siteName: 'Happy Tails',
    theme: 'meadow',
    whatsappNumber: '012-345 6789',
    nav: [{ label: 'Pets', href: '/pets' }],
    socials: [{ platform: 'instagram', url: 'https://instagram.com/x' }],
    customize: true,
    customTheme: { radius: 'lg', light: { primary: '#0a7d3c' } },
  })
  ok(saved.siteName === 'Happy Tails' && saved.theme === 'meadow' && saved.nav.length === 1, 'saved')
  const again = await getSettings()
  ok(again.customTheme?.radius === 'lg' && again.customTheme?.light?.primary === '#0a7d3c', `customTheme ${JSON.stringify(again.customTheme)}`)
  ok(again.whatsappMessage?.includes('{pet}'), 'default message kept')
})

// FK enforcement is on (SQLite needs a pragma)
await check('foreign keys are enforced', async () => {
  let blocked = false
  try {
    await db.insert(t.petPhotos).values({ petId: 99999, mediaId: 99999, position: 0 })
  } catch {
    blocked = true
  }
  ok(blocked, 'orphan row must be rejected')
})

await closeDatabase()
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
