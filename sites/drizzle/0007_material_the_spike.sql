CREATE TABLE `payment_control_requests` (
	`owner` text NOT NULL,
	`request_id` text NOT NULL,
	`run_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner`, `request_id`)
);
--> statement-breakpoint
CREATE TABLE `payment_control_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`status` text NOT NULL,
	`steps` text NOT NULL,
	`lease` text DEFAULT '' NOT NULL,
	`lease_until` text DEFAULT '' NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `control_owner_started` ON `payment_control_runs` (`owner`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `control_one_active_owner` ON `payment_control_runs` (`owner`) WHERE "payment_control_runs"."status" = 'running';