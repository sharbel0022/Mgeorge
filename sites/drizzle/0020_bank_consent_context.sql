ALTER TABLE `bank_auth_flows` ADD `context_json` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bank_auth_flows` ADD `result_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bank_auth_flows` ADD `connection_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `consent_metadata` text DEFAULT '' NOT NULL;