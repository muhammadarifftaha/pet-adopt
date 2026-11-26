// End-to-end check of the backend (accounts, auth, uploads, pets, pages, settings) against a
// database you can throw away. Run it on SQLite and on Postgres: the repositories are written once
// and must behave the same on both.
//
//   SQLite:   DATABASE_URL=file:/tmp/check.db \
//             SEED_ADMIN_EMAIL=owner@example.test SEED_ADMIN_PASSWORD=owner-password-123 pnpm check:backend
//   Postgres: run `pnpm migrate` against an empty database first, with the same variables and a
//             postgres:// DATABASE_URL.
//   Uploads go to the S3 storage in the S3_* variables (`docker compose up -d garage`
//   and the settings at the top of docker-compose.yml); use S3_PREFIX=check to keep them apart.
//
// It creates accounts, pets and pages, so never point it at a real site.
import { APIError } from 'better-auth/api'
import { eq, like, sql, type SQL } from 'drizzle-orm'
import zlib from 'node:zlib'

import { isEqual } from 'es-toolkit'

import sharp from 'sharp'

import { closeDatabase, getDatabase } from '../src/db/client'
import { safeHref, validateHttpsUrl } from '../src/lib/links'
import { richTextExtensions } from '../src/components/admin/pets/form/rich-text-extensions'
import { richTextToPlain } from '../src/lib/rich-text'
import { forgetAuth, getAuth } from '../src/server/auth'
import { createFirstAdmin, ensureSetupLink, finishSetup, hasAccounts, isSetupDone, isSetupKeyValid } from '../src/server/setup'
import { addSampleAboutPage, addSamplePets, hasSampleContent, removeSampleContent } from '../src/server/sample-content'
import { deleteAuthProvider, disconnectProvider, listAuthProviders, providersVersion, saveAuthProvider } from '../src/server/auth-providers'
import { listMedia, updateMediaDetails } from '../src/server/media'
import { cleanMediaName } from '../src/lib/media-name'
import { fillPetPlaceholders } from '../src/lib/pet-placeholders'
import {
  archivePage,
  deletePage,
  ensureHomePage,
  ensurePetPageTemplate,
  ensurePetsPage,
  getPageById,
  getPageVersionData,
  getPublishedPage,
  listPages,
  listPageVersions,
  publishPage,
  restoreAndPublishPageVersion,
  restorePage,
  restorePageVersion,
  saveDraft,
  savePageDetails,
  unpublishPage,
} from '../src/server/pages'
import { ageGroupOf, ageGroupRange, estimateBirthDate, formatAge, subtractDays, subtractMonths, todayISO } from '../src/lib/age'
import { deletePet, getLocationOptions, getPetById, getPetBySlug, getSpeciesOptions, queryPets, rankSimilarPets, savePet } from '../src/server/pets'
import { Fields, ValidationError, UserError, assertId, describeError } from '../src/server/result'
import { getStorage, s3Settings } from '../src/server/storage'
import { StripError, stripMetadata } from '../src/server/strip-metadata'
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
import { siteIcons } from '../src/lib/queries'
import { activateTheme, createTheme, deleteTheme, getTheme, listThemes, updateTheme } from '../src/server/themes'
import { createResetLink, isResetTokenValid, prepareResetEmail, resetPasswordWithToken } from '../src/server/password-reset'
import { accessOf, accessPermission, asRole, can, host, pluginTablePrefix, provideHost, ROLES, type EmailMessage, type PluginEmail, type Role } from '@pet-adopt/plugin-sdk'
import { formBuilderStorage, openFormsDatabase } from '@pet-adopt/plugin-form-builder'
import * as forms from '@pet-adopt/plugin-form-builder/server'
// The services plugins reach through `host()` (sign-in, limits, phone, email), as the server registers them.
import '../src/plugins/host'
import { forgetPluginStorageStatus, getPluginStorageStatus } from '../src/plugins/storage'
import { getEmailTemplateUsage } from '../src/plugins/registry'
import { storageProblems } from '../src/plugins/storage-rules'
import { applyPluginMigrations, pluginMigrationStates } from '../src/db/plugin-migrations'
import { archiveUser, createUser, deleteUser, DELETION_GRACE_DAYS, ensureOwner, listUsers, purgeDueDeletions, requestOwnDeletion, resetPassword, restoreUser, updateUser } from '../src/server/users'
import {
  activityRetentionDays,
  changedFields,
  exportActivityCsv,
  listActivity,
  listActivityActors,
  purgeOldActivity,
  recordActivity,
  recordedRecently,
  recordFailedSignIn,
} from '../src/server/activity'
import { getEmailSender, getEmailSettingsView, isLoopbackHost, parseFrom, resolveSmtp, saveEmailSettings, sendsToLocalServer } from '../src/server/email'
import { open, seal } from '../src/server/secret-box'
import { acceptInvite, isInviteTokenValid, sendInvite } from '../src/server/invites'
import { cancelEmailChange, confirmEmailChange, emailChangeFor, needsEmailConfirmation, pendingEmailChange, requestEmailChange, requestEmailVerification, sendEmailChangeNotice } from '../src/server/email-change'
import { adoptProviderPicture, AVATAR_SIZE, isPrivateAddress, pictureFromIdToken, removeAvatar, saveAvatar } from '../src/server/avatars'
import { backupCodesLeft, forgetTrustedDevices, needsTwoFactorSetup, resetTwoFactor, saveTwoFactorRoles } from '../src/server/two-factor'
import { BACKUP_CODE_ALPHABET, normalizeBackupCode, normalizeTotpCode } from '../src/server/two-factor-codes'
import { createHmac, generateKeyPairSync, randomBytes, sign as signData } from 'node:crypto'
import { createServer } from 'node:http'
import { DEFAULT_TEMPLATES, EMAIL_PURPOSES, emailImageSrc, LOGO_DEFAULTS, renderEmail, validateTemplate, type EmailPurpose, type RenderContext, type TemplateData } from '../src/lib/email-template'
import {
  createEmailTemplate,
  deleteEmailTemplate,
  emailContext,
  listEmailTemplates,
  getEmailTemplate,
  getSystemEmail,
  pickTemplate,
  restoreSeededTemplate,
  renderPurposeEmail,
  restoreSystemEmail,
  saveEmailTemplate,
  saveSystemEmail,
} from '../src/server/email-templates'

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
/** Accounts are removed in two steps (archive, then delete); the checks' own clean-up does both. */
const removeAccount = async (id: string) => {
  await archiveUser(id, { by: 'check-backend' })
  await deleteUser(id)
}

