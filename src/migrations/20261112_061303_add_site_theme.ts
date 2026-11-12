import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_site_settings_theme" AS ENUM('sunrise', 'meadow', 'ocean', 'heritage', 'studio');
  CREATE TYPE "public"."enum_site_settings_custom_theme_heading_font" AS ENUM('system', 'inter', 'nunito', 'dm-sans', 'lora', 'playfair-display');
  CREATE TYPE "public"."enum_site_settings_custom_theme_body_font" AS ENUM('system', 'inter', 'nunito', 'dm-sans', 'lora', 'playfair-display');
  CREATE TYPE "public"."enum_site_settings_custom_theme_radius" AS ENUM('none', 'sm', 'md', 'lg', 'xl');
  CREATE TYPE "public"."enum_site_settings_custom_theme_button" AS ENUM('pill', 'rounded', 'square');
  CREATE TYPE "public"."enum_site_settings_custom_theme_shadow" AS ENUM('none', 'lift', 'soft', 'medium', 'hard');
  CREATE TYPE "public"."enum_site_settings_custom_theme_density" AS ENUM('compact', 'comfortable', 'spacious');
  CREATE TYPE "public"."enum_site_settings_custom_theme_text_size" AS ENUM('small', 'medium', 'large');
  ALTER TABLE "site_settings" ALTER COLUMN "primary_color" DROP DEFAULT;
  ALTER TABLE "site_settings" ADD COLUMN "theme" "enum_site_settings_theme" DEFAULT 'sunrise';
  ALTER TABLE "site_settings" ADD COLUMN "allow_mode_toggle" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "customize" boolean DEFAULT false;
  ALTER TABLE "site_settings" ADD COLUMN "custom_theme_heading_font" "enum_site_settings_custom_theme_heading_font";
  ALTER TABLE "site_settings" ADD COLUMN "custom_theme_body_font" "enum_site_settings_custom_theme_body_font";
  ALTER TABLE "site_settings" ADD COLUMN "custom_theme_radius" "enum_site_settings_custom_theme_radius";
  ALTER TABLE "site_settings" ADD COLUMN "custom_theme_button" "enum_site_settings_custom_theme_button";
  ALTER TABLE "site_settings" ADD COLUMN "custom_theme_shadow" "enum_site_settings_custom_theme_shadow";
  ALTER TABLE "site_settings" ADD COLUMN "custom_theme_density" "enum_site_settings_custom_theme_density";
  ALTER TABLE "site_settings" ADD COLUMN "custom_theme_text_size" "enum_site_settings_custom_theme_text_size";
  ALTER TABLE "site_settings" ADD COLUMN "custom_theme_light_primary" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "custom_theme_light_background" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "custom_theme_light_surface" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "custom_theme_light_text" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "custom_theme_light_tint" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "custom_theme_dark_primary" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "custom_theme_dark_background" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "custom_theme_dark_surface" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "custom_theme_dark_text" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "custom_theme_dark_tint" varchar;`)

  // The brand colour used to default to #e8590c, which is exactly the Sunrise theme's colour. Left
  // in place it would now override every other theme's own colour, so clear it where it still
  // holds that old default. Sites that picked their own colour keep it.
  await db.execute(sql`
   UPDATE "site_settings" SET "primary_color" = NULL WHERE lower("primary_color") = '#e8590c';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "site_settings" ALTER COLUMN "primary_color" SET DEFAULT '#e8590c';
  ALTER TABLE "site_settings" DROP COLUMN "theme";
  ALTER TABLE "site_settings" DROP COLUMN "allow_mode_toggle";
  ALTER TABLE "site_settings" DROP COLUMN "customize";
  ALTER TABLE "site_settings" DROP COLUMN "custom_theme_heading_font";
  ALTER TABLE "site_settings" DROP COLUMN "custom_theme_body_font";
  ALTER TABLE "site_settings" DROP COLUMN "custom_theme_radius";
  ALTER TABLE "site_settings" DROP COLUMN "custom_theme_button";
  ALTER TABLE "site_settings" DROP COLUMN "custom_theme_shadow";
  ALTER TABLE "site_settings" DROP COLUMN "custom_theme_density";
  ALTER TABLE "site_settings" DROP COLUMN "custom_theme_text_size";
  ALTER TABLE "site_settings" DROP COLUMN "custom_theme_light_primary";
  ALTER TABLE "site_settings" DROP COLUMN "custom_theme_light_background";
  ALTER TABLE "site_settings" DROP COLUMN "custom_theme_light_surface";
  ALTER TABLE "site_settings" DROP COLUMN "custom_theme_light_text";
  ALTER TABLE "site_settings" DROP COLUMN "custom_theme_light_tint";
  ALTER TABLE "site_settings" DROP COLUMN "custom_theme_dark_primary";
  ALTER TABLE "site_settings" DROP COLUMN "custom_theme_dark_background";
  ALTER TABLE "site_settings" DROP COLUMN "custom_theme_dark_surface";
  ALTER TABLE "site_settings" DROP COLUMN "custom_theme_dark_text";
  ALTER TABLE "site_settings" DROP COLUMN "custom_theme_dark_tint";
  DROP TYPE "public"."enum_site_settings_theme";
  DROP TYPE "public"."enum_site_settings_custom_theme_heading_font";
  DROP TYPE "public"."enum_site_settings_custom_theme_body_font";
  DROP TYPE "public"."enum_site_settings_custom_theme_radius";
  DROP TYPE "public"."enum_site_settings_custom_theme_button";
  DROP TYPE "public"."enum_site_settings_custom_theme_shadow";
  DROP TYPE "public"."enum_site_settings_custom_theme_density";
  DROP TYPE "public"."enum_site_settings_custom_theme_text_size";`)
}
