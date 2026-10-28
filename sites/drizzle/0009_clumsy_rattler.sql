CREATE TABLE `backup_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`day` text NOT NULL,
	`state` text NOT NULL,
	`snapshot_key` text DEFAULT '' NOT NULL,
	`snapshot_hash` text DEFAULT '' NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`total_docs` integer DEFAULT 0 NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease` text DEFAULT '' NOT NULL,
	`lease_until` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`finished_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backup_owner_day` ON `backup_runs` (`owner`,`day`);--> statement-breakpoint
CREATE INDEX `backup_owner_created` ON `backup_runs` (`owner`,`created_at`);