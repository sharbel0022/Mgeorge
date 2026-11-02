CREATE TABLE `bankgiro_ingest_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`source_id` text NOT NULL,
	`scope_id` text NOT NULL,
	`report_id` text NOT NULL,
	`sha256` text NOT NULL,
	`filename` text NOT NULL,
	`available_at` text,
	`authorization_generation` text NOT NULL,
	`document_id` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`last_error` text,
	`import_id` text,
	`payment_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bankgiro_ingest_jobs_owner_report_hash` ON `bankgiro_ingest_jobs` (`owner`,`source_id`,`scope_id`,`report_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `bankgiro_ingest_jobs_due` ON `bankgiro_ingest_jobs` (`owner`,`source_id`,`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `bankgiro_ingest_jobs_hash` ON `bankgiro_ingest_jobs` (`owner`,`sha256`);--> statement-breakpoint
CREATE INDEX `bankgiro_ingest_jobs_identity` ON `bankgiro_ingest_jobs` (`owner`,`scope_id`,`report_id`);--> statement-breakpoint
CREATE TABLE `bankgiro_ingest_leases` (
	`owner` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bankgiro_ingest_sources` (
	`owner` text NOT NULL,
	`source_id` text NOT NULL,
	`scope_id` text,
	`authorization_generation` text,
	`authorization_status` text DEFAULT 'REVIEW' NOT NULL,
	`cursor` text,
	`missing_report_ids` text DEFAULT '[]' NOT NULL,
	`next_poll_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `source_id`)
);
