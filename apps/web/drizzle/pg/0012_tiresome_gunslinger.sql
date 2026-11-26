ALTER TABLE "page_versions" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "details_draft" jsonb;