// The form builder's tables on PostgreSQL. The twin of `sqlite.ts`.
// After changing either file: `pnpm plugin:generate plugins/form-builder <change_name>`.
//
// Relative imports only: drizzle-kit loads this file without the app's path aliases.
import { sql } from 'drizzle-orm'
import { boolean, foreignKey, index, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

import type { FormAnswer, FormField, FormSettings } from '../src/fields'

const at = (name: string) => timestamp(name, { mode: 'date', withTimezone: true })

export const forms = pgTable('plugin_form_builder_forms', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  fields: jsonb('fields').$type<FormField[]>().notNull().default(sql`'[]'::jsonb`),
  settings: jsonb('settings').$type<FormSettings>().notNull().default(sql`'{}'::jsonb`),
  isOpen: boolean('is_open').notNull().default(true),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
})

export const responses = pgTable(
  'plugin_form_builder_responses',
  {
    id: serial('id').primaryKey(),
    formId: integer('form_id').notNull(),
    answers: jsonb('answers').$type<FormAnswer[]>().notNull(),
    readAt: at('read_at'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Named here: the generated name is longer than PostgreSQL's 63-character limit.
    foreignKey({ name: 'plugin_form_builder_responses_form_fk', columns: [t.formId], foreignColumns: [forms.id] }).onDelete('cascade'),
    index('plugin_form_builder_responses_form_idx').on(t.formId, t.createdAt),
  ],
)
