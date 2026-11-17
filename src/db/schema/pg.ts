// PostgreSQL schema. The twin of `sqlite.ts`: same tables and column names, Postgres types.
// Keep them in step; `scripts/check-schemas.ts` fails when they drift.
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp as pgTimestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

const id = () => serial('id').primaryKey()
const timestamp = (name: string) => pgTimestamp(name, { mode: 'date', withTimezone: true })
const createdAt = () => timestamp('created_at').notNull().defaultNow()
const updatedAt = () => timestamp('updated_at').notNull().defaultNow()
const flag = (name: string) => boolean(name).notNull().default(false)

// --- Better Auth -------------------------------------------------------------------------

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  role: text('role'),
  banned: boolean('banned').default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),
})

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonated_by'),
  },
  (t) => [index('sessions_userId_idx').on(t.userId)],
)

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index('accounts_userId_idx').on(t.userId)],
)

export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
)

export const rateLimits = pgTable('rate_limits', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
})

// --- Site content ------------------------------------------------------------------------

export const media = pgTable(
  'media',
  {
    id: id(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    width: integer('width'),
    height: integer('height'),
    alt: text('alt').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('media_filename_idx').on(t.filename)],
)

export const pets = pgTable(
  'pets',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: text('status').notNull().default('available'),
    featured: flag('featured'),
    unlisted: flag('unlisted'),
    urgent: flag('urgent'),
    adoptedAt: timestamp('adopted_at'),
    species: text('species').notNull().default('cat'),
    breed: text('breed'),
    sex: text('sex').default('unknown'),
    ageGroup: text('age_group'),
    ageDescription: text('age_description'),
    size: text('size'),
    birthDate: text('birth_date'),
    color: text('color'),
    city: text('city'),
    state: text('state'),
    location: text('location'),
    vaccinated: flag('vaccinated'),
    neutered: flag('neutered'),
    microchipped: flag('microchipped'),
    houseTrained: flag('house_trained'),
    specialNeeds: flag('special_needs'),
    healthNotes: text('health_notes'),
    temperament: jsonb('temperament').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    goodWith: jsonb('good_with').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    description: text('description'),
    videoUrl: text('video_url'),
    adoptionFee: doublePrecision('adoption_fee'),
    rescuedAt: text('rescued_at'),
    contactWhatsApp: text('contact_whatsapp'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    seoImageId: integer('seo_image_id').references(() => media.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('pets_slug_idx').on(t.slug),
    index('pets_status_idx').on(t.status),
    index('pets_species_idx').on(t.species),
    index('pets_featured_idx').on(t.featured),
    index('pets_city_idx').on(t.city),
    index('pets_state_idx').on(t.state),
    index('pets_status_created_idx').on(t.status, t.createdAt),
  ],
)

export const petPhotos = pgTable(
  'pet_photos',
  {
    petId: integer('pet_id')
      .notNull()
      .references(() => pets.id, { onDelete: 'cascade' }),
    mediaId: integer('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.petId, t.position] }), index('pet_photos_media_idx').on(t.mediaId)],
)

export const pages = pgTable(
  'pages',
  {
    id: id(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    status: text('status').notNull().default('draft'),
    puckDraft: jsonb('puck_draft'),
    puckPublished: jsonb('puck_published'),
    seoDescription: text('seo_description'),
    seoImageId: integer('seo_image_id').references(() => media.id, { onDelete: 'set null' }),
    publishedAt: timestamp('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('pages_slug_idx').on(t.slug), index('pages_seo_image_idx').on(t.seoImageId)],
)

export const siteSettings = pgTable('site_settings', {
  id: integer('id').primaryKey(),
  siteName: text('site_name').notNull().default('Pet Adopt'),
  tagline: text('tagline').default('Find your new best friend'),
  logoId: integer('logo_id').references(() => media.id, { onDelete: 'set null' }),
  primaryColor: text('primary_color'),
  theme: text('theme').notNull().default('sunrise'),
  allowModeToggle: boolean('allow_mode_toggle').notNull().default(true),
  customize: flag('customize'),
  customTheme: jsonb('custom_theme'),
  whatsappNumber: text('whatsapp_number'),
  whatsappMessage: text('whatsapp_message').default("Hi! I'm interested in adopting {pet}."),
  address: text('address'),
  openingHours: text('opening_hours'),
  socials: jsonb('socials').$type<Array<{ platform: string; url: string }>>().notNull().default(sql`'[]'::jsonb`),
  nav: jsonb('nav').$type<Array<{ label: string; href: string }>>().notNull().default(sql`'[]'::jsonb`),
  footerText: text('footer_text'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})
