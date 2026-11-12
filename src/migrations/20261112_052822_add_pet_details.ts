import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_pets_temperament" AS ENUM('calm', 'playful', 'energetic', 'affectionate', 'independent', 'shy');
  CREATE TYPE "public"."enum_pets_good_with" AS ENUM('kids', 'dogs', 'cats', 'other-pets');
  CREATE TABLE "pets_temperament" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_pets_temperament",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "pets_good_with" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_pets_good_with",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  ALTER TABLE "pets" ADD COLUMN "urgent" boolean DEFAULT false;
  ALTER TABLE "pets" ADD COLUMN "birth_date" timestamp(3) with time zone;
  ALTER TABLE "pets" ADD COLUMN "color" varchar;
  ALTER TABLE "pets" ADD COLUMN "microchipped" boolean DEFAULT false;
  ALTER TABLE "pets" ADD COLUMN "house_trained" boolean DEFAULT false;
  ALTER TABLE "pets" ADD COLUMN "special_needs" boolean DEFAULT false;
  ALTER TABLE "pets" ADD COLUMN "health_notes" varchar;
  ALTER TABLE "pets" ADD COLUMN "video_url" varchar;
  ALTER TABLE "pets" ADD COLUMN "adoption_fee" numeric;
  ALTER TABLE "pets" ADD COLUMN "rescued_at" timestamp(3) with time zone;
  ALTER TABLE "pets" ADD COLUMN "contact_whats_app" varchar;
  ALTER TABLE "pets_temperament" ADD CONSTRAINT "pets_temperament_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."pets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pets_good_with" ADD CONSTRAINT "pets_good_with_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."pets"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pets_temperament_order_idx" ON "pets_temperament" USING btree ("order");
  CREATE INDEX "pets_temperament_parent_idx" ON "pets_temperament" USING btree ("parent_id");
  CREATE INDEX "pets_good_with_order_idx" ON "pets_good_with" USING btree ("order");
  CREATE INDEX "pets_good_with_parent_idx" ON "pets_good_with" USING btree ("parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "pets_temperament" CASCADE;
  DROP TABLE "pets_good_with" CASCADE;
  ALTER TABLE "pets" DROP COLUMN "urgent";
  ALTER TABLE "pets" DROP COLUMN "birth_date";
  ALTER TABLE "pets" DROP COLUMN "color";
  ALTER TABLE "pets" DROP COLUMN "microchipped";
  ALTER TABLE "pets" DROP COLUMN "house_trained";
  ALTER TABLE "pets" DROP COLUMN "special_needs";
  ALTER TABLE "pets" DROP COLUMN "health_notes";
  ALTER TABLE "pets" DROP COLUMN "video_url";
  ALTER TABLE "pets" DROP COLUMN "adoption_fee";
  ALTER TABLE "pets" DROP COLUMN "rescued_at";
  ALTER TABLE "pets" DROP COLUMN "contact_whats_app";
  DROP TYPE "public"."enum_pets_temperament";
  DROP TYPE "public"."enum_pets_good_with";`)
}
