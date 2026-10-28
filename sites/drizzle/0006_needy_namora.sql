ALTER TABLE `invoice_counterparties` ADD `bankgiro` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_counterparties` ADD `currency` text DEFAULT 'SEK' NOT NULL;