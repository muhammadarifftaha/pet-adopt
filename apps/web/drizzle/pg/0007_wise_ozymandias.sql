CREATE TABLE "themes" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base" text DEFAULT 'sunrise' NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "active_theme_id" integer;--> statement-breakpoint
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_active_theme_id_themes_id_fk" FOREIGN KEY ("active_theme_id") REFERENCES "public"."themes"("id") ON DELETE set null ON UPDATE no action;