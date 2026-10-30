ALTER TABLE `backup_runs` ADD `verification_cursor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `backup_runs` ADD `verified_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `backup_runs` ADD `verification_started_at` text DEFAULT '' NOT NULL;