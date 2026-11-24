ALTER TABLE "page_versions" ADD COLUMN "restored_from" integer;--> statement-breakpoint
ALTER TABLE "page_versions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;