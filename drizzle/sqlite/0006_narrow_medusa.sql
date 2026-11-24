ALTER TABLE `page_versions` ADD `restored_from` integer;--> statement-breakpoint
ALTER TABLE `page_versions` ADD `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL;