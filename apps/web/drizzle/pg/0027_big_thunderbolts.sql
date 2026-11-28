CREATE INDEX "activity_log_subject_at_idx" ON "activity_log" USING btree ("subject_id","at");--> statement-breakpoint
CREATE INDEX "pets_seo_image_idx" ON "pets" USING btree ("seo_image_id");