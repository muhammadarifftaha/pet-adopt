CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"alt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"puck_draft" jsonb,
	"puck_published" jsonb,
	"seo_description" text,
	"seo_image_id" integer,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pet_photos" (
	"pet_id" integer NOT NULL,
	"media_id" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "pet_photos_pet_id_position_pk" PRIMARY KEY("pet_id","position")
);
--> statement-breakpoint
CREATE TABLE "pets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"unlisted" boolean DEFAULT false NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"adopted_at" timestamp with time zone,
	"species" text DEFAULT 'cat' NOT NULL,
	"breed" text,
	"sex" text DEFAULT 'unknown',
	"age_group" text,
	"age_description" text,
	"size" text,
	"birth_date" text,
	"color" text,
	"city" text,
	"state" text,
	"location" text,
	"vaccinated" boolean DEFAULT false NOT NULL,
	"neutered" boolean DEFAULT false NOT NULL,
	"microchipped" boolean DEFAULT false NOT NULL,
	"house_trained" boolean DEFAULT false NOT NULL,
	"special_needs" boolean DEFAULT false NOT NULL,
	"health_notes" text,
	"temperament" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"good_with" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"video_url" text,
	"adoption_fee" double precision,
	"rescued_at" text,
	"contact_whatsapp" text,
	"seo_title" text,
	"seo_description" text,
	"seo_image_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"site_name" text DEFAULT 'Pet Adopt' NOT NULL,
	"tagline" text DEFAULT 'Find your new best friend',
	"logo_id" integer,
	"primary_color" text,
	"theme" text DEFAULT 'sunrise' NOT NULL,
	"allow_mode_toggle" boolean DEFAULT true NOT NULL,
	"customize" boolean DEFAULT false NOT NULL,
	"custom_theme" jsonb,
	"whatsapp_number" text,
	"whatsapp_message" text DEFAULT 'Hi! I''m interested in adopting {pet}.',
	"address" text,
	"opening_hours" text,
	"socials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nav" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"footer_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pet_photos" ADD CONSTRAINT "pet_photos_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pet_photos" ADD CONSTRAINT "pet_photos_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pets" ADD CONSTRAINT "pets_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_logo_id_media_id_fk" FOREIGN KEY ("logo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_userId_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_slug_idx" ON "pages" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "pages_seo_image_idx" ON "pages" USING btree ("seo_image_id");--> statement-breakpoint
CREATE INDEX "pet_photos_media_idx" ON "pet_photos" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pets_slug_idx" ON "pets" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "pets_status_idx" ON "pets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pets_species_idx" ON "pets" USING btree ("species");--> statement-breakpoint
CREATE INDEX "pets_featured_idx" ON "pets" USING btree ("featured");--> statement-breakpoint
CREATE INDEX "pets_city_idx" ON "pets" USING btree ("city");--> statement-breakpoint
CREATE INDEX "pets_state_idx" ON "pets" USING btree ("state");--> statement-breakpoint
CREATE INDEX "pets_status_created_idx" ON "pets" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "sessions_userId_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");