// Uploads have nowhere to go without the bucket settings: say so once instead of failing a dozen checks.
try {
  s3Settings()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const { dialect, db, t } = await getDatabase()
console.log(`Database dialect: ${dialect}`)

// --- first-time setup (needs a site with no accounts, so it runs first) -------------------
await check('first-time setup: a stable setup link while there are no accounts, only its key creates the first admin (once, even at the same moment), then the link is gone', async () => {
  ok(!(await hasAccounts()), 'a fresh database has no accounts')
  const link = await ensureSetupLink()
  ok(link && /\/setup\?key=[A-Za-z0-9_-]{43}$/.test(link), `a setup link: ${link}`)
  ok((await ensureSetupLink()) === link, 'the same link every time (every server instance prints the same one)')
  const key = new URL(link!).searchParams.get('key')!
  const [row] = await db.select({ sealed: t.siteSettings.setupKeyEncrypted }).from(t.siteSettings)
  ok(row.sealed && !row.sealed.includes(key), 'the key is stored sealed')
  ok(await isSetupKeyValid(key), 'its key works')
  ok(!(await isSetupKeyValid(`${key.slice(0, -1)}${key.endsWith('A') ? 'B' : 'A'}`)) && !(await isSetupKeyValid('nope')) && !(await isSetupKeyValid(undefined)), 'other keys do not')
  ok(/no longer works/.test(await userError(createFirstAdmin('x'.repeat(43), { name: 'Mal Lory', email: 'mallory@example.test', password: 'mallory-password-1' }))), 'a wrong key creates nothing')

  // Two people with the key at the same moment: exactly one account.
  const tries = await Promise.allSettled([
    createFirstAdmin(key, { name: 'First One', email: 'first@example.test', password: 'first-password-123' }),
    createFirstAdmin(key, { name: 'Second One', email: 'second@example.test', password: 'second-password-12' }),
  ])
  ok(tries.filter((r) => r.status === 'fulfilled').length === 1, 'only one first account')
  const users = await listUsers()
  ok(users.length === 1 && users[0].role === 'admin', 'an admin')
  ok(!(await isSetupKeyValid(key)) && (await ensureSetupLink()) === null, 'the link stops working once the account exists')
  const [after] = await db.select({ sealed: t.siteSettings.setupKeyEncrypted }).from(t.siteSettings)
  ok(after.sealed === null, 'and its key is deleted')

  ok(!(await isSetupDone()), 'the guided setup is not done yet')
  await finishSetup()
  ok(await isSetupDone(), 'finished (or skipped): it is not shown again')

  // Back to a site with no accounts for the checks that follow (they make their own owner).
  await db.delete(t.users)
  await db.update(t.siteSettings).set({ setupDoneAt: null })
})

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

// The transaction guarantees the repositories rely on, on a scratch table. The gate checks are for a
// local SQLite file, where client.ts makes other requests wait for an open transaction.
await check('transactions: nested work rolls back together, locked read-modify-writes lose nothing, local SQLite waits safely', async () => {
  const { withTransaction, migratesOnOpen } = await getDatabase()
  // Postgres query builders run raw SQL with execute() (rows in .rows); SQLite's with run() and all().
  type Raw = { execute?(q: unknown): Promise<{ rows: unknown[] }>; run?(q: unknown): Promise<unknown>; all?(q: unknown): Promise<unknown[]> }
  const run = (target: unknown, q: SQL) => (dialect === 'pg' ? (target as Raw).execute!(q) : (target as Raw).run!(q))
  const all = async (target: unknown, q: SQL) => (dialect === 'pg' ? (await (target as Raw).execute!(q)).rows : await (target as Raw).all!(q)) as Array<{ n: number | string }>
  const exec = (q: string) => run(db, sql.raw(q))
  const count = async () => (await all(db, sql.raw('select n from check_tx order by n'))).map((r) => Number(r.n))
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const codeOf = (e: unknown) => {
    for (let c = e as { code?: unknown; cause?: unknown } | undefined, i = 0; c && i < 4; c = c.cause as typeof c, i++) if (typeof c.code === 'string') return c.code
  }
  await exec('drop table if exists check_tx')
  await exec('create table check_tx (n integer not null)')
  try {
    // A failure undoes the outer and the nested call's writes.
    const failed = await withTransaction(async (tx) => {
      await run(tx, sql`insert into check_tx values (1)`)
      await withTransaction(async (inner) => run(inner, sql`insert into check_tx values (2)`))
      throw new Error('boom')
    }).catch((e: Error) => e.message)
    ok(failed === 'boom', 'the error comes back')
    ok((await count()).length === 0, `nested work must roll back with the outer: ${JSON.stringify(await count())}`)

    // A nested call taking the lock its outer call holds joins instead of waiting for itself.
    await withTransaction(async (tx) => {
      await run(tx, sql`insert into check_tx values (9)`)
      await withTransaction(async (inner) => run(inner, sql`delete from check_tx where n = 9`), { lock: 'check:tx' })
    }, { lock: 'check:tx' })
    ok((await count()).length === 0, 'a nested call under the same lock joins the outer transaction')

    // Same lock: one after the other, so neither reads a value the other is about to change.
    await exec('insert into check_tx values (0)')
    const bump = () =>
      withTransaction(
        async (tx) => {
          const [row] = await all(tx, sql`select n from check_tx`)
          await sleep(30)
          await run(tx, sql`update check_tx set n = ${Number(row.n) + 1}`)
        },
        { lock: 'check:tx' },
      )
    await Promise.all([bump(), bump(), bump()])
    ok((await count())[0] === 3, `three locked increments must give 3, got ${JSON.stringify(await count())}`)
    await exec('delete from check_tx')

    if (dialect !== 'sqlite' || !migratesOnOpen) {
      console.log('      (gate checks are for a local SQLite file; skipped)')
      return
    }

    // The outer db used inside a transaction joins it, so it rolls back too.
    await withTransaction(async () => {
      await run(db, sql`insert into check_tx values (3)`)
      throw new Error('boom')
    }).catch(() => undefined)
    ok((await count()).length === 0, 'a statement through the outer db inside a transaction must roll back with it')

    // Another request's statements wait for the open transaction instead of running inside it (and
    // being rolled back with it) or reading its uncommitted rows.
    const order: string[] = []
    const open = withTransaction(async (tx) => {
      await run(tx, sql`insert into check_tx values (4)`)
      await sleep(150)
      order.push('commit')
    })
    await sleep(30) // a different async context: like another request
    const reader = all(db, sql`select n from check_tx`).then((rows) => order.push(`read ${rows.length}`))
    const writer = run(db, sql`insert into check_tx values (5)`).then(() => order.push('write'))
    await Promise.all([open, reader, writer])
    ok(order[0] === 'commit', `other requests must wait for the commit: ${order.join(', ')}`)
    // Both waited for the commit (above); which of the two then runs first is up to the gate.
    ok(order.some((o) => o === 'read 1' || o === 'read 2'), `the read must see the committed row: ${order.join(', ')}`)
    ok(JSON.stringify(await count()) === '[4,5]', `both rows kept: ${JSON.stringify(await count())}`)

    // A transaction that awaits a promise another request started (a shared cache) cannot wait for
    // it forever: the gate gives up with SQLITE_BUSY, and the database keeps working.
    let shared: Promise<unknown> | undefined
    const cached = () => (shared ??= db.all(sql`select 1 as v`).then((rows) => rows))
    const started = Date.now()
    const stuck = withTransaction(async () => {
      await sleep(20)
      return cached()
    })
    setTimeout(() => void cached().catch(() => undefined), 5)
    const outcome = await stuck.then(() => 'finished', (e: unknown) => codeOf(e))
    const waited = Date.now() - started
    ok(outcome === 'SQLITE_BUSY', `expected SQLITE_BUSY, got ${String(outcome)}`)
    ok(waited >= 4500 && waited < 8000, `gave up after ${waited} ms, expected about 5000`)
    ok((await count()).length === 2, 'the database still answers afterwards')

    // Migrations need a transaction of their own.
    const { runMigrations } = await import('../src/db/migrate')
    const refused = await withTransaction(async () => runMigrations(await getDatabase())).then(() => 'ran', (e: Error) => e.message)
    ok(/cannot run inside a transaction/.test(refused), `migrate inside a transaction: ${refused}`)
  } finally {
    await exec('drop table if exists check_tx')
  }
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

await check('last admin cannot be demoted or archived; can once there are two', async () => {
  const users = await listUsers()
  const admin = users.find((u) => u.role === 'admin')!
  const editor = users.find((u) => u.role === 'editor')!
  await userError(updateUser(admin.id, { name: admin.name, role: 'editor' }, { canChangeRole: true }))
  ok(/last admin/.test(await userError(archiveUser(admin.id, { by: editor.id }))), 'the last admin cannot be archived')
  ok(/Archive the account/.test(await userError(deleteUser(admin.id))), 'an active account cannot be deleted')
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
  // The same race with archiving: two admins archiving each other.
  await updateUser(first.id, { name: first.name, role: 'admin' }, { canChangeRole: true })
  await updateUser(second.id, { name: second.name, role: 'admin' }, { canChangeRole: true })
  const archives = await Promise.allSettled([archiveUser(first.id, { by: second.id }), archiveUser(second.id, { by: first.id })])
  ok(archives.filter((r) => r.status === 'fulfilled').length === 1, 'exactly one archive may succeed')
  ok((await listUsers()).filter((u) => u.role === 'admin' && !u.archivedAt).length === 1, 'one active admin must remain after the archives too')
  // Put the accounts back the way later checks expect them.
  for (const user of await listUsers()) if (user.archivedAt) await restoreUser(user.id)
  await updateUser(first.id, { name: first.name, role: 'admin' }, { canChangeRole: true })
  await updateUser(second.id, { name: second.name, role: 'editor' }, { canChangeRole: true })
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
  const errs = await fieldErrors(savePet(null, { species: '!!!', videoUrl: 'javascript:alert(1)', adoptionFee: -5 }))
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

await check('health notes: rich text is rebuilt from allowed parts, links are vetted, old plain text still reads', async () => {
  const para = (text: string, marks?: unknown[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] })
  const doc = (...content: unknown[]) => ({ type: 'doc', content })

  const good = await savePet(null, {
    name: 'Notey',
    species: 'cat',
    photoIds: [mediaA],
    location: 'Penang',
    healthNotes: doc(
      para('Takes a tablet', [{ type: 'bold' }, { type: 'bold' }, { type: 'link', attrs: { href: '/pets/mochi', target: '_blank' } }]),
      { type: 'bulletList', content: [{ type: 'listItem', content: [para('Soft food')] }] },
    ),
  })
  const stored = (await getPetById(good.id))!.healthNotes!
  const first = stored.content[0] as { content: Array<{ marks: unknown[] }> }
  ok(JSON.stringify(first.content[0]!.marks) === JSON.stringify([{ type: 'bold' }, { type: 'link', attrs: { href: '/pets/mochi' } }]), 'duplicate marks dropped, extra link attributes removed')
  ok(richTextToPlain(stored) === 'Takes a tablet\nSoft food', 'plain text of a list')

  const nested = Array.from({ length: 8 }).reduce<unknown>(
    (inner) => ({ type: 'bulletList', content: [{ type: 'listItem', content: [para('x'), ...(inner ? [inner] : [])] }] }),
    null,
  )
  for (const [label, value] of [
    ['a heading', doc({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'x' }] })],
    ['an image', doc({ type: 'paragraph', content: [{ type: 'image', attrs: { src: '/media/a.png' } }] })],
    ['an unknown mark', doc(para('x', [{ type: 'highlight' }]))],
    ['a javascript: link', doc(para('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))],
    ['a //host link', doc(para('x', [{ type: 'link', attrs: { href: '//evil.test' } }]))],
    ['a link with a password', doc(para('x', [{ type: 'link', attrs: { href: 'https://a:b@evil.test' } }]))],
    ['an empty list', doc({ type: 'bulletList', content: [] })],
    ['more than 2000 characters', doc(para('x'.repeat(2001)))],
    ['lists nested too deeply', doc(nested)],
  ] as const) {
    ok((await fieldErrors(savePet(good.id, { healthNotes: value }))).healthNotes, `${label} is a field error`)
  }

  await savePet(good.id, { healthNotes: doc(para('x'.repeat(2000))) }) // exactly the limit is fine
  await savePet(good.id, { healthNotes: doc(para('   ')) })
  ok((await getPetById(good.id))!.healthNotes === null, 'a document with nothing visible clears the notes')

  const plain = await savePet(null, { name: 'Plainy', species: 'cat', photoIds: [mediaA], location: 'Penang', healthNotes: 'Line one\n\nLine two' })
  ok(richTextToPlain((await getPetById(plain.id))!.healthNotes!) === 'Line one\nLine two', 'plain text becomes one paragraph per line')

  // An old row (plain text column only) still reads, without a data migration.
  await db.update(t.pets).set({ healthNotes: 'Old note', healthNotesDoc: null }).where(eq(t.pets.id, plain.id))
  ok(richTextToPlain((await getPetById(plain.id))!.healthNotes!) === 'Old note', 'legacy plain-text notes are shown as a document')

  // The description is the same kind of field with a 5000-character limit.
  const long = await savePet(good.id, { description: doc(para('d'.repeat(5000))) })
  ok(richTextToPlain((await getPetById(long.id))!.description!) === 'd'.repeat(5000), 'a 5000-character description is accepted')
  ok((await fieldErrors(savePet(good.id, { description: doc(para('d'.repeat(5001))) }))).description, 'more than 5000 characters is a field error')
  ok((await fieldErrors(savePet(good.id, { description: doc({ type: 'heading', content: [] }) }))).description, 'a heading in the description is a field error')
  await savePet(good.id, { description: 'First\n\nSecond' })
  const asDoc = (await getPetById(good.id))!.description!
  ok(richTextToPlain(asDoc) === 'First\nSecond', 'a plain-text description becomes paragraphs')
  const [row] = await db.select().from(t.pets).where(eq(t.pets.id, good.id))
  ok(row!.description === null && row!.descriptionDoc !== null, 'saving writes the document column and clears the legacy text')
  await db.update(t.pets).set({ description: 'Old story', descriptionDoc: null }).where(eq(t.pets.id, good.id))
  ok(richTextToPlain((await getPetById(good.id))!.description!) === 'Old story', 'a legacy plain-text description still reads')
  await savePet(good.id, { description: '' })
  ok((await getPetById(good.id))!.description === null, 'a blank description clears it')

  // Personality notes: the same kind of field as the health notes (2000 characters), no legacy column.
  await savePet(good.id, { personalityNotes: doc(para('Loves chin scratches', [{ type: 'italic' }])) })
  ok(richTextToPlain((await getPetById(good.id))!.personalityNotes!) === 'Loves chin scratches', 'personality notes are saved as a document')
  ok((await fieldErrors(savePet(good.id, { personalityNotes: doc(para('p'.repeat(2001))) }))).personalityNotes, 'more than 2000 characters is a field error')
  ok((await fieldErrors(savePet(good.id, { personalityNotes: doc({ type: 'heading', content: [] }) }))).personalityNotes, 'a heading in personality notes is a field error')
  await savePet(good.id, { name: 'Notey' })
  ok((await getPetById(good.id))!.personalityNotes !== null, 'kept when another field is saved')
  await savePet(good.id, { personalityNotes: '' })
  ok((await getPetById(good.id))!.personalityNotes === null, 'a blank value clears them')

  // The editor can produce exactly what the validator accepts, no more.
  const names = richTextExtensions.map((e) => e.name).sort()
  ok(
    JSON.stringify(names) === JSON.stringify(['bold', 'bulletList', 'doc', 'italic', 'link', 'listItem', 'orderedList', 'paragraph', 'text', 'underline', 'undoRedo']),
    `editor extensions ${names.join(',')}`,
  )

  await deletePet(good.id)
  await deletePet(plain.id)
})

await check('species is free text: stored normalised, filterable, offered as an option', async () => {
  const custom = await savePet(null, { name: 'Nibbles', species: '  Guinea  Pig ', photoIds: [mediaA], location: 'Penang' })
  const hidden = await savePet(null, { name: 'Axel', species: 'Axolotl', unlisted: true, photoIds: [mediaA], location: 'Ipoh' })
  ok((await getPetById(custom.id))!.species === 'guinea-pig', 'stored normalised')
  ok((await queryPets({ species: 'Guinea Pig' })).docs.length === 1, 'the filter is normalised too')
  ok((await queryPets({ species: 'GUINEA-PIG' })).docs[0]?.slug === 'nibbles', 'another spelling of the same species')
  const options = await getSpeciesOptions()
  ok(options.some((o) => o.value === 'guinea-pig' && o.label === 'Guinea pig'), `custom label ${JSON.stringify(options)}`)
  ok(options.some((o) => o.value === 'dog' && o.label === 'Dog'), 'built-ins keep their labels')
  ok(!options.some((o) => o.value === 'rabbit'), 'a species nobody has is not offered')
  ok(!options.some((o) => o.value === 'axolotl'), 'unlisted pets do not leak their species')
  ok((await getSpeciesOptions({ includeUnlisted: true })).some((o) => o.value === 'axolotl'), 'the admin sees every species')
  ok((await fieldErrors(savePet(custom.id, { species: '***' }))).species, 'no letters or digits is an error')
  ok((await fieldErrors(savePet(custom.id, { species: 'x'.repeat(41) }))).species, 'too long is an error')
  await savePet(custom.id, { species: '' })
  ok((await getPetById(custom.id))!.species === 'guinea-pig', 'blank keeps the current species')
  await deletePet(custom.id)
  await deletePet(hidden.id)
})

await check('age: worked out from a birth date, so it moves with the calendar', async () => {
  // Pure functions, with `today` moved around.
  ok(estimateBirthDate(8, 'months', '2026-11-23') === '2026-03-23', 'months')
  ok(estimateBirthDate(2, 'years', '2026-11-23') === '2024-11-23', 'years')
  ok(estimateBirthDate(3, 'weeks', '2026-11-23') === '2026-11-02', 'weeks')
  ok(subtractMonths('2026-03-31', 1) === '2026-02-28', 'a shorter month clamps the day')
  ok(formatAge('2026-03-23', { estimated: true, today: '2026-11-23' }) === 'About 8 months', 'estimate label')
  ok(formatAge('2026-03-23', { estimated: true, today: '2026-12-23' }) === 'About 9 months', 'a month later it says 9')
  ok(formatAge('2024-07-23', { today: '2026-11-23' }) === '2 years 4 months', 'young animals show months too')
  ok(formatAge('2021-11-23', { today: '2026-11-23' }) === '5 years', 'older ones show years')
  ok(formatAge('2026-11-16', { today: '2026-11-23' }) === '1 week', 'one week')
  ok(formatAge('2026-11-20', { today: '2026-11-23' }) === 'Under 1 week', 'newborn')
  ok(formatAge('2027-01-01', { today: '2026-11-23' }) === null, 'a date in the future has no age')

  const today = '2026-11-23'
  ok(ageGroupOf('2026-05-24', today) === 'baby' && ageGroupOf('2026-05-23', today) === 'young', 'baby ends at 6 months')
  ok(ageGroupOf('2018-11-24', today) === 'adult' && ageGroupOf('2018-11-23', today) === 'senior', 'senior starts at 8 years')
  ok(ageGroupRange('robot', today) === null, 'an unknown group has no range')
  // The label and the SQL filter must agree on every date.
  for (let days = 0; days < 4000; days += 37) {
    const birth = subtractDays(today, days)
    const range = ageGroupRange(ageGroupOf(birth, today), today)
    ok(range && (!range.after || birth > range.after) && (!range.onOrBefore || birth <= range.onOrBefore), `range disagrees at ${birth}`)
  }
})

await check('age: saved as an estimate or an exact date, shown live, and filtered by group', async () => {
  const today = todayISO()
  const pup = await savePet(null, { name: 'Pip Squeak', species: 'dog', photoIds: [mediaA], location: 'Penang', ageValue: 3, ageUnit: 'months' })
  let pet = (await getPetById(pup.id))!
  ok(pet.birthDate === estimateBirthDate(3, 'months', today) && pet.birthDateEstimated === true, 'stored as an estimated birth date')
  ok(pet.ageDescription === 'About 3 months' && pet.ageGroup === 'baby', `live age ${pet.ageDescription} / ${pet.ageGroup}`)
  const babies = await queryPets({ ageGroup: 'baby' })
  ok(babies.docs.some((p) => p.slug === pup.slug && p.ageDescription === 'About 3 months'), 'the filter and the list use the live age')
  ok(!(await queryPets({ ageGroup: 'senior' })).docs.some((p) => p.slug === pup.slug), 'not senior')

  const before = pet.birthDate
  await savePet(pup.id, { breed: 'Beagle', birthDate: before })
  pet = (await getPetById(pup.id))!
  ok(pet.birthDate === before && pet.birthDateEstimated === true, 'saving the same date again keeps it an estimate')

  await savePet(pup.id, { birthDate: estimateBirthDate(7, 'years', today) })
  pet = (await getPetById(pup.id))!
  ok(!pet.birthDateEstimated && pet.ageGroup === 'adult' && pet.ageDescription === '7 years', `exact date ${pet.ageDescription}`)

  await savePet(pup.id, { birthDate: '', ageValue: 2, ageUnit: 'years' })
  pet = (await getPetById(pup.id))!
  ok(pet.birthDateEstimated && pet.ageDescription === 'About 2 years', 'a blank date next to an age means use the age')

  ok((await fieldErrors(savePet(pup.id, { ageValue: 3 }))).ageUnit, 'a number needs a unit')
  ok((await fieldErrors(savePet(pup.id, { ageUnit: 'years' }))).ageValue, 'a unit needs a number')
  ok((await fieldErrors(savePet(pup.id, { birthDate: '2020-01-01', ageValue: 2, ageUnit: 'years' }))).ageValue, 'a date and an age together')
  ok((await fieldErrors(savePet(pup.id, { birthDate: '2999-01-01' }))).birthDate, 'a birth date in the future')
  ok((await fieldErrors(savePet(pup.id, { ageValue: 1.5, ageUnit: 'years' }))).ageValue, 'a whole number')

  await savePet(pup.id, { ageDescription: 'young adult', ageGroup: 'young' })
  await savePet(pup.id, { birthDate: null })
  pet = (await getPetById(pup.id))!
  ok(pet.birthDate === null && !pet.birthDateEstimated && pet.ageDescription === 'young adult' && pet.ageGroup === 'young', 'cleared: back to the typed text')
  ok((await queryPets({ ageGroup: 'young' })).docs.some((p) => p.slug === pup.slug), 'a pet without a birth date is filtered by its picked group')
  await deletePet(pup.id)
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

await check('pages: archive first, then restore or delete; archived pages are off the site and read-only', async () => {
  const page = await savePageDetails(null, { title: 'Old news', slug: 'old-news' })
  const layout = { root: { props: {} }, zones: {}, content: [{ type: 'TextSection', props: { id: 'a', heading: 'News' } }] }
  await publishPage(page.id, layout)
  ok(/Archive the page before deleting/.test(await userError(deletePage(page.id))), 'a page in use cannot be deleted')

  await archivePage(page.id)
  await archivePage(page.id) // twice is fine
  ok((await getPublishedPage('old-news')) === null, 'an archived page is off the site')
  ok((await listPages()).find((p) => p.id === page.id)!.state === 'archived', 'listed as archived')
  ok(/archived/.test(await userError(saveDraft(page.id, layout))), 'no draft saves while archived')
  ok(/archived/.test(await userError(publishPage(page.id))), 'no publishing while archived')
  ok(/archived/.test(await userError(savePageDetails(page.id, { title: 'New' }))), 'no detail edits while archived')
  ok(/archived/.test(await userError(restorePageVersion(page.id, 1))), 'no version restores while archived')
  ok((await fieldErrors(savePageDetails(null, { title: 'Taken', slug: 'old-news' }))).slug, 'an archived page keeps its address')

  await restorePage(page.id)
  ok((await getPublishedPage('old-news')) !== null, 'restoring brings a published page back as it was')
  await archivePage(page.id)
  await deletePage(page.id)
  ok((await getPageById(page.id)) === null, 'deleted once archived')
  ok(/not found/i.test(await userError(deletePage(page.id))), 'a missing page')
})

await check('pages: one version per publish cycle; drafts update the open version; a restore is always a new version (also with publish); the latest 50 kept', async () => {
  const [admin] = await listUsers()
  const page = await savePageDetails(null, { title: 'History', slug: 'history' })
  const layout = (heading: string) => ({ root: { props: {} }, zones: {}, content: [{ type: 'TextSection', props: { id: 'a', heading } }] })
  const heading = (data: unknown) => (data as { content: Array<{ props: { heading: string } }> }).content[0].props.heading
  const shape = async () => (await listPageVersions(page.id)).map((v) => `${v.number}:${v.kind}`).join(',')

  // Version 1 collects every draft save until it is published.
  await saveDraft(page.id, layout('one'), undefined, admin.id)
  await saveDraft(page.id, layout('one-b'), undefined, admin.id)
  ok((await shape()) === '1:draft', `drafts update version 1 in place: ${await shape()}`)
  ok(heading(await getPageVersionData(page.id, 1)) === 'one-b', 'version 1 holds the latest draft')
  await publishPage(page.id, undefined, undefined, admin.id)
  ok((await shape()) === '1:published', `publishing closes version 1: ${await shape()}`)
  ok((await listPageVersions(page.id))[0].createdBy === admin.name, 'records who saved it')

  // Nothing opens while the draft is still what was published; the first real change opens version 2.
  await saveDraft(page.id, layout('one-b'))
  ok((await shape()) === '1:published', 'saving the published layout again opens nothing')
  await saveDraft(page.id, layout('two'))
  await saveDraft(page.id, layout('two-b'))
  ok((await shape()) === '2:draft,1:published', `changes after a publish are version 2: ${await shape()}`)
  await publishPage(page.id)
  await publishPage(page.id)
  ok((await shape()) === '2:published,1:published', `a re-publish adds nothing: ${await shape()}`)
  ok(heading(await getPageVersionData(page.id, 2)) === 'two-b', 'version 2 is what went live')

  // Restore: a new version holding the old layout, which remembers its source.
  const opened = (await getPageById(page.id))!.updatedAt.getTime()
  const restored = await restorePageVersion(page.id, 1, { baseVersion: opened, by: admin.id })
  ok(restored.number === 3, `version 1 goes into the open version 3: ${restored.number}`)
  let versions = await listPageVersions(page.id)
  ok(versions[0].kind === 'draft' && versions[0].restoredFrom === 1, 'version 3 is open and came from version 1')
  ok(heading((await getPageById(page.id))!.puckDraft) === 'one-b', 'the draft is version 1 again')
  ok(heading((await getPublishedPage('history'))!.puckData) === 'two-b', 'the live page is unchanged until published')
  // A save without a base version stamps Date.now(), which can share a millisecond with `opened`
  // and make the stale check below pass by accident. (The builder and the table always send one.)
  await new Promise((resolve) => setTimeout(resolve, 2))
  await saveDraft(page.id, layout('three'))
  versions = await listPageVersions(page.id)
  ok(versions[0].number === 3 && versions[0].restoredFrom === 1, 'later saves stay in version 3 and keep the mark')
  ok(/already the draft/.test(await userError(restorePageVersion(page.id, 3))), 'the open version cannot be restored onto itself')
  ok(/changed somewhere else/.test(await userError(restorePageVersion(page.id, 2, { baseVersion: opened }))), 'a stale restore is refused')
  ok(/no longer exists/.test(await userError(restorePageVersion(page.id, 99))), 'a missing version')

  // Restoring over unpublished work keeps that work: version 3 (an open draft) stays as it was and
  // version 1 comes back as a new version 4. Nothing is overwritten or renumbered.
  const before = (await getPageById(page.id))!.updatedAt.getTime()
  const again = await restorePageVersion(page.id, 1, { baseVersion: before, by: admin.id })
  ok(again.number === 4, `restoring over an open draft starts version 4: ${again.number}`)
  ok(heading(await getPageVersionData(page.id, 3)) === 'three', 'the unpublished work in version 3 is kept')
  ok(heading(await getPageVersionData(page.id, 4)) === 'one-b', 'version 4 holds version 1')
  ok((await shape()) === '4:draft,3:draft,2:published,1:published', `history: ${await shape()}`)
  await saveDraft(page.id, layout('four'))
  ok((await shape()).startsWith('4:draft,3:draft'), 'later saves go into version 4, the new open one')

  // Restore and publish: one step, the restored version goes live, the history only grows.
  const base = (await getPageById(page.id))!.updatedAt.getTime()
  const rolled = await restoreAndPublishPageVersion(page.id, 2, { baseVersion: base, by: admin.id })
  ok(rolled.number === 5, `restore and publish makes version 5: ${rolled.number}`)
  ok(heading((await getPublishedPage('history'))!.puckData) === 'two-b', 'version 2 is live again')
  ok((await shape()) === '5:published,4:draft,3:draft,2:published,1:published', `history after the rollback: ${await shape()}`)
  ok((await listPageVersions(page.id))[0].restoredFrom === 2, 'version 5 says where it came from')
  ok(/changed somewhere else/.test(await userError(restoreAndPublishPageVersion(page.id, 1, { baseVersion: base }))), 'a stale restore and publish is refused, nothing goes live')
  ok(heading((await getPublishedPage('history'))!.puckData) === 'two-b', 'and the live page is untouched by the refused one')

  // Only the latest 50 versions are kept.
  for (let i = 0; i < 55; i++) {
    await saveDraft(page.id, layout(`v${i}`))
    await publishPage(page.id)
  }
  versions = await listPageVersions(page.id)
  ok(versions.length === 50 && versions[0].number === 60 && versions.at(-1)!.number === 11, `trimmed to 50: ${versions.length}, ${versions[0].number}..${versions.at(-1)!.number}`)

  // Deleting the page removes its history.
  await archivePage(page.id)
  await deletePage(page.id)
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(t.pageVersions).where(eq(t.pageVersions.pageId, page.id))
  ok(Number(n) === 0, 'versions go with the page')
})

await check('pages: on a live page, settings wait for publish and make versions; addresses cannot clash, even as drafts', async () => {
  const [admin] = await listUsers()
  const layout = { root: { props: {} }, zones: {}, content: [{ type: 'TextSection', props: { id: 'a', heading: 'Hello' } }] }
  const page = await savePageDetails(null, { title: 'About us', slug: 'about-us' })
  await saveDraft(page.id, layout, undefined, admin.id)
  await publishPage(page.id, undefined, undefined, admin.id)
  const shape = async () => (await listPageVersions(page.id)).map((v) => `${v.number}:${v.kind}`).join(',')
  ok((await shape()) === '1:published', `published as version 1: ${await shape()}`)

  // A title and address change on the live page: a draft, visitors keep the old ones.
  await savePageDetails(page.id, { title: 'Who we are', slug: 'who-we-are', seoDescription: 'Our team.' }, { by: admin.id })
  let p = (await getPageById(page.id))!
  ok(p.title === 'About us' && p.slug === 'about-us', 'the live title and address are unchanged')
  ok(p.draftDetails?.title === 'Who we are' && p.draftDetails.slug === 'who-we-are' && p.draftDetails.seo.description === 'Our team.', 'the draft holds the new settings')
  ok((await getPublishedPage('about-us')) !== null && (await getPublishedPage('who-we-are')) === null, 'visitors still find it at the old address')
  ok((await listPages()).find((x) => x.id === page.id)?.hasUnpublishedChanges === true, 'it shows as having unpublished changes')
  ok((await shape()) === '2:draft,1:published', `a settings change opens version 2: ${await shape()}`)

  // Another page cannot take an address that is waiting to be published.
  ok((await fieldErrors(savePageDetails(null, { title: 'Clash', slug: 'who-we-are' }))).slug, 'a new page cannot take a pending address either')
  const other = await savePageDetails(null, { title: 'Other', slug: 'other' })
  ok((await fieldErrors(savePageDetails(other.id, { title: 'Other', slug: 'who-we-are' }))).slug, 'a pending address is taken')

  // Publishing applies the settings with the layout, in the same version.
  await publishPage(page.id, undefined, undefined, admin.id)
  p = (await getPageById(page.id))!
  ok(p.title === 'Who we are' && p.slug === 'who-we-are' && p.draftDetails === null, 'publishing applies the settings')
  ok((await getPublishedPage('who-we-are')) !== null && (await getPublishedPage('about-us')) === null, 'visitors now find it at the new address')
  ok((await shape()) === '2:published,1:published', `version 2 is what went live: ${await shape()}`)

  // Changing a setting back to what is live clears the draft.
  await savePageDetails(page.id, { title: 'Temporary', slug: 'who-we-are' })
  await savePageDetails(page.id, { title: 'Who we are', slug: 'who-we-are' })
  ok((await getPageById(page.id))!.draftDetails === null, 'settings back to the live ones leave no draft')

  // Restoring version 1 brings its title and address back, as a draft of a new version.
  const base = (await getPageById(page.id))!.updatedAt.getTime()
  const restored = await restorePageVersion(page.id, 1, { baseVersion: base, by: admin.id })
  p = (await getPageById(page.id))!
  ok(p.draftDetails?.title === 'About us' && p.draftDetails.slug === 'about-us' && p.title === 'Who we are', `the restore is a draft of the old settings (version ${restored.number})`)
  await publishPage(page.id)
  ok((await getPageById(page.id))!.slug === 'about-us', 'publishing the restore brings the old address back')

  // A page that is not live has nothing to protect: settings are written straight away.
  await unpublishPage(other.id)
  await savePageDetails(other.id, { title: 'Other page', slug: 'other' })
  ok((await getPageById(other.id))!.title === 'Other page', 'on a page that is not live, settings apply at once')

  for (const id of [page.id, other.id]) {
    await archivePage(id)
    await deletePage(id)
  }
})

await check('pages: the homepage always exists, starts from the built-in layout, keeps its address, cannot be archived or deleted', async () => {
  // Earlier checks created pages, so id 1 may already be taken by another page.
  const before = await listPages()
  const occupant = before.find((p) => p.id === 1)
  const occupantVersions = occupant ? (await listPageVersions(occupant.id)).length : 0
  ok((await ensureHomePage()) === 'created', 'created when missing')
  ok((await listPages()).find((p) => p.slug === 'home')!.id === 1, 'the homepage is id 1')
  if (occupant) {
    const moved = (await listPages()).find((p) => p.slug === occupant.slug)!
    ok(moved.id !== 1, 'the page that had id 1 moved')
    ok((await listPageVersions(moved.id)).length === occupantVersions, 'and its versions moved with it')
  }
  const fresh = await savePageDetails(null, { title: 'After home', slug: 'after-home' })
  ok(fresh.id > 1, `a new page gets a new id, no collision: ${fresh.id}`)
  // A homepage found under another id is moved back to 1, with its history.
  // A homepage found under another id swaps ids with the page on id 1, histories included.
  await db.update(t.pages).set({ id: 9999 }).where(eq(t.pages.slug, 'home'))
  await db.update(t.pages).set({ id: 1 }).where(eq(t.pages.id, fresh.id))
  ok((await ensureHomePage()) === 'moved', 'moved back')
  ok((await getPageById(1))!.slug === 'home' && (await listPageVersions(1)).length === 1, 'id 1 again, version 1 kept')
  ok((await getPageById(9999))!.slug === 'after-home', 'the other page took the homepage\'s old id (a swap)')
  fresh.id = 9999
  await archivePage(fresh.id)
  await deletePage(fresh.id)
  ok((await ensureHomePage()) === 'exists', 'not twice')
  const results = await Promise.all([ensureHomePage(), ensureHomePage()])
  ok(results.every((r) => r === 'exists'), 'parallel calls do not duplicate it')
  const home = (await listPages()).find((p) => p.slug === 'home')!
  ok(home.title === 'Home' && home.state === 'published' && !home.hasUnpublishedChanges, 'published, as the built-in layout')
  ok(home.latestVersion === 1, 'the built-in layout is version 1')
  const { DEFAULT_HOME_DATA } = await import('../src/puck/data')
  ok(JSON.stringify((await getPublishedPage('home'))!.puckData).length > 0 && (await listPageVersions(home.id))[0].kind === 'published', 'live and versioned')
  ok(Array.isArray(DEFAULT_HOME_DATA.content), 'built-in layout loaded')

  ok((await fieldErrors(savePageDetails(home.id, { slug: 'start' }))).slug, 'its address cannot change')
  await savePageDetails(home.id, { title: 'Welcome', slug: 'home' })
  ok((await getPageById(home.id))!.draftDetails?.title === 'Welcome', 'its title can change (as a draft: the homepage is live)')
  await publishPage(home.id)
  ok((await getPageById(home.id))!.title === 'Welcome', 'and goes live when published')
  ok(/cannot be archived/.test(await userError(archivePage(home.id))), 'cannot be archived')
  ok(/cannot be deleted/.test(await userError(deletePage(home.id))), 'cannot be deleted')
  await unpublishPage(home.id)
  ok((await getPublishedPage('home')) === null, 'can be unpublished (the built-in homepage shows instead)')
  ok((await ensureHomePage()) === 'exists', 'an unpublished homepage is not replaced')
  await publishPage(home.id)
})

await check('themes: created from a preset or duplicated, unique names, readable text enforced, active theme drives the settings', async () => {
  const before = await getSettings()
  const { id } = await createTheme({ name: 'Forest', preset: 'meadow' })
  ok((await getTheme(id))!.base === 'meadow', 'starts from the chosen preset')
  ok((await fieldErrors(createTheme({ name: 'forest', preset: 'ocean' }))).name, 'names are unique, ignoring case')
  ok((await fieldErrors(createTheme({ name: 'X', preset: 'nope' }))).preset, 'only real presets')

  // Unreadable text is refused, with the error on the colour set that causes it.
  const unreadable = await fieldErrors(updateTheme(id, { customTheme: { light: { text: '#f5f5f5', background: '#ffffff' } } }))
  ok(unreadable['customTheme.light.text'], `light text must be readable: ${JSON.stringify(unreadable)}`)
  ok((await fieldErrors(updateTheme(id, { customTheme: { radius: 'huge' } })))['customTheme.radius'], 'only known shapes')

  const saved = await updateTheme(id, { name: 'Forest floor', base: 'meadow', customTheme: { headingFont: 'lora', light: { primary: '#2f6b3a', tint: null }, dark: {} } })
  ok(saved.name === 'Forest floor' && saved.settings.headingFont === 'lora', 'name and fonts saved')
  // isEqual ignores key order: PostgreSQL's jsonb returns keys in its own order.
  ok(isEqual(saved.settings, { headingFont: 'lora', light: { primary: '#2f6b3a' } }), `cleared values are dropped: ${JSON.stringify(saved.settings)}`)

  const copy = await createTheme({ name: 'Forest floor copy', fromThemeId: id })
  ok(isEqual((await getTheme(copy.id))!.settings, saved.settings), 'a duplicate copies the customisations')

  // Using a theme lays it over the settings everything reads.
  await activateTheme({ themeId: id })
  let settings = await getSettings()
  ok(settings.activeThemeId === id && settings.theme === 'meadow' && settings.customize && settings.customTheme?.headingFont === 'lora', 'the active theme drives the settings')
  ok(settings.primaryColor === null, 'an old brand colour does not override the theme')
  ok((await listThemes()).activeThemeId === id, 'listed as in use')
  ok(/in use/.test(await userError(deleteTheme(id))), 'the theme in use cannot be deleted')

  // Back to a built-in preset as designed.
  await activateTheme({ preset: 'ocean' })
  settings = await getSettings()
  ok(settings.activeThemeId === null && settings.theme === 'ocean' && !settings.customize, 'a preset is used as it is')

  await deleteTheme(id)
  await deleteTheme(copy.id)
  ok((await getTheme(id)) === null, 'deleted')
  ok(/no longer exists/.test(await userError(activateTheme({ themeId: id }))), 'a deleted theme cannot be used')
  await activateTheme({ preset: before.theme })
})

await check('pages: the Pets page is a system page at id 2, keeps /pets, cannot be archived or deleted', async () => {
  await ensureHomePage()
  // A page may already sit on id 2: it moves out of the way, keeping its history.
  const other = (await listPages()).find((p) => p.id === 2)
  const otherVersions = other ? (await listPageVersions(other.id)).length : 0
  ok(['created', 'moved', 'exists'].includes(await ensurePetsPage()), 'ensured')
  const pets = (await getPageById(2))!
  ok(pets.slug === 'pets' && pets.status === 'published', 'the Pets page is id 2, published')
  ok((await getPageById(1))!.slug === 'home', 'the homepage stays at id 1')
  if (other && other.slug !== 'pets') {
    const moved = (await listPages()).find((p) => p.slug === other.slug)!
    ok(moved.id !== 2 && (await listPageVersions(moved.id)).length === otherVersions, 'the page on id 2 moved with its history')
  }
  ok((await ensurePetsPage()) === 'exists', 'not twice')
  const layout = (await getPublishedPage('pets'))!.puckData as { content: Array<{ type: string }> }
  ok(layout.content[0].type === 'PetCatalog', 'starts as the catalogue')

  // Its own reserved address is fine for it, and for nobody else.
  await savePageDetails(2, { title: 'Meet the pets', slug: 'pets' })
  ok((await getPageById(2))!.draftDetails?.title === 'Meet the pets', 'its title can change (as a draft: the Pets page is live)')
  await publishPage(2)
  ok((await getPageById(2))!.title === 'Meet the pets', 'and goes live when published')
  ok((await fieldErrors(savePageDetails(2, { slug: 'animals' }))).slug, 'its address cannot change')
  ok((await fieldErrors(savePageDetails(null, { title: 'Copy', slug: 'pets' }))).slug, 'no other page can take /pets')
  ok(/cannot be archived/.test(await userError(archivePage(2))), 'cannot be archived')
  ok(/cannot be deleted/.test(await userError(deletePage(2))), 'cannot be deleted')
  await savePageDetails(2, { title: 'Adoptable pets', slug: 'pets' })
})

await check('pages: the Pet page template is a system page at id 3 with the pet blocks; /pet-page is reserved; it cannot be archived or deleted', async () => {
  await ensurePetsPage()
  ok(['created', 'moved', 'exists'].includes(await ensurePetPageTemplate()), 'ensured')
  ok((await ensurePetPageTemplate()) === 'exists', 'not twice')
  const template = (await getPageById(3))!
  ok(template.slug === 'pet-page' && template.status === 'published', 'the template is id 3, published')
  ok((await getPageById(1))!.slug === 'home' && (await getPageById(2))!.slug === 'pets', 'the homepage and the Pets page keep ids 1 and 2')
  const layout = (await getPublishedPage('pet-page'))!.puckData as { content: Array<{ type: string }> }
  ok(layout.content.map((block) => block.type).join() === 'PetGallery,PetSummary,PetDescription,PetHealth,PetPersonality,MorePets', 'starts with the pet blocks')
  ok((await fieldErrors(savePageDetails(3, { slug: 'pet-layout' }))).slug, 'its address cannot change')
  ok((await fieldErrors(savePageDetails(null, { title: 'Copy', slug: 'pet-page' }))).slug, 'no other page can take /pet-page')
  ok(/cannot be archived/.test(await userError(archivePage(3))), 'cannot be archived')
  ok(/cannot be deleted/.test(await userError(deletePage(3))), 'cannot be deleted')
})

await check('pet placeholders: {pet} and friends are filled, missing values leave no gaps, unknown words stay', async () => {
  const pet = { name: 'Maple', speciesLabel: 'Cat', breed: null, ageLabel: 'About 3 years', sexLabel: 'Female', location: 'Ipoh, Perak' }
  ok(fillPetPlaceholders('Ask about {pet} on WhatsApp', pet) === 'Ask about Maple on WhatsApp', 'the name')
  ok(fillPetPlaceholders('Meet {pet}, a {breed} {species} in {location}', pet) === 'Meet Maple, a Cat in Ipoh, Perak', 'a missing breed leaves no double space')
  ok(fillPetPlaceholders('{pet} ({age}, {sex}) {price}', pet) === 'Maple (About 3 years, Female) {price}', 'unknown placeholders stay as typed')
  ok(fillPetPlaceholders('Hi {pet}', { ...pet, name: '{species} $& $1' }) === 'Hi {species} $& $1', 'a name is inserted as is, never filled again')
})

await check('more pets like this: available, listed pets of the same species first, then the same state, never the pet itself', async () => {
  // Its own photo: earlier checks delete the shared one.
  const photo = await saveUpload({ data: png, alt: 'Similar pets' })
  const make = (name: string, species: string, state: string, extra: Record<string, unknown> = {}) =>
    savePet(null, { name, species, city: 'Town', state, photoIds: [photo.id], ...extra })
  const pet = await make('Axo One', 'axolotl', 'Zedland')
  const sameSpecies = await make('Axo Two', 'axolotl', 'Elsewhere')
  const adopted = await make('Axo Adopted', 'axolotl', 'Zedland', { status: 'adopted' })
  const unlisted = await make('Axo Hidden', 'axolotl', 'Zedland', { unlisted: true })
  const sameState = await make('Quokka Near', 'quokka', 'Zedland')
  try {
    const top = await rankSimilarPets({ id: pet.id, species: 'axolotl', state: 'Zedland' }, 2)
    ok(top.map((p) => p.id).join() === `${sameSpecies.id},${sameState.id}`, `same species, then same state: ${top.map((p) => p.name)}`)
    const all = await rankSimilarPets({ id: pet.id, species: 'axolotl', state: 'Zedland' }, 12)
    const ids = new Set(all.map((p) => p.id))
    ok(!ids.has(pet.id) && !ids.has(adopted.id) && !ids.has(unlisted.id), 'never itself, adopted or unlisted pets')
    ok(ids.size === all.length && all.length <= 12, 'no pet twice, at most the limit')
    ok((await rankSimilarPets({ id: pet.id, species: 'axolotl', state: null }, 99)).length <= 12, 'the limit is clamped')
  } finally {
    for (const p of [pet, sameSpecies, adopted, unlisted, sameState]) await deletePet(p.id)
    await removeUpload(photo.id)
  }
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
  ok(saved.whatsappNumber === '+60123456789', `a local number is stored in E.164: ${saved.whatsappNumber}`)
  ok(/too short/.test((await fieldErrors(updateSettings({ whatsappNumber: '+60 12' }))).whatsappNumber ?? ''), 'a short number says why')
  ok((await updateSettings({ whatsappNumber: '+65 9123 4567' })).whatsappNumber === '+6591234567', 'another country keeps its code')
  await updateSettings({ whatsappNumber: '012-345 6789' })
  const again = await getSettings()
  ok(again.customTheme?.radius === 'lg' && again.customTheme?.light?.primary === '#0a7d3c', `customTheme ${JSON.stringify(again.customTheme)}`)
  ok(again.whatsappMessage?.includes('{pet}'), 'default message kept')
})

await check('settings: the site icon must be square and at least 32 px; it is served to every layout and cannot be deleted while used', async () => {
  const square = (size: number) => sharp({ create: { width: size, height: size, channels: 3, background: '#0a7d3c' } }).png().toBuffer()
  const wide = await saveUpload({ data: png, alt: 'Wide' })
  const tiny = await saveUpload({ data: await square(16), alt: 'Tiny' })
  const icon = await saveUpload({ data: await square(64), alt: 'Paw mark' })
  ok(/square/.test((await fieldErrors(updateSettings({ faviconId: wide.id }))).faviconId ?? ''), 'a 40 × 30 image is refused')
  ok(/at least 32/.test((await fieldErrors(updateSettings({ faviconId: tiny.id }))).faviconId ?? ''), 'a 16 px image is refused')
  ok((await fieldErrors(updateSettings({ faviconId: 2_000_000 }))).faviconId, 'a missing image is refused')
  const saved = await updateSettings({ faviconId: icon.id, logoId: wide.id })
  ok(saved.favicon?.id === icon.id && saved.logo?.id === wide.id, 'icon and logo are separate')
  const icons = siteIcons(saved) as { icon: Array<{ url: string; type?: string }> }
  ok(icons.icon[0].url === icon.url && icons.icon[0].type === 'image/png', `icon metadata ${JSON.stringify(icons)}`)
  ok(/site icon/.test(await userError(removeUpload(icon.id))), 'an image used as the site icon cannot be deleted')
  ok((await updateSettings({ faviconId: null, logoId: null })).favicon === null, 'the icon can be cleared')
  ok(siteIcons(await getSettings()) === undefined, 'no icon, no metadata')
  for (const media of [wide, tiny, icon]) await removeUpload(media.id)
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

await check('uploads: the display name is cleaned and searchable; the stored file keeps a random name', async () => {
  const named = await saveUpload({ data: png, alt: 'A cat', name: '  ../Barn\u0000 cats  final.JPG ' })
  ok(named.name === '.. Barn cats final', `cleaned name: ${JSON.stringify(named.name)}`)
  ok(/^[0-9a-f]{32}\.png$/.test(named.filename), `the file keeps a random name: ${named.filename}`)
  ok((await listMedia({ search: 'barn cats' })).docs.some((x) => x.id === named.id), 'search finds the name')
  const blank = await saveUpload({ data: png, alt: 'No name' })
  ok(blank.name === null, 'no name stays null')
  ok(cleanMediaName('x'.repeat(500))?.length === 120 && cleanMediaName(' .png ') === null, 'long names are cut, empty ones are null')
  // Renaming on the image page: cleaned, both fields required, the stored file is untouched.
  const renamed = await updateMediaDetails(named.id, { name: ' Kittens / spring.png ', alt: ' Two kittens ' })
  ok(renamed.name === 'Kittens spring' && renamed.alt === 'Two kittens' && renamed.filename === named.filename, `renamed: ${JSON.stringify(renamed.name)}`)
  const bad = await fieldErrors(updateMediaDetails(named.id, { name: ' ', alt: '' }))
  ok(bad.name && bad.alt, `both fields are required: ${JSON.stringify(bad)}`)
  await removeUpload(named.id)
  await removeUpload(blank.id)
})

await check('search is case-insensitive and Unicode-aware; hostile page numbers are clamped', async () => {
  const m = await saveUpload({ data: png, alt: 'Orange Square on Sofa' })
  ok((await listMedia({ search: 'orange square' })).docs.some((x) => x.id === m.id), 'a lower-case term finds mixed-case alt text')
  ok((await listMedia({ search: 'SOFA' })).docs.some((x) => x.id === m.id), 'an upper-case term does too')
  const paris = await savePet(null, { name: 'Café Parisienne', breed: 'Bâtard', photoIds: [m.id], location: 'Île-de-France' })
  // Folding is done by the app (foldText into stored search columns), so it is the same on every
  // database and every locale: case and accents both fold, in both directions.
  ok((await queryPets({ location: 'île' })).docs.some((p) => p.id === paris.id), 'accented lower-case search')
  ok((await queryPets({ location: 'ÎLE-DE' })).docs.some((p) => p.id === paris.id), 'accented upper-case search')
  ok((await queryPets({ location: 'ile-de' })).docs.some((p) => p.id === paris.id), 'unaccented search finds the accented location')
  ok((await queryPets({ search: 'cafe', includeUnlisted: true })).docs.some((p) => p.id === paris.id), '"cafe" finds "Café"')
  ok((await queryPets({ search: 'BATARD', includeUnlisted: true })).docs.some((p) => p.id === paris.id), 'breed is searched, folded')
  ok(!(await queryPets({ search: 'cafx', includeUnlisted: true })).docs.some((p) => p.id === paris.id), 'a different word does not match')
  const accented = await saveUpload({ data: png, alt: 'Chat sur le canapé' })
  ok((await listMedia({ search: 'CANAPE' })).docs.some((x) => x.id === accented.id), 'media search folds accents too')
  await savePet(paris.id, { name: 'Zoë' })
  ok((await queryPets({ search: 'zoe', includeUnlisted: true })).docs.some((p) => p.id === paris.id), 'a renamed pet is found by its new name')
  ok(!(await queryPets({ search: 'cafe', includeUnlisted: true })).docs.some((p) => p.id === paris.id), 'and no longer by its old one')
  for (const page of [1e20, NaN, -5, Infinity, '9'.repeat(30) as unknown as number]) {
    const result = await queryPets({ page })
    ok(result.page >= 1 && result.page <= 10_000, `page ${String(page)} must be clamped, got ${result.page}`)
  }
  ok((await listMedia({ page: NaN })).page === 1, 'a NaN media page becomes 1')
  await deletePet(paris.id)
  await removeUpload(m.id)
  await removeUpload(accented.id)
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

await check('uploads: AVIF and HEIC are refused, EXIF is stripped from the stored file, oversized images are refused', async () => {
  const base = { create: { width: 64, height: 48, channels: 3 as const, background: '#f60' } }
  // Their metadata, extra images and thumbnails are items woven into the file's offset tables and
  // cannot be cut out, so they are refused outright (with or without metadata).
  const avifErrors = await fieldErrors(saveUpload({ data: await sharp(base).avif().toBuffer(), alt: 'An AVIF image' }))
  ok(/AVIF and HEIC/.test(avifErrors.file), `AVIF must be refused with an explanation, got: ${avifErrors.file}`)

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

  // A JFIF header can carry a thumbnail after its fixed fields (a copy of the original, perhaps
  // uncropped). The header must be rebuilt without it, not copied.
  const plain = await sharp(noise).jpeg({ quality: 90 }).toBuffer() // sharp writes no JFIF header, so one is built here
  const jfifFields = Buffer.concat([Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 2, 1, 0, 72, 0, 72])]) // "JFIF\0", version 1.02, dots per inch, 72 x 72
  const jfifPayload = Buffer.concat([jfifFields, Buffer.from([2, 2]), Buffer.from('THUMBSECRET!')]) // then a 2 x 2 thumbnail and its 12 bytes
  const thumbJpeg = Buffer.concat([plain.subarray(0, 2), Buffer.from([0xff, 0xe0, 0, jfifPayload.length + 2]), jfifPayload, plain.subarray(2)])
  await sharp(thumbJpeg).metadata() // precondition: sharp reads a JPEG with a JFIF thumbnail
  ok(secrets(thumbJpeg, ['THUMBSECRET!']).length === 1, 'precondition: the JPEG upload really carries a JFIF thumbnail')
  const thumb = await put(thumbJpeg, 'A JPEG with a JFIF thumbnail')
  made.push(thumb.media.id)
  ok(secrets(thumb.body, ['THUMBSECRET!']).length === 0, 'the JFIF thumbnail is not copied')
  ok(thumb.body[2] === 0xff && thumb.body[3] === 0xe0 && thumb.body.readUInt16BE(4) === 16, 'the JFIF header is the 16-byte one with no thumbnail')
  ok((await pixels(thumbJpeg)).equals(await pixels(thumb.body)), 'and the pixels are identical')

  // A marker the stripper does not know is not copied and not guessed at: the file is refused.
  const oddJpeg = Buffer.concat([plain.subarray(0, 2), Buffer.from([0xff, 0xf3, 0x00, 14]), Buffer.from('jpegn-secret'), plain.subarray(2)])
  ok(secrets(oddJpeg, ['jpegn-secret']).length === 1, 'precondition: the extension segment really holds the bytes')
  let stripperRefused = false
  try {
    stripMetadata('jpg', oddJpeg)
  } catch (error) {
    stripperRefused = error instanceof StripError
  }
  ok(stripperRefused, 'the stripper itself refuses a JPEG with an unexpected marker')
  // (libjpeg, which sharp uses to read the file, also rejects such a marker, so the upload fails
  // before reaching the stripper: two independent layers.)
  ok((await fieldErrors(saveUpload({ data: oddJpeg, alt: 'A JPEG with an extension marker' }))).file, 'and an upload of it is refused')

  // A GIF loop block can carry extra sub-blocks after the loop count. It is rewritten with the count only.
  const loopWithExtra = Buffer.concat([
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from('NETSCAPE2.0', 'latin1'),
    Buffer.from([0x03, 0x01, 0x00, 0x00]),
    Buffer.from([0x10]),
    Buffer.from('gif-extra-secret'),
    Buffer.from([0x00]),
  ])
  const gifExtraFile = Buffer.concat([gif0.subarray(0, at), loopWithExtra, gif0.subarray(at)])
  ok(secrets(gifExtraFile, ['gif-extra-secret']).length === 1, 'precondition: the GIF upload really has hidden bytes in its loop block')
  const gifExtra = await put(gifExtraFile, 'A GIF with a loaded loop block')
  made.push(gifExtra.media.id)
  ok(secrets(gifExtra.body, ['gif-extra-secret']).length === 0, 'the extra bytes in the loop block are not copied')
  ok(gifExtra.body.includes(Buffer.from('NETSCAPE2.0')), 'but the loop block itself is rewritten')
  ok((await pixels(gifExtraFile)).equals(await pixels(gifExtra.body)), 'and the pixels are identical')

  // AVIF is refused even when it carries metadata.
  const avifFile = await sharp(noise).withMetadata({ exif: { IFD0: { Copyright: 'avif-secret' } } }).avif().toBuffer()
  ok((await fieldErrors(saveUpload({ data: avifFile, alt: 'AVIF with EXIF' }))).file, 'an AVIF with metadata is refused')

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
  await archivePage(page.id)
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
  await archivePage(page.id)
  await archivePage(empty.id)
  await deletePage(page.id)
  await deletePage(empty.id)
})

// --- password reset links ------------------------------------------------------------------
await check('reset links: one use, hashed at rest, expire, cancel older ones, end sessions, lift lockouts', async () => {
  const email = 'reset@example.test'
  const { id } = await createUser({ email, name: 'Reset', password: 'old-password-123456', role: 'editor' })
  const auth = await getAuth()
  const signIn = (password: string) => auth.api.signInEmail({ body: { email, password }, headers: ip(70) })
  await signIn('old-password-123456')

  const first = await createResetLink(id)
  const tokenOf = (url: string) => new URL(url).searchParams.get('token')!
  const token = tokenOf(first.url)
  ok(/^[A-Za-z0-9_-]{43}$/.test(token), 'the token is 32 random bytes in base64url')
  const stored = await db.select().from(t.verifications).where(eq(t.verifications.value, id))
  ok(stored.length === 1 && !stored[0].identifier.includes(token), 'only a hash of the token is stored')
  ok(await isResetTokenValid(token), 'a fresh link is valid')
  ok(!(await isResetTokenValid('x'.repeat(43))) && !(await isResetTokenValid(['a'])), 'made-up tokens are not')

  // A newer link cancels the older one.
  const second = await createResetLink(id)
  ok(!(await isResetTokenValid(token)), 'the older link stops working')
  const token2 = tokenOf(second.url)

  // A password that breaks the rules is a field error, and does not use up the link.
  ok((await fieldErrors(resetPasswordWithToken({ token: token2, password: 'short' }))).password, 'short password is a field error')
  ok(await isResetTokenValid(token2), 'the link survives a refused password')

  // Locked out by wrong guesses, then the reset lets them back in.
  for (let i = 0; i < 5; i++) await guardSignIn(email, ip(70)).catch(() => undefined)
  ok(/Too many attempts/.test(await userError(guardSignIn(email, ip(70)))), 'locked out before the reset')

  // Two requests with the same link at once: exactly one gets it.
  const results = await Promise.allSettled([
    resetPasswordWithToken({ token: token2, password: 'new-password-123456' }),
    resetPasswordWithToken({ token: token2, password: 'other-password-123456' }),
  ])
  ok(results.filter((r) => r.status === 'fulfilled').length === 1, `one of two parallel uses succeeds: ${results.map((r) => r.status)}`)
  ok(/expired or was already used/.test(await userError(resetPasswordWithToken({ token: token2, password: 'again-password-123456' }))), 'a used link is refused')

  const [{ n: sessions }] = await db.select({ n: sql<number>`count(*)` }).from(t.sessions).where(eq(t.sessions.userId, id))
  ok(Number(sessions) === 0, 'every session of that person ended')
  await guardSignIn(email, ip(70))
  const winner = results.findIndex((r) => r.status === 'fulfilled') === 0 ? 'new-password-123456' : 'other-password-123456'
  await signIn(winner)
  let oldWorks = true
  await signIn('old-password-123456').catch(() => (oldWorks = false))
  ok(!oldWorks, 'the old password no longer works')

  // Expired links are refused.
  const third = await createResetLink(id)
  await db.update(t.verifications).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(t.verifications.value, id))
  ok(!(await isResetTokenValid(tokenOf(third.url))), 'an expired link is not valid')
  ok(/expired/.test(await userError(resetPasswordWithToken({ token: tokenOf(third.url), password: 'late-password-123456' }))), 'and cannot be used')

  ok(/not found/.test(await userError(createResetLink('no-such-user'))), 'no link for a missing account')
  await removeAccount(id)
})

await check('reset emails: same answer for unknown addresses, sent only to real accounts, limited per email', async () => {
  const sent: EmailMessage[] = []
  const sender = { send: async (m: EmailMessage) => void sent.push(m) }
  const email = 'mailme@example.test'
  const { id } = await createUser({ email, name: 'Mail <Me>', password: 'mail-password-123456', role: 'editor' })

  await (await prepareResetEmail('MailMe@Example.test', ip(71), sender))()
  ok(sent.length === 1 && sent[0].to === email, 'one email, to the lower-cased address')
  const url = sent[0].text.match(/https?:\/\/\S+/)?.[0] ?? ''
  ok(url.startsWith(`${process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'}/admin/reset-password?token=`), `the link uses the configured site URL: ${url}`)
  ok(await isResetTokenValid(new URL(url).searchParams.get('token')), 'the emailed link works')
  ok(sent[0].html?.includes('Mail &lt;Me&gt;') && !sent[0].html.includes('<Me>'), 'names are escaped in the HTML')

  await (await prepareResetEmail('nobody-here@example.test', ip(71), sender))()
  ok(sent.length === 1, 'nothing is sent for an address without an account')
  ok((await fieldErrors(prepareResetEmail('not-an-email', ip(71), sender))).email, 'a malformed address is a field error')

  // A failing sender is logged, never thrown at the person.
  await (await prepareResetEmail(email, ip(72), { send: async () => { throw new Error('down') } }))()
  await (await prepareResetEmail(email, ip(73), sender))()
  ok(/Too many attempts/.test(await userError(prepareResetEmail(email, ip(74), sender))), 'the fourth request for one email within the hour is refused')

  await removeAccount(id)
})

// --- plugins with their own tables -------------------------------------------------------

await check('plugin storage: names must carry the plugin prefix, schemas must be twins, migrations in order and only on its own tables', async () => {
  ok(storageProblems('form-builder', formBuilderStorage).length === 0, `the form builder passes: ${storageProblems('form-builder', formBuilderStorage).join(' ')}`)
  ok(pluginTablePrefix('form-builder') === 'plugin_form_builder_', 'dashes become underscores in the prefix')

  const wrongOwner = storageProblems('other-plugin', formBuilderStorage)
  ok(wrongOwner.some((p) => /must start with "plugin_other_plugin_"/.test(p)), 'tables of another plugin are refused')
  ok(wrongOwner.some((p) => /touches/.test(p)), 'and so is SQL on them')

  const sqlOn = (sqlite: string, pg = sqlite) => storageProblems('form-builder', { ...formBuilderStorage, migrations: [{ id: '0000_x', sqlite, pg }] })
  ok(sqlOn('CREATE TABLE "plugin_form_builder_x" ("id" integer)').length === 0, 'its own table is fine')
  ok(sqlOn('ALTER TABLE `pets` ADD `x` text').some((p) => p.includes('"pets"')), 'altering a site table is refused')
  ok(sqlOn('CREATE TABLE "plugin_form_builder_x" ("m" integer REFERENCES "public"."media"("id"))').some((p) => p.includes('"media"')), 'a foreign key into a site table is refused')
  ok(sqlOn('CREATE INDEX "media_idx" ON "plugin_form_builder_x" ("id")').some((p) => p.includes('"media_idx"')), 'an index name without the prefix is refused')
  ok(sqlOn('DELETE FROM users').some((p) => p.includes('"users"')), 'deleting from a site table is refused')
  ok(sqlOn('CREATE TABLE `__new_plugin_form_builder_x` (`id` integer);\n--> statement-breakpoint\nALTER TABLE `__new_plugin_form_builder_x` RENAME TO `plugin_form_builder_x`').length === 0, "drizzle-kit's table rebuild is allowed")

  const order = storageProblems('form-builder', {
    ...formBuilderStorage,
    migrations: [{ id: '0001_b', sqlite: 'select 1', pg: 'select 1' }, { id: '0000_a', sqlite: 'select 1', pg: '' }, { id: 'bad id', sqlite: 'x', pg: 'x' }],
  })
  ok(order.some((p) => /must sort after/.test(p)) && order.some((p) => /no pg SQL/.test(p)) && order.some((p) => /must look like/.test(p)), `order, missing SQL and bad ids are reported: ${order.join(' | ')}`)

  const notTwins = storageProblems('form-builder', { ...formBuilderStorage, tables: { sqlite: formBuilderStorage.tables.sqlite, pg: {} } })
  ok(notTwins.some((p) => /not twins/.test(p)), 'a table missing from one dialect is reported')
})

await check('plugin migrations: run once in order, recorded with a checksum, a changed or out-of-order migration is refused, a failure rolls back', async () => {
  const database = await getDatabase()
  const table = 'plugin_check_notes'
  const exec = async (q: string) => (dialect === 'pg' ? (db as unknown as { execute(q: unknown): Promise<unknown> }).execute(sql.raw(q)) : db.run(sql.raw(q)))
  const create = { id: '0000_init', sqlite: `CREATE TABLE "${table}" ("id" integer PRIMARY KEY, "body" text NOT NULL)`, pg: `CREATE TABLE "${table}" ("id" serial PRIMARY KEY, "body" text NOT NULL)` }
  const addColumn = { id: '0001_pinned', sqlite: `ALTER TABLE "${table}" ADD "pinned" integer`, pg: `ALTER TABLE "${table}" ADD "pinned" integer` }
  const drop = async () => {
    await exec(`DROP TABLE IF EXISTS "${table}"`)
    await db.delete(t.pluginMigrations).where(eq(t.pluginMigrations.plugin, 'check'))
  }
  await drop()
  try {
    let [state] = await pluginMigrationStates(database, [{ plugin: 'check', migrations: [create] }])
    ok(state.pending.join() === '0000_init' && !state.applied.length, 'a new plugin has everything pending')

    // Two servers starting at once: the migration runs exactly once.
    const runs = await Promise.all([applyPluginMigrations(database, { plugin: 'check', migrations: [create] }), applyPluginMigrations(database, { plugin: 'check', migrations: [create] })])
    ok(runs.flat().length === 1, `ran once, not twice: ${JSON.stringify(runs)}`)
    await exec(`INSERT INTO "${table}" ("body") VALUES ('hello')`)

    ok((await applyPluginMigrations(database, { plugin: 'check', migrations: [create, addColumn] })).join() === '0001_pinned', 'a later migration runs on its own')
    ;[state] = await pluginMigrationStates(database, [{ plugin: 'check', migrations: [create, addColumn] }])
    ok(!state.pending.length && state.applied.length === 2, 'both recorded')

    const edited = { ...create, sqlite: `${create.sqlite} -- edited`, pg: `${create.pg} -- edited` }
    ;[state] = await pluginMigrationStates(database, [{ plugin: 'check', migrations: [edited, addColumn] }])
    ok(state.changed.join() === '0000_init', 'an edited migration is reported as changed')
    ok(/changed after it ran/.test(await applyPluginMigrations(database, { plugin: 'check', migrations: [edited, addColumn] }).then(() => '', (e: Error) => e.message)), 'and is refused')

    const sneaked = { id: '0000_b_sneaked', sqlite: 'select 1', pg: 'select 1' }
    ok(/sorts before/.test(await applyPluginMigrations(database, { plugin: 'check', migrations: [create, sneaked, addColumn] }).then(() => '', (e: Error) => e.message)), 'a migration slipped in before one that ran is refused')

    // Second statement fails: the first one is rolled back and nothing is recorded.
    const broken = { id: '0002_broken', sqlite: `ALTER TABLE "${table}" ADD "x" integer;\n--> statement-breakpoint\nALTER TABLE "no_such_table" ADD "y" integer`, pg: `ALTER TABLE "${table}" ADD "x" integer;\n--> statement-breakpoint\nALTER TABLE "no_such_table" ADD "y" integer` }
    let failed = false
    await applyPluginMigrations(database, { plugin: 'check', migrations: [create, addColumn, broken] }).catch(() => (failed = true))
    ;[state] = await pluginMigrationStates(database, [{ plugin: 'check', migrations: [create, addColumn, broken] }])
    ok(failed && state.pending.join() === '0002_broken', 'the failed migration is still pending')
    ok(/no such column|does not exist/.test(await exec(`SELECT "x" FROM "${table}"`).then(() => '', (e: Error) => `${e.message} ${String(e.cause ?? '')}`)), 'and its first statement did not stick')
  } finally {
    await drop()
  }
})

await check('plugin storage: the form builder is set up by migrate, cascades responses, and is flagged (not queried) while its tables are missing', async () => {
  forgetPluginStorageStatus()
  const [status] = (await getPluginStorageStatus()).filter((s) => s.plugin === 'form-builder')
  ok(status?.ready, `the form builder is ready after migrate: ${status?.problem}`)

  const forms = await openFormsDatabase()
  const [form] = await forms.db.insert(forms.t.forms).values({ name: 'Check form', fields: [] }).returning()
  await forms.db.insert(forms.t.responses).values({ formId: form.id, answers: [{ id: 'a', label: 'A', type: 'text', value: 'x' }] })
  ok(form.isOpen === true && Array.isArray(form.fields), 'defaults and JSON columns round-trip')
  await forms.db.delete(forms.t.forms).where(eq(forms.t.forms.id, form.id))
  const left = await forms.db.select().from(forms.t.responses).where(eq(forms.t.responses.formId, form.id))
  ok(left.length === 0, 'deleting a form deletes its responses')

  // As if the plugin had just been added to a site where `pnpm migrate` has not run since.
  const saved = await db.select().from(t.pluginMigrations).where(eq(t.pluginMigrations.plugin, 'form-builder'))
  await db.delete(t.pluginMigrations).where(eq(t.pluginMigrations.plugin, 'form-builder'))
  try {
    forgetPluginStorageStatus()
    const [flagged] = (await getPluginStorageStatus()).filter((s) => s.plugin === 'form-builder')
    ok(!flagged.ready && /pnpm migrate/.test(flagged.problem ?? '') && flagged.pending.join() === '0000_init', `flagged with what to do: ${flagged.problem}`)
    ok(/not set up yet/.test(await userError(openFormsDatabase())), 'opening its tables is refused with a message an owner can act on')
  } finally {
    await db.insert(t.pluginMigrations).values(saved)
    forgetPluginStorageStatus()
  }
  ok((await getPluginStorageStatus()).every((s) => s.ready), 'ready again once recorded')
})

await check('form builder: forms are validated and unique; answers are checked per field and stored as a snapshot; honeypot, closed forms, limits, CSV and cascade', async () => {
  // Forms: one message per problem, keyed so the editor can put it next to its input.
  const bad = await fieldErrors(forms.createForm({ name: ' ', fields: [{ type: 'choice', label: 'Pick' }, { type: 'nope', label: 'x' }], settings: { notifyEmail: 'not-an-email' } }))
  ok(bad.name && bad['fields.0.options'] && bad['fields.1.type'] && bad['settings.notifyEmail'], `form errors: ${JSON.stringify(bad)}`)

  const fields = [
    { id: 'name', type: 'text', label: 'Your name', required: true },
    { id: 'email', type: 'email', label: 'Email', required: true },
    { id: 'phone', type: 'phone', label: 'Phone' },
    { id: 'home', type: 'choice', label: 'Home', options: ['House', 'Flat'], display: 'dropdown', required: true },
    { id: 'pets', type: 'checkboxes', label: 'Other pets', options: ['Dog', 'Cat', 'Bird'] },
    { id: 'kids', type: 'number', label: 'Children' },
    { id: 'from', type: 'date', label: 'Available from' },
    { id: 'notes', type: 'textarea', label: 'Anything else', hint: 'Optional' },
    { id: 'agree', type: 'checkbox', label: 'I agree to a home visit', required: true },
    { type: 'text', label: '  Spaces   collapse  ', unknownProp: '<script>' },
  ]
  const { id } = await forms.createForm({ name: 'Adoption application', description: 'Tell us about you.\n\n\n\nThanks!', fields, settings: { submitLabel: 'Apply', notifyEmail: 'Team@Example.test' } })
  ok(/another form/i.test((await fieldErrors(forms.createForm({ name: 'ADOPTION application' }))).name ?? ''), 'names are unique whatever their case')
  const form = (await forms.getForm(id))!
  ok(form.fields.length === 10 && form.fields[9].label === 'Spaces collapse' && /^f/.test(form.fields[9].id) && !('unknownProp' in form.fields[9]), 'fields are rebuilt: cleaned label, generated id, unknown props dropped')
  ok(form.description === 'Tell us about you.\n\nThanks!' && form.settings.notifyEmail === 'team@example.test', 'description and settings are cleaned')
  ok((await forms.getPublicForm(id))!.submitLabel === 'Apply' && !('settings' in (await forms.getPublicForm(id))!), 'the public view has the button text and no private settings')

  // Answers: checked per type, errors keyed by field id.
  const client = { client: '10.77.0.1' }
  const wrong = await fieldErrors(forms.submitResponse(id, { email: 'nope', phone: '123', home: 'Castle', pets: ['Dog', 'Lion'], kids: '2e3', from: '2026-02-31', agree: false }, client))
  for (const key of ['name', 'email', 'phone', 'home', 'pets', 'kids', 'from', 'agree']) ok(wrong[key], `"${key}" is reported: ${JSON.stringify(wrong)}`)

  const good = { name: '  Ana  ', email: 'Ana@Example.TEST', phone: '+60 12-345 6789', home: 'Flat', pets: ['Bird', 'Dog'], kids: '2', from: '2026-12-01', notes: 'Line one\r\nLine two', agree: 'on', evil: 'ignored' }
  const sent = await forms.submitResponse(id, good, client)
  ok(sent.message.length > 0 && sent.stored, 'a valid response is stored')
  const [stored] = (await forms.listResponses(id)).items
  const value = (k: string) => stored.answers.find((a) => a.id === k)?.value
  ok(value('name') === 'Ana' && value('email') === 'ana@example.test' && value('phone') === '+60123456789', `text cleaned, email lower-cased, phone stored as E.164: ${JSON.stringify(stored.answers)}`)
  ok(JSON.stringify(value('pets')) === '["Dog","Bird"]' && value('agree') === true && value('notes') === 'Line one\nLine two', 'choices in form order, ticked box true, line breaks normalised')
  ok(stored.answers.length === 10 && !stored.answers.some((a) => a.id === 'evil') && stored.answers[0].label === 'Your name', 'one answer per field, with its label; unknown keys ignored')

  // Honeypot: same answer, nothing stored.
  const bot = await forms.submitResponse(id, good, { client: '10.77.0.2', honeypot: 'http://spam.test' })
  ok(bot.message === sent.message && bot.stored === null && (await forms.listResponses(id)).total === 1, 'a filled honeypot looks like success and stores nothing')

  // Renaming a field keeps old answers under their old label; removing one keeps its CSV column.
  await forms.updateForm(id, { fields: fields.slice(0, 8).map((f) => (f.id === 'name' ? { ...f, label: 'Full name' } : f)) })
  await forms.submitResponse(id, { ...good, name: '=HYPERLINK("http://evil.test")', notes: 'Says "hi", twice' }, { client: '10.77.0.3' })
  const { csv, filename } = await forms.exportResponsesCsv(id)
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n')
  ok(/^adoption-application-responses-\d{4}-\d{2}-\d{2}\.csv$/.test(filename), `file name: ${filename}`)
  ok(lines[0] === 'Submitted,Full name,Email,Phone,Home,Other pets,Children,Available from,Anything else,I agree to a home visit,Spaces collapse', `header keeps removed fields at the end: ${lines[0]}`)
  ok(lines[2].includes(`"'=HYPERLINK(""http://evil.test"")"`) && lines[2].includes('"Says ""hi"", twice"'), `formulas are defused and quotes escaped: ${lines[2]}`)

  // Read state, paging, deleting only this form's responses.
  let summary = (await forms.listForms()).find((f) => f.id === id)!
  ok(summary.responses === 2 && summary.unread === 2 && summary.lastResponseAt instanceof Date && summary.fieldCount === 8, `summary: ${JSON.stringify(summary)}`)
  const page = await forms.listResponses(id, { page: 99, limit: 1 })
  ok(page.page === 2 && page.totalPages === 2 && page.items.length === 1, 'a page past the end is clamped to the last one')
  ok((await forms.markResponsesRead(id, [page.items[0].id])) === 1 && (await forms.markResponsesRead(id)) === 1, 'marking read counts only unread rows')
  const other = await forms.createForm({ name: 'Volunteer sign-up', fields: [{ id: 'n', type: 'text', label: 'Name' }] })
  await forms.submitResponse(other.id, { n: 'Bo' }, { client: '10.77.0.4' })
  const otherResponse = (await forms.listResponses(other.id)).items[0].id
  ok((await forms.deleteResponses(id, [otherResponse, page.items[0].id])) === 1, "another form's response is not deleted through this form")
  summary = (await forms.listForms()).find((f) => f.id === id)!
  ok(summary.responses === 1 && summary.unread === 0, 'counts follow')

  // Notification: sent to the form's address through the site's email sender.
  const mails: PluginEmail[] = []
  const realHost = host()
  provideHost({ ...realHost, sendTemplatedEmail: async (message) => (mails.push(message), true) })
  try {
    await forms.notifyNewResponse((await forms.getForm(id))!, stored.answers)
  } finally {
    provideHost(realHost)
  }
  ok(
    mails.length === 1 && mails[0].purpose === 'team-notification' && mails[0].to === 'team@example.test' && mails[0].details?.some((detail) => detail.label === 'Your name' && detail.value === 'Ana'),
    `notification: ${JSON.stringify(mails[0])}`,
  )

  // Closed forms, then the per-visitor limit (10 per 10 minutes, across forms).
  await forms.updateForm(id, { isOpen: false })
  ok(/not accepting/.test(await userError(forms.submitResponse(id, good, { client: '10.77.0.5' }))), 'a closed form refuses responses')
  for (let i = 0; i < 10; i++) await forms.submitResponse(other.id, { n: `v${i}` }, { client: '10.77.0.9' })
  ok(/Too many attempts/.test(await userError(forms.submitResponse(other.id, { n: 'one more' }, { client: '10.77.0.9' }))), 'the 11th response from one address is refused')
  ok((await forms.submitResponse(other.id, { n: 'someone else' }, { client: '10.77.0.10' })).stored, 'another address is not affected')

  // Deleting a form deletes its responses.
  await forms.deleteForm(other.id)
  const { db: fdb, t: ft } = await openFormsDatabase()
  ok((await fdb.select().from(ft.responses).where(eq(ft.responses.formId, other.id))).length === 0, 'responses go with their form')
  ok(/no longer exists/.test(await userError(forms.deleteForm(other.id))), 'deleting twice says it is gone')
  await forms.deleteForm(id)
  await db.delete(t.rateLimits).where(sql`${t.rateLimits.key} like 'plugin:form-builder:%'`)
})

await check('form builder: a "Which pet?" question offers listed pets that are not adopted, checks the pick when sent, and stores the name with a reference', async () => {
  ok((await fieldErrors(forms.createForm({ name: 'Bad list', fields: [{ type: 'source', label: 'Pick', source: 'cars' }] })))['fields.0.source'], 'an unknown list is refused')

  // Its own photo: earlier checks delete the shared one. Say which field broke if a pet cannot be made.
  const photo = await saveUpload({ data: png, alt: 'Pet question' })
  const pet = (input: Record<string, unknown>) =>
    savePet(null, { species: 'dog', photoIds: [photo.id], ...input }).catch((e) => {
      throw new Error(`savePet ${input.name}: ${JSON.stringify((e as ValidationError).fieldErrors ?? e.message)}`)
    })
  const listed = await pet({ name: 'Zuri Pickme' })
  const pending = await pet({ name: 'Ayla Pending', species: 'cat', status: 'pending' })
  const adopted = await pet({ name: 'Bo Adopted', status: 'adopted' })
  const hidden = await pet({ name: 'Cy Hidden', unlisted: true })
  const { id } = await forms.createForm({ name: 'Pet question', fields: [{ id: 'pet', type: 'source', source: 'pets', label: 'Which pet?', required: true }] })
  try {
    const choices = (await forms.getPublicForm(id))!.fields[0].choices ?? []
    const labels = choices.map((c) => c.label)
    ok(labels.includes('Zuri Pickme') && labels.includes('Ayla Pending (adoption pending)'), `listed pets are offered, pending ones marked: ${labels.join(', ')}`)
    ok(!labels.some((l) => /Bo Adopted|Cy Hidden/.test(l)), 'adopted and unlisted pets are not offered')
    ok(choices.find((c) => c.label === 'Zuri Pickme')?.value === String(listed.id), "a choice's value is the pet's id")

    const client = { client: '10.78.0.1' }
    ok(/no longer available/.test((await fieldErrors(forms.submitResponse(id, { pet: String(adopted.id) }, client))).pet ?? ''), 'an adopted pet cannot be picked')
    ok(/no longer available/.test((await fieldErrors(forms.submitResponse(id, { pet: String(hidden.id) }, client))).pet ?? ''), 'an unlisted pet cannot be picked')
    ok(/required/.test((await fieldErrors(forms.submitResponse(id, { pet: '' }, client))).pet ?? ''), 'a required pick cannot be blank')

    await forms.submitResponse(id, { pet: String(listed.id) }, client)
    const [answer] = (await forms.listResponses(id)).items[0].answers
    ok(answer.value === 'Zuri Pickme' && answer.ref === `pets:${listed.id}` && answer.type === 'source', `stored as the name with a reference: ${JSON.stringify(answer)}`)
    ok((await forms.exportResponsesCsv(id)).csv.includes('Zuri Pickme'), 'the CSV shows the name')
  } finally {
    await forms.deleteForm(id)
    for (const made of [listed, pending, adopted, hidden]) await deletePet(made.id)
    await removeUpload(photo.id)
    await db.delete(t.rateLimits).where(sql`${t.rateLimits.key} like 'plugin:form-builder:%'`)
  }
})

// Roles: the agreed table, every server action checking a permission, and the users rules.
await check('roles: the permission table is as agreed, every action checks a permission, developer and audit accounts work', async () => {
  // The table agreed with the owner. Any change to what a role may do must change this too.
  const table: Record<Role, string> = {
    // pets pages media theme settings plugins users pluginContent personalData (v = view, e = edit, - = none),
    // then: export personal data, then the activity log (o = own entries, a = everyone's, x = everyone's and download)
    admin: 'e e e e e e e e e x x',
    editor: 'e e e - - - - e e x o',
    developer: 'e e e e e e - e - - o',
    audit: 'v v v v v v v v v - x',
  }
  const areas = ['pets', 'pages', 'media', 'theme', 'settings', 'plugins', 'users', 'pluginContent', 'personalData'] as const
  for (const role of ROLES) {
    const cells = table[role].split(' ')
    areas.forEach((area, i) => {
      const expected = cells[i]
      const view = can(role, `${area}:view`)
      const edit = can(role, `${area}:edit`)
      const got = edit ? 'e' : view ? 'v' : '-'
      ok(got === expected, `${role} on ${area}: expected ${expected}, got ${got}`)
      ok(!edit || view, `${role} can edit ${area} without viewing it`)
    })
    ok(can(role, 'personalData:export') === (cells[9] === 'x'), `${role} and downloading personal data`)
    const activity = can(role, 'activity:export') ? 'x' : can(role, 'activity:view') ? 'a' : can(role, 'activity:own') ? 'o' : '-'
    ok(activity === cells[10], `${role} and the activity log: expected ${cells[10]}, got ${activity}`)
    ok(!can(role, 'activity:export') || can(role, 'activity:view'), `${role} can download the activity log without reading it`)
  }
  ok(!can(asRole('superuser'), 'pets:view') || asRole('superuser') === 'audit', 'an unknown stored role changes nothing')
  ok(asRole('superuser') === 'audit' && asRole(null) === 'audit', 'unknown roles are read as audit')
  // Plugin levels map onto the table.
  ok(accessPermission('personalData', 'view') === 'personalData:view' && !can('developer', accessPermission('personalData', 'view')), 'developers cannot open personal-data screens')
  ok(can('developer', accessPermission('admin', 'edit')) && !can('editor', accessPermission('admin', 'view')), 'admin-level plugin screens are for admins and developers')
  ok(accessOf({ adminOnly: true }) === 'admin' && accessOf({}) === 'all', 'the older adminOnly flag still means admin level')

  // Every exported server action checks a permission. The listed ones are public or are about the
  // person's own account; save/publish in the page builder check it inside persist().
  const allowed = new Set([
    'signInAction', 'signOutAction', 'getCurrentUserAction', 'updateProfileAction', 'changePasswordAction',
    'verifyTwoFactorAction', 'getTwoFactorStatusAction', 'startTwoFactorSetupAction', 'confirmTwoFactorSetupAction',
    'disableTwoFactorAction', 'regenerateBackupCodesAction',
    'startProviderSignInAction', 'getMyProvidersAction', 'connectProviderAction', 'disconnectProviderAction',
    'uploadAvatarAction', 'removeAvatarAction',
    'getEmailChangeStatusAction', 'requestEmailChangeAction', 'cancelEmailChangeAction', 'confirmEmailChangeAction',
    'requestAccountDeletionAction', 'requestEmailVerificationAction',
    'createFirstAdminAction', 'finishSetupAction',
    'requestPasswordResetAction', 'resetPasswordWithTokenAction', 'acceptInviteAction', 'submitFormAction',
    'fetchPetSpotlightAction', 'fetchCatalogAction', 'fetchPetProfilesAction', 'fetchPetsAction', 'fetchFormAction', 'fetchSimilarPetsAction',
  ])
  const { readFileSync, readdirSync } = await import('node:fs')
  const files = [
    ...readdirSync('src/server/actions').map((f) => `src/server/actions/${f}`),
    'src/puck/actions.ts',
    'src/app/(editor)/edit/[id]/actions.ts',
    '../../plugins/form-builder/src/actions.ts',
  ]
  const unchecked: string[] = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const part of source.split(/^export async function /m).slice(1)) {
      const name = part.match(/^(\w+)/)?.[1] ?? '?'
      const body = part.split(/^export /m)[0]
      if (allowed.has(name)) continue
      if (!/requirePermission\(|\bpersist\(/.test(body)) unchecked.push(`${file}: ${name}`)
    }
  }
  ok(unchecked.length === 0, `actions without a permission check: ${unchecked.join(', ')}`)

  // Every action that changes something (or downloads) writes to the activity log. Listed: not
  // changes (a test email), or agreed not to be logged (marking responses as read).
  const unlogged = new Set(['sendTestEmailAction', 'sendEmailTemplateTestAction', 'markResponsesReadAction'])
  const silent: string[] = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const part of source.split(/^export async function /m).slice(1)) {
      const name = part.match(/^(\w+)/)?.[1] ?? '?'
      const body = part.split(/^export /m)[0]
      if (unlogged.has(name) || !/requirePermission\([^)]*(:edit|:export)/.test(body)) continue
      if (!/record\w*\(/.test(body)) silent.push(`${file}: ${name}`)
    }
  }
  ok(silent.length === 0, `changes that are not logged: ${silent.join(', ')}`)

  // The new roles as accounts: created, changed, and the last-admin rule still holds.
  const dev = await createUser({ email: 'dev@example.test', name: 'Dev Eloper', password: 'developer-password-1', role: 'developer' })
  const aud = await createUser({ email: 'audit@example.test', name: 'Audrey Tor', password: 'audit-password-123', role: 'audit' })
  const roles = Object.fromEntries((await listUsers()).map((u) => [u.email, u.role]))
  ok(roles['dev@example.test'] === 'developer' && roles['audit@example.test'] === 'audit', `stored roles: ${JSON.stringify(roles)}`)
  const bad = await fieldErrors(createUser({ email: 'x@example.test', name: 'X', password: 'some-password-123', role: 'superuser' }))
  ok(bad.role, 'an unknown role is a field error')
  await updateUser(aud.id, { name: 'Audrey Tor', role: 'developer' }, { canChangeRole: true })
  ok((await listUsers()).find((u) => u.id === aud.id)?.role === 'developer', 'a role can be changed to developer')
  const admins = (await listUsers()).filter((u) => u.role === 'admin')
  if (admins.length === 1) {
    const message = await userError(updateUser(admins[0].id, { name: admins[0].name, role: 'audit' }, { canChangeRole: true }))
    ok(/last admin/.test(message), `the last admin cannot become audit: ${message}`)
  }
  await removeAccount(dev.id)
  await removeAccount(aud.id)
})

await check('activity log: entries name fields not values, own vs everyone, failed sign-ins keep no email, plugins prefixed, CSV safe, old entries purged', async () => {
  const { db, t } = await getDatabase()
  await db.delete(t.activityLog)
  const ana = await createUser({ email: 'ana@example.test', name: 'Ana', password: 'ana-password-123456', role: 'editor' })
  const ben = await createUser({ email: 'ben@example.test', name: 'Ben', password: 'ben-password-123456', role: 'audit' })
  const anaActor = { id: ana.id, name: 'Ana', role: 'editor' as const }

  // Changed fields: names only, deep comparison, timestamps ignored.
  const fields = changedFields(
    { name: 'Bella', status: 'available', temperament: ['calm'], updatedAt: new Date(1), notes: 'x' },
    { name: 'Bella', status: 'adopted', temperament: ['calm', 'shy'], updatedAt: new Date(2), notes: 'x' },
  )
  ok(isEqual(fields, ['status', 'temperament']), `changed fields: ${fields}`)

  await recordActivity({ actor: anaActor, action: 'pet.update', area: 'pets', summary: 'Updated the pet “Bella”', subject: { id: 7, label: 'Bella' }, fields, client: '192.0.2.7' })
  await recordActivity({ actor: { id: ben.id, name: 'Ben', role: 'audit' }, action: 'auth.sign-in', area: 'sign-in', summary: 'Signed in', client: null })
  // The page builder's autosave logs a draft at most every 15 minutes: "recently" is per person, action and subject.
  ok(await recordedRecently(ana.id, 'pet.update', 7, 60_000), 'a fresh entry counts as recent')
  ok(!(await recordedRecently(ana.id, 'pet.update', 8, 60_000)), 'another subject does not')
  ok(!(await recordedRecently(ana.id, 'page.draft', 7, 60_000)), 'another action does not')
  ok(!(await recordedRecently(ben.id, 'pet.update', 7, 60_000)), 'another person does not')
  await db.update(t.activityLog).set({ at: new Date(Date.now() - 120_000) }).where(eq(t.activityLog.subjectId, '7'))
  ok(!(await recordedRecently(ana.id, 'pet.update', 7, 60_000)), 'an older entry does not')
  await db.update(t.activityLog).set({ at: new Date() }).where(eq(t.activityLog.subjectId, '7'))

  // A failed sign-in finds the account but stores neither the typed email nor anything typed.
  await recordFailedSignIn('ANA@example.test', '192.0.2.8')
  await recordFailedSignIn('password-typed-in-the-email-box', '192.0.2.9')
  const rows = await db.select().from(t.activityLog)
  ok(rows.length === 4, `four entries, got ${rows.length}`)
  ok(!JSON.stringify(rows).includes('password-typed') && !JSON.stringify(rows).toLowerCase().includes('ana@example.test'), 'no typed email is stored')
  const failed = rows.filter((row) => row.action === 'auth.sign-in-failed')
  ok(failed.some((row) => row.subjectId === ana.id && row.actorId === null) && failed.some((row) => row.subjectId === null), 'failed sign-ins: one on Ana, one unknown')

  // Own scope: what they did plus failed sign-ins on their account. Everyone: all of it.
  const own = await listActivity({ id: ana.id, all: false })
  ok(own.total === 2 && own.entries.every((row) => row.actorId === ana.id || row.subjectId === ana.id), `Ana sees her own: ${own.total}`)
  const everyone = await listActivity({ id: ben.id, all: true })
  ok(everyone.total === 4, `audit sees everything: ${everyone.total}`)
  ok((await listActivity({ id: ben.id, all: false }, { actor: ana.id })).total === 1, 'the person filter cannot widen the own scope')
  ok((await listActivity({ id: ben.id, all: true }, { actor: ana.id })).total === 1, 'filter by person')
  ok((await listActivity({ id: ben.id, all: true }, { area: 'sign-in' })).total === 3, 'filter by area')
  ok(/Unknown area/.test(await userError(listActivity({ id: ben.id, all: true }, { area: 'nope' }))), 'an unknown area is refused')
  ok(/not valid/.test(await userError(listActivity({ id: ben.id, all: true }, { from: 'yesterday-ish' }))), 'a bad date is refused')
  const future = new Date(Date.now() + 60_000).toISOString()
  ok((await listActivity({ id: ben.id, all: true }, { from: future })).total === 0 && (await listActivity({ id: ben.id, all: true }, { to: future })).total === 4, 'date range')
  ok(isEqual((await listActivityActors()).map((a) => a.name), ['Ana', 'Ben']), 'people with entries')

  // CSV: a summary that looks like a formula is defused; commas and quotes are escaped.
  await recordActivity({ actor: anaActor, action: 'pet.update', area: 'pets', summary: '=HYPERLINK("http://evil")', subject: { id: 8, label: 'Rex, "the dog"' } })
  const csv = await exportActivityCsv({ id: ben.id, all: true })
  ok(csv.rows === 5 && !csv.truncated && csv.csv.startsWith('\uFEFFWhen (UTC),Who'), 'CSV header and rows')
  ok(csv.csv.includes(`"'=HYPERLINK(""http://evil"")"`) && csv.csv.includes(`"Rex, ""the dog"""`), 'CSV cells are escaped and formulas defused')

  // Plugins: recorded under `plugins` only with their own name in front, and only for a signed-in person.
  const before = (await db.select().from(t.activityLog)).length
  await host().recordActivity({ action: 'pet.delete', summary: 'pretending to be the site' })
  await host().recordActivity({ action: 'form-builder.form.update', summary: 'Updated the form' })
  ok((await db.select().from(t.activityLog)).length === before, 'a non-plugin action is refused, and nothing is logged with nobody signed in')

  // Retention: older than ACTIVITY_LOG_DAYS (default 365) is purged.
  ok(activityRetentionDays() === 365, 'kept for a year by default')
  const day = 24 * 60 * 60 * 1000
  await db.insert(t.activityLog).values({ action: 'pet.update', area: 'pets', summary: 'old', at: new Date(Date.now() - 366 * day) })
  await db.insert(t.activityLog).values({ action: 'pet.update', area: 'pets', summary: 'recent', at: new Date(Date.now() - 364 * day) })
  ok((await purgeOldActivity()) === 1, 'one old entry purged')
  const saved = process.env.ACTIVITY_LOG_DAYS
  process.env.ACTIVITY_LOG_DAYS = '90'
  ok(activityRetentionDays() === 90 && (await purgeOldActivity()) === 1, 'ACTIVITY_LOG_DAYS shortens it')
  process.env.ACTIVITY_LOG_DAYS = 'nonsense'
  ok(activityRetentionDays() === 365, 'a bad value falls back to a year')
  if (saved === undefined) delete process.env.ACTIVITY_LOG_DAYS
  else process.env.ACTIVITY_LOG_DAYS = saved

  // Entries outlive their account (no foreign key) and keep the name.
  await removeAccount(ana.id)
  ok((await listActivity({ id: ben.id, all: true }, { actor: ana.id })).entries.every((row) => row.actorName === 'Ana'), 'entries outlive the account')
  await removeAccount(ben.id)
  await db.delete(t.activityLog)
})

await check('email: SMTP settings are validated, the password is stored only encrypted, environment variables override fields, and mail goes out (Mailpit)', async () => {
  const { db, t } = await getDatabase()
  await db.delete(t.emailSettings)
  const saved = { ...process.env }
  const restoreEnv = () => {
    for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURITY', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM', 'EMAIL_REPLY_TO', 'BETTER_AUTH_SECRET']) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURITY', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM', 'EMAIL_REPLY_TO']) delete process.env[key]
  try {
    // The secret box: a round trip, and nothing opens with the wrong purpose, a changed byte or another secret.
    const sealed = seal('s3cret pass', 'smtp-password')
    ok(open(sealed, 'smtp-password') === 's3cret pass' && !sealed.includes('s3cret'), 'sealed and opened')
    ok(seal('same', 'x') !== seal('same', 'x'), 'a fresh IV each time')
    ok(open(sealed, 'other-purpose') === null, 'another purpose cannot open it')
    const parts = sealed.split('.')
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BA' : 'AA')
    ok(open(parts.join('.'), 'smtp-password') === null && open('garbage', 'smtp-password') === null, 'a changed value is refused')

    ok(isEqual(parseFrom('Pet Adopt <no-reply@example.test>'), { name: 'Pet Adopt', address: 'no-reply@example.test' }) && parseFrom('a@b.test')?.name === null && parseFrom('Nope <not-an-email>') === null, 'EMAIL_FROM is parsed')

    // Nothing set: no sender, and the view says what is missing.
    ok((await getEmailSender()) === null, 'no email until it is set up')
    const empty = await getEmailSettingsView()
    ok(!empty.ready && empty.problems.length >= 2 && empty.port === 587 && empty.security === 'starttls', `defaults: ${JSON.stringify(empty.problems)}`)

    // Validation, per field.
    const bad = await fieldErrors(saveEmailSettings({ host: 'https://smtp.example.test', port: '70000', security: 'ssl', fromAddress: 'nope', replyTo: 'also nope' }))
    ok(bad.host && bad.port && bad.security && bad.fromAddress && bad.replyTo, `field errors: ${Object.keys(bad)}`)
    ok((await fieldErrors(saveEmailSettings({ host: 'smtp.example.test' }))).fromAddress, 'a server needs a sender address')
    ok((await fieldErrors(saveEmailSettings({ port: '25.5' }))).port, 'a port is a whole number')

    // Saved with a password: encrypted at rest, never in the view.
    const first = await saveEmailSettings({ host: 'localhost', port: 1025, security: 'none', username: 'mailer', password: 'pa55-word!', fromName: 'Pet Adopt', fromAddress: 'no-reply@pet-adopt.test', replyTo: 'team@pet-adopt.test' })
    ok(['server', 'port', 'encryption', 'user name', 'password', 'sender address'].every((field) => first.changed.includes(field)), `changed fields: ${first.changed}`)
    const [row] = await db.select().from(t.emailSettings)
    ok(row.passwordEncrypted?.startsWith('v1.') && !JSON.stringify(row).includes('pa55-word!'), 'the password is stored encrypted only')
    const view = await getEmailSettingsView()
    ok(view.ready && view.passwordSet && !JSON.stringify(view).includes('pa55') && !('password' in view), 'ready, and the view never carries the password')
    ok((await resolveSmtp()).config.password === 'pa55-word!', 'the server can read it back')

    // Saving without a password keeps it; clearing removes it, and then a user without a password is not ready.
    const second = await saveEmailSettings({ host: 'localhost', fromName: 'Pet Adopt Team' })
    ok(isEqual(second.changed, ['sender name']) && (await resolveSmtp()).config.password === 'pa55-word!', `a blank password keeps the saved one: ${second.changed}`)
    await saveEmailSettings({ clearPassword: true })
    const cleared = await getEmailSettingsView()
    ok(!cleared.passwordSet && !cleared.ready && cleared.problems.some((p) => /password/.test(p)), 'cleared: the user now needs a password')

    // A changed BETTER_AUTH_SECRET makes the stored password unreadable, and the screen says so.
    await saveEmailSettings({ password: 'pa55-word!' })
    process.env.BETTER_AUTH_SECRET = 'a-completely-different-secret-for-this-check-0123456789'
    const unreadable = await getEmailSettingsView()
    ok(unreadable.passwordUnreadable && !unreadable.passwordSet && !unreadable.ready, 'a changed secret: enter the password again')
    restoreEnv()
    for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURITY', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM', 'EMAIL_REPLY_TO']) delete process.env[key]

    // Environment variables win field by field, lock those fields, and are reported when wrong.
    process.env.SMTP_HOST = 'smtp.env.test'
    process.env.EMAIL_FROM = 'Env Sender <env@pet-adopt.test>'
    process.env.SMTP_PORT = 'eighty'
    const locked = await getEmailSettingsView()
    ok(locked.host === 'smtp.env.test' && locked.fromAddress === 'env@pet-adopt.test' && locked.fromName === 'Env Sender', 'environment values are used')
    ok(locked.locked.host === 'SMTP_HOST' && locked.locked.fromAddress === 'EMAIL_FROM' && locked.locked.port === 'SMTP_PORT' && !locked.locked.username, `locked fields: ${JSON.stringify(locked.locked)}`)
    ok(locked.problems.some((p) => /SMTP_PORT/.test(p)) && !locked.ready, 'a bad variable is reported')
    await saveEmailSettings({ host: 'ignored.example.test', username: 'changed' })
    const [afterEnv] = await db.select().from(t.emailSettings)
    ok(afterEnv.host === 'localhost' && afterEnv.username === 'changed', 'a locked field is not saved; the others are')
    restoreEnv()
    for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURITY', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM', 'EMAIL_REPLY_TO']) delete process.env[key]

    // A real send through the compose Mailpit (any login is accepted there).
    const mailpit = process.env.MAILPIT_URL || 'http://127.0.0.1:8025'
    const reachable = await fetch(`${mailpit}/api/v1/info`).then((r) => r.ok, () => false)
    ok(reachable, `Mailpit is not running at ${mailpit}: docker compose up -d mailpit`)
    await saveEmailSettings({ host: '127.0.0.1', port: 1025, security: 'none', username: 'mailer', password: 'pa55-word!', fromName: 'Pet Adopt', fromAddress: 'no-reply@pet-adopt.test', replyTo: 'team@pet-adopt.test' })
    const sender = await getEmailSender()
    ok(sender !== null && sender.status?.().provider === 'SMTP', 'the built-in SMTP sender is used when no plugin sends email')
    // A mail server on this machine (Mailpit) lifts the test-email limit; a real one keeps it.
    ok(['localhost', 'LOCALHOST', 'mail.localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]'].every(isLoopbackHost) && !['smtp.example.com', '10.0.0.1', '1127.0.0.1', 'localhost.example.com', ''].some(isLoopbackHost), 'loopback hosts')
    ok(await sendsToLocalServer(), 'sending to 127.0.0.1 counts as a local server')
    const subject = `Check ${Date.now()}`
    await sender!.send({ to: 'someone@pet-adopt.test', subject, text: 'Plain text body', html: '<p>HTML body</p>' })
    let found: { From: { Name: string; Address: string }; To: Array<{ Address: string }>; ReplyTo: Array<{ Address: string }>; Subject: string } | undefined
    for (let i = 0; i < 20 && !found; i++) {
      const list = (await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`subject:"${subject}"`)}`)).json()) as { messages: (typeof found)[] }
      found = list.messages[0]
      if (!found) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    ok(found?.Subject === subject && found.From.Address === 'no-reply@pet-adopt.test' && found.From.Name === 'Pet Adopt', `delivered with the sender: ${JSON.stringify(found?.From)}`)
    ok(found?.To[0]?.Address === 'someone@pet-adopt.test' && found?.ReplyTo[0]?.Address === 'team@pet-adopt.test', 'to and reply-to')

    // A wrong server fails with a reason, quickly.
    await saveEmailSettings({ port: 1 })
    const failure = await (await getEmailSender())!.send({ to: 'someone@pet-adopt.test', subject: 'x', text: 'x' }).then(() => '', (error: Error) => error.message)
    ok(/ECONNREFUSED|connect/i.test(failure), `an unreachable server is an error: ${failure}`)
    // Only this check's own message: the inbox is the developer's too.
    await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`subject:"${subject}"`)}`, { method: 'DELETE' })
  } finally {
    restoreEnv()
    await db.delete(t.emailSettings)
  }
})

