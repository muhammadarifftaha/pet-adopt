import { defineConfig } from 'drizzle-kit'

// Generates SQLite migrations into ./drizzle/sqlite (`pnpm db:generate` runs this and the Postgres twin).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema/sqlite.ts',
  out: './drizzle/sqlite',
})
