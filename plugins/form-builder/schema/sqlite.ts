// The form builder's tables on SQLite. `pg.ts` next to this file is its twin (the registry checks
// they match). Every name starts with "plugin_form_builder_", as the plugin system requires.
// After changing either file: `pnpm plugin:generate plugins/form-builder <change_name>`.
//
// Relative imports only: drizzle-kit loads this file without the app's path aliases.
import { sql } from 'drizzle-orm'
import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { FormAnswer, FormField, FormSettings } from '../src/fields'

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`

export const forms = sqliteTable('plugin_form_builder_forms', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** Shown above the form. Plain text; line breaks kept. */
  description: text('description'),
  fields: text('fields', { mode: 'json' }).$type<FormField[]>().notNull().default(sql`'[]'`),
  settings: text('settings', { mode: 'json' }).$type<FormSettings>().notNull().default(sql`'{}'`),
  /** Accepting responses. A closed form still shows on the site, with a "closed" note. */
  isOpen: integer('is_open', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
})

export const responses = sqliteTable(
  'plugin_form_builder_responses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    formId: integer('form_id').notNull(),
    /** A snapshot: each answer carries the label and type it was given under. */
    answers: text('answers', { mode: 'json' }).$type<FormAnswer[]>().notNull(),
    /** When someone in the admin first opened it; null while new. */
    readAt: integer('read_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (t) => [
    // Named here: the generated name is longer than PostgreSQL's 63-character limit.
    foreignKey({ name: 'plugin_form_builder_responses_form_fk', columns: [t.formId], foreignColumns: [forms.id] }).onDelete('cascade'),
    index('plugin_form_builder_responses_form_idx').on(t.formId, t.createdAt),
  ],
)

/**
 * The form builder's own settings, one row (id = 1). Spam protection (captcha, agreed with the
 * owner: on public forms only, keys brought by the owner): the provider, its site key, the secret key
 * sealed with host().secrets (never sent to a browser), reCAPTCHA v3's minimum score in hundredths,
 * whether it is switched on, and when the saved keys last passed "Check these keys". Forms are
 * only protected while it is on AND checked; changing a key clears the check.
 */
export const settings = sqliteTable('plugin_form_builder_settings', {
  id: integer('id').primaryKey(),
  captchaProvider: text('captcha_provider'),
  captchaSiteKey: text('captcha_site_key'),
  captchaSecretEncrypted: text('captcha_secret_encrypted'),
  captchaMinScore: integer('captcha_min_score').notNull().default(50),
  captchaEnabled: integer('captcha_enabled', { mode: 'boolean' }).notNull().default(false),
  captchaCheckedAt: integer('captcha_checked_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
})
