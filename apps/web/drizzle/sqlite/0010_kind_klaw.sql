CREATE TABLE `plugin_migrations` (
	`plugin` text NOT NULL,
	`migration` text NOT NULL,
	`checksum` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`plugin`, `migration`)
);
