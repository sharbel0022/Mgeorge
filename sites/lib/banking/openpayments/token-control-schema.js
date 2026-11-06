// Shared, side-effect-free control-plane schema. Request paths do not run DDL.
// Node backup uses only this gate; application token rows never enter an export.
export const APPLICATION_TOKEN_CONTROL_SCHEMA = `CREATE TABLE IF NOT EXISTS company_application_token_control (
  id INTEGER PRIMARY KEY NOT NULL CHECK(id=1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
  recovery_required INTEGER NOT NULL DEFAULT 0 CHECK(typeof(recovery_required)='integer' AND recovery_required IN (0,1)),
  restore_marker TEXT NOT NULL DEFAULT '' CHECK(length(restore_marker)<=100),
  recovery_evidence TEXT NOT NULL DEFAULT '' CHECK(length(recovery_evidence)<=200)
);`;
