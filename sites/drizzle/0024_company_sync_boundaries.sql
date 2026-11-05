-- Protect additive sync coordination under the same authoritative company guard.

--> statement-breakpoint
CREATE TRIGGER company_boundary_company_bank_sync_jobs_insert BEFORE INSERT ON company_bank_sync_jobs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_company_bank_sync_jobs_update BEFORE UPDATE ON company_bank_sync_jobs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_company_bank_sync_jobs_delete BEFORE DELETE ON company_bank_sync_jobs
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_company_bank_sync_receipts_insert BEFORE INSERT ON company_bank_sync_receipts
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_company_bank_sync_receipts_update BEFORE UPDATE ON company_bank_sync_receipts
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_company_bank_sync_receipts_delete BEFORE DELETE ON company_bank_sync_receipts
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_company_bank_sync_requests_insert BEFORE INSERT ON company_bank_sync_requests
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_company_bank_sync_requests_update BEFORE UPDATE ON company_bank_sync_requests
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_company_bank_sync_requests_delete BEFORE DELETE ON company_bank_sync_requests
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_company_bank_sync_scopes_insert BEFORE INSERT ON company_bank_sync_scopes
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_company_bank_sync_scopes_update BEFORE UPDATE ON company_bank_sync_scopes
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner)) OR ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=NEW.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=NEW.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
--> statement-breakpoint
CREATE TRIGGER company_boundary_company_bank_sync_scopes_delete BEFORE DELETE ON company_bank_sync_scopes
WHEN ((EXISTS(SELECT 1 FROM companies WHERE storage_owner=OLD.owner) OR EXISTS(SELECT 1 FROM company_operation_guard)) AND NOT EXISTS(SELECT 1 FROM company_operation_guard WHERE slot=1 AND authorized=1 AND storage_owner=OLD.owner))
BEGIN SELECT RAISE(ABORT,'COMPANY_BOUNDARY_VIOLATION'); END;
