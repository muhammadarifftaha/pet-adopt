// Runs once when the server starts. Creates the first owner from SEED_ADMIN_EMAIL and
// SEED_ADMIN_PASSWORD (if no user exists yet), so nobody else can claim a brand-new site first.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { ensureOwner } = await import('@/server/users')
    await ensureOwner()
  } catch (error) {
    // Most likely the schema is not there yet (run `pnpm migrate` first on Postgres). Log a short
    // description, never the error object: database errors carry the bound values.
    const { logError } = await import('@/server/result')
    logError(error, 'Could not create the owner account from SEED_ADMIN_EMAIL')
  }
}
