CREATE TABLE `bank_provider_grant_claims` (
	`fingerprint` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`company_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider_kind` text NOT NULL,
	`environment` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "bank_provider_claim_kind" CHECK("bank_provider_grant_claims"."provider_kind" = 'open_payments'),
	CONSTRAINT "bank_provider_claim_environment" CHECK("bank_provider_grant_claims"."environment" IN ('SANDBOX','PRODUCTION'))
);
--> statement-breakpoint
CREATE INDEX `bank_provider_claim_owner` ON `bank_provider_grant_claims` (`owner`,`company_id`,`connection_id`);--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `session_fingerprint` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `bank_remote_session_unique` ON `bank_connections` (`session_fingerprint`) WHERE "bank_connections"."session_fingerprint" <> '';--> statement-breakpoint
ALTER TABLE `bank_provider_connections` ADD `grant_fingerprint` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `bank_provider_current_grant` ON `bank_provider_connections` (`grant_fingerprint`) WHERE "bank_provider_connections"."grant_fingerprint" <> '';
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_provider_grant_claims_insert BEFORE INSERT ON bank_provider_grant_claims
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_provider_grant_claims_update BEFORE UPDATE ON bank_provider_grant_claims
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_provider_grant_claims_delete BEFORE DELETE ON bank_provider_grant_claims
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_provider_bank_provider_grant_claims_insert BEFORE INSERT ON bank_provider_grant_claims
WHEN NOT EXISTS(SELECT 1 FROM companies c JOIN company_memberships m ON m.company_id=c.id JOIN company_operation_guard g ON g.slot=1 AND g.storage_owner=NEW.owner AND g.company_id=c.id AND g.actor_id=m.actor_id AND g.membership_version=m.membership_version WHERE c.id=NEW.company_id AND c.storage_owner=NEW.owner AND c.status='active' AND m.status='active' AND m.role IN ('owner','admin') AND g.authorized=1)
BEGIN SELECT RAISE(ABORT,'COMPANY_PROVIDER_SCOPE_INVALID'); END;
--> statement-breakpoint
CREATE TRIGGER bank_provider_claim_immutable BEFORE UPDATE ON bank_provider_grant_claims
BEGIN SELECT RAISE(ABORT,'BANK_PROVIDER_CLAIM_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER bank_provider_claim_retained BEFORE DELETE ON bank_provider_grant_claims
BEGIN SELECT RAISE(ABORT,'BANK_PROVIDER_CLAIM_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER bank_provider_claim_connection BEFORE INSERT ON bank_provider_grant_claims
WHEN NOT EXISTS(SELECT 1 FROM bank_provider_connections c WHERE c.id=NEW.connection_id AND c.owner=NEW.owner AND c.company_id=NEW.company_id AND c.provider_kind=NEW.provider_kind AND c.environment=NEW.environment)
BEGIN SELECT RAISE(ABORT,'BANK_PROVIDER_CLAIM_CONNECTION_INVALID'); END;