await check('email templates: only allowed blocks and placeholders, no answers to visitors, a required reset link, escaping, system emails edited in place, a library used where picked, plugin defaults that always exist, and real sends (Mailpit)', async () => {
  const { db, t } = await getDatabase()
  await db.delete(t.emailTemplates)
  const ctx = await emailContext({ name: '<b>Ana</b> & co', resetLink: 'https://example.test/r?token=a&b=1', minutes: '60', title: 'Adopt "Rex"' })

  // Every built-in template passes its own rules.
  for (const purpose of EMAIL_PURPOSES) ok(validateTemplate(DEFAULT_TEMPLATES[purpose], purpose).ok, `the built-in ${purpose} template is valid`)

  // The layout is rebuilt from allowed parts: unknown props and control characters go.
  const rebuilt = validateTemplate(
    { root: { props: { subject: 'Hi {{siteName}}\u0007', footer: '', extra: 'x' } }, content: [{ type: 'Text', props: { id: 'a', text: 'Hello\u0000 {{name}}', align: 'middle', onclick: 'alert(1)' } }] },
    'password-reset',
  )
  ok(!rebuilt.ok && rebuilt.errors.some((e) => /resetLink/.test(e)), 'a reset email must contain {{resetLink}}')
  const clean = validateTemplate(
    { root: { props: { subject: 'Hi {{siteName}}\u0007' } }, content: [{ type: 'Text', props: { id: 'a', text: 'Hello\u0000 {{name}}', align: 'middle', onclick: 'alert(1)' } }, { type: 'Button', props: { label: 'Go', url: '{{resetLink}}' } }] },
    'password-reset',
  )
  ok(clean.ok && clean.data.content[0].type === 'Text' && isEqual(clean.data.content[0].props, { id: 'a', text: 'Hello {{name}}', align: 'left', size: 'normal' }) && clean.data.root.props.subject === 'Hi {{siteName}}', `rebuilt: ${JSON.stringify(clean.ok && clean.data)}`)

  const errorsOf = (content: unknown[], purpose: EmailPurpose = 'visitor-message') => {
    const result = validateTemplate({ root: { props: { subject: 'S' } }, content }, purpose)
    return result.ok ? [] : result.errors
  }
  ok(errorsOf([{ type: 'Script', props: {} }]).some((e) => /cannot be used/.test(e)), 'unknown blocks are refused')
  ok(errorsOf([{ type: 'Text', props: { text: 'Hi {{resetLink}} {{password}}' } }]).length === 2, 'placeholders of another purpose, or unknown ones, are refused')
  ok(errorsOf([{ type: 'Details', props: {} }]).some((e) => /details can only go/.test(e)), 'a message to a visitor cannot list details')
  ok(errorsOf([{ type: 'Details', props: {} }], 'team-notification').length === 0, 'a team notification can')
  for (const url of ['javascript:alert(1)', '//evil.test', 'https://user:pw@evil.test', '{{resetLink}}', '{{name}}', 'data:text/html,x']) {
    ok(errorsOf([{ type: 'Button', props: { label: 'x', url } }]).some((e) => /link must be/.test(e)), `button link refused: ${url}`)
  }
  for (const url of ['https://example.test/a?b=1', '/pets', '{{siteUrl}}', '{{siteUrl}}/pets']) ok(errorsOf([{ type: 'Button', props: { label: 'x', url } }]).length === 0, `button link allowed: ${url}`)
  ok(errorsOf([{ type: 'Image', props: { image: { id: 1, url: 'https://evil.test/x.png', alt: '' } } }]).some((e) => /media library/.test(e)), 'images come from the media library only')
  ok(errorsOf([{ type: 'Columns', props: { left: [{ type: 'Columns', props: {} }] } }]).some((e) => /inside columns/.test(e)), 'no columns in columns')
  ok(errorsOf(Array.from({ length: 61 }, () => ({ type: 'Divider', props: {} }))).some((e) => /at most 60/.test(e)), 'at most 60 blocks')

  // Rendering escapes what people typed and what placeholders hold, in text and in links.
  const tricky = validateTemplate(
    {
      root: { props: { subject: 'Hello {{name}}', preheader: 'Pre', footer: 'Bye <i>' } },
      content: [
        { type: 'Heading', props: { text: '<script>alert(1)</script>', level: 'h1' } },
        { type: 'Text', props: { text: 'Hi {{name}},\n\nSecond paragraph' } },
        { type: 'Button', props: { label: 'Reset', url: '{{resetLink}}' } },
        { type: 'Columns', props: { left: [{ type: 'Text', props: { text: 'Left' } }], right: [{ type: 'Divider', props: {} }] } },
      ],
    },
    'password-reset',
  )
  ok(tricky.ok, 'the tricky template is valid')
  const email = renderEmail((tricky as { data: TemplateData }).data, ctx)
  ok(!email.html.includes('<script>') && email.html.includes('&lt;script&gt;') && email.html.includes('&lt;b&gt;Ana&lt;/b&gt; &amp; co') && email.html.includes('Bye &lt;i&gt;'), 'typed text and placeholder values are escaped')
  ok(email.html.includes('href="https://example.test/r?token=a&amp;b=1"') && email.html.includes('class="pa-columns"'), 'the reset link is filled in, escaped, and columns render')
  ok(email.subject === 'Hello <b>Ana</b> & co' && email.text.includes('Reset: https://example.test/r?token=a&b=1') && email.text.includes('Second paragraph'), `plain text and subject: ${email.subject}`)

  ok(email.html.includes('mso-padding-alt') && email.html.includes('<!--[if mso]><table role="presentation" width="600"') && email.html.includes(`bgcolor="${ctx.theme.surface}"`), 'classic Outlook gets a bulletproof button, a fixed width and bgcolor')

  // The email's logo (page settings): the logo from Site settings at a size, aligned, optionally linked,
  // and optionally with the site's name beside or under it, either way round. Old templates keep the old look.
  const logoEmail = (root: Record<string, unknown>, logo: RenderContext['logo'] = { url: '/media/logo.png', alt: 'Our logo' }) => {
    const layout = validateTemplate({ root: { props: { subject: 'Logo', ...root } }, content: [{ type: 'Text', props: { text: 'Body' } }] }, 'test')
    if (!layout.ok) throw new Error(layout.errors.join(' '))
    return { root: layout.data.root.props, html: renderEmail(layout.data, { ...ctx, logo }).html }
  }
  ok(isEqual(logoEmail({ logoSize: 'huge', logoLayout: 'diagonal' }).root, { subject: 'Logo', preheader: '', footer: '', ...LOGO_DEFAULTS }), 'missing or unknown logo options keep the old look')
  ok(errorsOf([{ type: 'Logo', props: {} }]).some((e) => /cannot be used/.test(e)), 'there is no Logo block: the logo is the email’s own')
  const linked = logoEmail({ logoSize: 'large', logoAlign: 'left', logoLink: true }).html
  ok(linked.includes('<td align="left" style="padding:28px 32px 0">') && linked.includes(`<a href="${ctx.origin}" target="_blank" style="text-decoration:none"><img src="${ctx.origin}/media/logo.png" alt="Our logo" height="64"`), 'large, left, linked')
  const order = (html: string) => (html.indexOf('<img') < html.indexOf(`>${ctx.values.siteName}</span>`) ? 'logo first' : 'name first')
  const horizontal = logoEmail({ showSiteName: true, logoLayout: 'horizontal' }).html
  ok(order(horizontal) === 'logo first' && /<tr><td valign="middle"[^>]*><img[^]*?<\/td><td valign="middle">/.test(horizontal), 'horizontal: logo then name, in one row')
  ok(order(logoEmail({ showSiteName: true, logoLayout: 'horizontal-reverse' }).html) === 'name first', 'horizontal reversed: name then logo')
  const vertical = logoEmail({ showSiteName: true, logoLayout: 'vertical', logoAlign: 'right' }).html
  ok(order(vertical) === 'logo first' && vertical.includes('</td></tr><tr><td align="right">'), 'vertical: logo above name, in two rows')
  ok(order(logoEmail({ showSiteName: true, logoLayout: 'vertical-reverse' }).html) === 'name first', 'vertical reversed: name above logo')
  const nameOnly = logoEmail({ showSiteName: true }, null).html
  ok(nameOnly.split(`>${ctx.values.siteName}</span>`).length === 2 && !nameOnly.includes('<img'), 'without a logo: the name once')

  // The site's own emails have no library: the built-in one is edited in place and can be restored.
  const admin = (await listUsers()).find((user) => user.role === 'admin')!
  ok((await fieldErrors(createEmailTemplate({ name: 'My reset', purpose: 'password-reset' }, admin.id))).purpose, 'no library templates for the site’s own emails')
  ok(!(await getSystemEmail('password-reset')).customised, 'the original to start with')
  ok(Object.keys(await fieldErrors(saveSystemEmail('password-reset', { root: { props: { subject: 'x' } }, content: [{ type: 'Text', props: { text: 'no link' } }] }, admin.id))).length > 0, 'an edited reset email still needs {{resetLink}}')
  const custom = structuredClone(DEFAULT_TEMPLATES['password-reset'])
  custom.root.props.subject = 'Custom reset for {{name}}'
  await saveSystemEmail('password-reset', custom, admin.id)
  await saveSystemEmail('password-reset', custom, admin.id)
  ok((await getSystemEmail('password-reset')).customised && (await db.select().from(t.emailTemplates).where(eq(t.emailTemplates.purpose, 'password-reset'))).length === 1 && !(await listEmailTemplates()).some((item) => item.purpose === 'password-reset'), 'edited in place: one row however many saves, and not in the library')

  // The password reset email uses the edited version, and the original after a restore.
  const sent: EmailMessage[] = []
  const user = await createUser({ email: 'tpl@example.test', name: 'Tem Plate', password: 'template-password-123', role: 'editor' })
  const capture = { send: async (message: EmailMessage) => void sent.push(message) }
  await (await prepareResetEmail('tpl@example.test', ip(90), capture))()
  ok(sent[0]?.subject === 'Custom reset for Tem Plate' && /reset-password\?token=/.test(sent[0].text), `the reset email uses the edited version: ${sent[0]?.subject}`)
  ok((await restoreSystemEmail('password-reset')) && !(await getSystemEmail('password-reset')).customised, 'restored')
  await (await prepareResetEmail('tpl@example.test', ip(91), capture))()
  ok(sent[1]?.subject === 'Reset your Pet Adopt password' || /^Reset your .+ password$/.test(sent[1]?.subject ?? ''), `the original again: ${sent[1]?.subject}`)

  // Form emails have a library: as many as people like, unique names, layouts checked on save, and
  // used only where a form picks one (otherwise the built-in email).
  const a = await createEmailTemplate({ name: 'Friendly notification', purpose: 'team-notification' }, admin.id)
  ok(/already has this name/.test((await fieldErrors(createEmailTemplate({ name: 'FRIENDLY notification', purpose: 'visitor-message' }, admin.id))).name ?? ''), 'names are unique whatever their case')
  const b = await createEmailTemplate({ name: 'Second notification', purpose: 'team-notification', fromId: a.id }, admin.id)
  ok((await fieldErrors(createEmailTemplate({ name: 'Wrong copy', purpose: 'visitor-message', fromId: a.id }, admin.id))).purpose, 'a copy keeps its purpose')
  const bad = await fieldErrors(saveEmailTemplate(a.id, { data: { root: { props: { subject: '' } }, content: [{ type: 'Text', props: { text: '{{nope}}' } }] } }))
  ok(Object.keys(bad).length >= 2 && Object.keys(bad).every((key) => key.startsWith('template.')), `layout problems come back one per field error: ${JSON.stringify(bad)}`)
  ok((await pickTemplate('team-notification')).templateId === null, 'nothing chosen: the built-in email, however many templates exist')
  ok((await pickTemplate('team-notification', a.id)).templateId === a.id, 'a chosen template is used')
  const other = await createEmailTemplate({ name: 'Confirmation look', purpose: 'visitor-message' }, admin.id)
  ok((await pickTemplate('team-notification', other.id)).templateId === null, 'a template of another type falls back to the built-in email')
  const library = await listEmailTemplates()
  ok(isEqual(library.map((item) => item.name).sort(), ['Confirmation look', 'Form confirmation', 'Form response', 'Friendly notification', 'Second notification']), `the library: people's templates and the form builder's defaults: ${library.map((item) => item.name)}`)
  ok(library.find((item) => item.name === 'Friendly notification')?.createdByName === admin.name && library.find((item) => item.name === 'Form response')?.createdByName === null, 'created by: the person, or nobody for a plugin default')

  // Plugin defaults: seeded, never deleted, editable and restorable, and the fallback for that plugin's emails.
  const seededNotification = library.find((item) => item.seedKey === 'form-builder:notification')!
  ok(seededNotification.purpose === 'team-notification' && !seededNotification.edited, 'the form builder’s notification default is seeded')
  ok(/cannot be deleted/.test(await userError(deleteEmailTemplate(seededNotification.id))), 'a plugin default cannot be deleted')
  const changed = structuredClone((await getEmailTemplate(seededNotification.id))!.data)
  changed.root.props.subject = 'Changed: {{title}}'
  await saveEmailTemplate(seededNotification.id, { data: changed })
  ok((await getEmailTemplate(seededNotification.id))!.edited, 'edited')
  const restored = await restoreSeededTemplate(seededNotification.id)
  ok(!restored.edited && restored.data.root.props.subject === 'New response: {{title}}', 'restored to the plugin’s own layout')
  ok(/Only a default/.test(await userError(restoreSeededTemplate(a.id))), 'only plugin defaults can be restored')
  ok((await pickTemplate('team-notification', 999999, 'form-builder:notification')).templateId === seededNotification.id, 'a missing pick falls back to the plugin default')
  ok((await pickTemplate('team-notification', null, 'form-builder:confirmation')).templateId === null, 'a default of another type is not used')
  await deleteEmailTemplate(b.id)
  ok((await pickTemplate('team-notification', b.id)).templateId === null, 'deleted: the built-in email')

  // "Used by": the form builder reports which forms use which template.
  const { id: usingForm } = await forms.createForm({ name: 'Uses a template', fields: [{ id: 'm', type: 'email', label: 'Email' }], settings: { notifyEmail: 'team@example.test', notifyTemplateId: a.id, confirmationFieldId: 'm', confirmationTemplateId: other.id } })
  const { id: plainForm } = await forms.createForm({ name: 'Uses the defaults', fields: [{ id: 'm', type: 'email', label: 'Email' }], settings: { notifyEmail: 'team@example.test', confirmationFieldId: 'm' } })
  const usage = await getEmailTemplateUsage()
  ok(usage.get('form-builder:notification')?.some((use) => use.label === 'Form “Uses the defaults” (notification)') && usage.get('form-builder:confirmation')?.length === 1, 'forms that picked nothing use the defaults')
  await forms.deleteForm(plainForm)
  ok(usage.get(a.id)?.[0]?.label === 'Form “Uses a template” (notification)' && usage.get(a.id)?.[0]?.href === `/admin/plugins/form-builder/forms/${usingForm}`, `used by: ${JSON.stringify(usage.get(a.id))}`)
  ok(usage.get(other.id)?.[0]?.label === 'Form “Uses a template” (confirmation)', 'the confirmation template too')
  await forms.deleteForm(usingForm)

  // Visitor confirmations never carry answers, whatever is passed.
  const confirmation = await renderPurposeEmail({ purpose: 'visitor-message', values: { title: 'Hello' }, details: [{ label: 'Secret', value: 'visitor text' }] })
  ok(!confirmation.html.includes('visitor text') && !confirmation.text.includes('visitor text'), 'nothing typed in a message to a visitor')

  // The form builder: a confirmation needs an Email question, and is limited per address.
  const fields = [
    { id: 'name', type: 'text', label: 'Name' },
    { id: 'mail', type: 'email', label: 'Your email', required: true },
  ]
  ok((await fieldErrors(forms.createForm({ name: 'Confirm me', fields, settings: { confirmationFieldId: 'name' } })))['settings.confirmationFieldId'], 'the confirmation must use an Email question')
  const { id: formId } = await forms.createForm({ name: 'Confirm me', fields, settings: { confirmationFieldId: 'mail', notifyEmail: 'team@example.test' } })
  const form = (await forms.getForm(formId))!
  const captured: PluginEmail[] = []
  const realHost = host()
  provideHost({ ...realHost, sendTemplatedEmail: async (message) => (captured.push(message), true) })
  try {
    const answers = [
      { id: 'name', label: 'Name', type: 'text' as const, value: 'Visitor text' },
      { id: 'mail', label: 'Your email', type: 'email' as const, value: 'visitor@example.test' },
    ]
    const results = []
    for (let i = 0; i < 4; i++) results.push(await forms.confirmToVisitor(form, answers, `10.88.0.${i}`))
    ok(isEqual(results, [true, true, true, false]), `three confirmations an hour to one address: ${results}`)
    ok(captured[0].purpose === 'visitor-message' && captured[0].to === 'visitor@example.test' && !captured[0].details && captured[0].values?.title === 'Confirm me' && captured[0].fallback === 'form-builder:confirmation', `the confirmation: ${JSON.stringify(captured[0])}`)
    await forms.notifyNewResponse(form, answers)
    const note = captured.at(-1)!
    ok(note.purpose === 'team-notification' && note.to === 'team@example.test' && note.details?.some((detail) => detail.value === 'Visitor text'), 'the team notification carries the answers as details')
  } finally {
    provideHost(realHost)
  }

  // A real notification through Mailpit, with the answers in it.
  const mailpit = process.env.MAILPIT_URL || 'http://127.0.0.1:8025'
  await saveEmailSettings({ host: '127.0.0.1', port: 1025, security: 'none', fromName: 'Pet Adopt', fromAddress: 'no-reply@pet-adopt.test' })
  const title = `Mailpit form ${Date.now()}`
  ok(await host().sendTemplatedEmail({ purpose: 'team-notification', to: 'team@example.test', values: { title }, details: [{ label: 'Q', value: 'A <b>' }] }), 'sent')
  let html = ''
  for (let i = 0; i < 20 && !html; i++) {
    const list = (await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`subject:"New: ${title}"`)}`)).json()) as { messages: Array<{ ID: string }> }
    if (list.messages[0]) html = ((await (await fetch(`${mailpit}/api/v1/message/${list.messages[0].ID}`)).json()) as { HTML: string }).HTML
    else await new Promise((resolve) => setTimeout(resolve, 100))
  }
  ok(html.includes('A &lt;b&gt;') && html.includes(title), 'the notification arrived with the escaped details')
  // Only this check's own message: the inbox is the developer's too.
  await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`subject:"New: ${title}"`)}`, { method: 'DELETE' })

  await forms.deleteForm(formId)
  await removeAccount(user.id)
  await db.delete(t.emailTemplates)
  await db.delete(t.emailSettings)
})

