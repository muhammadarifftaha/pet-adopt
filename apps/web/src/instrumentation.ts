// Runs once when the server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // A configuration mistake must stop a production server from starting, not be logged and
  // ignored: otherwise the public pages work, every sign-in fails, and nothing says why. This
  // throws for a weak or missing BETTER_AUTH_SECRET, and loading the module throws for a missing
  // NEXT_PUBLIC_SERVER_URL. (Neither is enforced in development or during `next build`.)
  const { assertAuthConfig } = await import('@/server/auth')
  assertAuthConfig()

  // Creates the first owner from SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (if no user exists yet),
  // so nobody else can claim a brand-new site first.
  try {
    const { ensureOwner } = await import('@/server/users')
    await ensureOwner()
  } catch (error) {
    // Most likely the schema is not there yet (run `pnpm migrate` first on Postgres). Log a short
    // description, never the error object: database errors carry the bound values.
    const { logError } = await import('@/server/result')
    logError(error, 'Could not create the owner account from SEED_ADMIN_EMAIL')
  }

  // The homepage and the Pets page are pages like any other; create them from their built-in layouts if missing.
  try {
    const { ensureSystemPages } = await import('@/server/pages')
    await ensureSystemPages()
  } catch (error) {
    const { logError } = await import('@/server/result')
    logError(error, 'Could not create the system pages')
  }

  // A plugin added since the last `pnpm migrate` (PostgreSQL) has no tables yet: say so now, not on
  // the first request that needs them. Its admin screens show the same notice.
  const { warnAboutPluginStorage } = await import('@/plugins/storage')
  await warnAboutPluginStorage()
}
