// The Instagram feed plugin's tables on SQLite. `pg.ts` next to this file is its twin (the registry
// checks they match). Every name starts with "plugin_instagram_feed_", as the plugin system requires.
// After changing either file: `pnpm plugin:generate plugins/instagram-feed <change_name>`.
//
// Relative imports only: drizzle-kit loads this file without the app's path aliases.
import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { FeedPost, FeedProfile } from '../src/types'

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`

/** A post as it is kept: whether it is pinned is worked out when a feed is put together. */
export type StoredPost = Omit<FeedPost, 'pinned'>

/**
 * The connection, one row (id = 1). The Meta app's ID and its secret (sealed with host().secrets,
 * never sent to a browser), the account's access token (sealed the same way), how and by whom it
 * was connected, the account as Instagram described it, a sign-in that is under way (only the
 * sha256 of its one-time `state`, when it ends and who started it), the team's pinned posts, and
 * how the last read from Instagram went.
 */
export const settings = sqliteTable('plugin_instagram_feed_settings', {
  id: integer('id').primaryKey(),
  appId: text('app_id'),
  appSecretEncrypted: text('app_secret_encrypted'),
  accessTokenEncrypted: text('access_token_encrypted'),
  /** When the token was made, or the earliest moment it is known to have existed (a pasted token). */
  tokenIssuedAt: integer('token_issued_at', { mode: 'timestamp_ms' }),
  /** Null when unknown (a pasted token, until its first refresh). */
  tokenExpiresAt: integer('token_expires_at', { mode: 'timestamp_ms' }),
  /** The last time a token refresh was tried, so a failing one is tried once a day, not every hour. */
  tokenRefreshTriedAt: integer('token_refresh_tried_at', { mode: 'timestamp_ms' }),
  /** 'oauth' (Instagram's sign-in) or 'token' (a pasted access token). */
  method: text('method'),
  accountId: text('account_id'),
  accountUsername: text('account_username'),
  accountName: text('account_name'),
  accountType: text('account_type'),
  accountPictureUrl: text('account_picture_url'),
  connectedAt: integer('connected_at', { mode: 'timestamp_ms' }),
  /** The id of the person who connected it. No foreign key: plugin tables never reference the site's. */
  connectedBy: text('connected_by'),
  oauthStateHash: text('oauth_state_hash'),
  oauthStateExpiresAt: integer('oauth_state_expires_at', { mode: 'timestamp_ms' }),
  oauthStateUserId: text('oauth_state_user_id'),
  /** Instagram media ids, in the order they lead the feed. */
  pinnedIds: text('pinned_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  /** The last time a read from Instagram was started (it may have failed). */
  lastAttemptAt: integer('last_attempt_at', { mode: 'timestamp_ms' }),
  /** The last time a read from Instagram worked. */
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp_ms' }),
  /** Why the last read failed, in words for the owner. Never an address or a token. */
  lastError: text('last_error'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
})

/**
 * The feed as last read from Instagram, one row (id = 1): the profile, the latest posts, and pinned
 * posts that are older than those. Every address in it was checked before it was stored.
 */
export const cache = sqliteTable('plugin_instagram_feed_cache', {
  id: integer('id').primaryKey(),
  profile: text('profile', { mode: 'json' }).$type<FeedProfile>().notNull(),
  posts: text('posts', { mode: 'json' }).$type<StoredPost[]>().notNull().default(sql`'[]'`),
  /** Pinned posts that are not among the latest, read one by one. */
  pinnedPosts: text('pinned_posts', { mode: 'json' }).$type<StoredPost[]>().notNull().default(sql`'[]'`),
  fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
})