await check('email images: a WebP upload is sent as a lossless PNG copy (classic Outlook cannot show WebP), kept in storage and removed with the upload', async () => {
  const { GET } = await import('../src/app/media/email/[name]/route')
  const ctx = await emailContext({})
  ok(emailImageSrc('/media/abc123.webp', ctx) === `${ctx.origin}/media/email/abc123.png`, 'a WebP image is linked as its PNG copy')
  ok(emailImageSrc('/media/abc123.jpg', ctx) === `${ctx.origin}/media/abc123.jpg` && emailImageSrc('/media/abc123.webp', { ...ctx, showPlaceholders: true }) === `${ctx.origin}/media/abc123.webp`, 'other formats, and the builder’s canvas, keep the original')

  const webp = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#2a7' } }).webp({ lossless: true }).toBuffer()
  const media = await saveUpload({ data: webp, alt: 'A WebP logo' })
  const base = media.filename.replace(/\.webp$/, '')
  ok(media.filename.endsWith('.webp'), `stored as WebP: ${media.filename}`)
  const call = (name: string) => GET(new Request(`http://localhost:3000/media/email/${name}`), { params: Promise.resolve({ name }) })
  const response = await call(`${base}.png`)
  const body = Buffer.from(await response.arrayBuffer())
  ok(response.status === 200 && response.headers.get('content-type') === 'image/png' && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'a PNG comes back')
  const meta = await sharp(body).metadata()
  ok(meta.width === 24 && meta.height === 16, 'same size')
  const [a, b] = await Promise.all([sharp(webp).raw().toBuffer(), sharp(body).removeAlpha().raw().toBuffer()])
  ok(a.equals(b), 'the same pixels (lossless)')
  const storage = await getStorage()
  ok(await storage.exists(`${base}.email.png`), 'the copy is kept in storage')
  ok((await call(`${base}.png`)).status === 200, 'and served again from there')
  ok((await call('nothing-here.png')).status === 404 && (await call('../secret.png')).status === 404 && (await call(`${base}.webp`)).status === 404, 'unknown, unsafe and non-PNG names are not found')
  const jpeg = await saveUpload({ data: await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).jpeg().toBuffer(), alt: 'A JPEG' })
  ok((await call(jpeg.filename.replace(/\.jpg$/, '.png'))).status === 404, 'only WebP uploads have an email copy')

  await removeUpload(media.id)
  await removeUpload(jpeg.id)
  ok(!(await storage.exists(`${base}.email.png`)), 'removed with the upload')
})

