-- Additive only: existing connections and retained economic evidence are untouched.
ALTER TABLE bank_auth_flows ADD COLUMN context_json TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE bank_auth_flows ADD COLUMN result_code TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE bank_auth_flows ADD COLUMN connection_id TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE bank_connections ADD COLUMN consent_metadata TEXT NOT NULL DEFAULT '';
