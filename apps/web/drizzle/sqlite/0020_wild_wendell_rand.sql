CREATE TABLE `auth_providers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`discovery_url` text,
	`authorization_url` text,
	`token_url` text,
	`user_info_url` text,
	`client_id` text NOT NULL,
	`client_secret_encrypted` text,
	`scopes` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_providers_slug_unique` ON `auth_providers` (`slug`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `sign_in_method` text;