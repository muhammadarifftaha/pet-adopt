CREATE TABLE `plugin_instagram_feed_cache` (
	`id` integer PRIMARY KEY NOT NULL,
	`profile` text NOT NULL,
	`posts` text DEFAULT '[]' NOT NULL,
	`pinned_posts` text DEFAULT '[]' NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plugin_instagram_feed_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`app_id` text,
	`app_secret_encrypted` text,
	`access_token_encrypted` text,
	`token_issued_at` integer,
	`token_expires_at` integer,
	`token_refresh_tried_at` integer,
	`method` text,
	`account_id` text,
	`account_username` text,
	`account_name` text,
	`account_type` text,
	`account_picture_url` text,
	`connected_at` integer,
	`connected_by` text,
	`oauth_state_hash` text,
	`oauth_state_expires_at` integer,
	`oauth_state_user_id` text,
	`pinned_ids` text DEFAULT '[]' NOT NULL,
	`last_attempt_at` integer,
	`last_fetched_at` integer,
	`last_error` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
