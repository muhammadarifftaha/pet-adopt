CREATE TABLE "pet_timeline_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"pet_id" integer NOT NULL,
	"date" text NOT NULL,
	"time" text,
	"title" text NOT NULL,
	"body_doc" jsonb,
	"photo_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pet_timeline_entries" ADD CONSTRAINT "pet_timeline_entries_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pet_timeline_entries" ADD CONSTRAINT "pet_timeline_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pet_timeline_entries_pet_date_idx" ON "pet_timeline_entries" USING btree ("pet_id","date");