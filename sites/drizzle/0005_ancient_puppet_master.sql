CREATE TABLE `document_automation` (
	`owner` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`auto_register` integer DEFAULT 1 NOT NULL,
	`worker_seen` text DEFAULT '' NOT NULL,
	`last_cloud_run` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`document_id` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_jobs` (
	`owner` text NOT NULL,
	`document_id` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`engine` text DEFAULT 'cloud' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`available_at` text NOT NULL,
	`lease` text DEFAULT '' NOT NULL,
	`lease_until` text DEFAULT '' NOT NULL,
	`extraction` text DEFAULT '{}' NOT NULL,
	`error_code` text DEFAULT '' NOT NULL,
	`invoice_id` text DEFAULT '' NOT NULL,
	`automatic` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner`, `document_id`)
);
--> statement-breakpoint
CREATE INDEX `document_job_due` ON `document_jobs` (`owner`,`state`,`available_at`);--> statement-breakpoint
CREATE TABLE `document_registrations` (
	`owner` text NOT NULL,
	`document_id` text NOT NULL,
	`identity` text NOT NULL,
	`invoice_id` text NOT NULL,
	`attempt` text NOT NULL,
	`total` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner`, `document_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_invoice_identity` ON `document_registrations` (`owner`,`identity`);--> statement-breakpoint
CREATE TABLE `invoice_counterparties` (
	`owner` text NOT NULL,
	`identity` text NOT NULL,
	`email` text NOT NULL,
	`evidence` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`verified_at` text NOT NULL,
	PRIMARY KEY(`owner`, `identity`)
);