// --- two-factor sign-in ----------------------------------------------------------------------
/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) from an otpauth:// URI, as an authenticator app works it out. */
function totpFrom(uri: string, offsetSteps = 0): string {
  const secret = new URL(uri).searchParams.get('secret') ?? ''
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offsetSteps))
  const mac = createHmac('sha1', key).update(counter).digest()
  const offset = mac[mac.length - 1] & 0xf
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}
/** The cookies a Better Auth answer set, as a Cookie header added to `base`. */
function withCookies(base: Headers, ...from: Headers[]): Headers {
  const jar = new Map<string, string>()
  for (const part of (base.get('cookie') ?? '').split('; ').filter(Boolean)) jar.set(part.split('=')[0], part)
  for (const headers of from) {
    for (const line of headers.getSetCookie()) {
      const pair = line.split(';')[0]
      const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]
      if (value && !/max-age=0/i.test(line)) jar.set(name, pair)
      else jar.delete(name)
    }
  }
  const next = new Headers(base)
  next.set('cookie', [...jar.values()].join('; '))
  return next
}
async function authCode(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    const code = (e as { body?: { code?: string } }).body?.code
    if (code) return code
    throw e
  }
  throw new Error('expected a Better Auth error')
}

await check('archived accounts: cannot sign in (also with two-factor), signed out, no reset links, read-only, email kept, restorable; only archived accounts can be deleted; nobody archives themselves', async () => {
  const email = 'archive@example.test'
  const password = 'archive-password-123'
  const { id } = await createUser({ email, name: 'Archie Ved', password, role: 'editor' })
  const owner = (await listUsers()).find((u) => u.role === 'admin' && !u.archivedAt)!
  const auth = await getAuth()
  const signIn = (pw = password) => auth.api.signInEmail({ body: { email, password: pw }, headers: ip(90), returnHeaders: true })

  const before = await signIn()
  const session = withCookies(ip(90), before.headers)
  ok((await auth.api.getSession({ headers: session }))?.user.id === id, 'signed in before archiving')
  await createResetLink(id)

  ok(/your own account/.test(await userError(archiveUser(owner.id, { by: owner.id }))), 'nobody archives themselves')
  ok(/Archive the account/.test(await userError(deleteUser(id))), 'an active account cannot be deleted')
  await archiveUser(id, { by: owner.id })
  ok((await listUsers()).find((u) => u.id === id)?.archivedAt instanceof Date, 'archived, with the time')
  ok(/already archived/.test(await userError(archiveUser(id, { by: owner.id }))), 'archiving twice is refused')

  ok((await db.select().from(t.sessions).where(eq(t.sessions.userId, id))).length === 0, 'signed out everywhere')
  ok(!(await auth.api.getSession({ headers: session })), 'the old session no longer works')
  ok((await db.select().from(t.verifications).where(eq(t.verifications.value, id))).every((r) => !r.identifier.startsWith('pwreset:')), 'pending reset links are cancelled')
  ok((await authCode(signIn())) === 'ACCOUNT_ARCHIVED', 'the right password is refused')
  ok((await authCode(signIn('wrong-password-123'))) === 'INVALID_EMAIL_OR_PASSWORD', 'a wrong password looks like any wrong password')
  ok(/archived/.test(await userError(createResetLink(id))), 'no reset links')
  ok(/archived/.test(await userError(updateUser(id, { name: 'New Name', role: 'admin' }, { canChangeRole: true }))), 'read-only while archived')
  ok(/archived/.test(await userError(resetPassword(id, { password: 'another-password-123' }))), 'no new password while archived')
  ok(/archived account has this email/.test((await fieldErrors(createUser({ email, name: 'Again', password, role: 'editor' }))).email ?? ''), 'its email cannot be reused; restore instead')

  // Restored: as it was, and it signs in again.
  ok(/not archived/.test(await userError(restoreUser(owner.id))), 'only archived accounts are restored')
  await restoreUser(id)
  ok(!(await listUsers()).find((u) => u.id === id)?.archivedAt, 'restored')
  ok((await signIn()).response.user.id === id, 'signs in again')

  // With two-factor on, the archive is refused before the code step (no code-step cookie either).
  const enabled = withCookies(ip(90), (await signIn()).headers)
  const setup = await auth.api.enableTwoFactor({ body: { password }, headers: enabled })
  await auth.api.verifyTOTP({ body: { code: totpFrom((setup as { totpURI: string }).totpURI) }, headers: enabled })
  ok('twoFactorRedirect' in (await signIn()).response, 'two-factor is on')
  await archiveUser(id, { by: owner.id })
  ok((await authCode(signIn())) === 'ACCOUNT_ARCHIVED', 'an archived account with two-factor is refused at the password')

  await deleteUser(id)
  ok(!(await listUsers()).some((u) => u.id === id), 'an archived account can be deleted')
})

