// Runs once when the server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // A configuration mistake must stop a production server from starting, not be logged and
  // ignored: otherwise the public pages work, every sign-in fails, and nothing says why. This
  // throws for a weak or missing BETTER_AUTH_SECRET, and loading the module throws for a missing
  // NEXT_PUBLIC_SERVER_URL. (Neither is enforced in development or during `next build`.)
  const { assertAuthConfig } = await import('@/server/auth')
  assertAuthConfig()

  // Uploads live only in S3-compatible storage. Production refuses to start with missing or
  // malformed S3_* settings; development says so once and keeps going (pages work, images 502).
  {
    const { s3Settings } = await import('@/server/storage')
    try {
      s3Settings()
    } catch (error) {
      // `next build` never touches uploads, so it must not need the bucket settings.
      if (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build') throw error
      console.warn(`Upload storage is not set up: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

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

  // Search text is folded in JavaScript, so rows saved before migration 0011 are filled here.
  try {
    const { backfillSearchText } = await import('@/server/search-text')
    await backfillSearchText()
  } catch (error) {
    const { logError } = await import('@/server/result')
    logError(error, 'Could not fill the search text of older pets and images')
  }

  // The homepage and the Pets page are pages like any other; create them from their built-in layouts if missing.
  try {
    const { ensureSystemPages } = await import('@/server/pages')
    await ensureSystemPages()
  } catch (error) {
    const { logError } = await import('@/server/result')
    logError(error, 'Could not create the system pages')
  }

  // Activity log entries older than ACTIVITY_LOG_DAYS (default 365). Never throws; it runs again at
  // most hourly while someone reads the log.
  const { purgeOldActivitySometimes } = await import('@/server/activity')
  await purgeOldActivitySometimes()
  // Accounts whose owners asked to delete them, once their 30 days are over.
  const { purgeDueDeletionsSometimes } = await import('@/server/users')
  await purgeDueDeletionsSometimes()

  // Plugins' default email templates (Email > Templates), created if missing. Never throws.
  const { ensurePluginTemplates } = await import('@/server/email-templates')
  await ensurePluginTemplates()

  // A plugin added since the last `pnpm migrate` (PostgreSQL) has no tables yet: say so now, not on
  // the first request that needs them. Its admin screens show the same notice.
  await import('@/plugins/host') // the services plugins reach through `host()`
  const { warnAboutPluginStorage } = await import('@/plugins/storage')
  await warnAboutPluginStorage()
}
