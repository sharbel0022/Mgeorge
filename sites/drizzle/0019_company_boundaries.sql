-- Additive catalogue and isolation fences. No financial payload or original is rewritten.
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`storage_owner` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`company_version` integer DEFAULT 1 NOT NULL,
	`boundary_version` integer DEFAULT 1 NOT NULL,
	`legacy_owner` text,
	`ownership_verified_by` text NOT NULL,
	`ownership_evidence` text NOT NULL,
	`ownership_verified_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "companies_status" CHECK("companies"."status" IN ('active','suspended')),
	CONSTRAINT "companies_version" CHECK("companies"."company_version">0),
	CONSTRAINT "companies_boundary" CHECK("companies"."boundary_version"=1),
	CONSTRAINT "companies_legacy_owner" CHECK("companies"."legacy_owner" IS NULL OR "companies"."legacy_owner"="companies"."storage_owner")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_storage_owner_unique` ON `companies` (`storage_owner`);--> statement-breakpoint
CREATE UNIQUE INDEX `companies_legacy_owner_unique` ON `companies` (`legacy_owner`);--> statement-breakpoint
CREATE TABLE `company_memberships` (
	`company_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`membership_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `actor_id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role`) REFERENCES `company_roles`(`role`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "company_membership_status" CHECK("company_memberships"."status" IN ('active','revoked')),
	CONSTRAINT "company_membership_version_positive" CHECK("company_memberships"."membership_version">0)
);
--> statement-breakpoint
CREATE INDEX `company_memberships_actor` ON `company_memberships` (`actor_id`,`status`);--> statement-breakpoint
CREATE TABLE `company_operation_guard` (
	`slot` integer PRIMARY KEY NOT NULL,
	`storage_owner` text NOT NULL,
	`company_id` text,
	`actor_id` text NOT NULL,
	`context_version` integer,
	`membership_version` integer,
	`action` text NOT NULL,
	`authorized` integer NOT NULL,
	CONSTRAINT "company_guard_singleton" CHECK("company_operation_guard"."slot"=1),
	CONSTRAINT "company_guard_authorized" CHECK("company_operation_guard"."authorized"=1)
);
--> statement-breakpoint
CREATE TABLE `company_roles` (
	`role` text PRIMARY KEY NOT NULL,
	CONSTRAINT "company_roles_valid" CHECK("company_roles"."role" IN ('owner','admin','accountant','viewer'))
);
--> statement-breakpoint
CREATE TABLE `company_user_contexts` (
	`actor_id` text PRIMARY KEY NOT NULL,
	`active_company_id` text,
	`context_version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`active_company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "company_context_version_positive" CHECK("company_user_contexts"."context_version">0)
);
--> statement-breakpoint
CREATE TABLE `company_worker_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`membership_version` integer NOT NULL,
	`company_version` integer NOT NULL,
	`runner` text NOT NULL,
	`credential_sha256` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`grant_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "company_worker_membership_version" CHECK("company_worker_grants"."membership_version">0),
	CONSTRAINT "company_worker_company_version" CHECK("company_worker_grants"."company_version">0),
	CONSTRAINT "company_worker_runner" CHECK("company_worker_grants"."runner" IN ('cloud','local')),
	CONSTRAINT "company_worker_credential" CHECK(length("company_worker_grants"."credential_sha256")=64),
	CONSTRAINT "company_worker_status" CHECK("company_worker_grants"."status" IN ('active','revoked')),
	CONSTRAINT "company_worker_version" CHECK("company_worker_grants"."grant_version">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_worker_grants_company_runner` ON `company_worker_grants` (`company_id`,`runner`) WHERE status='active';--> statement-breakpoint
CREATE UNIQUE INDEX `company_worker_grants_credential` ON `company_worker_grants` (`credential_sha256`);--> statement-breakpoint
ALTER TABLE `bank_auth_flows` ADD `company_id` text;--> statement-breakpoint
ALTER TABLE `bank_auth_flows` ADD `company_actor_id` text;--> statement-breakpoint
ALTER TABLE `bank_auth_flows` ADD `company_context_version` integer;--> statement-breakpoint
ALTER TABLE `bank_auth_flows` ADD `company_membership_version` integer;--> statement-breakpoint
ALTER TABLE `gmail_flows` ADD `company_id` text;--> statement-breakpoint
ALTER TABLE `gmail_flows` ADD `company_actor_id` text;--> statement-breakpoint
ALTER TABLE `gmail_flows` ADD `company_context_version` integer;--> statement-breakpoint
ALTER TABLE `gmail_flows` ADD `company_membership_version` integer;
--> statement-breakpoint
INSERT INTO company_roles(role) VALUES ('owner'),('admin'),('accountant'),('viewer');
--> statement-breakpoint
CREATE TRIGGER company_boundary_immutable BEFORE UPDATE OF id,storage_owner,boundary_version,legacy_owner ON companies
WHEN NEW.id IS NOT OLD.id OR NEW.storage_owner IS NOT OLD.storage_owner OR NEW.boundary_version IS NOT OLD.boundary_version OR NEW.legacy_owner IS NOT OLD.legacy_owner
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_retained BEFORE DELETE ON companies BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER company_membership_identity_immutable BEFORE UPDATE OF company_id,actor_id ON company_memberships
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.actor_id IS NOT OLD.actor_id
BEGIN SELECT RAISE(ABORT,'COMPANY_MEMBERSHIP_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER company_membership_version BEFORE UPDATE OF status,role ON company_memberships
WHEN NEW.membership_version<=OLD.membership_version
BEGIN SELECT RAISE(ABORT,'COMPANY_MEMBERSHIP_VERSION_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER company_membership_tombstone BEFORE DELETE ON company_memberships BEGIN SELECT RAISE(ABORT,'COMPANY_MEMBERSHIP_REVOKE_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER company_last_owner BEFORE UPDATE OF status,role ON company_memberships
WHEN OLD.role='owner' AND OLD.status='active' AND (NEW.role<>'owner' OR NEW.status<>'active')
 AND NOT EXISTS(SELECT 1 FROM company_memberships WHERE company_id=OLD.company_id AND actor_id<>OLD.actor_id AND role='owner' AND status='active')
BEGIN SELECT RAISE(ABORT,'COMPANY_LAST_OWNER'); END;
--> statement-breakpoint
CREATE TRIGGER company_context_version BEFORE UPDATE OF active_company_id ON company_user_contexts
WHEN NEW.context_version<=OLD.context_version
BEGIN SELECT RAISE(ABORT,'COMPANY_CONTEXT_VERSION_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_audit_events_insert BEFORE INSERT ON audit_events
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_audit_events_update BEFORE UPDATE ON audit_events
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_audit_events_delete BEFORE DELETE ON audit_events
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_backup_runs_insert BEFORE INSERT ON backup_runs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_backup_runs_update BEFORE UPDATE ON backup_runs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_backup_runs_delete BEFORE DELETE ON backup_runs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_applications_insert BEFORE INSERT ON bank_applications
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_applications_update BEFORE UPDATE ON bank_applications
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_applications_delete BEFORE DELETE ON bank_applications
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_auth_flows_insert BEFORE INSERT ON bank_auth_flows
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_auth_flows_update BEFORE UPDATE ON bank_auth_flows
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_auth_flows_delete BEFORE DELETE ON bank_auth_flows
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_connections_insert BEFORE INSERT ON bank_connections
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_connections_update BEFORE UPDATE ON bank_connections
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_connections_delete BEFORE DELETE ON bank_connections
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_locks_insert BEFORE INSERT ON bank_locks
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_locks_update BEFORE UPDATE ON bank_locks
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_locks_delete BEFORE DELETE ON bank_locks
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_sync_runs_insert BEFORE INSERT ON bank_sync_runs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_sync_runs_update BEFORE UPDATE ON bank_sync_runs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bank_sync_runs_delete BEFORE DELETE ON bank_sync_runs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bankgiro_ingest_jobs_insert BEFORE INSERT ON bankgiro_ingest_jobs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bankgiro_ingest_jobs_update BEFORE UPDATE ON bankgiro_ingest_jobs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bankgiro_ingest_jobs_delete BEFORE DELETE ON bankgiro_ingest_jobs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bankgiro_ingest_leases_insert BEFORE INSERT ON bankgiro_ingest_leases
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bankgiro_ingest_leases_update BEFORE UPDATE ON bankgiro_ingest_leases
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bankgiro_ingest_leases_delete BEFORE DELETE ON bankgiro_ingest_leases
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bankgiro_ingest_sources_insert BEFORE INSERT ON bankgiro_ingest_sources
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bankgiro_ingest_sources_update BEFORE UPDATE ON bankgiro_ingest_sources
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_bankgiro_ingest_sources_delete BEFORE DELETE ON bankgiro_ingest_sources
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_customer_contacts_insert BEFORE INSERT ON customer_contacts
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_customer_contacts_update BEFORE UPDATE ON customer_contacts
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_customer_contacts_delete BEFORE DELETE ON customer_contacts
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_customer_deliveries_insert BEFORE INSERT ON customer_deliveries
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_customer_deliveries_update BEFORE UPDATE ON customer_deliveries
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_customer_deliveries_delete BEFORE DELETE ON customer_deliveries
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_customer_messages_insert BEFORE INSERT ON customer_messages
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_customer_messages_update BEFORE UPDATE ON customer_messages
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_customer_messages_delete BEFORE DELETE ON customer_messages
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_customer_reviews_insert BEFORE INSERT ON customer_reviews
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_customer_reviews_update BEFORE UPDATE ON customer_reviews
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_customer_reviews_delete BEFORE DELETE ON customer_reviews
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_document_automation_insert BEFORE INSERT ON document_automation
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_document_automation_update BEFORE UPDATE ON document_automation
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_document_automation_delete BEFORE DELETE ON document_automation
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_document_extractions_insert BEFORE INSERT ON document_extractions
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_document_extractions_update BEFORE UPDATE ON document_extractions
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_document_extractions_delete BEFORE DELETE ON document_extractions
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_document_jobs_insert BEFORE INSERT ON document_jobs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_document_jobs_update BEFORE UPDATE ON document_jobs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_document_jobs_delete BEFORE DELETE ON document_jobs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_document_registrations_insert BEFORE INSERT ON document_registrations
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_document_registrations_update BEFORE UPDATE ON document_registrations
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_document_registrations_delete BEFORE DELETE ON document_registrations
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_documents_insert BEFORE INSERT ON documents
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_documents_update BEFORE UPDATE ON documents
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_documents_delete BEFORE DELETE ON documents
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_gmail_connections_insert BEFORE INSERT ON gmail_connections
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_gmail_connections_update BEFORE UPDATE ON gmail_connections
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_gmail_connections_delete BEFORE DELETE ON gmail_connections
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_gmail_flows_insert BEFORE INSERT ON gmail_flows
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_gmail_flows_update BEFORE UPDATE ON gmail_flows
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_gmail_flows_delete BEFORE DELETE ON gmail_flows
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_gmail_locks_insert BEFORE INSERT ON gmail_locks
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_gmail_locks_update BEFORE UPDATE ON gmail_locks
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_gmail_locks_delete BEFORE DELETE ON gmail_locks
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_gmail_runs_insert BEFORE INSERT ON gmail_runs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_gmail_runs_update BEFORE UPDATE ON gmail_runs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_gmail_runs_delete BEFORE DELETE ON gmail_runs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_gmail_sources_insert BEFORE INSERT ON gmail_sources
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_gmail_sources_update BEFORE UPDATE ON gmail_sources
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_gmail_sources_delete BEFORE DELETE ON gmail_sources
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_invoice_counterparties_insert BEFORE INSERT ON invoice_counterparties
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_invoice_counterparties_update BEFORE UPDATE ON invoice_counterparties
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_invoice_counterparties_delete BEFORE DELETE ON invoice_counterparties
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_payment_control_requests_insert BEFORE INSERT ON payment_control_requests
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_payment_control_requests_update BEFORE UPDATE ON payment_control_requests
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_payment_control_requests_delete BEFORE DELETE ON payment_control_requests
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_payment_control_runs_insert BEFORE INSERT ON payment_control_runs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_payment_control_runs_update BEFORE UPDATE ON payment_control_runs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_payment_control_runs_delete BEFORE DELETE ON payment_control_runs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_reconciliation_findings_insert BEFORE INSERT ON reconciliation_findings
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_reconciliation_findings_update BEFORE UPDATE ON reconciliation_findings
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_reconciliation_findings_delete BEFORE DELETE ON reconciliation_findings
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_workspaces_insert BEFORE INSERT ON workspaces
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_workspaces_update BEFORE UPDATE ON workspaces
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_workspaces_delete BEFORE DELETE ON workspaces
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_flow_bank_auth_flows AFTER INSERT ON bank_auth_flows
WHEN EXISTS(SELECT 1 FROM company_operation_guard WHERE company_id IS NOT NULL AND storage_owner=NEW.owner)
BEGIN
 UPDATE bank_auth_flows SET company_id=(SELECT company_id FROM company_operation_guard WHERE slot=1),
 company_actor_id=(SELECT actor_id FROM company_operation_guard WHERE slot=1),
 company_context_version=(SELECT context_version FROM company_operation_guard WHERE slot=1),
 company_membership_version=(SELECT membership_version FROM company_operation_guard WHERE slot=1)
 WHERE state_hash=NEW.state_hash;
END;
--> statement-breakpoint
CREATE TRIGGER company_flow_gmail_flows AFTER INSERT ON gmail_flows
WHEN EXISTS(SELECT 1 FROM company_operation_guard WHERE company_id IS NOT NULL AND storage_owner=NEW.owner)
BEGIN
 UPDATE gmail_flows SET company_id=(SELECT company_id FROM company_operation_guard WHERE slot=1),
 company_actor_id=(SELECT actor_id FROM company_operation_guard WHERE slot=1),
 company_context_version=(SELECT context_version FROM company_operation_guard WHERE slot=1),
 company_membership_version=(SELECT membership_version FROM company_operation_guard WHERE slot=1)
 WHERE state_hash=NEW.state_hash;
END;
--> statement-breakpoint
CREATE TRIGGER company_worker_credential_immutable BEFORE UPDATE OF id,company_id,runner,credential_sha256 ON company_worker_grants
WHEN NEW.id IS NOT OLD.id OR NEW.company_id IS NOT OLD.company_id OR NEW.runner IS NOT OLD.runner OR NEW.credential_sha256 IS NOT OLD.credential_sha256
BEGIN SELECT RAISE(ABORT,'COMPANY_WORKER_CREDENTIAL_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER company_worker_credential_retained BEFORE DELETE ON company_worker_grants BEGIN SELECT RAISE(ABORT,'COMPANY_WORKER_CREDENTIAL_RETAINED'); END;
