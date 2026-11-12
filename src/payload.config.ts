import { postgresAdapter } from '@payloadcms/db-postgres'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import path from 'path'
import { buildConfig } from 'payload'
import type { Plugin } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { Media } from './collections/Media'
import { Pages } from './collections/Pages'
import { Pets } from './collections/Pets'
import { Users } from './collections/Users'
import { SiteSettings } from './globals/SiteSettings'
import { ensureOwner } from './lib/ensureOwner'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// Runtime-only requirements are enforced when the server runs in production. `next build`
// also loads this file (often in CI, with no secrets), so it is exempt.
const enforce = process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build'

// Only used when PAYLOAD_SECRET is empty during local development.
const DEV_SECRET = 'insecure-development-secret-do-not-deploy'

function resolveSecret(): string {
  const secret = process.env.PAYLOAD_SECRET ?? ''
  if (enforce && (secret.length < 32 || secret === 'change-me')) {
    throw new Error('PAYLOAD_SECRET must be a random string of at least 32 characters. Generate one with: openssl rand -hex 32')
  }
  return secret || DEV_SECRET
}

// Public URL of the site. Browsers may only send cookie-authenticated requests from here.
const siteURL = (process.env.NEXT_PUBLIC_SERVER_URL ?? '').trim().replace(/\/+$/, '')
if (enforce && !siteURL) {
  throw new Error('NEXT_PUBLIC_SERVER_URL must be set in production, for example https://adopt.example.com')
}
const allowedOrigins = siteURL ? [siteURL] : []

// DATABASE_URL picks the database:
//   postgres://...      -> PostgreSQL (production)
//   file:./pet-adopt.db -> SQLite (zero-setup local development)
const databaseURL = process.env.DATABASE_URL || 'file:./pet-adopt.db'
const usePostgres = /^postgres(ql)?:\/\//.test(databaseURL)

// Optional S3-compatible storage (AWS S3, Cloudflare R2, MinIO...) for uploads.
// Without it, uploads are written to ./media, which suits a VPS or Docker volume.
const plugins: Plugin[] = []
if (process.env.S3_BUCKET) {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY
  if (enforce && (!accessKeyId || !secretAccessKey)) {
    throw new Error('S3_BUCKET is set, so S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required too.')
  }
  plugins.push(
    s3Storage({
      collections: { media: true },
      bucket: process.env.S3_BUCKET,
      config: {
        credentials: {
          accessKeyId: accessKeyId || '',
          secretAccessKey: secretAccessKey || '',
        },
        region: process.env.S3_REGION || 'auto',
        endpoint: process.env.S3_ENDPOINT || undefined,
        forcePathStyle: Boolean(process.env.S3_ENDPOINT),
      },
    }),
  )
}

// Migrations are per database. SQLite (local development) pushes its schema automatically.
// PostgreSQL never does: create migrations with `npm run migrate:create` and apply them
// with `npm run migrate` before starting the server.
const migrationDir = path.resolve(dirname, 'migrations')

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    meta: {
      titleSuffix: ' - Pet Adopt',
    },
  },
  collections: [Pets, Pages, Media, Users],
  globals: [SiteSettings],
  editor: lexicalEditor(),
  secret: resolveSecret(),
  csrf: allowedOrigins,
  cors: allowedOrigins,
  // The site does not use GraphQL, so keep that attack surface switched off.
  graphQL: { disable: true },
  // Public REST requests may not ask for deeply nested relationships.
  maxDepth: 3,
  // Reject oversized uploads (10 MB) before they are buffered.
  upload: { limits: { fileSize: 10_000_000 } },
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: usePostgres
    ? postgresAdapter({
        migrationDir,
        push: false,
        pool: {
          connectionString: databaseURL,
          max: Number(process.env.DB_POOL_MAX) || 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 10_000,
        },
      })
    : sqliteAdapter({ migrationDir, client: { url: databaseURL } }),
  sharp,
  plugins,
  // Creates the first owner from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD when no user exists.
  onInit: async (payload) => {
    await ensureOwner(payload)
  },
})
