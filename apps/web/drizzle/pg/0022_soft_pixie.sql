ALTER TABLE "site_settings" ADD COLUMN "setup_key_encrypted" text;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "setup_done_at" timestamp with time zone;--> statement-breakpoint
-- Sites that already have accounts were set up before onboarding existed: never send them into it.
INSERT INTO "site_settings" ("id") SELECT 1 WHERE EXISTS (SELECT 1 FROM "users") ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "site_settings" SET "setup_done_at" = now() WHERE "setup_done_at" IS NULL AND EXISTS (SELECT 1 FROM "users");
