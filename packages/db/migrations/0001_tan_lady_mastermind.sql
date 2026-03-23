ALTER TABLE "backups" ADD COLUMN "storage_profile_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "backups" ADD CONSTRAINT "backups_storage_profile_id_storage_profiles_id_fk" FOREIGN KEY ("storage_profile_id") REFERENCES "public"."storage_profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
