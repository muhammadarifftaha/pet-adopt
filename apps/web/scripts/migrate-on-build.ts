/**
 * The first half of `pnpm build` (apps/web's build script runs it, then `next build`), so a deploy's
 * database is migrated before the new code goes live. It is part of the app's own build script, not
 * a separate turbo task, so it runs however the build is started: `pnpm build` at the root, turbo,
 * or a host that builds apps/web directly.
 *
 *   PostgreSQL, hosted libSQL (Turso)  migrates, exactly like `pnpm migrate`. A failure fails the
 *                                      build, so code never ships against an older schema.
 *   a local SQLite file                skipped: it migrates itself when the server opens it, and a
 *                                      build must never create the database file.
 *   a Vercel preview build             skipped (VERCEL_ENV is not "production"): a preview usually
 *                                      shares the production DATABASE_URL, and a branch must not
 *                                      change that schema before it is merged. MIGRATE_ON_PREVIEW=1
 *                                      runs them anyway, for previews with a database of their own.
 *   SKIP_BUILD_MIGRATE=1               skipped: for builds that cannot reach the database (a
 *                                      Docker image built without it). Run `pnpm migrate` before
 *                                      starting the server then.
 *
 * turbo.json does not cache `build`: a cache hit would skip this step.
 */
import { isRemoteSqlite, resolveDatabaseUrl } from '../src/db/client'
import { describeError } from '../src/server/result'

const flag = (name: string) => ['1', 'true'].includes(process.env[name]?.trim().toLowerCase() ?? '')

if (flag('SKIP_BUILD_MIGRATE')) {
  console.log('Build: SKIP_BUILD_MIGRATE is set, so migrations are not run. Run `pnpm migrate` before starting the server.')
  process.exit(0)
}

const vercelEnv = process.env.VERCEL_ENV
if (vercelEnv && vercelEnv !== 'production' && !flag('MIGRATE_ON_PREVIEW')) {
  console.log(`Build: a Vercel ${vercelEnv} build, so migrations are not run (set MIGRATE_ON_PREVIEW=1 if it has its own database).`)
  process.exit(0)
}

const { dialect, url } = resolveDatabaseUrl()
const remote = dialect === 'pg' || isRemoteSqlite(url)
if (!remote) {
  console.log('Build: the database is a local SQLite file, which migrates itself when the server opens it. Nothing to do.')
  process.exit(0)
}

console.log(`Build: migrating the ${dialect === 'pg' ? 'PostgreSQL' : 'hosted libSQL'} database before building.`)
const { migrateAll } = await import('./migrate-all')
try {
  await migrateAll()
  process.exit(0)
} catch (error) {
  // Never the error object: database errors carry the bound values, and build logs are often shared.
  console.error(`Migration failed: ${describeError(error)}`)
  console.error(
    '\nThe build stops here so the new code is not deployed against an older schema. Check DATABASE_URL and that the ' +
      'build can reach the database, or set SKIP_BUILD_MIGRATE=1 and run `pnpm migrate` before starting the server.',
  )
  process.exit(1)
}
