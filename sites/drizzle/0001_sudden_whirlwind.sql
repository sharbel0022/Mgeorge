CREATE TABLE `bank_applications` (
	`owner` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`metadata` text NOT NULL,
	`generation` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bank_auth_flows` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`cookie_hash` text NOT NULL,
	`app_generation` text NOT NULL,
	`bank_name` text NOT NULL,
	`country` text NOT NULL,
	`environment` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`date_from` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bank_flow_owner` ON `bank_auth_flows` (`owner`);--> statement-breakpoint
CREATE TABLE `bank_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`app_generation` text NOT NULL,
	`environment` text NOT NULL,
	`bank_name` text NOT NULL,
	`country` text NOT NULL,
	`encrypted_session` text NOT NULL,
	`encrypted_accounts` text NOT NULL,
	`selected_accounts` text DEFAULT '[]' NOT NULL,
	`valid_until` text NOT NULL,
	`date_from` text NOT NULL,
	`status` text NOT NULL,
	`last_synced_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_connections_owner_unique` ON `bank_connections` (`owner`);--> statement-breakpoint
CREATE TABLE `bank_locks` (
	`owner` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bank_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`connection_id` text NOT NULL,
	`imported` integer NOT NULL,
	`skipped` integer NOT NULL,
	`warnings` text NOT NULL,
	`test` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bank_run_owner_created` ON `bank_sync_runs` (`owner`,`created_at`);