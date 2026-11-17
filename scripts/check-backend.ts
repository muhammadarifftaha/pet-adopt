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
import { eq, sql } from 'drizzle-orm'
import zlib from 'node:zlib'

import sharp from 'sharp'

import { closeDatabase, getDatabase } from '../src/db/client'
import { safeHref, validateHttpsUrl } from '../src/lib/links'
import { getAuth } from '../src/server/auth'
import { listMedia } from '../src/server/media'
import {
  deletePage,
  getPageById,
  getPublishedPage,
  listPages,
  publishPage,
  saveDraft,
  savePageDetails,
  unpublishPage,
} from '../src/server/pages'
import { deletePet, getLocationOptions, getPetById, getPetBySlug, queryPets, savePet } from '../src/server/pets'
import { Fields, ValidationError, UserError, assertId, describeError } from '../src/server/result'
import { getStorage } from '../src/server/storage'
import { getSettings, updateSettings } from '../src/server/settings'
import {
  PAIR_RULE,
  PASSWORD_CHANGE_RULE,
  clearAttempts,
  clientAddress,
  consumeAttempt,
  guardPasswordChange,
  guardSignIn,
} from '../src/server/throttle'
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

await check('ensureOwner repairs a lone owner left without a password', async () => {
  // An earlier start was interrupted between creating the user and its password.
  await db.delete(t.accounts)
  ok((await ensureOwner()) === 'repaired', 'should repair')
  ok((await ensureOwner()) === 'skipped', 'then there is nothing left to do')
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
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => consumeAttempt(key, PAIR_RULE)))
  const passed = results.filter((r) => r.status === 'fulfilled').length
  ok(passed === 5, `expected exactly 5 of 12 parallel attempts to pass, got ${passed}`)
  ok(/Too many attempts/.test(await userError(consumeAttempt(key, PAIR_RULE))), 'the next attempt is locked out')
  await consumeAttempt('login:email:other@example.test', PAIR_RULE) // other keys are unaffected
  await clearAttempts(key) // a successful sign-in clears the counter
  await consumeAttempt(key, PAIR_RULE)
  // an old lockout expires and the count restarts
  const { db, t } = await getDatabase()
  await db.update(t.rateLimits).set({ count: 9, lastRequest: Date.now() - 11 * 60 * 1000 }).where(eq(t.rateLimits.key, key))
  await consumeAttempt(key, PAIR_RULE)
  const [row] = await db.select().from(t.rateLimits).where(eq(t.rateLimits.key, key))
  ok(row.count === 1, `count should restart after the window, got ${row.count}`)
  await clearAttempts(key)
})

await check('lockout is per email AND client: one machine cannot lock the owner out; a lock does not extend; keys are hashed', async () => {
  const { db, t } = await getDatabase()
  const attacker = new Headers({ 'x-forwarded-for': '203.0.113.10' })
  const owner = new Headers({ 'x-forwarded-for': '203.0.113.11' })
  for (let i = 0; i < 5; i++) await guardSignIn('victim@example.test', attacker)
  ok(/Too many attempts/.test(await userError(guardSignIn('victim@example.test', attacker))), 'the attacker is locked out')
  const { keys } = await guardSignIn('victim@example.test', owner) // the real owner, elsewhere, is not
  const pairRows = () => db.select().from(t.rateLimits).where(eq(t.rateLimits.key, keys[0].replace('203.0.113.11', '203.0.113.10')))
  const [before] = await pairRows()
  for (let i = 0; i < 3; i++) await userError(guardSignIn('victim@example.test', attacker))
  const [after] = await pairRows()
  ok(before.lastRequest === after.lastRequest && after.count > before.count, 'hammering a locked key must not extend the lock')
  await clearAttempts(keys) // the owner signs in: their counters clear
  ok(!(await db.select().from(t.rateLimits)).some((r) => r.key.includes('victim')), 'the email must never appear in a key')
  const huge = await guardSignIn('x'.repeat(200_000), owner)
  ok(huge.keys.every((k) => k.length < 200), 'a huge "email" must become a short key')
  await db.delete(t.rateLimits)
})

await check('client address: trusted hop, bad values and a missing header', async () => {
  ok(clientAddress(new Headers({ 'x-forwarded-for': '6.6.6.6, 10.1.1.1' })) === '10.1.1.1', 'the last entry, which a client cannot forge')
  ok(clientAddress(new Headers({ 'x-forwarded-for': 'not-an-ip' })) === null, 'not an IP address')
  ok(clientAddress(new Headers()) === null, 'no header')
  const addr = (value: string) => clientAddress(new Headers({ 'x-forwarded-for': value }))
  ok(addr('203.0.113.5') === '203.0.113.5', 'IPv4 is counted individually')
  ok(addr('2001:db8::1') === '2001:db8:0:0::/64', `IPv6 is counted by /64, got ${addr('2001:db8::1')}`)
  ok(addr('2001:0DB8:0000:0000:ffff::2') === '2001:db8:0:0::/64', 'another host in the same /64, written differently')
  ok(addr('2001:db8:0:1::1') === '2001:db8:0:1::/64', 'a different /64 is a different client')
  ok(addr('::1') === '0:0:0:0::/64', 'loopback')
  ok(addr('fe80::1%eth0') === 'fe80:0:0:0::/64', 'a zone id is ignored')
  ok(addr('::ffff:203.0.113.5') === '203.0.113.5', 'IPv4 written as IPv6 counts as that IPv4 address')
  // Without an address there is no per-client bucket, so unidentifiable clients cannot lock each other out.
  for (let i = 0; i < 8; i++) await guardSignIn(`nobody${i}@example.test`, new Headers())
  const { db, t } = await getDatabase()
  await db.delete(t.rateLimits)
})

await check('addresses in one IPv6 /64 share one lockout, so hopping addresses does not help', async () => {
  const from = (address: string) => new Headers({ 'x-forwarded-for': address })
  for (const address of ['2001:db8::1', '2001:db8::2', '2001:db8::3', '2001:db8:0:0:aaaa::4', '2001:db8::5']) {
    await guardSignIn('hop@example.test', from(address))
  }
  ok(/Too many attempts/.test(await userError(guardSignIn('hop@example.test', from('2001:db8::6')))), 'the sixth address in the same /64 is locked')
  await guardSignIn('hop@example.test', from('2001:db8:0:9::1')) // a different /64 is a different client
  const { db, t } = await getDatabase()
  await db.delete(t.rateLimits)
})

await check('password change attempts are limited per user and clear on success', async () => {
  for (let i = 0; i < PASSWORD_CHANGE_RULE.max; i++) await guardPasswordChange('user-1')
  ok(/Too many attempts/.test(await userError(guardPasswordChange('user-1'))), 'sixth guess is refused')
  await guardPasswordChange('user-2') // another user is unaffected
  await clearAttempts(['chpw:user-1', 'chpw:user-2'])
  await guardPasswordChange('user-1')
  await clearAttempts('chpw:user-1')
})

await check('error logs drop the bound parameters of a failed query', async () => {
  const text = describeError(new Error('Failed query: insert into "accounts" values ($1)\nparams: secret-hash-123,owner@example.test'))
  ok(!text.includes('secret-hash') && !text.includes('owner@'), `leaked: ${text}`)
  ok(text.includes('Failed query'), 'still says what failed')
})

