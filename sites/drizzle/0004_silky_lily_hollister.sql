CREATE TABLE `customer_contacts` (
	`owner` text NOT NULL,
	`invoice_id` text NOT NULL,
	`email` text NOT NULL,
	`identity` text NOT NULL,
	`evidence` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner`, `invoice_id`)
);
--> statement-breakpoint
CREATE TABLE `customer_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`message_id` text NOT NULL,
	`review_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot` text NOT NULL,
	`recipient` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`gmail_message_id` text DEFAULT '' NOT NULL,
	`rfc_message_id` text NOT NULL,
	`approved_at` text NOT NULL,
	`sent_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_deliveries_message_id_unique` ON `customer_deliveries` (`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `customer_deliveries_review_id_unique` ON `customer_deliveries` (`review_id`);--> statement-breakpoint
CREATE TABLE `customer_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`invoice_id` text NOT NULL,
	`kind` text NOT NULL,
	`recipient` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`snapshot` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_owner_invoice` ON `customer_messages` (`owner`,`invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_evidence_unique` ON `customer_messages` (`owner`,`invoice_id`,`kind`,`snapshot`);--> statement-breakpoint
CREATE TABLE `customer_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`message_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot` text NOT NULL,
	`cookie_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reconciliation_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`invoice_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`kind` text NOT NULL,
	`details` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `findings_owner` ON `reconciliation_findings` (`owner`);--> statement-breakpoint
ALTER TABLE `gmail_flows` ADD `request_send` integer DEFAULT 0 NOT NULL;