CREATE TABLE `gmail_connections` (
	`owner` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`tokens` text NOT NULL,
	`last_synced` text DEFAULT '' NOT NULL,
	`page_token` text DEFAULT '' NOT NULL,
	`started_at` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`last_attempt` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gmail_flows` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`cookie_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gmail_locks` (
	`owner` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gmail_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`found` integer,
	`imported` integer,
	`duplicates` integer,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gmail_sources` (
	`owner` text NOT NULL,
	`source_id` text NOT NULL,
	`document_id` text NOT NULL,
	`metadata` text NOT NULL,
	`status` text DEFAULT 'needs_review' NOT NULL,
	`extraction` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner`, `source_id`)
);
