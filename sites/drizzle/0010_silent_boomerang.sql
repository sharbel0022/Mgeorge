ALTER TABLE `document_automation` ADD `cloud_worker_seen` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `document_automation` ADD `cloud_worker_completed` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `document_jobs` ADD `lease_runner` text DEFAULT 'local' NOT NULL;