CREATE TABLE "plugin_migrations" (
	"plugin" text NOT NULL,
	"migration" text NOT NULL,
	"checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_migrations_plugin_migration_pk" PRIMARY KEY("plugin","migration")
);
