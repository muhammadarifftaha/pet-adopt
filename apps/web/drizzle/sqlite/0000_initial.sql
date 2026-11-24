CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounts_userId_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`alt` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_filename_idx` ON `media` (`filename`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`puck_draft` text,
	`puck_published` text,
	`seo_description` text,
	`seo_image_id` integer,
	`published_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seo_image_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_slug_idx` ON `pages` (`slug`);--> statement-breakpoint
CREATE INDEX `pages_seo_image_idx` ON `pages` (`seo_image_id`);--> statement-breakpoint
CREATE TABLE `pet_photos` (
	`pet_id` integer NOT NULL,
	`media_id` integer NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`pet_id`, `position`),
	FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `pet_photos_media_idx` ON `pet_photos` (`media_id`);--> statement-breakpoint
CREATE TABLE `pets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`unlisted` integer DEFAULT false NOT NULL,
	`urgent` integer DEFAULT false NOT NULL,
	`adopted_at` integer,
	`species` text DEFAULT 'cat' NOT NULL,
	`breed` text,
	`sex` text DEFAULT 'unknown',
	`age_group` text,
	`age_description` text,
	`size` text,
	`birth_date` text,
	`color` text,
	`city` text,
	`state` text,
	`location` text,
	`vaccinated` integer DEFAULT false NOT NULL,
	`neutered` integer DEFAULT false NOT NULL,
	`microchipped` integer DEFAULT false NOT NULL,
	`house_trained` integer DEFAULT false NOT NULL,
	`special_needs` integer DEFAULT false NOT NULL,
	`health_notes` text,
	`temperament` text DEFAULT '[]' NOT NULL,
	`good_with` text DEFAULT '[]' NOT NULL,
	`description` text,
	`video_url` text,
	`adoption_fee` real,
	`rescued_at` text,
	`contact_whatsapp` text,
	`seo_title` text,
	`seo_description` text,
	`seo_image_id` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seo_image_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pets_slug_idx` ON `pets` (`slug`);--> statement-breakpoint
CREATE INDEX `pets_status_idx` ON `pets` (`status`);--> statement-breakpoint
CREATE INDEX `pets_species_idx` ON `pets` (`species`);--> statement-breakpoint
CREATE INDEX `pets_featured_idx` ON `pets` (`featured`);--> statement-breakpoint
CREATE INDEX `pets_city_idx` ON `pets` (`city`);--> statement-breakpoint
CREATE INDEX `pets_state_idx` ON `pets` (`state`);--> statement-breakpoint
CREATE INDEX `pets_status_created_idx` ON `pets` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limits_key_unique` ON `rate_limits` (`key`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_userId_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `site_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`site_name` text DEFAULT 'Pet Adopt' NOT NULL,
	`tagline` text DEFAULT 'Find your new best friend',
	`logo_id` integer,
	`primary_color` text,
	`theme` text DEFAULT 'sunrise' NOT NULL,
	`allow_mode_toggle` integer DEFAULT true NOT NULL,
	`customize` integer DEFAULT false NOT NULL,
	`custom_theme` text,
	`whatsapp_number` text,
	`whatsapp_message` text DEFAULT 'Hi! I''m interested in adopting {pet}.',
	`address` text,
	`opening_hours` text,
	`socials` text DEFAULT '[]' NOT NULL,
	`nav` text DEFAULT '[]' NOT NULL,
	`footer_text` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`logo_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`role` text,
	`banned` integer DEFAULT false,
	`ban_reason` text,
	`ban_expires` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);