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
// two-factor plugin, plus our own `role` and `archived_at` on users; regenerate and compare if you
// upgrade Better Auth or add a plugin.
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
  // Ours, not a plugin's: declared to Better Auth as additional fields in src/server/auth.ts.
  role: text('role'),
  // Better Auth's two-factor plugin: true once an authenticator app is set up and confirmed.
  twoFactorEnabled: integer('two_factor_enabled', { mode: 'boolean' }).default(false),
  // Set when an admin archives the account (src/server/users.ts): it cannot sign in, keeps its name
  // on what it made, and can be restored, or then deleted.
  archivedAt: timestamp('archived_at'),
  // Set when the person asked to delete their own account: archived now, deleted for good after this
  // (src/server/users.ts, purgeDueDeletions). An admin's restore clears it.
  deleteAfter: timestamp('delete_after'),
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
    // How this session signed in: 'password' (with the code when two-factor is on) or
    // 'provider:<id>' (a sign-in provider, which counts as two-factor; src/server/auth.ts).
    signInMethod: text('sign_in_method'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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

// Better Auth's two-factor plugin: one row per account that has started setting up an authenticator
// app. `secret` and `backup_codes` are encrypted by Better Auth with BETTER_AUTH_SECRET; `verified`
// is false until the first code is confirmed. The failure count and lock are its account lockout
// (10 wrong codes in a row lock the second step for 15 minutes).
export const twoFactors = sqliteTable(
  'two_factors',
  {
    id: text('id').primaryKey(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    verified: integer('verified', { mode: 'boolean' }).default(true),
    failedVerificationCount: integer('failed_verification_count').default(0),
    lockedUntil: timestamp('locked_until'),
  },
  (t) => [index('two_factors_secret_idx').on(t.secret), uniqueIndex('two_factors_user_id_unique').on(t.userId)],
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
    /** A display name chosen at upload (null for older images). The stored file keeps its random name. */
    name: text('name'),
    /** Name and description folded for search (foldText); filled on save, backfilled on start. */
    searchText: text('search_text'),
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
    // ISO 3166-1 alpha-2 ("MY"). Null on pets saved before the column: read as the site's country.
    country: text('country'),
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
    healthNotesDoc: text('health_notes_doc', { mode: 'json' }).$type<RichTextDoc>(),
    temperament: text('temperament', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    goodWith: text('good_with', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    // Personality notes, a rich-text JSON document like the health notes (no legacy text column).
    personalityNotesDoc: text('personality_notes_doc', { mode: 'json' }).$type<RichTextDoc>(),
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
    // Settings (title, address, SEO) saved but not published yet, for a live page; null when there are
    // none. Publishing copies them into the columns above. See PageDetails in src/server/pages.ts.
    detailsDraft: text('details_draft', { mode: 'json' }),
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
    // The page's settings in this version (title, address, SEO); null in versions saved before they
    // were kept, which then restore the layout only.
    details: text('details', { mode: 'json' }),
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
  // The page holding the privacy policy (Site settings > Navigation). While it is live, the footer
  // and every form link to it, and the form builder stops warning about it.
  privacyPageId: integer('privacy_page_id').references(() => pages.id, { onDelete: 'set null', onUpdate: 'cascade' }),
  // Where the site is: the country (ISO 3166-1 alpha-2) the pet form suggests cities and states
  // for, and the time zone (IANA name) the admin shows times in. Null: the default country, and each
  // person's own device time.
  country: text('country'),
  timeZone: text('time_zone'),
  // First-time setup (src/server/setup.ts): the setup link's key, sealed, while no account exists;
  // and when the guided setup was finished or skipped.
  setupKeyEncrypted: text('setup_key_encrypted'),
  setupDoneAt: timestamp('setup_done_at'),
  // Roles that must use two-factor sign-in (src/server/two-factor.ts); set on the Users screen.
  twoFactorRoles: text('two_factor_roles', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// --- Plugins -----------------------------------------------------------------------------

// Which of each plugin's own migrations have run (src/db/plugin-migrations.ts). A plugin's tables are
// not in this file: the plugin declares them and ships the SQL, and `pnpm migrate` applies it.
// `checksum` is the sha256 of the SQL that ran, so a migration edited after it ran is refused.
export const pluginMigrations = sqliteTable(
  'plugin_migrations',
  {
    plugin: text('plugin').notNull(),
    migration: text('migration').notNull(),
    checksum: text('checksum').notNull(),
    appliedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.plugin, t.migration] })],
)

// --- Email -------------------------------------------------------------------------------

// Sign-in providers (OAuth 2 / OpenID Connect) admins add on Authentication > Sign-in providers
// (src/server/auth-providers.ts). `slug` is the provider's id in Better Auth and in the callback
// address (/api/auth/callback/<slug>), fixed once created. The client secret is only stored
// encrypted (src/server/secret-box.ts). People connect a provider to their own account first
// (Better Auth's `accounts` rows, providerId = slug); a provider never creates accounts.
export const authProviders = sqliteTable('auth_providers', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  // 'oidc' (discovery URL) or 'oauth2' (the three endpoints by hand).
  kind: text('kind').notNull(),
  discoveryUrl: text('discovery_url'),
  authorizationUrl: text('authorization_url'),
  tokenUrl: text('token_url'),
  userInfoUrl: text('user_info_url'),
  clientId: text('client_id').notNull(),
  clientSecretEncrypted: text('client_secret_encrypted'),
  // Space-separated.
  scopes: text('scopes').notNull(),
  enabled: flag('enabled'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// The built-in SMTP sender's settings (src/server/email.ts), one row (id 1), edited in
// Email > Sending. SMTP_* / EMAIL_* environment variables override single fields. The password is
// only stored encrypted (AES-256-GCM, key derived from BETTER_AUTH_SECRET; src/server/secret-box.ts)
// and never sent back to a browser.
export const emailSettings = sqliteTable('email_settings', {
  id: integer('id').primaryKey(),
  host: text('host'),
  port: integer('port'),
  // 'tls' (implicit TLS, usually 465), 'starttls' (usually 587) or 'none' (unencrypted, local test servers).
  security: text('security').notNull().default('starttls'),
  username: text('username'),
  passwordEncrypted: text('password_encrypted'),
  fromName: text('from_name'),
  fromAddress: text('from_address'),
  replyTo: text('reply_to'),
  updatedAt: updatedAt(),
})

// Email templates people build (src/server/email-templates.ts, the email builder at /edit/email/<id>).
// `purpose` decides which placeholders a template may use and which email it can be used for; at
// most one template per purpose is the default (checked in the app, under a lock). `data` is the
// builder's layout, rebuilt from allowed blocks on save (src/lib/email-template.ts).
export const emailTemplates = sqliteTable('email_templates', {
  id: id(),
  name: text('name').notNull(),
  purpose: text('purpose').notNull(),
  data: text('data', { mode: 'json' }).notNull(),
  isDefault: flag('is_default'),
  // A template a plugin ships (`<plugin>:<key>`, e.g. form-builder:notification): seeded at start,
  // editable, never deleted, and what that plugin's emails use when nothing else is picked.
  seedKey: text('seed_key').unique(),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// --- Activity log ------------------------------------------------------------------------

// Who did what, and when (src/server/activity.ts). Append-only: nothing in the app edits a row, and
// rows older than ACTIVITY_LOG_DAYS (default 365) are purged. No foreign keys on purpose: an entry
// outlives the account and the item it is about, so their names are copied in when it is written.
// `fields` lists which fields changed, never their values, so the log holds no personal data.
export const activityLog = sqliteTable(
  'activity_log',
  {
    id: id(),
    at: timestamp('at').notNull().default(nowMs),
    // Who did it; null for a failed sign-in (nobody signed in).
    actorId: text('actor_id'),
    actorName: text('actor_name'),
    actorRole: text('actor_role'),
    // `pet.update`, `auth.sign-in-failed`, `form-builder.form.update`...; `area` groups them.
    action: text('action').notNull(),
    area: text('area').notNull(),
    summary: text('summary').notNull(),
    subjectId: text('subject_id'),
    subjectLabel: text('subject_label'),
    fields: text('fields', { mode: 'json' }).$type<string[]>(),
    // The client address (an IPv6 address cut to its /64), when the proxy reports one.
    client: text('client'),
  },
  (t) => [index('activity_log_at_idx').on(t.at), index('activity_log_actor_at_idx').on(t.actorId, t.at), index('activity_log_area_at_idx').on(t.area, t.at)],
)
