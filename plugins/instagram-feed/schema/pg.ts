// The Instagram feed plugin's tables on PostgreSQL. The twin of `sqlite.ts` (see there for what
// each column holds).
// After changing either file: `pnpm plugin:generate plugins/instagram-feed <change_name>`.
//
// Relative imports only: drizzle-kit loads this file without the app's path aliases.
import { sql } from 'drizzle-orm'
import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import type { FeedProfile } from '../src/types'
import type { StoredPost } from './sqlite'

const at = (name: string) => timestamp(name, { mode: 'date', withTimezone: true })

export const settings = pgTable('plugin_instagram_feed_settings', {
  id: integer('id').primaryKey(),
  appId: text('app_id'),
  appSecretEncrypted: text('app_secret_encrypted'),
  accessTokenEncrypted: text('access_token_encrypted'),
  tokenIssuedAt: at('token_issued_at'),
  tokenExpiresAt: at('token_expires_at'),
  tokenRefreshTriedAt: at('token_refresh_tried_at'),
  method: text('method'),
  accountId: text('account_id'),
  accountUsername: text('account_username'),
  accountName: text('account_name'),
  accountType: text('account_type'),
  accountPictureUrl: text('account_picture_url'),
  connectedAt: at('connected_at'),
  connectedBy: text('connected_by'),
  oauthStateHash: text('oauth_state_hash'),
  oauthStateExpiresAt: at('oauth_state_expires_at'),
  oauthStateUserId: text('oauth_state_user_id'),
  pinnedIds: jsonb('pinned_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  lastAttemptAt: at('last_attempt_at'),
  lastFetchedAt: at('last_fetched_at'),
  lastError: text('last_error'),
  updatedAt: at('updated_at').notNull().defaultNow(),
})

export const cache = pgTable('plugin_instagram_feed_cache', {
  id: integer('id').primaryKey(),
  profile: jsonb('profile').$type<FeedProfile>().notNull(),
  posts: jsonb('posts').$type<StoredPost[]>().notNull().default(sql`'[]'::jsonb`),
  pinnedPosts: jsonb('pinned_posts').$type<StoredPost[]>().notNull().default(sql`'[]'::jsonb`),
  fetchedAt: at('fetched_at').notNull(),
})
