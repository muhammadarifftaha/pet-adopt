// SQLite schema. `pg.ts` next to this file is its twin: same tables, same column names, with the
// Postgres column types. Keep them in step; `scripts/check-schemas.ts` fails when they drift.
//
// Portable choices (so one set of repositories works on both databases):
//  - ids are integers, timestamps are Date objects, booleans are booleans;
//  - lists and nested settings are JSON columns (text on SQLite, jsonb on Postgres);
//  - "date only" values (birth date, rescue date) are YYYY-MM-DD text;
//  - select options are plain text, validated in the app (src/lib/options.ts).
//
// The first five tables belong to Better Auth (src/server/auth.ts). They match what
// `npx @better-auth/cli generate` produces for the Drizzle adapter with `usePlural` and the
// admin plugin; regenerate and compare if you upgrade Better Auth or add a plugin.
import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Relative, not '@/': drizzle-kit loads this file without the app's path aliases.
import { PET_STATUS_VALUES, PetStatus } from '../../lib/options'
import type { RichTextDoc } from '../../lib/rich-text'

const id = () => integer('id').primaryKey({ autoIncrement: true })
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' })
const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`
const createdAt = () => timestamp('created_at').notNull().default(nowMs)
const updatedAt = () => timestamp('updated_at').notNull().default(nowMs)
const flag = (name: string) => integer(name, { mode: 'boolean' }).notNull().default(false)

// --- Better Auth -------------------------------------------------------------------------

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).default(false).notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').default(nowMs).notNull(),
  updatedAt: timestamp('updated_at')
    .default(nowMs)
    .$onUpdate(() => new Date())
    .notNull(),
  role: text('role'),
  banned: integer('banned', { mode: 'boolean' }).default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),
})

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').default(nowMs).notNull(),
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

export const accounts = sqliteTable(
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
    createdAt: timestamp('created_at').default(nowMs).notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index('accounts_userId_idx').on(t.userId)],
)

export const verifications = sqliteTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').default(nowMs).notNull(),
    updatedAt: timestamp('updated_at')
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
)

export const rateLimits = sqliteTable('rate_limits', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: integer('last_request').notNull(),
})

// --- Site content ------------------------------------------------------------------------

export const media = sqliteTable(
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

export const pets = sqliteTable(
  'pets',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    // Still plain text in the database; `enum` only types the column as PetStatus (no CHECK, no migration).
    status: text('status', { enum: PET_STATUS_VALUES }).notNull().default(PetStatus.Available),
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
    // True when the birth date came from "about 8 months old" rather than a known date.
    birthDateEstimated: flag('birth_date_estimated'),
    color: text('color'),
    city: text('city'),
    state: text('state'),
    location: text('location'),
    vaccinated: flag('vaccinated'),
    neutered: flag('neutered'),
    microchipped: flag('microchipped'),
    houseTrained: flag('house_trained'),
    specialNeeds: flag('special_needs'),
    // Legacy plain text. Never written any more; `healthNotesDoc` replaces it. Old rows are turned into
    // a document when read, and the next save writes the document and clears this column.
    healthNotes: text('health_notes'),
    // The health notes as a rich-text JSON document (src/lib/rich-text.ts).
    healthNotesDoc: text('health_notes_doc', { mode: 'json' }).$type<RichTextDoc>(),
    temperament: text('temperament', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    goodWith: text('good_with', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    // Legacy plain text, like `healthNotes` above: read as a document when `descriptionDoc` is empty,
    // never written any more.
    description: text('description'),
    // The description as a rich-text JSON document (src/lib/rich-text.ts).
    descriptionDoc: text('description_doc', { mode: 'json' }).$type<RichTextDoc>(),
    videoUrl: text('video_url'),
    adoptionFee: real('adoption_fee'),
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
    // The catalog filters on status and sorts newest first.
    index('pets_status_created_idx').on(t.status, t.createdAt),
  ],
)

export const petPhotos = sqliteTable(
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

export const pages = sqliteTable(
  'pages',
  {
    id: id(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    status: text('status').notNull().default('draft'),
    // Puck's layout JSON. `puckDraft` is what the editor works on; `puckPublished` is what visitors see.
    puckDraft: text('puck_draft', { mode: 'json' }),
    puckPublished: text('puck_published', { mode: 'json' }),
    seoDescription: text('seo_description'),
    seoImageId: integer('seo_image_id').references(() => media.id, { onDelete: 'set null' }),
    publishedAt: timestamp('published_at'),
    // Set while the page is archived: off the site and read-only, but kept (with its address) until
    // it is restored or deleted. Only an archived page can be deleted.
    archivedAt: timestamp('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('pages_slug_idx').on(t.slug), index('pages_seo_image_idx').on(t.seoImageId)],
)

// A page's history, one version per publish cycle (the latest 50 per page are kept). Version N
// collects every draft save after publish N-1 and is closed by the next publish: `kind` is 'draft'
// while it is open (at most one, always the newest) and 'published' once closed. `number` counts
// up per page.
export const pageVersions = sqliteTable(
  'page_versions',
  {
    id: id(),
    pageId: integer('page_id')
      .notNull()
      // onUpdate: a page's history follows it when its id changes (the homepage is moved to id 1).
      .references(() => pages.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    number: integer('number').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
    // Who saved it last (an open version is saved many times).
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    // The version whose layout was copied in with "Use as draft", if any.
    restoredFrom: integer('restored_from'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('page_versions_page_number_idx').on(t.pageId, t.number)],
)

// Owners' own themes: a built-in preset (`base`) with their customisations laid over it. `settings`
// has the shape of ThemeSettings['customTheme'] (fonts, text size, corners, buttons, shadows,
// spacing, and light / dark colours). Which one is in use is site_settings.active_theme_id.
export const themes = sqliteTable('themes', {
  id: id(),
  name: text('name').notNull(),
  base: text('base').notNull().default('sunrise'),
  settings: text('settings', { mode: 'json' }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// One row (id = 1) holds the whole site configuration.
export const siteSettings = sqliteTable('site_settings', {
  id: integer('id').primaryKey(),
  siteName: text('site_name').notNull().default('Pet Adopt'),
  tagline: text('tagline').default('Find your new best friend'),
  logoId: integer('logo_id').references(() => media.id, { onDelete: 'set null' }),
  faviconId: integer('favicon_id').references(() => media.id, { onDelete: 'set null' }),
  primaryColor: text('primary_color'),
  theme: text('theme').notNull().default('sunrise'),
  allowModeToggle: integer('allow_mode_toggle', { mode: 'boolean' }).notNull().default(true),
  customize: flag('customize'),
  customTheme: text('custom_theme', { mode: 'json' }),
  // The owner's saved theme in use (themes.id), or null for the preset in `theme`.
  activeThemeId: integer('active_theme_id').references(() => themes.id, { onDelete: 'set null' }),
  whatsappNumber: text('whatsapp_number'),
  whatsappMessage: text('whatsapp_message').default("Hi! I'm interested in adopting {pet}."),
  address: text('address'),
  openingHours: text('opening_hours'),
  socials: text('socials', { mode: 'json' }).$type<Array<{ platform: string; url: string }>>().notNull().default(sql`'[]'`),
  nav: text('nav', { mode: 'json' }).$type<Array<{ label: string; href: string }>>().notNull().default(sql`'[]'`),
  footerText: text('footer_text'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})
