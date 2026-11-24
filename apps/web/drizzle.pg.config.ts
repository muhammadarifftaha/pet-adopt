import { defineConfig } from 'drizzle-kit'

// Generates Postgres migrations into ./drizzle/pg. Generating needs no database connection.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/pg.ts',
  out: './drizzle/pg',
})
