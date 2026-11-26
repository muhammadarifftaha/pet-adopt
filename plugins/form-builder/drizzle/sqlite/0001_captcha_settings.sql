CREATE TABLE `plugin_form_builder_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`captcha_provider` text,
	`captcha_site_key` text,
	`captcha_secret_encrypted` text,
	`captcha_min_score` integer DEFAULT 50 NOT NULL,
	`captcha_enabled` integer DEFAULT false NOT NULL,
	`captcha_checked_at` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
