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

// Relative, not '@/': drizzle-kit loads this file without the app's path aliases.
import { PET_STATUS_VALUES, PetStatus } from '../../lib/options'
import type { RichTextDoc } from '../../lib/rich-text'

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
    /** A display name chosen at upload (null for older images). The stored file keeps its random name. */
    name: text('name'),
    /** Name and description folded for search (foldText); filled on save, backfilled on start. */
    searchText: text('search_text'),
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
    /** Name, breed and location folded for the admin search (foldText); filled on save, backfilled on start. */
    searchText: text('search_text'),
    /** Location folded for the catalog's location filter. */
    locationSearch: text('location_search'),
    vaccinated: flag('vaccinated'),
    neutered: flag('neutered'),
    microchipped: flag('microchipped'),
    houseTrained: flag('house_trained'),
    specialNeeds: flag('special_needs'),
    // Legacy plain text. Never written any more; `healthNotesDoc` replaces it. Old rows are turned into
    // a document when read, and the next save writes the document and clears this column.
    healthNotes: text('health_notes'),
    // The health notes as a rich-text JSON document (src/lib/rich-text.ts).
    healthNotesDoc: jsonb('health_notes_doc').$type<RichTextDoc>(),
    temperament: jsonb('temperament').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    goodWith: jsonb('good_with').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    // Legacy plain text, like `healthNotes` above: read as a document when `descriptionDoc` is empty,
    // never written any more.
    description: text('description'),
    // The description as a rich-text JSON document (src/lib/rich-text.ts).
    descriptionDoc: jsonb('description_doc').$type<RichTextDoc>(),
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
    // Settings (title, address, SEO) saved but not published yet, for a live page; null when there are
    // none. Publishing copies them into the columns above. See PageDetails in src/server/pages.ts.
    detailsDraft: jsonb('details_draft'),
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
export const pageVersions = pgTable(
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
    data: jsonb('data').notNull(),
    // Who saved it last (an open version is saved many times).
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    // The version whose layout was copied in with "Use as draft", if any.
    restoredFrom: integer('restored_from'),
    // The page's settings in this version (title, address, SEO); null in versions saved before they
    // were kept, which then restore the layout only.
    details: jsonb('details'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('page_versions_page_number_idx').on(t.pageId, t.number)],
)

// Owners' own themes: a built-in preset (`base`) with their customisations laid over it. `settings`
// has the shape of ThemeSettings['customTheme'] (fonts, text size, corners, buttons, shadows,
// spacing, and light / dark colours). Which one is in use is site_settings.active_theme_id.
export const themes = pgTable('themes', {
  id: id(),
  name: text('name').notNull(),
  base: text('base').notNull().default('sunrise'),
  settings: jsonb('settings').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const siteSettings = pgTable('site_settings', {
  id: integer('id').primaryKey(),
  siteName: text('site_name').notNull().default('Pet Adopt'),
  tagline: text('tagline').default('Find your new best friend'),
  logoId: integer('logo_id').references(() => media.id, { onDelete: 'set null' }),
  faviconId: integer('favicon_id').references(() => media.id, { onDelete: 'set null' }),
  primaryColor: text('primary_color'),
  theme: text('theme').notNull().default('sunrise'),
  allowModeToggle: boolean('allow_mode_toggle').notNull().default(true),
  customize: flag('customize'),
  customTheme: jsonb('custom_theme'),
  // The owner's saved theme in use (themes.id), or null for the preset in `theme`.
  activeThemeId: integer('active_theme_id').references(() => themes.id, { onDelete: 'set null' }),
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

// --- Plugins -----------------------------------------------------------------------------

// Which of each plugin's own migrations have run (src/db/plugin-migrations.ts). A plugin's tables are
// not in this file: the plugin declares them and ships the SQL, and `pnpm migrate` applies it.
// `checksum` is the sha256 of the SQL that ran, so a migration edited after it ran is refused.
export const pluginMigrations = pgTable(
  'plugin_migrations',
  {
    plugin: text('plugin').notNull(),
    migration: text('migration').notNull(),
    checksum: text('checksum').notNull(),
    appliedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.plugin, t.migration] })],
)
