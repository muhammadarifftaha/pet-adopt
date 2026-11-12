import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pets" ADD COLUMN "city" varchar;
  ALTER TABLE "pets" ADD COLUMN "state" varchar;
  CREATE INDEX "pets_city_idx" ON "pets" USING btree ("city");
  CREATE INDEX "pets_state_idx" ON "pets" USING btree ("state");`)

  // Backfill from the free-text location ("City, State") by splitting on the last comma.
  // A location without a comma becomes the city. Rows that already have a city or state are
  // left alone, and the location text itself is not changed.
  await db.execute(sql`
   UPDATE "pets"
   SET "city" = NULLIF(trim(regexp_replace("location", ',[^,]*$', '')), ''),
       "state" = CASE WHEN "location" LIKE '%,%' THEN NULLIF(trim(regexp_replace("location", '^.*,', '')), '') END
   WHERE "location" IS NOT NULL AND "city" IS NULL AND "state" IS NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "pets_city_idx";
  DROP INDEX "pets_state_idx";
  ALTER TABLE "pets" DROP COLUMN "city";
  ALTER TABLE "pets" DROP COLUMN "state";`)
}