await check('two-factor: setup needs the password and a code, secrets are stored encrypted, sign-in asks for a code, backup codes work once, trusted browsers, lockouts, required roles, admin reset', async () => {
  // Typed codes are tidied up; anything else is refused before Better Auth sees it.
  ok(normalizeTotpCode(' 123 456 ') === '123456' && normalizeTotpCode('12345') === null && normalizeTotpCode('12345a') === null, 'authenticator codes: 6 digits, spaces allowed')
  ok(normalizeBackupCode('K7M2P X9QRT') === 'k7m2p-x9qrt' && normalizeBackupCode('k7m2p-x9qr') === null && normalizeBackupCode('k7m2p-x9qr0') === null, 'backup codes: case and spacing ignored, look-alikes refused')

  const email = 'twofactor@example.test'
  const password = 'two-factor-password-1'
  const { id } = await createUser({ email, name: 'Tess Factor', password, role: 'editor' })
  const auth = await getAuth()
  const base = ip(80)
  const signIn = (headers: Headers = base) => auth.api.signInEmail({ body: { email, password }, headers, returnHeaders: true })

  const first = await signIn()
  ok(!('twoFactorRedirect' in first.response), 'no code is asked before two-factor is on')
  const session = withCookies(base, first.headers)

  ok((await authCode(auth.api.enableTwoFactor({ body: { password: 'wrong-password-123' }, headers: session }))) === 'INVALID_PASSWORD', 'setup needs the right password')
  const setup = await auth.api.enableTwoFactor({ body: { password, issuer: 'Check Site' }, headers: session })
  ok('totpURI' in setup && setup.totpURI.startsWith('otpauth://totp/') && setup.totpURI.includes('issuer=Check'), `an authenticator URI with the site's name: ${'totpURI' in setup ? setup.totpURI : ''}`)
  const uri = (setup as { totpURI: string }).totpURI
  const codes = (setup as { backupCodes: string[] }).backupCodes
  ok(codes.length === 10 && codes.every((code) => normalizeBackupCode(code) === code && [...code.replace('-', '')].every((c) => BACKUP_CODE_ALPHABET.includes(c))), `ten backup codes in our format: ${codes.join(' ')}`)

  const [row] = await db.select().from(t.twoFactors).where(eq(t.twoFactors.userId, id))
  const secret = new URL(uri).searchParams.get('secret') as string
  ok(row && row.verified === false, 'not on until a code is confirmed')
  ok(!row.secret.includes(secret) && !codes.some((code) => row.backupCodes.includes(code)), 'the secret and backup codes are stored encrypted')
  ok(!(await listUsers()).find((u) => u.id === id)?.twoFactorEnabled, 'the account is not marked yet')
  const halfway = await signIn()
  ok(!('twoFactorRedirect' in halfway.response), 'an unfinished setup does not lock the person out')

  ok((await authCode(auth.api.verifyTOTP({ body: { code: '000000' === totpFrom(uri) ? '111111' : '000000' }, headers: session }))) === 'INVALID_CODE', 'a wrong confirmation code is refused')
  await auth.api.verifyTOTP({ body: { code: totpFrom(uri) }, headers: session })
  ok((await listUsers()).find((u) => u.id === id)?.twoFactorEnabled === true, 'confirmed: two-factor is on')
  ok((await backupCodesLeft(id)) === 10, 'ten backup codes left')

  // A sign-in now stops after the password: no session, Better Auth's code-step cookie instead.
  const step = await signIn()
  ok('twoFactorRedirect' in step.response && step.response.twoFactorRedirect === true, 'the password alone does not sign in')
  ok(!step.headers.getSetCookie().some((line) => /session_token=[^;]+/.test(line) && !/max-age=0/i.test(line)), 'no session cookie after the password')
  const pending = withCookies(base, step.headers)
  ok((await authCode(auth.api.verifyTOTP({ body: { code: totpFrom(uri, 20) }, headers: pending }))) === 'INVALID_CODE', 'a code from ten minutes ahead is refused')
  const signedIn = await auth.api.verifyTOTP({ body: { code: totpFrom(uri) }, headers: pending, returnHeaders: true })
  ok(signedIn.response.user.id === id && signedIn.headers.getSetCookie().some((line) => /session_token=/.test(line)), 'the right code signs in')
  ok((await authCode(auth.api.verifyTOTP({ body: { code: totpFrom(uri) }, headers: pending }))) === 'INVALID_TWO_FACTOR_COOKIE', 'a code step works once')

  // Backup codes: each signs in once.
  const viaBackup = withCookies(base, (await signIn()).headers)
  await auth.api.verifyBackupCode({ body: { code: codes[0] }, headers: viaBackup })
  ok((await backupCodesLeft(id)) === 9, 'a used backup code is gone')
  const again = withCookies(base, (await signIn()).headers)
  ok((await authCode(auth.api.verifyBackupCode({ body: { code: codes[0] }, headers: again }))) === 'INVALID_BACKUP_CODE', 'a backup code works only once')

  // Five wrong codes end that sign-in (the 1 above counts too); then the account-wide lock.
  for (let i = 0; i < 4; i++) await authCode(auth.api.verifyTOTP({ body: { code: '000001' }, headers: again }))
  ok((await authCode(auth.api.verifyTOTP({ body: { code: totpFrom(uri) }, headers: again }))) === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE', 'five wrong codes end that sign-in, even before a right one')
  // That was 5 failures in a row for the account; 5 more make 10.
  const more = withCookies(base, (await signIn()).headers)
  for (let i = 0; i < 5; i++) await authCode(auth.api.verifyTOTP({ body: { code: '000001' }, headers: more }))
  const locked = withCookies(base, (await signIn()).headers)
  ok((await authCode(auth.api.verifyTOTP({ body: { code: totpFrom(uri) }, headers: locked }))) === 'ACCOUNT_TEMPORARILY_LOCKED', 'ten wrong codes in a row lock the code step for the account')
  await db.update(t.twoFactors).set({ lockedUntil: null, failedVerificationCount: 0 }).where(eq(t.twoFactors.userId, id))

  // "Trust this device": the next sign-in on that browser skips the code, until it is forgotten.
  const trusting = withCookies(base, (await signIn()).headers)
  const trusted = await auth.api.verifyTOTP({ body: { code: totpFrom(uri), trustDevice: true }, headers: trusting, returnHeaders: true })
  const browser = withCookies(base, trusted.headers)
  ok(browser.get('cookie')?.includes('trust_device'), 'a trusted-device cookie is set')
  const skip = await signIn(browser)
  ok(!('twoFactorRedirect' in skip.response), 'a trusted browser signs in with the password alone')
  await forgetTrustedDevices(id)
  ok('twoFactorRedirect' in (await signIn(browser)).response, 'forgotten trusted browsers are asked for a code again')
  ok('twoFactorRedirect' in (await signIn(ip(81))).response, 'another browser is always asked')

  // Required roles: saved per role, and someone in one who has not set it up must do so first.
  ok((await fieldErrors(saveTwoFactorRoles(['editor', 'superuser']))).roles, 'unknown roles are refused')
  ok((await fieldErrors(saveTwoFactorRoles('editor'))).roles, 'a list is required')
  const saved = await saveTwoFactorRoles(['editor', 'admin', 'editor'])
  ok(saved.after.join() === 'admin,editor', `stored once each, in role order: ${saved.after.join()}`)
  const editor = { id: 'x', email: 'x@example.test', name: 'X', role: 'editor' as const, signInMethod: 'password' }
  ok(await needsTwoFactorSetup({ ...editor, twoFactorEnabled: false }), 'an editor without two-factor must set it up')
  ok(!(await needsTwoFactorSetup({ ...editor, twoFactorEnabled: true })), 'an editor with two-factor is fine')
  ok(!(await needsTwoFactorSetup({ ...editor, role: 'developer', twoFactorEnabled: false })), 'roles not ticked are not asked')
  await saveTwoFactorRoles([])
  const [settingsRow] = await db.select({ roles: t.siteSettings.twoFactorRoles }).from(t.siteSettings)
  ok(Array.isArray(settingsRow.roles) && settingsRow.roles.length === 0, 'cleared')

  // Admin reset (lost phone and codes): off, secret and codes gone, trusted browsers forgotten.
  const trustingAgain = withCookies(base, (await signIn()).headers)
  const browser2 = withCookies(base, (await auth.api.verifyTOTP({ body: { code: totpFrom(uri), trustDevice: true }, headers: trustingAgain, returnHeaders: true })).headers)
  const reset = await resetTwoFactor(id)
  ok(reset.wasEnabled && !(await listUsers()).find((u) => u.id === id)?.twoFactorEnabled, 'reset turns it off')
  ok((await db.select().from(t.twoFactors).where(eq(t.twoFactors.userId, id))).length === 0, 'the secret and backup codes are deleted')
  const trustRows = await db.select().from(t.verifications).where(eq(t.verifications.value, id))
  ok(!trustRows.some((r) => r.identifier.startsWith('trust-device-')), 'trusted browsers are forgotten')
  ok(!('twoFactorRedirect' in (await signIn(browser2)).response), 'the password alone signs in again')
  ok(!(await resetTwoFactor(id)).wasEnabled, 'a second reset changes nothing')
  ok(/no longer exists/.test(await userError(resetTwoFactor('no-such-user'))), 'an unknown account is refused')

  await removeAccount(id)
})

// --- sign-in providers (OAuth 2 / OIDC) -------------------------------------------------------
/**
 * A tiny OpenID Connect provider for the checks: discovery, keys, authorize (answers at once for
 * whoever `as` names), token (an RS256 ID token carrying the nonce) and userinfo.
 */
async function mockOidc() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, string>), kid: 'k1', alg: 'RS256', use: 'sig' }
  const b64 = (value: object | Buffer) => (Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))).toString('base64url')
  const codes = new Map<string, { sub: string; email: string; nonce?: string; clientId: string }>()
  const state = { as: { sub: 'idp-user-1', email: 'someone@idp.example' } }
  let issuer = ''
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', issuer)
    const json = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      })
    }
    if (url.pathname === '/jwks') return json({ keys: [jwk] })
    if (url.pathname === '/authorize') {
      const code = randomBytes(16).toString('hex')
      codes.set(code, { ...state.as, nonce: url.searchParams.get('nonce') ?? undefined, clientId: url.searchParams.get('client_id') ?? '' })
      const back = new URL(url.searchParams.get('redirect_uri') ?? '')
      back.searchParams.set('code', code)
      back.searchParams.set('state', url.searchParams.get('state') ?? '')
      back.searchParams.set('iss', issuer)
      res.writeHead(302, { location: back.toString() })
      return res.end()
    }
    if (url.pathname === '/token') {
      let body = ''
      for await (const chunk of req) body += chunk
      const grant = codes.get(new URLSearchParams(body).get('code') ?? '')
      if (!grant) {
        res.writeHead(400, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: 'invalid_grant' }))
      }
      const now = Math.floor(Date.now() / 1000)
      const head = b64({ alg: 'RS256', typ: 'JWT', kid: 'k1' })
      const claims = b64({ iss: issuer, sub: grant.sub, aud: grant.clientId, iat: now, exp: now + 300, nonce: grant.nonce, email: grant.email, email_verified: true, name: 'IdP Person' })
      const signature = signData('sha256', Buffer.from(`${head}.${claims}`), privateKey).toString('base64url')
      return json({ access_token: `at-${grant.sub}`, token_type: 'Bearer', expires_in: 300, id_token: `${head}.${claims}.${signature}` })
    }
    if (url.pathname === '/userinfo') return json({ sub: state.as.sub, email: state.as.email, name: 'IdP Person' })
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  issuer = `http://localhost:${port}`
  return { issuer, state, close: () => server.close() }
}

