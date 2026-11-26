CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`actor_id` text,
	`actor_name` text,
	`actor_role` text,
	`action` text NOT NULL,
	`area` text NOT NULL,
	`summary` text NOT NULL,
	`subject_id` text,
	`subject_label` text,
	`fields` text,
	`client` text
);
--> statement-breakpoint
CREATE INDEX `activity_log_at_idx` ON `activity_log` (`at`);--> statement-breakpoint
CREATE INDEX `activity_log_actor_at_idx` ON `activity_log` (`actor_id`,`at`);--> statement-breakpoint
CREATE INDEX `activity_log_area_at_idx` ON `activity_log` (`area`,`at`);