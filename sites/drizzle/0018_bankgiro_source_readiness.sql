DROP INDEX `bankgiro_ingest_jobs_owner_report_hash`;--> statement-breakpoint
ALTER TABLE `bankgiro_ingest_jobs` ADD `registration_binding` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `bankgiro_ingest_jobs_owner_report_hash` ON `bankgiro_ingest_jobs` (`owner`,`source_id`,`scope_id`,`report_id`,`sha256`,`registration_binding`);--> statement-breakpoint
ALTER TABLE `bankgiro_ingest_sources` ADD `revoked_generations` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `bankgiro_ingest_sources` ADD `registration_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bankgiro_ingest_sources` ADD `registration_binding` text;--> statement-breakpoint
ALTER TABLE `bankgiro_ingest_sources` ADD `authorization_verified_at` integer;--> statement-breakpoint
ALTER TABLE `bankgiro_ingest_sources` ADD `authorization_valid_until` integer;--> statement-breakpoint
ALTER TABLE `bankgiro_ingest_sources` ADD `last_success_at` integer;--> statement-breakpoint
ALTER TABLE `bankgiro_ingest_sources` ADD `last_failure_at` integer;--> statement-breakpoint
ALTER TABLE `bankgiro_ingest_sources` ADD `last_failure_code` text;