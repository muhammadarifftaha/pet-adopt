import type { Payload } from 'payload'

const MIN_PASSWORD_LENGTH = 12

/**
 * Creates the first owner account from SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD.
 *
 * It only acts while the users collection is empty, so it never resets a password or
 * brings back an account that was deleted on purpose. Running it on boot also closes the
 * window where anyone who reaches a brand-new deployment could claim /admin first.
 */
export async function ensureOwner(payload: Payload): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim()
  const password = process.env.SEED_ADMIN_PASSWORD
  if (!email || !password) return
  // `next build` initialises Payload too, usually without a database. Nothing to do there.
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  if (process.env.NODE_ENV === 'production' && password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters in production.`)
  }

  try {
    const { totalDocs } = await payload.count({ collection: 'users' })
    if (totalDocs > 0) return
    await payload.create({ collection: 'users', data: { email, password } })
    payload.logger.info(`Created owner account ${email}`)
  } catch (error) {
    // Most likely the schema is not there yet (run `pnpm migrate` first on Postgres).
    payload.logger.error(
      { err: error },
      'Could not create the owner account from SEED_ADMIN_EMAIL. Has the database schema been created?',
    )
  }
}
