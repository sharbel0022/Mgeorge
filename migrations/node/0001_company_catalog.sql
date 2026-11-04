-- Additive SaaS control plane. Existing business rows are never rewritten.
CREATE TABLE IF NOT EXISTS company_schema_migrations (
 version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS company_roles (role TEXT PRIMARY KEY);
INSERT OR IGNORE INTO company_roles(role) VALUES ('owner'),('admin'),('accountant'),('viewer');
CREATE TABLE IF NOT EXISTS companies (
 company_id TEXT PRIMARY KEY, name TEXT NOT NULL, storage_owner TEXT NOT NULL UNIQUE,
 database_key TEXT NOT NULL UNIQUE, company_version INTEGER NOT NULL DEFAULT 1 CHECK(company_version>0),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 verification_ref TEXT NOT NULL, verified_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS company_memberships (
 company_id TEXT NOT NULL REFERENCES companies(company_id), actor_id TEXT NOT NULL,
 role TEXT NOT NULL REFERENCES company_roles(role),
 membership_version INTEGER NOT NULL DEFAULT 1 CHECK(membership_version>0),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,actor_id)
);
CREATE TABLE IF NOT EXISTS company_active_contexts (
 actor_id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(company_id),
 context_version INTEGER NOT NULL DEFAULT 1 CHECK(context_version>0)
);
CREATE TRIGGER IF NOT EXISTS company_storage_identity_immutable
 BEFORE UPDATE OF company_id,storage_owner,database_key,verification_ref,verified_by ON companies
 BEGIN SELECT RAISE(ABORT,'company_storage_identity_immutable'); END;
CREATE TRIGGER IF NOT EXISTS company_storage_identity_no_replace BEFORE INSERT ON companies
 WHEN EXISTS(SELECT 1 FROM companies WHERE company_id=NEW.company_id OR storage_owner=NEW.storage_owner OR database_key=NEW.database_key)
 BEGIN SELECT RAISE(ABORT,'company_storage_identity_immutable'); END;
INSERT OR IGNORE INTO company_schema_migrations(version) VALUES(1);
