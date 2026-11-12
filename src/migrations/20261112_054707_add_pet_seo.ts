import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pets" ADD COLUMN "seo_title" varchar;
  ALTER TABLE "pets" ADD COLUMN "seo_description" varchar;
  ALTER TABLE "pets" ADD COLUMN "seo_image_id" integer;
  ALTER TABLE "pets" ADD CONSTRAINT "pets_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "pets_seo_seo_image_idx" ON "pets" USING btree ("seo_image_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pets" DROP CONSTRAINT "pets_seo_image_id_media_id_fk";
  
  DROP INDEX "pets_seo_seo_image_idx";
  ALTER TABLE "pets" DROP COLUMN "seo_title";
  ALTER TABLE "pets" DROP COLUMN "seo_description";
  ALTER TABLE "pets" DROP COLUMN "seo_image_id";`)
}
