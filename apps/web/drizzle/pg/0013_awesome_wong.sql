CREATE TABLE "activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"actor_role" text,
	"action" text NOT NULL,
	"area" text NOT NULL,
	"summary" text NOT NULL,
	"subject_id" text,
	"subject_label" text,
	"fields" jsonb,
	"client" text
);
--> statement-breakpoint
CREATE INDEX "activity_log_at_idx" ON "activity_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "activity_log_actor_at_idx" ON "activity_log" USING btree ("actor_id","at");--> statement-breakpoint
CREATE INDEX "activity_log_area_at_idx" ON "activity_log" USING btree ("area","at");