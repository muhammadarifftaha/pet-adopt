/**
 * Sets a new password for an account, signs that account out everywhere, and lifts any sign-in
 * lockout on its email. For the day an owner is locked out or has forgotten their password and no
 * other admin can reset it from the admin.
 *
 *   NEW_PASSWORD='a-long-password' pnpm admin:reset-password owner@example.com
 *
 * It talks to the database in your .env directly, so run it where the site's DATABASE_URL works.
 * The password comes from the environment (not an argument) so it stays out of the process list.
 */
export {} // makes this file a module, so top-level await is allowed

const email = process.argv[2]?.trim().toLowerCase()
const password = process.env.NEW_PASSWORD

if (!email || !password) {
  console.error("Usage: NEW_PASSWORD='a-long-password' pnpm admin:reset-password owner@example.com")
  process.exit(1)
}

const { eq } = await import('drizzle-orm')
const { closeDatabase, getDatabase } = await import('../src/db/client')
const { clearLockoutsFor } = await import('../src/server/throttle')
const { resetPassword } = await import('../src/server/users')
const { describeError, ValidationError, UserError } = await import('../src/server/result')

try {
  const { db, t } = await getDatabase()
  const [user] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, email)).limit(1)
  if (!user) {
    console.error('No account has that email.')
    process.exit(1)
  }
  await resetPassword(user.id, { password })
  await clearLockoutsFor(email)
  console.log('Password reset. That account is signed out everywhere and any lockout is lifted.')
  await closeDatabase()
  process.exit(0)
} catch (error) {
  if (error instanceof ValidationError) console.error(Object.values(error.fieldErrors).join(' '))
  else if (error instanceof UserError) console.error(error.message)
  // Never the error object: a failed query carries its parameters (the new password hash).
  else console.error(`Could not reset the password: ${describeError(error)}`)
  process.exit(1)
}
