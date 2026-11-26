CREATE TABLE `email_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`host` text,
	`port` integer,
	`security` text DEFAULT 'starttls' NOT NULL,
	`username` text,
	`password_encrypted` text,
	`from_name` text,
	`from_address` text,
	`reply_to` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