/**
 * Runs a provider round trip like a browser: the start (sign-in or connect), the provider's
 * authorize page, then Better Auth's callback route. Returns where the callback sent the browser
 * and the cookies it set.
 */
async function providerRoundTrip(start: { url: string; headers: Headers }, cookies: Headers) {
  const jar = withCookies(cookies, start.headers)
  const authorize = await fetch(start.url, { redirect: 'manual' })
  const callback = authorize.headers.get('location') ?? ''
  const auth = await getAuth()
  const response = await auth.handler(new Request(callback, { headers: jar }))
  return { location: response.headers.get('location') ?? '', headers: withCookies(jar, response.headers) }
}

await check('sign-in providers: https only, secret encrypted, never an account or a link by email, connect then sign in (counts as two-factor), one link per provider account, archived and disabled refused, delete disconnects', async () => {
  const idp = await mockOidc()
  try {
    // Saving: endpoints are checked, the secret is only stored encrypted.
    const bad = await fieldErrors(saveAuthProvider(null, { name: 'Bad', kind: 'oidc', discoveryUrl: 'http://idp.example/.well-known/openid-configuration', clientId: 'x' }))
    ok(bad.discoveryUrl, 'plain http to a real host is refused')
    ok((await fieldErrors(saveAuthProvider(null, { name: 'Bad', kind: 'oidc', discoveryUrl: 'https://user:pw@idp.example/x', clientId: 'x' }))).discoveryUrl, 'credentials in the address are refused')
    const manual = await fieldErrors(saveAuthProvider(null, { name: 'Manual', kind: 'oauth2', clientId: 'x' }))
    ok(manual.authorizationUrl && manual.tokenUrl && manual.userInfoUrl, 'OAuth 2 needs its three endpoints')
    const versionBefore = await providersVersion()
    const { provider } = await saveAuthProvider(null, {
      name: 'Mock IdP',
      kind: 'oidc',
      discoveryUrl: `${idp.issuer}/.well-known/openid-configuration`,
      clientId: 'pet-adopt',
      clientSecret: 'mock-client-secret',
      enabled: true,
    })
    ok(provider.slug === 'mock-idp' && provider.secretSet && provider.scopes === 'openid email profile', `saved: ${provider.slug} ${provider.scopes}`)
    ok(provider.redirectUri.endsWith('/api/auth/callback/mock-idp'), `the address to register: ${provider.redirectUri}`)
    const [stored] = await db.select().from(t.authProviders).where(eq(t.authProviders.id, provider.id))
    ok(stored.clientSecretEncrypted && !stored.clientSecretEncrypted.includes('mock-client-secret'), 'the client secret is stored encrypted')
    ok(!('clientSecretEncrypted' in provider), 'the view never carries the secret')
    ok((await providersVersion()) !== versionBefore, 'saving changes the version other servers watch')
    const { provider: second } = await saveAuthProvider(null, { name: 'Mock IdP', kind: 'oidc', discoveryUrl: `${idp.issuer}/x`, clientId: 'y' })
    ok(second.slug === 'mock-idp-2' && !second.enabled, 'names may repeat: the address gets a number; new providers start off')
    await deleteAuthProvider(second.id)
    forgetAuth()

    const auth = await getAuth()
    const base = ip(95)
    const start = async (headers: Headers) => {
      const r = await auth.api.signInSocial({ body: { provider: 'mock-idp', callbackURL: '/admin', errorCallbackURL: '/admin/login', disableRedirect: true }, headers, returnHeaders: true })
      return { url: (r.response as { url: string }).url, headers: r.headers }
    }

    // A provider account whose email matches an account here is NOT linked by that, and an unknown
    // one creates nothing.
    const owner = (await listUsers()).find((u) => u.role === 'admin' && !u.archivedAt)!
    idp.state.as = { sub: 'idp-owner', email: owner.email }
    const byEmail = await providerRoundTrip(await start(base), base)
    ok(byEmail.location.startsWith('/admin/login?error='), `a matching email is not enough: ${byEmail.location}`)
    ok(!byEmail.headers.get('cookie')?.includes('session_token'), 'and no session')
    idp.state.as = { sub: 'idp-stranger', email: 'stranger@idp.example' }
    const usersBefore = (await listUsers()).length
    const stranger = await providerRoundTrip(await start(base), base)
    ok(stranger.location.startsWith('/admin/login?error=') && (await listUsers()).length === usersBefore, `a stranger gets no account: ${stranger.location}`)

    // Connecting while signed in (their provider email may differ), then signing in with it.
    const email = 'provider@example.test'
    const password = 'provider-password-123'
    const { id } = await createUser({ email, name: 'Pro Vider', password, role: 'editor' })
    const signed = await auth.api.signInEmail({ body: { email, password }, headers: base, returnHeaders: true })
    const session = withCookies(base, signed.headers)
    idp.state.as = { sub: 'idp-pro', email: 'pro.vider@idp.example' }
    const link = await auth.api.linkSocialAccount({ body: { provider: 'mock-idp', callbackURL: '/admin/account?connected=mock-idp', errorCallbackURL: '/admin/account', disableRedirect: true }, headers: session, returnHeaders: true })
    const linked = await providerRoundTrip({ url: (link.response as { url: string }).url, headers: link.headers }, session)
    ok(linked.location === '/admin/account?connected=mock-idp', `connected: ${linked.location}`)
    const links = await db.select().from(t.accounts).where(eq(t.accounts.userId, id))
    const providerLink = links.find((row) => row.providerId === 'mock-idp')
    ok(providerLink?.accountId === 'idp-pro', 'stored as a link to that provider account')
    ok(!providerLink?.accessToken || !providerLink.accessToken.includes('at-idp-pro'), 'provider tokens are stored encrypted')
    ok((await listAuthProviders()).find((p) => p.slug === 'mock-idp')?.connected === 1, 'the admin list counts it')

    const viaProvider = await providerRoundTrip(await start(base), base)
    ok(viaProvider.location === '/admin', `signed in through the provider: ${viaProvider.location}`)
    const providerSession = await auth.api.getSession({ headers: viaProvider.headers })
    ok(providerSession?.user.id === id, 'as the connected account')
    ok((providerSession?.session as { signInMethod?: string }).signInMethod === 'provider:mock-idp', 'the session records how it signed in')
    ok((await db.select().from(t.sessions).where(eq(t.sessions.userId, id))).some((row) => row.signInMethod === 'password'), 'password sessions are marked too')
    await saveTwoFactorRoles(['editor'])
    const asUser = { id, email, name: 'Pro Vider', role: 'editor' as const, twoFactorEnabled: false }
    ok(!(await needsTwoFactorSetup({ ...asUser, signInMethod: 'provider:mock-idp' })), 'a provider sign-in counts as two-factor')
    ok(await needsTwoFactorSetup({ ...asUser, signInMethod: 'password' }), 'a password sign-in still has to set it up')
    // Changing the password replaces the session; it must still count as a provider sign-in.
    const changed = await auth.api.changePassword({
      body: { currentPassword: password, newPassword: 'provider-password-456', revokeOtherSessions: true },
      headers: viaProvider.headers,
      returnHeaders: true,
    })
    const replaced = await auth.api.getSession({ headers: withCookies(viaProvider.headers, changed.headers) })
    ok((replaced?.session as { signInMethod?: string } | undefined)?.signInMethod === 'provider:mock-idp', 'a replaced session keeps how it signed in')
    await saveTwoFactorRoles([])
    const logged = await db.select().from(t.activityLog).where(eq(t.activityLog.actorId, id))
    ok(logged.some((row) => row.action === 'account.provider-connect' && row.summary.includes('Mock IdP')), 'connecting is logged')
    ok(logged.some((row) => row.action === 'auth.sign-in' && row.summary === 'Signed in with Mock IdP'), 'the provider sign-in is logged')

    // That provider account belongs to one account here.
    const other = await createUser({ email: 'other@example.test', name: 'Oth Er', password, role: 'editor' })
    const otherSession = withCookies(base, (await auth.api.signInEmail({ body: { email: 'other@example.test', password }, headers: base, returnHeaders: true })).headers)
    const steal = await auth.api.linkSocialAccount({ body: { provider: 'mock-idp', callbackURL: '/admin/account', errorCallbackURL: '/admin/account', disableRedirect: true }, headers: otherSession, returnHeaders: true })
    const stolen = await providerRoundTrip({ url: (steal.response as { url: string }).url, headers: steal.headers }, otherSession)
    ok(stolen.location.includes('error=account_already_linked_to_different_user'), `someone else's provider account cannot be connected: ${stolen.location}`)

    // Archived accounts and disabled providers are refused.
    await archiveUser(id, { by: owner.id })
    const archived = await providerRoundTrip(await start(base), base)
    ok(archived.location.includes(`error=${'ACCOUNT_ARCHIVED'}`), `an archived account is refused: ${archived.location}`)
    await restoreUser(id)
    await saveAuthProvider(provider.id, { enabled: false })
    forgetAuth()
    const off = await getAuth()
    ok(
      (await authCode(off.api.signInSocial({ body: { provider: 'mock-idp', callbackURL: '/admin', disableRedirect: true }, headers: base }))) !== '',
      'a disabled provider cannot be used',
    )
    await saveAuthProvider(provider.id, { enabled: true })
    forgetAuth()

    // Disconnecting ends it; deleting the provider removes every connection.
    await disconnectProvider(id, 'mock-idp')
    const after = await providerRoundTrip(await start(base), base)
    ok(after.location.startsWith('/admin/login?error='), 'disconnected: no longer signs in')
    await db.insert(t.accounts).values({ id: 'acct-check', accountId: 'idp-x', providerId: 'mock-idp', userId: other.id, createdAt: new Date(), updatedAt: new Date() })
    const removed = await deleteAuthProvider(provider.id)
    forgetAuth()
    ok(removed.disconnected === 1 && (await db.select().from(t.accounts).where(eq(t.accounts.providerId, 'mock-idp'))).length === 0, 'deleting a provider disconnects everyone')
    ok(!(await db.select().from(t.accounts).where(eq(t.accounts.userId, id))).every((row) => row.providerId !== 'credential'), 'passwords stay')

    await removeAccount(id)
    await removeAccount(other.id)
  } finally {
    idp.close()
  }
})

await check('invites: an account without a password, emailed (or the link to copy), a resend cancels the old link, accepted once, then signs in; expiry, archive and an admin password cancel it; the Invitation email needs {{inviteLink}}', async () => {
  const email = 'invited@example.test'
  const { id } = await createUser({ email, name: 'In Vited', role: 'editor', invite: true })
  const listed = (await listUsers()).find((u) => u.id === id)!
  ok(listed.invited && !listed.inviteActive, 'invited, with no link yet')
  ok((await db.select().from(t.accounts).where(eq(t.accounts.userId, id))).length === 0, 'no password at all')
  const auth = await getAuth()
  ok((await authCode(auth.api.signInEmail({ body: { email, password: 'any-password-12345' }, headers: ip(97) }))) !== '', 'cannot sign in before accepting')

  // Emailed through the site's sender (a stand-in here), or the link to copy without one.
  const sent: EmailMessage[] = []
  const first = await sendInvite(id, 'Ad Min', { send: async (message) => void sent.push(message) })
  ok(first.sent && sent.length === 1 && sent[0].to === email, 'emailed to them')
  ok(sent[0].subject.includes('invited') && (sent[0].html ?? '').includes(first.url.replace(/&/g, '&amp;')) && sent[0].text.includes(first.url), 'the email carries the link')
  ok(sent[0].text.includes('Ad Min') && sent[0].text.includes('Editor') && sent[0].text.includes('7 days'), 'and who invited them, their role and how long it works')
  ok(first.url.startsWith(`${process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'}/admin/invite?token=`), `a link on this site: ${first.url}`)
  const tokenOf = (url: string) => new URL(url).searchParams.get('token')!
  ok((await isInviteTokenValid(tokenOf(first.url)))?.name === 'In Vited', 'the link works')
  const unsent = await sendInvite(id, 'Ad Min', null)
  ok(!unsent.sent && unsent.problem && unsent.url !== first.url, 'without email: not sent, a link to copy')
  ok(!(await isInviteTokenValid(tokenOf(first.url))), 'a new invite cancels the older link')
  const failing = await sendInvite(id, 'Ad Min', { send: async () => { throw new Error('smtp down') } })
  ok(!failing.sent && /could not be sent/.test(failing.problem ?? ''), 'a failed send still gives the link')
  const stored = await db.select().from(t.verifications).where(eq(t.verifications.value, id))
  ok(stored.length === 1 && stored[0].identifier.startsWith('invite:') && !stored[0].identifier.includes(tokenOf(failing.url)), 'one pending invite, stored as a hash')
  ok((await listUsers()).find((u) => u.id === id)?.inviteActive, 'the list shows it pending')

  // Accepting: checks the password, works once, then they sign in.
  ok((await fieldErrors(acceptInvite({ token: tokenOf(failing.url), password: 'short' }))).password, 'the password rules apply')
  ok(/expired or was already used/.test(await userError(acceptInvite({ token: 'x'.repeat(43), password: 'invited-password-1' }))), 'an unknown token is refused')
  await acceptInvite({ token: tokenOf(failing.url), password: 'invited-password-1' })
  ok(/expired or was already used/.test(await userError(acceptInvite({ token: tokenOf(failing.url), password: 'another-password-1' }))), 'a link works once')
  ok((await auth.api.signInEmail({ body: { email, password: 'invited-password-1' }, headers: ip(97) })).user.id === id, 'they sign in with their password')
  const after = (await listUsers()).find((u) => u.id === id)!
  ok(!after.invited && !after.inviteActive, 'no longer invited')
  ok(/already have a password/.test(await userError(sendInvite(id, 'Ad Min', null))), 'no invites once they have a password')

  // Expired links, archiving and an admin's password cancel or end an invite.
  const second = await createUser({ email: 'invited2@example.test', name: 'Sec Ond', role: 'editor', invite: true })
  const late = await sendInvite(second.id, 'Ad Min', null)
  await db.update(t.verifications).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(t.verifications.value, second.id))
  ok(!(await isInviteTokenValid(tokenOf(late.url))) && !(await listUsers()).find((u) => u.id === second.id)?.inviteActive, 'an expired invite no longer works')
  const again = await sendInvite(second.id, 'Ad Min', null)
  const owner = (await listUsers()).find((u) => u.role === 'admin' && !u.archivedAt)!
  await archiveUser(second.id, { by: owner.id })
  ok(!(await isInviteTokenValid(tokenOf(again.url))), 'archiving cancels the invite')
  ok(/archived/.test(await userError(sendInvite(second.id, 'Ad Min', null))), 'and no new one while archived')
  await restoreUser(second.id)
  const third = await sendInvite(second.id, 'Ad Min', null)
  await resetPassword(second.id, { password: 'admin-set-password-1' })
  ok(!(await isInviteTokenValid(tokenOf(third.url))) && !(await listUsers()).find((u) => u.id === second.id)?.invited, 'an admin setting a password cancels the invite')

  // The Invitation email: a system email that must carry {{inviteLink}}; other emails cannot use it.
  const noLink = validateTemplate({ root: { props: { subject: 'Hi' } }, content: [{ type: 'Text', props: { text: 'No link here' } }] }, 'invite')
  ok(!noLink.ok && noLink.errors.some((e) => /inviteLink/.test(e)), 'an invitation must contain {{inviteLink}}')
  ok(validateTemplate(DEFAULT_TEMPLATES.invite, 'invite').ok, 'the built-in invitation is valid')
  const misuse = validateTemplate({ root: { props: { subject: 'Hi' } }, content: [{ type: 'Button', props: { label: 'Go', url: '{{inviteLink}}' } }] }, 'test')
  ok(!misuse.ok, 'other emails cannot link to {{inviteLink}}')
  ok((await fieldErrors(createEmailTemplate({ name: 'My invite', purpose: 'invite' }, owner.id))).purpose, 'no library templates for the invitation: it is edited in place')

  await removeAccount(id)
  await removeAccount(second.id)
})

