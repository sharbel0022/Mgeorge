-- Agent 5: additive company sync coordination. Generated from db/schema.ts.
CREATE TABLE `company_bank_sync_jobs` (
	`company_id` text NOT NULL,
	`account_key` text NOT NULL,
	`owner` text NOT NULL,
	`provider` text NOT NULL,
	`connection_id` text NOT NULL,
	`authority_hash` text NOT NULL,
	`generation_hash` text NOT NULL,
	`authority_revision` integer NOT NULL,
	`valid_until` integer NOT NULL,
	`revoked` integer DEFAULT 0 NOT NULL,
	`lease_token` text DEFAULT '' NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`lease_deadline` integer DEFAULT 0 NOT NULL,
	`fence_version` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`retry_blocked` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`coverage` text DEFAULT '{"ais":"unknown","bankgiro":"unknown","paymentDataComplete":false}' NOT NULL,
	`checkpoint` text,
	PRIMARY KEY(`company_id`, `account_key`)
);
--> statement-breakpoint
CREATE INDEX `company_bank_sync_jobs_due` ON `company_bank_sync_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `company_bank_sync_receipts` (
	`company_id` text NOT NULL,
	`owner` text NOT NULL,
	`account_key` text NOT NULL,
	`receipt_key` text NOT NULL,
	`sha256` text NOT NULL,
	`result` text NOT NULL,
	`committed_at` integer NOT NULL,
	PRIMARY KEY(`company_id`, `account_key`, `receipt_key`)
);
--> statement-breakpoint
CREATE TABLE `company_bank_sync_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`owner` text NOT NULL,
	`account_key` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider` text NOT NULL,
	`reserved_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `company_bank_sync_requests_budget` ON `company_bank_sync_requests` (`company_id`,`account_key`,`reserved_at`);--> statement-breakpoint
CREATE INDEX `company_bank_sync_requests_connection_budget` ON `company_bank_sync_requests` (`company_id`,`provider`,`connection_id`,`reserved_at`);--> statement-breakpoint
CREATE TABLE `company_bank_sync_scopes` (
	`company_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`evidence_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`reference_policy` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_bank_sync_scopes_owner_unique` ON `company_bank_sync_scopes` (`owner`);