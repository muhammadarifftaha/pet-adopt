ALTER TABLE `email_templates` ADD `seed_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `email_templates_seed_key_unique` ON `email_templates` (`seed_key`);