await check('a transaction started inside another one joins it instead of deadlocking', async () => {
  const { withTransaction, t } = await getDatabase()
  await withTransaction(async (tx) => {
    await withTransaction(async (inner) => {
      await inner.select().from(t.users).limit(1)
    })
    await tx.select().from(t.users).limit(1)
  })
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

await check('two admins demoting each other at once never leave zero admins', async () => {
  const users = await listUsers()
  const first = users.find((u) => u.role === 'admin')!
  const second = users.find((u) => u.role === 'editor')!
  await updateUser(second.id, { name: second.name, role: 'admin' }, { canChangeRole: true }) // two admins now
  const results = await Promise.allSettled([
    updateUser(first.id, { name: first.name, role: 'editor' }, { canChangeRole: true }),
    updateUser(second.id, { name: second.name, role: 'editor' }, { canChangeRole: true }),
  ])
  ok(results.filter((r) => r.status === 'fulfilled').length === 1, 'exactly one demotion may succeed')
  ok((await listUsers()).filter((u) => u.role === 'admin').length === 1, 'one admin must remain')
  // The same race with deletes: two admins deleting each other.
  await updateUser(first.id, { name: first.name, role: 'admin' }, { canChangeRole: true })
  await updateUser(second.id, { name: second.name, role: 'admin' }, { canChangeRole: true })
  const deletes = await Promise.allSettled([deleteUser(first.id), deleteUser(second.id)])
  ok(deletes.filter((r) => r.status === 'fulfilled').length === 1, 'exactly one deletion may succeed')
  ok((await listUsers()).filter((u) => u.role === 'admin').length === 1, 'one admin must remain after the deletes too')
  // Put the accounts back the way later checks expect them.
  const survivor = (await listUsers())[0]
  const ownerSurvived = survivor.id === first.id
  await createUser({
    email: ownerSurvived ? 'editor@example.test' : process.env.SEED_ADMIN_EMAIL!,
    name: ownerSurvived ? 'Ed' : 'Owner',
    password: 'editor-password-1',
    role: 'editor',
  })
  const afterwards = await listUsers()
  const owner = afterwards.find((u) => u.email === process.env.SEED_ADMIN_EMAIL)!
  const editor = afterwards.find((u) => u.email === 'editor@example.test')!
  await updateUser(owner.id, { name: owner.name, role: 'admin' }, { canChangeRole: true })
  await updateUser(editor.id, { name: editor.name, role: 'editor' }, { canChangeRole: true })
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
await check('resetPassword creates a missing credential and ends every session', async () => {
  const editor = (await listUsers()).find((u) => u.role === 'editor')!
  const { db, t } = await getDatabase()
  await db.delete(t.accounts).where(eq(t.accounts.userId, editor.id)) // an account left without a password
  await resetPassword(editor.id, { password: 'another-password-77' })
  const auth = await getAuth()
  await auth.api.signInEmail({ body: { email: 'editor@example.test', password: 'another-password-77' }, headers: ip(5) })
  ok((await db.select().from(t.sessions).where(eq(t.sessions.userId, editor.id))).length >= 1, 'signed in')
  await resetPassword(editor.id, { password: 'yet-another-password-88' })
  ok((await db.select().from(t.sessions).where(eq(t.sessions.userId, editor.id))).length === 0, 'every session must be gone')
  ok(/not found/i.test(await userError(resetPassword('no-such-user', { password: 'whatever-password-1' }))), 'unknown user')
})

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

await check('settings: partial theme updates merge; contrast is checked on the effective theme; bad shapes are errors', async () => {
  await updateSettings({ customTheme: { shadow: 'soft' } })
  const merged = (await getSettings()).customTheme
  ok(merged?.radius === 'lg' && merged?.shadow === 'soft' && merged?.light?.primary === '#0a7d3c', `not merged: ${JSON.stringify(merged)}`)
  ok((await fieldErrors(updateSettings({ customTheme: 'garbage' }))).customTheme, 'a string is not a theme')
  ok((await fieldErrors(updateSettings({ customTheme: { light: 5 } })))['customTheme.light'], 'light must be an object')
  // Light text on a dark page is fine...
  await updateSettings({ customTheme: { light: { background: '#101010', surface: '#1a1a1a', text: '#f5f5f5' } } })
  // ...but changing ONLY the background to near-white makes the text that is already stored unreadable.
  const errors = await fieldErrors(updateSettings({ customTheme: { light: { background: '#fafafa', surface: '#ffffff' } } }))
  ok(errors['customTheme.light.text'], `expected a contrast error, got ${JSON.stringify(errors)}`)
  await updateSettings({ customTheme: { light: { background: null, surface: null, text: null } } })
  ok(!(await getSettings()).customTheme?.light?.text, 'colours can be cleared one by one')
})

await check('HTTP route: change-password shares the per-user limit; sign-in needs JSON with an email', async () => {
  const { POST } = await import('../src/app/api/auth/[...all]/route')
  await createUser({ email: 'http@example.test', name: 'Http', password: 'http-password-123456', role: 'editor' })
  const auth = await getAuth()
  const signed = await auth.api.signInEmail({
    body: { email: 'http@example.test', password: 'http-password-123456' },
    headers: ip(60),
    returnHeaders: true,
  })
  const cookie = signed.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const call = (path: string, body: unknown, headers: Record<string, string> = {}, type = 'application/json') =>
    POST(
      new Request(`http://localhost:3000/api/auth/${path}`, {
        method: 'POST',
        headers: { 'content-type': type, origin: 'http://localhost:3000', 'x-forwarded-for': '192.0.2.60', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    )

  // Guessing the current password over HTTP is limited like the server action: 5, then refused.
  const wrong = { currentPassword: 'definitely-wrong-password', newPassword: 'a-totally-new-password-1' }
  const codes: number[] = []
  for (let i = 0; i < 7; i++) codes.push((await call('change-password', wrong, { cookie })).status)
  ok(codes.slice(0, 5).every((c) => c !== 429), `the first five guesses reach Better Auth: ${codes}`)
  ok(codes.slice(5).every((c) => c === 429), `the sixth and seventh are refused: ${codes}`)
  ok((await call('change-password', wrong)).status === 401, 'without a session Better Auth answers 401')

  // Sign-in over HTTP: JSON with an email only.
  ok((await call('sign-in/email', 'email=a%40b.c&password=x', {}, 'application/x-www-form-urlencoded')).status === 415, 'form body')
  ok((await call('sign-in/email', '{nope')).status === 400, 'invalid JSON')
  ok((await call('sign-in/email', { password: 'x' })).status === 400, 'missing email')
  ok((await call('sign-in/social', {})).status === 404, 'other sign-in methods are closed')
  // Only the endpoints the app uses are open; everything else Better Auth ships is closed, including
  // ones that would skip this app's validation (update-user) or the last-admin rule (admin/*).
  for (const path of ['update-user', 'list-sessions', 'revoke-sessions', 'sign-up/email', 'request-password-reset', 'admin/set-role', 'change-email']) {
    ok((await call(path, {}, { cookie })).status === 404, `${path} must be closed`)
  }
  const { GET } = await import('../src/app/api/auth/[...all]/route')
  const session = await GET(new Request('http://localhost:3000/api/auth/get-session', { headers: { cookie } }))
  ok(session.status === 200, 'get-session stays open')
  const { db, t } = await getDatabase()
  await db.delete(t.rateLimits)
})

await check('input parsing: numbers, ids, flags, dates and control characters are strict', async () => {
  const num = (value: unknown) => {
    const f = new Fields({ n: value })
    return { value: f.number('n', { min: 0 }), error: f.errors.n }
  }
  ok(num(' ').value === null && !num(' ').error, 'whitespace-only is blank, not zero')
  ok(num('12.50').value === 12.5 && num(7).value === 7, 'plain numbers')
  for (const bad of ['0x10', '1e3', '--1', [5], true, {}, NaN, Infinity, -1, 1e12]) ok(num(bad).error, `should reject ${String(bad)}`)
  ok(Object.is(num(-0).value, 0), 'negative zero is stored as 0')

  const id = (value: unknown) => {
    const f = new Fields({ i: value })
    return { value: f.id('i'), error: f.errors.i }
  }
  ok(id('12').value === 12 && id(12).value === 12, 'ids')
  for (const bad of [true, [1], '1e2', '0', 0, -3, 1.5, 99_999_999_999, 'abc', {}]) ok(id(bad).error, `should reject id ${String(bad)}`)
  const list = new Fields({ x: [1, '2', 2] }).ids('x', { min: 1, max: 3 })
  ok(JSON.stringify(list) === '[1,2]', `ids dedupe and coerce: ${JSON.stringify(list)}`)

  const flag = (value: unknown) => {
    const f = new Fields({ b: value })
    return { value: f.flag('b'), error: f.errors.b }
  }
  ok(flag(true).value === true && flag('false').value === false && flag('true').value === true, 'booleans and the words')
  for (const bad of [0, 1, 'yes', [], {}, 'False ']) ok(flag(bad).error, `"${String(bad)}" must not become a boolean`)

  const date = (value: unknown) => {
    const f = new Fields({ d: value })
    return { value: f.date('d'), error: f.errors.d }
  }
  ok(date('2026-02-28').value === '2026-02-28' && date('2024-02-29').value === '2024-02-29', 'real dates, leap day included')
  for (const bad of ['2026-02-31', '2025-02-29', '2026-13-01', '26-1-1', 5]) ok(date(bad).error, `${String(bad)} is not a date`)

  const text = new Fields({ t: 'a\u0000b\u0007c\td\ne' }).text('t', 50)
  ok(text === 'abc\td\ne', `control characters go, tabs and line breaks stay: ${JSON.stringify(text)}`)

  ok(assertId('5') === 5, 'a digit string is an id')
  for (const bad of ['x', 0, 2 ** 40, null, {}, '1e2']) {
    ok(/not found/i.test(await userError((async () => assertId(bad))())), `assertId must refuse ${String(bad)}`)
  }
})

await check('links: a path cannot hide a host behind control characters; video links must be https', async () => {
  ok(safeHref('/pets') === '/pets' && safeHref('/pets?x=1#y') === '/pets?x=1#y', 'normal paths')
  for (const bad of ['/\t/evil.example', '/\n/evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/a\u0000b']) {
    ok(safeHref(bad) === '#', `${JSON.stringify(bad)} must be refused`)
  }
  ok(validateHttpsUrl('https://youtu.be/x') === true && validateHttpsUrl('') === true, 'https and blank are fine')
  ok(validateHttpsUrl('http://youtu.be/x') !== true, 'http is refused')
})

await check('search is case-insensitive and Unicode-aware; hostile page numbers are clamped', async () => {
  const m = await saveUpload({ data: png, alt: 'Orange Square on Sofa' })
  ok((await listMedia({ search: 'orange square' })).docs.some((x) => x.id === m.id), 'a lower-case term finds mixed-case alt text')
  ok((await listMedia({ search: 'SOFA' })).docs.some((x) => x.id === m.id), 'an upper-case term does too')
  const paris = await savePet(null, { name: 'Parisienne', photoIds: [m.id], location: 'Île-de-France' })
  // PostgreSQL folds accents according to the database's locale; SQLite is made to fold them.
  let folds = true
  if (dialect === 'pg') {
    const rows = await (db as unknown as { execute: (q: unknown) => Promise<{ rows: Array<{ v: string }> }> }).execute(sql`select lower('Î') as v`)
    folds = rows.rows[0].v === 'î'
  }
  if (folds) {
    ok((await queryPets({ location: 'île' })).docs.some((p) => p.id === paris.id), 'accented lower-case search')
    ok((await queryPets({ location: 'ÎLE-DE' })).docs.some((p) => p.id === paris.id), 'accented upper-case search')
  } else {
    console.log('      (this PostgreSQL database uses a locale that does not fold accents; skipped)')
  }
  for (const page of [1e20, NaN, -5, Infinity, '9'.repeat(30) as unknown as number]) {
    const result = await queryPets({ page })
    ok(result.page >= 1 && result.page <= 10_000, `page ${String(page)} must be clamped, got ${result.page}`)
  }
  ok((await listMedia({ page: NaN })).page === 1, 'a NaN media page becomes 1')
  await deletePet(paris.id)
  await removeUpload(m.id)
})

await check('pets: clearing city and state clears the derived location; http videos refused; same-name creates race safely', async () => {
  const m = await saveUpload({ data: png, alt: 'Pet photo' })
  const derived = await savePet(null, { name: 'Ipoh Cat', photoIds: [m.id], city: 'Ipoh', state: 'Perak' })
  ok((await getPetById(derived.id))!.location === 'Ipoh, Perak', 'location built from city and state')
  await savePet(derived.id, { city: '', state: '' })
  ok((await getPetById(derived.id))!.location === null, 'the derived location goes when both are cleared')
  const legacy = await savePet(null, { name: 'Legacy Cat', photoIds: [m.id], location: 'Somewhere typed' })
  await savePet(legacy.id, { city: '', state: '' })
  ok((await getPetById(legacy.id))!.location === 'Somewhere typed', 'a location typed by hand is its own')
  ok((await fieldErrors(savePet(legacy.id, { videoUrl: 'http://video.example/x' }))).videoUrl, 'an http video link is refused')
  await savePet(legacy.id, { videoUrl: 'https://video.example/x' })
  // Two owners saving the same name at the same moment: both must succeed, with different addresses.
  const [a, b] = await Promise.all([
    savePet(null, { name: 'Racer', photoIds: [m.id] }),
    savePet(null, { name: 'Racer', photoIds: [m.id] }),
  ])
  ok(a.slug !== b.slug && a.slug.startsWith('racer') && b.slug.startsWith('racer'), `slugs ${a.slug} and ${b.slug}`)
  for (const pet of [derived, legacy, a, b]) await deletePet(pet.id)
  await removeUpload(m.id)
})

await check('uploads: AVIF is accepted, EXIF is stripped from the stored file, oversized images are refused', async () => {
  const base = { create: { width: 64, height: 48, channels: 3 as const, background: '#f60' } }
  const avif = await saveUpload({ data: await sharp(base).avif().toBuffer(), alt: 'An AVIF image' })
  ok(avif.mimeType === 'image/avif' && avif.url.endsWith('.avif'), `AVIF stored as ${avif.mimeType} ${avif.url}`)

  const photo = await sharp(base).withExif({ IFD0: { Copyright: 'secret-owner', Software: 'camera-app' } }).jpeg().toBuffer()
  ok((await sharp(photo).metadata()).exif, 'the test photo really carries EXIF')
  const jpeg = await saveUpload({ data: photo, alt: 'A photo' })
  const stored = await (await getStorage()).get(jpeg.filename)
  ok(stored, 'the file was stored')
  ok(!(await sharp(stored!.body).metadata()).exif, 'the stored file has no EXIF block')
  ok(!stored!.body.includes(Buffer.from('secret-owner')), 'and none of its text')

  const wide = await sharp({ create: { width: 13_000, height: 10, channels: 3, background: '#000' } }).png().toBuffer()
  ok((await fieldErrors(saveUpload({ data: wide, alt: 'wide' }))).file, 'a 13000 pixel side is refused')
  const huge = await sharp({ create: { width: 6_500, height: 6_500, channels: 3, background: '#000' } }).png().toBuffer()
  ok((await fieldErrors(saveUpload({ data: huge, alt: 'huge' }))).file, 'more than 40 megapixels is refused')
  await removeUpload(avif.id)
  await removeUpload(jpeg.id)
})

await check('metadata is cut out WITHOUT touching the pixels (JPEG, PNG, WebP, GIF); orientation is kept; bad files are refused', async () => {
  const storage = await getStorage()
  const put = async (data: Buffer, alt: string) => {
    const media = await saveUpload({ data, alt })
    const file = await storage.get(media.filename)
    ok(file, 'the file was stored')
    return { media, body: file!.body }
  }
  // Decoded pixels, with no rotation applied: equal buffers mean not one pixel changed.
  const pixels = async (data: Buffer) => sharp(data, { animated: true }).raw().toBuffer()
  const noise = { create: { width: 160, height: 120, channels: 3 as const, background: '#888', noise: { type: 'gaussian' as const, mean: 128, sigma: 40 } } }
  const secrets = (body: Buffer, words: string[]) => words.filter((word) => body.includes(Buffer.from(word)))
  const made: number[] = []

  // JPEG: EXIF with text, orientation 6 (a phone photo taken upright is stored sideways), a comment
  // segment, and a payload hidden after the end of the image.
  const exifJpeg = await sharp(noise)
    .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'secret-owner', Software: 'camera-app' } } })
    .jpeg({ quality: 92 })
    .toBuffer()
  ok((await sharp(exifJpeg).metadata()).exif, 'the test photo really carries EXIF')
  const text = Buffer.from('comment-secret')
  const comment = Buffer.concat([Buffer.from([0xff, 0xfe, (text.length + 2) >> 8, (text.length + 2) & 255]), text])
  const jpegFile = Buffer.concat([exifJpeg.subarray(0, 2), comment, exifJpeg.subarray(2), Buffer.from('TRAILING-SECRET-PAYLOAD')])
  ok(secrets(jpegFile, ['secret-owner', 'camera-app', 'comment-secret', 'TRAILING-SECRET']).length === 4, 'precondition: the JPEG upload really contains all four secrets')
  const jpeg = await put(jpegFile, 'A sideways phone photo')
  made.push(jpeg.media.id)
  ok(secrets(jpeg.body, ['secret-owner', 'camera-app', 'comment-secret', 'TRAILING-SECRET']).length === 0, 'no metadata text survives in the JPEG')
  ok((await pixels(jpegFile)).equals(await pixels(jpeg.body)), 'JPEG pixels are identical to the upload')
  const jpegMeta = await sharp(jpeg.body).metadata()
  ok(jpegMeta.orientation === 6, `the orientation is kept so the photo stays upright, got ${jpegMeta.orientation}`)
  ok((jpegMeta.exif?.length ?? 0) < 60, `the EXIF block holds only the orientation (${jpegMeta.exif?.length} bytes)`)
  ok(jpeg.body.length < jpegFile.length, 'and the file got smaller, not bigger')
  ok(jpeg.media.width === 120 && jpeg.media.height === 160, `stored size is the upright size, got ${jpeg.media.width}x${jpeg.media.height}`)

  // PNG: a text chunk with a "comment", and bytes after the end chunk.
  const crc = (data: Buffer) => {
    const out = Buffer.alloc(4)
    out.writeUInt32BE(zlib.crc32(data) >>> 0)
    return out
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    return Buffer.concat([length, body, crc(body)])
  }
  const png0 = await sharp(noise).png().toBuffer()
  const pngFile = Buffer.concat([png0.subarray(0, 33), chunk('tEXt', Buffer.from('Comment\0png-secret')), png0.subarray(33), Buffer.from('PNG-TRAILING-SECRET')])
  ok(secrets(pngFile, ['png-secret', 'PNG-TRAILING']).length === 2, 'precondition: the PNG upload really contains both secrets')
  const png = await put(pngFile, 'A PNG with a text chunk')
  made.push(png.media.id)
  ok(secrets(png.body, ['png-secret', 'PNG-TRAILING']).length === 0, 'no metadata text survives in the PNG')
  ok((await pixels(pngFile)).equals(await pixels(png.body)), 'PNG pixels are identical to the upload')

  // GIF: a comment block and bytes after the trailer.
  const gif0 = await sharp(noise).gif().toBuffer()
  const at = 13 + (gif0[10] & 0x80 ? 3 * (1 << ((gif0[10] & 7) + 1)) : 0)
  const note = Buffer.from('gif-secret')
  const gifFile = Buffer.concat([gif0.subarray(0, at), Buffer.from([0x21, 0xfe, note.length]), note, Buffer.from([0]), gif0.subarray(at), Buffer.from('GIF-TRAILING-SECRET')])
  ok(secrets(gifFile, ['gif-secret', 'GIF-TRAILING']).length === 2, 'precondition: the GIF upload really contains both secrets')
  const gif = await put(gifFile, 'A GIF with a comment')
  made.push(gif.media.id)
  ok(secrets(gif.body, ['gif-secret', 'GIF-TRAILING']).length === 0, 'no metadata text survives in the GIF')
  ok((await pixels(gifFile)).equals(await pixels(gif.body)), 'GIF pixels are identical to the upload')

  // WebP with EXIF text.
  const webpFile = await sharp(noise).withMetadata({ exif: { IFD0: { Copyright: 'webp-secret' } } }).webp({ quality: 90 }).toBuffer()
  if ((await sharp(webpFile).metadata()).exif) {
    ok(secrets(webpFile, ['webp-secret']).length === 1, 'precondition: the WebP upload really contains the secret')
    const webp = await put(webpFile, 'A WebP with EXIF')
    made.push(webp.media.id)
    ok(secrets(webp.body, ['webp-secret']).length === 0, 'no metadata text survives in the WebP')
    ok((await pixels(webpFile)).equals(await pixels(webp.body)), 'WebP pixels are identical to the upload')
    ok(!(await sharp(webp.body).metadata()).exif, 'and it has no EXIF block (orientation 1 needs none)')
  } else {
    console.log('      (this sharp build did not write EXIF into the test WebP; skipped)')
  }

  // AVIF with metadata cannot be cut out safely, so it is refused instead of recompressed.
  const avifFile = await sharp(noise).withMetadata({ exif: { IFD0: { Copyright: 'avif-secret' } } }).avif().toBuffer()
  if ((await sharp(avifFile).metadata()).exif) {
    ok((await fieldErrors(saveUpload({ data: avifFile, alt: 'AVIF with EXIF' }))).file, 'an AVIF with metadata is refused')
  }

  // A file the stripper cannot walk to the end is refused, never stored with its metadata.
  const broken = exifJpeg.subarray(0, exifJpeg.length - 30)
  ok((await fieldErrors(saveUpload({ data: broken, alt: 'Truncated JPEG' }))).file, 'a truncated JPEG is refused')
  for (const id of made) await removeUpload(id)
})

await check('an image placed inside a page layout counts as in use', async () => {
  const m = await saveUpload({ data: png, alt: 'In a hero block' })
  const page = await savePageDetails(null, { title: 'Layout use', slug: 'layout-use' })
  const layout = { root: { props: {} }, zones: {}, content: [{ type: 'Hero', props: { id: 'h', image: { id: m.id, url: m.url, alt: 'In a hero block' } } }] }
  await publishPage(page.id, layout)
  ok(/page layout/.test(await userError(removeUpload(m.id))), 'refused while a layout uses it')
  await deletePage(page.id)
  await removeUpload(m.id)
})

await check('pages: stale saves are refused, publish copies the stored draft, bad layouts and NULs are handled', async () => {
  const page = await savePageDetails(null, { title: 'Versions', slug: 'versions' })
  const layout = (heading: string) => ({ root: { props: {} }, zones: {}, content: [{ type: 'TextSection', props: { id: 'a', heading } }] })
  const opened = (await getPageById(page.id))!.updatedAt.getTime()
  const saved = await saveDraft(page.id, layout('one'), opened)
  ok(/changed somewhere else/.test(await userError(saveDraft(page.id, layout('stale'), opened))), 'a stale base is refused')
  const second = await saveDraft(page.id, layout('two'), saved.version)
  ok(/changed somewhere else/.test(await userError(publishPage(page.id, undefined, saved.version))), 'publishing from a stale base is refused')
  await publishPage(page.id, undefined, second.version)
  const live = (await getPublishedPage('versions'))!.puckData as { content: Array<{ props: { heading: string } }> }
  ok(live.content[0].props.heading === 'two', 'publishing copied the stored draft')
  ok(/not found/i.test(await userError(saveDraft(999_999, layout('x')))), 'a missing page')
  const empty = await savePageDetails(null, { title: 'Empty', slug: 'empty-page' })
  ok(/no layout/i.test(await userError(publishPage(empty.id))), 'nothing to publish yet')

  const bad: unknown[] = [
    { content: [{ type: 'Hero', props: 'x' }] },
    { content: [{ type: 'Hero' }] },
    { content: [], root: 5 },
    { content: [], zones: { a: 'nope' } },
    layout('x'.repeat(1_100_000)),
  ]
  for (const data of bad) ok(/invalid/.test(await userError(saveDraft(page.id, data))), 'a malformed or oversized layout is refused')

  await saveDraft(page.id, layout('a\u0000b'))
  const draft = (await getPageById(page.id))!.puckDraft as { content: Array<{ props: { heading: string } }> }
  ok(draft.content[0].props.heading === 'ab', 'a NUL is removed before it can break the save')
  await deletePage(page.id)
  await deletePage(empty.id)
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
