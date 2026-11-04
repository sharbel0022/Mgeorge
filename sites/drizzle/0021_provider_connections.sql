CREATE TABLE `bank_provider_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`company_id` text NOT NULL,
	`provider_kind` text NOT NULL,
	`environment` text NOT NULL,
	`app_generation` text NOT NULL,
	`bank_id` text NOT NULL,
	`bank_name` text NOT NULL,
	`status` text NOT NULL,
	`encrypted_state` text NOT NULL,
	`selected_accounts` text DEFAULT '[]' NOT NULL,
	`valid_until` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`last_synced_at` text,
	`last_error` text,
	`request_key_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "bank_provider_kind" CHECK("bank_provider_connections"."provider_kind" = 'open_payments'),
	CONSTRAINT "bank_provider_revision" CHECK("bank_provider_connections"."revision" > 0),
	CONSTRAINT "bank_provider_environment" CHECK("bank_provider_connections"."environment" IN ('SANDBOX','PRODUCTION'))
);
--> statement-breakpoint
CREATE INDEX `bank_provider_owner_company` ON `bank_provider_connections` (`owner`,`company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bank_provider_request` ON `bank_provider_connections` (`owner`,`request_key_hash`);--> statement-breakpoint
ALTER TABLE `bank_auth_flows` ADD `company_version` integer;--> statement-breakpoint
ALTER TABLE `bank_auth_flows` ADD `provider_kind` text DEFAULT 'enable_banking' NOT NULL;--> statement-breakpoint
ALTER TABLE `bank_auth_flows` ADD `provider_payload` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bank_auth_flows` ADD `provider_connection_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bank_auth_flows` ADD `provider_flow_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bank_auth_flows` ADD `provider_request_key_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `bank_provider_flow_id` ON `bank_auth_flows` (`owner`,`provider_flow_id`) WHERE "bank_auth_flows"."provider_flow_id" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX `bank_provider_flow_request` ON `bank_auth_flows` (`owner`,`provider_request_key_hash`) WHERE "bank_auth_flows"."provider_request_key_hash" <> '';--> statement-breakpoint
ALTER TABLE `gmail_flows` ADD `company_version` integer;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_provider_connections_insert BEFORE INSERT ON bank_provider_connections
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_provider_connections_update BEFORE UPDATE ON bank_provider_connections
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_provider_connections_delete BEFORE DELETE ON bank_provider_connections
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_provider_bank_provider_connections_insert BEFORE INSERT ON bank_provider_connections
WHEN NOT EXISTS(SELECT 1 FROM companies c JOIN company_memberships m ON m.company_id=c.id JOIN company_operation_guard g ON g.slot=1 AND g.storage_owner=NEW.owner AND g.company_id=c.id AND g.actor_id=m.actor_id AND g.membership_version=m.membership_version WHERE c.id=NEW.company_id AND c.storage_owner=NEW.owner AND c.status='active' AND m.status='active' AND m.role IN ('owner','admin') AND g.authorized=1)
BEGIN SELECT RAISE(ABORT,'COMPANY_PROVIDER_SCOPE_INVALID'); END;
--> statement-breakpoint
CREATE TRIGGER company_provider_bank_provider_connections_update BEFORE UPDATE ON bank_provider_connections
WHEN NOT EXISTS(SELECT 1 FROM companies c JOIN company_memberships m ON m.company_id=c.id JOIN company_operation_guard g ON g.slot=1 AND g.storage_owner=NEW.owner AND g.company_id=c.id AND g.actor_id=m.actor_id AND g.membership_version=m.membership_version WHERE c.id=NEW.company_id AND c.storage_owner=NEW.owner AND c.status='active' AND m.status='active' AND m.role IN ('owner','admin') AND g.authorized=1)
BEGIN SELECT RAISE(ABORT,'COMPANY_PROVIDER_SCOPE_INVALID'); END;
--> statement-breakpoint
CREATE TRIGGER bank_provider_identity_immutable BEFORE UPDATE ON bank_provider_connections
WHEN NEW.id IS NOT OLD.id OR NEW.owner IS NOT OLD.owner OR NEW.company_id IS NOT OLD.company_id OR NEW.provider_kind IS NOT OLD.provider_kind OR NEW.environment IS NOT OLD.environment OR NEW.app_generation IS NOT OLD.app_generation OR NEW.bank_id IS NOT OLD.bank_id OR NEW.request_key_hash IS NOT OLD.request_key_hash OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'BANK_PROVIDER_IDENTITY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER bank_provider_revision_fence BEFORE UPDATE ON bank_provider_connections
WHEN NEW.revision<>OLD.revision+1
BEGIN SELECT RAISE(ABORT,'BANK_PROVIDER_REVISION_CONFLICT'); END;
--> statement-breakpoint
CREATE TRIGGER bank_provider_retained BEFORE DELETE ON bank_provider_connections
BEGIN SELECT RAISE(ABORT,'BANK_PROVIDER_RETAINED'); END;
--> statement-breakpoint
DROP TRIGGER company_flow_bank_auth_flows;
--> statement-breakpoint
CREATE TRIGGER company_flow_bank_auth_flows AFTER INSERT ON bank_auth_flows
WHEN EXISTS(SELECT 1 FROM company_operation_guard WHERE company_id IS NOT NULL AND storage_owner=NEW.owner)
BEGIN
 UPDATE bank_auth_flows SET company_id=(SELECT company_id FROM company_operation_guard WHERE slot=1),
 company_actor_id=(SELECT actor_id FROM company_operation_guard WHERE slot=1),
 company_context_version=(SELECT context_version FROM company_operation_guard WHERE slot=1),
 company_membership_version=(SELECT membership_version FROM company_operation_guard WHERE slot=1),
 company_version=(SELECT c.company_version FROM companies c JOIN company_operation_guard g ON g.company_id=c.id WHERE g.slot=1)
 WHERE state_hash=NEW.state_hash;
END;
--> statement-breakpoint
CREATE TRIGGER company_flow_bank_auth_flows_immutable BEFORE UPDATE ON bank_auth_flows
WHEN OLD.company_id IS NOT NULL AND (NEW.company_id IS NOT OLD.company_id OR NEW.company_actor_id IS NOT OLD.company_actor_id OR NEW.company_context_version IS NOT OLD.company_context_version OR NEW.company_membership_version IS NOT OLD.company_membership_version OR NEW.company_version IS NOT OLD.company_version)
BEGIN SELECT RAISE(ABORT,'COMPANY_FLOW_IMMUTABLE'); END;
--> statement-breakpoint
DROP TRIGGER company_flow_gmail_flows;
--> statement-breakpoint
CREATE TRIGGER company_flow_gmail_flows AFTER INSERT ON gmail_flows
WHEN EXISTS(SELECT 1 FROM company_operation_guard WHERE company_id IS NOT NULL AND storage_owner=NEW.owner)
BEGIN
 UPDATE gmail_flows SET company_id=(SELECT company_id FROM company_operation_guard WHERE slot=1),
 company_actor_id=(SELECT actor_id FROM company_operation_guard WHERE slot=1),
 company_context_version=(SELECT context_version FROM company_operation_guard WHERE slot=1),
 company_membership_version=(SELECT membership_version FROM company_operation_guard WHERE slot=1),
 company_version=(SELECT c.company_version FROM companies c JOIN company_operation_guard g ON g.company_id=c.id WHERE g.slot=1)
 WHERE state_hash=NEW.state_hash;
END;
--> statement-breakpoint
CREATE TRIGGER company_flow_gmail_flows_immutable BEFORE UPDATE ON gmail_flows
WHEN OLD.company_id IS NOT NULL AND (NEW.company_id IS NOT OLD.company_id OR NEW.company_actor_id IS NOT OLD.company_actor_id OR NEW.company_context_version IS NOT OLD.company_context_version OR NEW.company_membership_version IS NOT OLD.company_membership_version OR NEW.company_version IS NOT OLD.company_version)
BEGIN SELECT RAISE(ABORT,'COMPANY_FLOW_IMMUTABLE'); END;
--> statement-breakpoint
