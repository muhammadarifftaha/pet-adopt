/**
 * Turns off two-factor sign-in for an account: removes its authenticator secret, backup codes and
 * trusted browsers. For the day an owner lost their phone and their backup codes and no other admin
 * can turn it off from the Users screen (the last admin, say).
 *
 *   pnpm admin:reset-2fa owner@example.com
 *
 * It talks to the database in your .env directly, so run it where the site's DATABASE_URL works.
 * Their password stays the same. If their role must use two-factor, they set it up again at once.
 */
export {} // makes this file a module, so top-level await is allowed

const email = process.argv[2]?.trim().toLowerCase()

if (!email) {
  console.error('Usage: pnpm admin:reset-2fa owner@example.com')
  process.exit(1)
}

const { eq } = await import('drizzle-orm')
const { closeDatabase, getDatabase } = await import('../src/db/client')
const { quoted, recordActivity } = await import('../src/server/activity')
const { resetTwoFactor } = await import('../src/server/two-factor')
const { describeError } = await import('../src/server/result')

try {
  const { db, t } = await getDatabase()
  const [user] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, email)).limit(1)
  if (!user) {
    console.error('No account has that email.')
    process.exit(1)
  }
  const reset = await resetTwoFactor(user.id)
  if (reset.wasEnabled) {
    await recordActivity({
      actor: null,
      action: 'user.two-factor-reset',
      area: 'users',
      // quoted(): the form anonymiseActivity looks for, so the name is replaced if the account is deleted.
      summary: `Turned off two-factor sign-in for ${quoted(reset.name)} from the command line`,
      subject: { id: reset.id, label: reset.name },
      client: null,
    })
    console.log('Two-factor sign-in is off for that account. Their password still works; they can set it up again on their Account page.')
  } else {
    console.log('Two-factor sign-in was not on for that account. Nothing changed.')
  }
  await closeDatabase()
  process.exit(0)
} catch (error) {
  console.error(`Could not reset two-factor: ${describeError(error)}`)
  process.exit(1)
}
