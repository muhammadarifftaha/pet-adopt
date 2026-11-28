CREATE TABLE "plugin_instagram_feed_cache" (
	"id" integer PRIMARY KEY NOT NULL,
	"profile" jsonb NOT NULL,
	"posts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pinned_posts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_instagram_feed_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"app_id" text,
	"app_secret_encrypted" text,
	"access_token_encrypted" text,
	"token_issued_at" timestamp with time zone,
	"token_expires_at" timestamp with time zone,
	"token_refresh_tried_at" timestamp with time zone,
	"method" text,
	"account_id" text,
	"account_username" text,
	"account_name" text,
	"account_type" text,
	"account_picture_url" text,
	"connected_at" timestamp with time zone,
	"connected_by" text,
	"oauth_state_hash" text,
	"oauth_state_expires_at" timestamp with time zone,
	"oauth_state_user_id" text,
	"pinned_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_fetched_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
