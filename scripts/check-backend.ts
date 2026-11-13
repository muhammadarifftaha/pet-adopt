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
import { ValidationError, UserError, describeError } from '../src/server/result'
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
  const { db, t } = await getDatabase()
  await db.delete(t.rateLimits)
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
