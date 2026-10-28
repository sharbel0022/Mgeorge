ALTER TABLE `bank_connections` ADD `retry_after` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `sync_failures` integer DEFAULT 0 NOT NULL;