ALTER TABLE "email_templates" ADD COLUMN "seed_key" text;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_seed_key_unique" UNIQUE("seed_key");