await check('profile pictures: checked like uploads, cropped as the browser shows the photo, kept as a 256 px square without metadata, old files removed; a provider picture is used only when there is none, fetched carefully', async () => {
  const { id } = await createUser({ email: 'avatar@example.test', name: 'Ava Tar', password: 'avatar-password-12', role: 'editor' })
  const storage = await getStorage()
  const imageOf = async () => (await listUsers()).find((u) => u.id === id)!.image
  const fileOf = (url: string | null) => (url ?? '').replace('/media/', '')

  // A 40 x 30 photo: crops must be whole pixels, a square inside the picture, at least 16 px.
  const photo = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#09f' } }).png().toBuffer()
  for (const crop of [{ x: 20, y: 0, size: 30 }, { x: 0, y: 0, size: 31 }, { x: -1, y: 0, size: 20 }, { x: 0.5, y: 0, size: 20 }, { x: 0, y: 0, size: 8 }, null]) {
    ok((await fieldErrors(saveAvatar(id, photo, crop))).crop, `refused crop ${JSON.stringify(crop)}`)
  }
  ok((await fieldErrors(saveAvatar(id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { x: 0, y: 0, size: 16 }))).file, 'SVG is refused')
  ok((await fieldErrors(saveAvatar(id, Buffer.from('not a picture'), { x: 0, y: 0, size: 16 }))).file, 'junk is refused')

  const first = await saveAvatar(id, photo, { x: 5, y: 0, size: 30 })
  ok(/^\/media\/avatar-[a-f0-9]{32}\.webp$/.test(first) && (await imageOf()) === first, `stored and set: ${first}`)
  const stored = await storage.get(fileOf(first))
  const meta = await sharp(stored!.body).metadata()
  ok(meta.format === 'webp' && meta.width === AVATAR_SIZE && meta.height === AVATAR_SIZE && !meta.exif, 'a 256 px WebP square with no metadata')

  // A phone photo stored sideways (EXIF orientation 6): 40 x 20 in the file, 20 x 40 upright. The
  // crop is chosen on the upright picture, as the browser shows it.
  const sideways = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#f60' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer()
  const second = await saveAvatar(id, sideways, { x: 0, y: 15, size: 20 })
  ok((await imageOf()) === second && !(await storage.exists(fileOf(first))), 'replacing deletes the old file')

  ok(await removeAvatar(id), 'removed')
  ok((await imageOf()) === null && !(await storage.exists(fileOf(second))), 'back to initials, file deleted')
  ok(!(await removeAvatar(id)), 'nothing to remove twice')

  // A provider picture: only for someone without one, centre-cropped, never from a private address.
  ok(pictureFromIdToken(`x.${Buffer.from(JSON.stringify({ picture: 'https://img.example/p.png' })).toString('base64url')}.y`) === 'https://img.example/p.png', 'read from the ID token')
  ok(pictureFromIdToken('not-a-token') === null && pictureFromIdToken(null) === null, 'no token, no picture')
  ok(await adoptProviderPicture(id, 'https://img.example/p.png', async () => photo), 'used when there is none')
  const adopted = await imageOf()
  ok(adopted && (await sharp((await storage.get(fileOf(adopted)))!.body).metadata()).width === AVATAR_SIZE, 'stored the same way')
  ok(!(await adoptProviderPicture(id, 'https://img.example/q.png', async () => photo)) && (await imageOf()) === adopted, 'a picture someone has is kept')
  await removeAvatar(id)
  ok(!(await adoptProviderPicture(id, 'https://img.example/p.png', async () => Buffer.from('junk'))) && (await imageOf()) === null, 'an unreadable picture is not used')
  ok(!(await adoptProviderPicture(id, 'http://img.example/p.png')) && !(await adoptProviderPicture(id, 'https://127.0.0.1/p.png')) && !(await adoptProviderPicture(id, 'https://localhost/p.png')), 'only https, never a private or local address')
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
    ok(isPrivateAddress(address), `${address} is private`)
  }
  ok(!isPrivateAddress('93.184.216.34') && !isPrivateAddress('2606:4700::1111'), 'public addresses are fine')

  // Deleting the account deletes its picture.
  const last = await saveAvatar(id, photo, { x: 0, y: 0, size: 30 })
  await removeAccount(id)
  ok(!(await storage.exists(fileOf(last))), 'the picture goes with the account')
})

await check('email changes: yourself with your password and a link to the new address (the old one is told), confirmed once; an admin at once with notices to both; addresses stay unique; the two emails need their links', async () => {
  const email = 'mover@example.test'
  const password = 'mover-password-123'
  const { id } = await createUser({ email, name: 'Mo Ver', password, role: 'editor' })
  const auth = await getAuth()
  const inbox: EmailMessage[] = []
  const sender = { send: async (message: EmailMessage) => void inbox.push(message) }
  const tokenIn = (message: EmailMessage) => /token=([A-Za-z0-9_-]{43})/.exec(message.text)?.[1] ?? ''

  // Checks first: password, a real and different address that nobody uses, and the site must email.
  ok(/cannot send email/.test(await userError(requestEmailChange(id, { email: 'new@example.test', password }, null))), 'without email: ask an admin')
  ok((await fieldErrors(requestEmailChange(id, { email: 'new@example.test', password: 'wrong-password-1' }, sender))).password, 'the current password is required')
  ok((await fieldErrors(requestEmailChange(id, { email: 'not an email', password }, sender))).email, 'a real address')
  ok((await fieldErrors(requestEmailChange(id, { email: email.toUpperCase(), password }, sender))).email, 'a different address')
  ok((await fieldErrors(requestEmailChange(id, { email: process.env.SEED_ADMIN_EMAIL!, password }, sender))).email, 'nobody else may have it')
  ok(inbox.length === 0, 'nothing sent for refused requests')

  // A request: the link goes to the new address, a notice to the old one; nothing changes yet.
  const first = await requestEmailChange(id, { email: 'Mover.New@Example.test', password }, sender)
  ok(first.email === 'mover.new@example.test', 'stored in lower case')
  ok(inbox.length === 2 && inbox[0].to === 'mover.new@example.test' && tokenIn(inbox[0]), 'a confirmation link to the new address')
  ok(inbox[1].to === email && inbox[1].text.includes('mover.new@example.test') && !tokenIn(inbox[1]), 'a notice without the link to the old address')
  ok((await listUsers()).find((u) => u.id === id)?.email === email, 'nothing changes before it is confirmed')
  ok((await pendingEmailChange(id))?.email === 'mover.new@example.test', 'the change waits')
  const stored = (await db.select().from(t.verifications)).filter((row) => row.identifier.startsWith('email-change:'))
  ok(stored.length === 1 && !stored[0].identifier.includes(tokenIn(inbox[0])), 'one pending change, its token stored as a hash')

  // A second request cancels the first link.
  const firstToken = tokenIn(inbox[0])
  await requestEmailChange(id, { email: 'mover.second@example.test', password }, sender)
  const secondToken = tokenIn(inbox[2])
  ok(!(await emailChangeFor(firstToken)) && (await emailChangeFor(secondToken))?.email === 'mover.second@example.test', 'a new request cancels the older link')

  // Confirming: once; then the new address signs in and the old one does not.
  const changed = await confirmEmailChange(secondToken)
  ok(changed.from === email && changed.to === 'mover.second@example.test', 'confirmed')
  ok(/expired or was already used/.test(await userError(confirmEmailChange(secondToken))), 'a link works once')
  ok((await auth.api.signInEmail({ body: { email: 'mover.second@example.test', password }, headers: ip(98) })).user.id === id, 'signs in with the new address')
  ok((await authCode(auth.api.signInEmail({ body: { email, password }, headers: ip(98) }))) !== '', 'not with the old one')
  ok(!(await pendingEmailChange(id)), 'nothing pending any more')

  // Expired and cancelled links.
  await requestEmailChange(id, { email: 'mover.third@example.test', password }, sender)
  const third = tokenIn(inbox[inbox.length - 2])
  await db.update(t.verifications).set({ expiresAt: new Date(Date.now() - 1000) }).where(like(t.verifications.identifier, 'email-change:%'))
  ok(!(await emailChangeFor(third)) && /expired/.test(await userError(confirmEmailChange(third))), 'an expired link does nothing')
  await requestEmailChange(id, { email: 'mover.fourth@example.test', password }, sender)
  await cancelEmailChange(id)
  ok(!(await pendingEmailChange(id)), 'cancelled')

  // An admin: at once, unique, and both addresses are told. The person's own form cannot do it.
  await updateUser(id, { name: 'Mo Ver', email: 'sneaky@example.test' }, { canChangeRole: false })
  ok((await listUsers()).find((u) => u.id === id)?.email === 'mover.second@example.test', 'the name form ignores an email')
  ok((await fieldErrors(updateUser(id, { name: 'Mo Ver', email: process.env.SEED_ADMIN_EMAIL! }, { canChangeRole: true }))).email, 'an admin cannot pick a taken address')
  ok((await fieldErrors(updateUser(id, { name: 'Mo Ver', email: '' }, { canChangeRole: true }))).email, 'or an empty one')
  const unchanged = await updateUser(id, { name: 'Mo Ver', email: 'MOVER.second@example.test' }, { canChangeRole: true })
  ok(unchanged.email === null, 'the same address in other case is no change')
  const byAdmin = await updateUser(id, { name: 'Mo Ver', email: 'mover.admin@example.test' }, { canChangeRole: true })
  ok(byAdmin.email?.from === 'mover.second@example.test' && byAdmin.email.to === 'mover.admin@example.test', 'changed at once')
  const before = inbox.length
  ok((await sendEmailChangeNotice({ name: 'Mo Ver' }, byAdmin.email!, 'Ad Min', [byAdmin.email!.from, byAdmin.email!.to], sender)) === 2, 'both addresses are told')
  ok(inbox.slice(before).every((message) => message.text.includes('Ad Min')), 'who asked for it')

  // The two emails: the confirmation must carry {{confirmLink}}, which no other email may use.
  ok(validateTemplate(DEFAULT_TEMPLATES['email-change'], 'email-change').ok && validateTemplate(DEFAULT_TEMPLATES['email-changed'], 'email-changed').ok, 'the built-in emails are valid')
  const missing = validateTemplate({ root: { props: { subject: 'Hi' } }, content: [{ type: 'Text', props: { text: 'No link' } }] }, 'email-change')
  ok(!missing.ok && missing.errors.some((e) => /confirmLink/.test(e)), 'a confirmation must contain {{confirmLink}}')
  ok(!validateTemplate({ root: { props: { subject: 'Hi' } }, content: [{ type: 'Button', props: { label: 'Go', url: '{{confirmLink}}' } }] }, 'email-changed').ok, 'the notice cannot carry the link')

  await removeAccount(id)
})

await check('deleting accounts: your own request closes it at once and deletes it after 30 days (an admin can restore it); every deletion anonymises the activity log, removes the picture and counters, and leaves other people alone', async () => {
  const owner = (await listUsers()).find((u) => u.role === 'admin' && !u.archivedAt)!
  const ownerActor = { id: owner.id, name: owner.name, role: owner.role }
  const email = 'leaver@example.test'
  const password = 'leaver-password-123'
  const { id } = await createUser({ email, name: 'Lee Ver', password, role: 'editor' })
  const auth = await getAuth()

  // History about them: their own entries, an admin's entry about them, a failed sign-in on them (with
  // an address), then a rename, so their entries carry two names. Another person shares the old name.
  const twin = await createUser({ email: 'twin@example.test', name: 'Lee Ver', password, role: 'editor' })
  await recordActivity({ actor: { id, name: 'Lee Ver', role: 'editor' }, action: 'pet.update', area: 'pets', summary: 'Updated the pet “Rex”', subject: { id: 42, label: 'Rex' }, fields: ['name'], client: '203.0.113.7' })
  await recordActivity({ actor: ownerActor, action: 'user.create', area: 'users', summary: 'Added the account “Lee Ver” as Editor', subject: { id, label: 'Lee Ver' } })
  await recordActivity({ actor: null, action: 'auth.sign-in-failed', area: 'sign-in', summary: 'Failed sign-in to the account “Lee Ver” (wrong password)', subject: { id, label: 'Lee Ver' }, client: '198.51.100.9' })
  await updateUser(id, { name: 'Lee Renamed' }, { canChangeRole: false })
  await recordActivity({ actor: { id, name: 'Lee Renamed', role: 'editor' }, action: 'page.update', area: 'pages', summary: 'Saved a draft of “About”', client: '203.0.113.7' })
  await recordActivity({ actor: { id: twin.id, name: 'Lee Ver', role: 'editor' }, action: 'pet.update', area: 'pets', summary: 'Updated the pet “Lee Ver”', subject: { id: 43, label: 'Lee Ver' } })
  const signedIn = withCookies(ip(99), (await auth.api.signInEmail({ body: { email, password }, headers: ip(99), returnHeaders: true })).headers)
  const picture = await saveAvatar(id, await sharp({ create: { width: 20, height: 20, channels: 3, background: '#0a0' } }).png().toBuffer(), { x: 0, y: 0, size: 20 })
  await consumeAttempt(`chpw:${id}`, PASSWORD_CHANGE_RULE)

  // Asking: the password, not the last admin; then closed at once with a date.
  ok((await fieldErrors(requestOwnDeletion(id, { password: 'wrong-password-12' }))).password, 'the password is checked')
  // The last active admin cannot delete their own account: made certain here (other admins are made
  // editors for the moment), not left to whoever happens to be an admin at this point of the run.
  const otherAdmins = (await listUsers()).filter((u) => u.role === 'admin' && !u.archivedAt && u.id !== owner.id)
  for (const other of otherAdmins) await updateUser(other.id, { name: other.name, role: 'editor' }, { canChangeRole: true })
  ok(/last admin/.test(await userError(requestOwnDeletion(owner.id, { password: process.env.SEED_ADMIN_PASSWORD! }))), 'the last admin cannot delete their account')
  ok(!(await listUsers()).find((u) => u.id === owner.id)?.archivedAt, 'and stays active')
  // Two admins asking at the same moment: exactly one gets through, one admin stays.
  await updateUser(twin.id, { name: 'Lee Ver', role: 'admin' }, { canChangeRole: true })
  const both = await Promise.allSettled([requestOwnDeletion(owner.id, { password: process.env.SEED_ADMIN_PASSWORD! }), requestOwnDeletion(twin.id, { password })])
  ok(both.filter((r) => r.status === 'fulfilled').length === 1, 'two admins deleting themselves at once: only one gets through')
  ok((await listUsers()).filter((u) => u.role === 'admin' && !u.archivedAt).length === 1, 'one active admin remains')
  for (const user of await listUsers()) if (user.deleteAfter && (user.id === owner.id || user.id === twin.id)) await restoreUser(user.id)
  await updateUser(twin.id, { name: 'Lee Ver', role: 'editor' }, { canChangeRole: true })
  for (const other of otherAdmins) await updateUser(other.id, { name: other.name, role: 'admin' }, { canChangeRole: true })
  const asked = await requestOwnDeletion(id, { password })
  const days = (asked.deleteAfter.getTime() - Date.now()) / 86_400_000
  ok(days > DELETION_GRACE_DAYS - 0.01 && days <= DELETION_GRACE_DAYS, `deleted in ${DELETION_GRACE_DAYS} days`)
  const listed = (await listUsers()).find((u) => u.id === id)!
  ok(listed.archivedAt && listed.deleteAfter, 'closed now, with its date')
  ok(!(await auth.api.getSession({ headers: signedIn })), 'signed out everywhere')
  ok((await authCode(auth.api.signInEmail({ body: { email, password }, headers: ip(99) }))) === 'ACCOUNT_ARCHIVED', 'cannot sign in')

  // An admin can restore it (cancelling the deletion), and the person can ask again.
  await restoreUser(id)
  ok(!(await listUsers()).find((u) => u.id === id)?.deleteAfter, 'restoring cancels the deletion')
  await requestOwnDeletion(id, { password })
  ok((await purgeDueDeletions()) === 0 && (await listUsers()).some((u) => u.id === id), 'nothing is deleted before its date')

  // After the 30 days: deleted, and the log is anonymised.
  ok((await purgeDueDeletions(new Date(Date.now() + (DELETION_GRACE_DAYS + 1) * 86_400_000))) === 1, 'deleted on its date')
  ok(!(await listUsers()).some((u) => u.id === id), 'the account is gone')
  ok(!(await getStorage().then((s) => s.exists(picture.replace('/media/', '')))), 'its picture is gone')
  ok((await db.select().from(t.rateLimits).where(like(t.rateLimits.key, `%${id}%`))).length === 0, 'its attempt counters are gone')
  const log = await db.select().from(t.activityLog)
  const mentions = (row: (typeof log)[number]) => [row.actorName, row.subjectLabel, row.summary].some((text) => text?.includes('Lee Renamed'))
  ok(!log.some((row) => row.actorId === id || row.subjectId === id), 'no entry points at the account any more')
  ok(!log.some(mentions), 'their newer name is nowhere in the log')
  // Earlier checks deleted accounts too: find this person's label from their own entry.
  const label = log.find((row) => row.action === 'pet.update' && row.summary === 'Updated the pet “Rex”' && row.actorName?.startsWith('Deleted user'))?.actorName
  const theirs = log.filter((row) => label && (row.actorName === label || row.subjectLabel === label))
  ok(label && theirs.length === 5, `their entries carry one anonymous label: ${label} (${theirs.length} entries)`)
  ok(new Set(theirs.map((row) => (row.actorName === label ? row.actorId : row.subjectId))).size === 1, 'and one id that links to nothing, so they still group together')
  ok(theirs.every((row) => row.client === null), 'their client addresses are cleared')
  ok(theirs.some((row) => row.action === 'pet.update' && row.summary === 'Updated the pet “Rex”' && (row.fields ?? []).includes('name')), 'what was done stays')
  ok(theirs.some((row) => row.action === 'user.create' && row.summary === `Added the account “${label}” as Editor`), 'names inside summaries are replaced')
  ok(theirs.some((row) => row.action === 'auth.sign-in-failed' && !row.summary.includes('Lee Ver')), 'including under their older name')
  ok(theirs.some((row) => row.action === 'user.delete' && row.actorId === null && row.summary.includes(label!)), 'the automatic deletion is logged without the name')
  const twinRows = log.filter((row) => row.actorId === twin.id)
  ok(twinRows.length === 1 && twinRows[0].actorName === 'Lee Ver' && twinRows[0].summary === 'Updated the pet “Lee Ver”', 'someone else with the same name is untouched')

  // An admin's deletion anonymises the same way.
  await archiveUser(twin.id, { by: owner.id })
  const ghost = await deleteUser(twin.id)
  const after = await db.select().from(t.activityLog).where(eq(t.activityLog.actorId, ghost.id))
  ok(after.length === 1 && after[0].actorName === ghost.label && !after[0].summary.includes('Lee Ver'), 'an admin deletion anonymises too')

  ok(validateTemplate(DEFAULT_TEMPLATES['account-deletion'], 'account-deletion').ok, 'the Account deletion email is valid')
})

await check('confirmed emails: new accounts start unconfirmed and cannot change anything until they confirm (only while the site can send email); the link, an accepted invite or a confirmed change confirm; an admin email change unconfirms', async () => {
  const inbox: EmailMessage[] = []
  const sender = { send: async (message: EmailMessage) => void inbox.push(message) }
  const tokenIn = (message: EmailMessage) => /token=([A-Za-z0-9_-]{43})/.exec(message.text)?.[1] ?? ''
  const verified = async (id: string) => (await listUsers()).find((u) => u.id === id)!.emailVerified

  const { id } = await createUser({ email: 'confirmme@example.test', name: 'Con Firm', password: 'confirm-password-1', role: 'editor' })
  ok(!(await verified(id)), 'a new account starts unconfirmed')
  ok(await needsEmailConfirmation({ emailVerified: false }, true), 'unconfirmed and the site can email: changes wait')
  ok(!(await needsEmailConfirmation({ emailVerified: false }, false)), 'without email the rule is paused (nobody could confirm)')
  ok(!(await needsEmailConfirmation({ emailVerified: true }, true)), 'confirmed: nothing waits')
  ok(!(await needsEmailConfirmation({}, true)), 'sessions without the field count as confirmed')

  // The link: to the current address, once.
  ok(/cannot send email/.test(await userError(requestEmailVerification(id, null))), 'no link without email')
  const asked = await requestEmailVerification(id, sender)
  ok(asked.email === 'confirmme@example.test' && inbox.at(-1)?.to === 'confirmme@example.test' && /Confirm your email/.test(inbox.at(-1)!.subject), 'a "Confirm your email" link to their address')
  const token = tokenIn(inbox.at(-1)!)
  const page = await emailChangeFor(token)
  ok(page?.email === 'confirmme@example.test' && page.isChange === false, 'the page knows it is a confirmation, not a change')
  const done = await confirmEmailChange(token)
  ok(done.from === done.to && (await verified(id)), 'confirmed, same address')
  ok(/expired or was already used/.test(await userError(confirmEmailChange(token))), 'a link works once')
  ok(/already confirmed/.test(await userError(requestEmailVerification(id, sender))), 'nothing to confirm twice')

  // An admin's new address is not confirmed; confirming a change confirms it.
  await updateUser(id, { name: 'Con Firm', email: 'confirm.admin@example.test' }, { canChangeRole: true })
  ok(!(await verified(id)), 'an admin email change unconfirms')
  await requestEmailChange(id, { email: 'confirm.self@example.test', password: 'confirm-password-1' }, sender)
  const changeToken = tokenIn(inbox.find((m) => m.to === 'confirm.self@example.test')!)
  await confirmEmailChange(changeToken)
  ok(await verified(id), 'confirming a change confirms the new address')

  // An accepted invite confirms.
  const invited = await createUser({ email: 'confirm.invite@example.test', name: 'In Vite', role: 'editor', invite: true })
  const invite = await sendInvite(invited.id, 'Ad Min', null)
  await acceptInvite({ token: new URL(invite.url).searchParams.get('token')!, password: 'invited-password-9' })
  ok(await verified(invited.id), 'accepting an invite confirms the address')

  ok(validateTemplate(DEFAULT_TEMPLATES['email-verify'], 'email-verify').ok, 'the Confirm your email email is valid')
  await removeAccount(id)
  await removeAccount(invited.id)
})

await check('sample content: example pets and an About page are added once, never next to real pets, and taken out again', async () => {
  const removed = await removeSampleContent()
  void removed
  const realPets = (await queryPets({ includeUnlisted: true, limit: 1 })).totalDocs
  if (realPets === 0) {
    const added = await addSamplePets()
    ok(added > 0 && (await hasSampleContent()), `added ${added} example pets`)
    ok((await addSamplePets()) === 0, 'running it again adds nothing')
    await addSampleAboutPage()
    ok((await removeSampleContent()) === added && !(await hasSampleContent()), 'all taken out again')
  } else {
    ok((await addSamplePets()) === 0 && !(await hasSampleContent()), 'never next to real pets')
  }
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
