ALTER TABLE `bank_connections` ADD `auto_sync_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `auto_last_attempt_at` text;--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `auto_next_at` text;