-- Control-plane state. Never register these tables in a tenant query/backup API.
CREATE TABLE IF NOT EXISTS company_application_token_control (
  id INTEGER PRIMARY KEY NOT NULL CHECK(id=1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
  recovery_required INTEGER NOT NULL DEFAULT 0 CHECK(typeof(recovery_required)='integer' AND recovery_required IN (0,1)),
  restore_marker TEXT NOT NULL DEFAULT '' CHECK(length(restore_marker)<=100),
  recovery_evidence TEXT NOT NULL DEFAULT '' CHECK(length(recovery_evidence)<=200)
);
INSERT OR IGNORE INTO company_application_token_control(id) VALUES(1);
CREATE TABLE IF NOT EXISTS company_application_tokens (
  family_key TEXT PRIMARY KEY NOT NULL CHECK(length(family_key)=64 AND family_key NOT GLOB '*[^a-f0-9]*'),
  config_hash TEXT NOT NULL CHECK(length(config_hash)=64 AND config_hash NOT GLOB '*[^a-f0-9]*'),
  configuration_evidence TEXT NOT NULL DEFAULT '' CHECK(length(configuration_evidence)<=200),
  epoch INTEGER NOT NULL DEFAULT 1 CHECK(typeof(epoch)='integer' AND epoch BETWEEN 1 AND 9007199254740991),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
  token_ciphertext TEXT NOT NULL DEFAULT '' CHECK(length(token_ciphertext)<=32768),
  token_version TEXT NOT NULL DEFAULT '' CHECK(length(token_version)<=100),
  expires_at INTEGER NOT NULL DEFAULT 0 CHECK(typeof(expires_at)='integer' AND expires_at BETWEEN 0 AND 8640000000000000),
  lease_token TEXT NOT NULL DEFAULT '' CHECK(length(lease_token)<=100),
  lease_until INTEGER NOT NULL DEFAULT 0 CHECK(typeof(lease_until)='integer' AND lease_until BETWEEN 0 AND 8640000000000000),
  fence INTEGER NOT NULL DEFAULT 0 CHECK(typeof(fence)='integer' AND fence BETWEEN 0 AND 9007199254740991),
  uncertain_until INTEGER NOT NULL DEFAULT 0 CHECK(typeof(uncertain_until)='integer' AND uncertain_until BETWEEN 0 AND 8640000000000000),
  cooldown_until INTEGER NOT NULL DEFAULT 0 CHECK(typeof(cooldown_until)='integer' AND cooldown_until BETWEEN 0 AND 8640000000000000),
  cooldown_blocked INTEGER NOT NULL DEFAULT 0 CHECK(typeof(cooldown_blocked)='integer' AND cooldown_blocked IN (0,1)),
  last_safe_code TEXT NOT NULL DEFAULT '' CHECK(length(last_safe_code)<=80 AND last_safe_code NOT GLOB '*[^A-Z_]*'),
  updated_at INTEGER NOT NULL DEFAULT 0 CHECK(typeof(updated_at)='integer' AND updated_at BETWEEN 0 AND 8640000000000000),
  CHECK((token_ciphertext='' AND token_version='' AND expires_at=0) OR (token_ciphertext<>'' AND token_version<>'' AND expires_at>0)),
  CHECK((lease_token='' AND lease_until=0) OR (lease_token<>'' AND lease_until>0 AND uncertain_until>=lease_until))
);
