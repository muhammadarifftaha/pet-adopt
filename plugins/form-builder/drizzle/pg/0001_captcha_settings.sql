CREATE TABLE "plugin_form_builder_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"captcha_provider" text,
	"captcha_site_key" text,
	"captcha_secret_encrypted" text,
	"captcha_min_score" integer DEFAULT 50 NOT NULL,
	"captcha_enabled" boolean DEFAULT false NOT NULL,
	"captcha_checked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
