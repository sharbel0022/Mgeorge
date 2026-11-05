-- Additive only: existing connections and retained economic evidence are untouched.
ALTER TABLE bank_auth_flows ADD COLUMN context_json TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE bank_auth_flows ADD COLUMN result_code TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE bank_auth_flows ADD COLUMN connection_id TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE bank_connections ADD COLUMN consent_metadata TEXT NOT NULL DEFAULT '';

--> statement-breakpoint
CREATE TABLE saas_bank_state (owner TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL);
--> statement-breakpoint
CREATE TRIGGER company_boundary_saas_bank_state_insert BEFORE INSERT ON saas_bank_state
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_saas_bank_state_update BEFORE UPDATE ON saas_bank_state
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_saas_bank_state_delete BEFORE DELETE ON saas_bank_state
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
