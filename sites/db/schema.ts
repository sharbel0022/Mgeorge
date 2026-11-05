import { primaryKey, sqliteTable, text, integer, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";
import { sql } from 'drizzle-orm';
export const workspaces = sqliteTable("workspaces", {
  owner: text("owner").primaryKey(), revision: integer("revision").notNull().default(0),
  payload: text("payload").notNull(), updatedAt: text("updated_at").notNull(),
});
export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(), owner: text("owner").notNull(), revision: integer("revision").notNull(),
  action: text("action").notNull(), detail: text("detail").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [index("audit_owner_revision").on(t.owner, t.revision)]);
export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(), owner: text("owner").notNull(), filename: text("filename").notNull(),
  mime: text("mime").notNull(), size: integer("size").notNull(), sha256: text("sha256").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [index("documents_owner_hash").on(t.owner, t.sha256)]);

export const bankApplications = sqliteTable('bank_applications', {
  owner: text('owner').primaryKey(), applicationId: text('application_id').notNull(),
  encryptedKey: text('encrypted_key').notNull(), metadata: text('metadata').notNull(),
  generation: text('generation').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
export const bankConnections = sqliteTable('bank_connections', {
  id: text('id').primaryKey(), owner: text('owner').notNull().unique(), appGeneration: text('app_generation').notNull(),
  environment: text('environment').notNull(), bankName: text('bank_name').notNull(), country: text('country').notNull(),
  encryptedSession: text('encrypted_session').notNull(), encryptedAccounts: text('encrypted_accounts').notNull(),
  selectedAccounts: text('selected_accounts').notNull().default('[]'), validUntil: text('valid_until').notNull(),
  dateFrom: text('date_from').notNull(), status: text('status').notNull(), lastSyncedAt: text('last_synced_at'),
  lastError: text('last_error'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
  autoSyncEnabled: integer('auto_sync_enabled').notNull().default(0),
  autoLastAttemptAt: text('auto_last_attempt_at'), autoNextAt: text('auto_next_at'),
  retryAfter: text('retry_after').notNull().default(''), syncFailures: integer('sync_failures').notNull().default(0),
  accountEvidenceRetry: text('account_evidence_retry').notNull().default(''),
  controlLastAttemptAt: text('control_last_attempt_at'),
  consentMetadata: text('consent_metadata').notNull().default(''),
});
export const bankAuthFlows = sqliteTable('bank_auth_flows', {
  stateHash: text('state_hash').primaryKey(), owner: text('owner').notNull(), cookieHash: text('cookie_hash').notNull(),
  appGeneration: text('app_generation').notNull(), bankName: text('bank_name').notNull(), country: text('country').notNull(),
  environment: text('environment').notNull(), redirectUri: text('redirect_uri').notNull(), dateFrom: text('date_from').notNull(),
  expiresAt: text('expires_at').notNull(), status: text('status').notNull(), createdAt: text('created_at').notNull(),
  contextJson: text('context_json').notNull().default(''), resultCode: text('result_code').notNull().default(''),
  connectionId: text('connection_id').notNull().default(''),
  companyId:text('company_id'),companyActorId:text('company_actor_id'),companyContextVersion:integer('company_context_version'),companyMembershipVersion:integer('company_membership_version'),
}, t => [index('bank_flow_owner').on(t.owner)]);
export const bankSyncRuns = sqliteTable('bank_sync_runs', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), connectionId: text('connection_id').notNull(),
  imported: integer('imported').notNull(), skipped: integer('skipped').notNull(), warnings: text('warnings').notNull(),
  test: integer('test').notNull().default(0), createdAt: text('created_at').notNull(),
}, t => [index('bank_run_owner_created').on(t.owner, t.createdAt)]);
export const bankLocks = sqliteTable('bank_locks', {
  owner: text('owner').primaryKey(), token: text('token').notNull(), expiresAt: text('expires_at').notNull(),
});

// Report delivery state is separate from AIS connections and financial rows.
export const bankgiroIngestSources=sqliteTable('bankgiro_ingest_sources',{
 owner:text('owner').notNull(),sourceId:text('source_id').notNull(),scopeId:text('scope_id'),
 revokedGenerations:text('revoked_generations').notNull().default('[]'),
 registrationRevision:integer('registration_revision').notNull().default(0),registrationBinding:text('registration_binding'),
 authorizationVerifiedAt:integer('authorization_verified_at'),authorizationValidUntil:integer('authorization_valid_until'),
 lastSuccessAt:integer('last_success_at'),lastFailureAt:integer('last_failure_at'),lastFailureCode:text('last_failure_code'),
 authorizationGeneration:text('authorization_generation'),authorizationStatus:text('authorization_status').notNull().default('REVIEW'),
 cursor:text('cursor'),missingReportIds:text('missing_report_ids').notNull().default('[]'),nextPollAt:integer('next_poll_at'),
 attempts:integer('attempts').notNull().default(0),lastError:text('last_error'),updatedAt:integer('updated_at').notNull(),
},t=>[primaryKey({columns:[t.owner,t.sourceId]})]);
export const bankgiroIngestJobs=sqliteTable('bankgiro_ingest_jobs',{
 id:text('id').primaryKey().notNull(),owner:text('owner').notNull(),sourceId:text('source_id').notNull(),scopeId:text('scope_id').notNull(),
 registrationBinding:text('registration_binding').notNull().default(''),
 reportId:text('report_id').notNull(),sha256:text('sha256').notNull(),filename:text('filename').notNull(),availableAt:text('available_at'),
 authorizationGeneration:text('authorization_generation').notNull(),documentId:text('document_id'),status:text('status').notNull().default('PENDING'),
 attempts:integer('attempts').notNull().default(0),nextAttemptAt:integer('next_attempt_at'),lastError:text('last_error'),
 importId:text('import_id'),paymentCount:integer('payment_count').notNull().default(0),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),
},t=>[
 uniqueIndex('bankgiro_ingest_jobs_owner_report_hash').on(t.owner,t.sourceId,t.scopeId,t.reportId,t.sha256,t.registrationBinding),
 index('bankgiro_ingest_jobs_due').on(t.owner,t.sourceId,t.status,t.nextAttemptAt),
 index('bankgiro_ingest_jobs_hash').on(t.owner,t.sha256),index('bankgiro_ingest_jobs_identity').on(t.owner,t.scopeId,t.reportId),
]);
export const bankgiroIngestLeases=sqliteTable('bankgiro_ingest_leases',{
 owner:text('owner').primaryKey().notNull(),token:text('token').notNull(),expiresAt:integer('expires_at').notNull(),
});

// Gmail owns separate rows and never rewrites bank connections or keys.
export const gmailConnections = sqliteTable('gmail_connections', {
  owner:text('owner').primaryKey(),email:text('email').notNull(),tokens:text('tokens').notNull(),
  lastSynced:text('last_synced').notNull().default(''),pageToken:text('page_token').notNull().default(''),startedAt:text('started_at').notNull().default(''),status:text('status').notNull().default('connected'),lastAttempt:text('last_attempt').notNull().default(''),
  retryAfter:text('retry_after').notNull().default(''),
  syncFailures:integer('sync_failures').notNull().default(0),
});
export const gmailFlows=sqliteTable('gmail_flows',{
  companyId:text('company_id'),companyActorId:text('company_actor_id'),companyContextVersion:integer('company_context_version'),companyMembershipVersion:integer('company_membership_version'),
  stateHash:text('state_hash').primaryKey(),owner:text('owner').notNull(),cookieHash:text('cookie_hash').notNull(),expiresAt:text('expires_at').notNull(),consumed:integer('consumed').notNull().default(0),
  requestSend:integer('request_send').notNull().default(0),
});
export const customerContacts=sqliteTable('customer_contacts',{
  owner:text('owner').notNull(),invoiceId:text('invoice_id').notNull(),email:text('email').notNull(),identity:text('identity').notNull(),evidence:text('evidence').notNull(),version:integer('version').notNull().default(1),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.owner,t.invoiceId]})]);
export const customerMessages=sqliteTable('customer_messages',{
  id:text('id').primaryKey(),owner:text('owner').notNull(),invoiceId:text('invoice_id').notNull(),kind:text('kind').notNull(),recipient:text('recipient').notNull(),subject:text('subject').notNull(),body:text('body').notNull(),snapshot:text('snapshot').notNull(),version:integer('version').notNull().default(1),status:text('status').notNull().default('draft'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[index('messages_owner_invoice').on(t.owner,t.invoiceId),uniqueIndex('messages_evidence_unique').on(t.owner,t.invoiceId,t.kind,t.snapshot)]);
export const reconciliationFindings=sqliteTable('reconciliation_findings',{
  id:text('id').primaryKey(),owner:text('owner').notNull(),invoiceId:text('invoice_id').notNull(),transactionId:text('transaction_id').notNull(),kind:text('kind').notNull(),details:text('details').notNull(),active:integer('active').notNull().default(1),createdAt:text('created_at').notNull(),
},t=>[index('findings_owner').on(t.owner)]);
export const customerReviews=sqliteTable('customer_reviews',{
  id:text('id').primaryKey(),owner:text('owner').notNull(),messageId:text('message_id').notNull(),version:integer('version').notNull(),snapshot:text('snapshot').notNull(),cookieHash:text('cookie_hash').notNull(),expiresAt:text('expires_at').notNull(),consumed:integer('consumed').notNull().default(0),
});
export const customerDeliveries=sqliteTable('customer_deliveries',{
  id:text('id').primaryKey(),owner:text('owner').notNull(),messageId:text('message_id').notNull().unique(),reviewId:text('review_id').notNull().unique(),version:integer('version').notNull(),snapshot:text('snapshot').notNull(),recipient:text('recipient').notNull(),subject:text('subject').notNull(),body:text('body').notNull(),status:text('status').notNull(),gmailMessageId:text('gmail_message_id').notNull().default(''),rfcMessageId:text('rfc_message_id').notNull(),approvedAt:text('approved_at').notNull(),sentAt:text('sent_at').notNull().default(''),
});
export const gmailSources=sqliteTable('gmail_sources',{
  owner:text('owner').notNull(),sourceId:text('source_id').notNull(),documentId:text('document_id').notNull(),metadata:text('metadata').notNull(),status:text('status').notNull().default('needs_review'),extraction:text('extraction').notNull().default('{}'),createdAt:text('created_at').notNull(),
},t=>[primaryKey({columns:[t.owner,t.sourceId]})]);
export const gmailRuns=sqliteTable('gmail_runs',{
  id:text('id').primaryKey(),owner:text('owner').notNull(),found:integer('found'),imported:integer('imported'),duplicates:integer('duplicates'),status:text('status').notNull(),createdAt:text('created_at').notNull(),
});
export const gmailLocks=sqliteTable('gmail_locks',{
  owner:text('owner').primaryKey(),token:text('token').notNull(),expiresAt:text('expires_at').notNull(),
});
export const documentAutomation=sqliteTable('document_automation',{
  owner:text('owner').primaryKey(),email:text('email').notNull(),enabled:integer('enabled').notNull().default(0),autoRegister:integer('auto_register').notNull().default(1),workerSeen:text('worker_seen').notNull().default(''),cloudWorkerSeen:text('cloud_worker_seen').notNull().default(''),cloudWorkerCompleted:text('cloud_worker_completed').notNull().default(''),lastCloudRun:text('last_cloud_run').notNull().default(''),updatedAt:text('updated_at').notNull(),
});
export const documentJobs=sqliteTable('document_jobs',{
  owner:text('owner').notNull(),documentId:text('document_id').notNull(),state:text('state').notNull().default('queued'),engine:text('engine').notNull().default('cloud'),attempts:integer('attempts').notNull().default(0),availableAt:text('available_at').notNull(),lease:text('lease').notNull().default(''),leaseUntil:text('lease_until').notNull().default(''),leaseRunner:text('lease_runner').notNull().default('local'),extraction:text('extraction').notNull().default('{}'),errorCode:text('error_code').notNull().default(''),invoiceId:text('invoice_id').notNull().default(''),automatic:integer('automatic').notNull().default(0),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.owner,t.documentId]}),index('document_job_due').on(t.owner,t.state,t.availableAt)]);
export const documentExtractions=sqliteTable('document_extractions',{
  id:text('id').primaryKey(),owner:text('owner').notNull(),documentId:text('document_id').notNull(),result:text('result').notNull(),createdAt:text('created_at').notNull(),
});
export const invoiceCounterparties=sqliteTable('invoice_counterparties',{
  owner:text('owner').notNull(),identity:text('identity').notNull(),email:text('email').notNull(),bankgiro:text('bankgiro').notNull().default(''),currency:text('currency').notNull().default('SEK'),evidence:text('evidence').notNull(),version:integer('version').notNull().default(1),verifiedAt:text('verified_at').notNull(),
},t=>[primaryKey({columns:[t.owner,t.identity]})]);
export const documentRegistrations=sqliteTable('document_registrations',{
  owner:text('owner').notNull(),documentId:text('document_id').notNull(),identity:text('identity').notNull(),invoiceId:text('invoice_id').notNull(),attempt:text('attempt').notNull(),total:integer('total').notNull(),createdAt:text('created_at').notNull(),
},t=>[primaryKey({columns:[t.owner,t.documentId]}),uniqueIndex('document_invoice_identity').on(t.owner,t.identity)]);

// Durable manual controls. Financial data and originals stay in their existing tables.
export const paymentControlRuns=sqliteTable('payment_control_runs',{
  id:text('id').primaryKey(),owner:text('owner').notNull(),status:text('status').notNull(),
  steps:text('steps').notNull(),lease:text('lease').notNull().default(''),leaseUntil:text('lease_until').notNull().default(''),
  startedAt:text('started_at').notNull(),finishedAt:text('finished_at').notNull().default(''),updatedAt:text('updated_at').notNull(),
},t=>[index('control_owner_started').on(t.owner,t.startedAt),uniqueIndex('control_one_active_owner').on(t.owner).where(sql`${t.status} = 'running'`)]);
export const paymentControlRequests=sqliteTable('payment_control_requests',{
  owner:text('owner').notNull(),requestId:text('request_id').notNull(),runId:text('run_id').notNull(),createdAt:text('created_at').notNull(),
},t=>[primaryKey({columns:[t.owner,t.requestId]})]);

export const backupRuns=sqliteTable('backup_runs',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),day:text('day').notNull(),state:text('state').notNull(),
 snapshotKey:text('snapshot_key').notNull().default(''),snapshotHash:text('snapshot_hash').notNull().default(''),
 cursor:integer('cursor').notNull().default(0),totalDocs:integer('total_docs').notNull().default(0),bytes:integer('bytes').notNull().default(0),attempts:integer('attempts').notNull().default(0),
 apiEvidence:text('api_evidence').notNull().default(''),
 verificationCursor:integer('verification_cursor').notNull().default(0),verifiedBytes:integer('verified_bytes').notNull().default(0),verificationStartedAt:text('verification_started_at').notNull().default(''),
 lease:text('lease').notNull().default(''),leaseUntil:text('lease_until').notNull().default(''),lastError:text('last_error').notNull().default(''),
 createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),finishedAt:text('finished_at').notNull().default(''),
},t=>[uniqueIndex('backup_owner_day').on(t.owner,t.day),index('backup_owner_created').on(t.owner,t.createdAt)]);

// Company catalogue is additive. Existing owner values remain immutable storage
// identities, including R2 prefixes and bank/Gmail encryption associated data.
export const companyRoles=sqliteTable('company_roles',{
 role:text('role').primaryKey().notNull(),
},t=>[check('company_roles_valid',sql`${t.role} IN ('owner','admin','accountant','viewer')`)]);
export const companies=sqliteTable('companies',{
 id:text('id').primaryKey().notNull(),name:text('name').notNull(),storageOwner:text('storage_owner').notNull().unique(),
 status:text('status').notNull().default('active'),companyVersion:integer('company_version').notNull().default(1),boundaryVersion:integer('boundary_version').notNull().default(1),legacyOwner:text('legacy_owner').unique(),
 ownershipVerifiedBy:text('ownership_verified_by').notNull(),ownershipEvidence:text('ownership_evidence').notNull(),ownershipVerifiedAt:text('ownership_verified_at').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[check('companies_status',sql`${t.status} IN ('active','suspended')`),check('companies_version',sql`${t.companyVersion}>0`),check('companies_boundary',sql`${t.boundaryVersion}=1`),check('companies_legacy_owner',sql`${t.legacyOwner} IS NULL OR ${t.legacyOwner}=${t.storageOwner}`)]);
export const companyMemberships=sqliteTable('company_memberships',{
 companyId:text('company_id').notNull().references(()=>companies.id),actorId:text('actor_id').notNull(),role:text('role').notNull().references(()=>companyRoles.role),status:text('status').notNull().default('active'),membershipVersion:integer('membership_version').notNull().default(1),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.companyId,t.actorId]}),index('company_memberships_actor').on(t.actorId,t.status),check('company_membership_status',sql`${t.status} IN ('active','revoked')`),check('company_membership_version_positive',sql`${t.membershipVersion}>0`)]);
export const companyUserContexts=sqliteTable('company_user_contexts',{
 actorId:text('actor_id').primaryKey().notNull(),activeCompanyId:text('active_company_id').references(()=>companies.id),contextVersion:integer('context_version').notNull().default(1),updatedAt:text('updated_at').notNull(),
},t=>[check('company_context_version_positive',sql`${t.contextVersion}>0`)]);
export const companyWorkerGrants=sqliteTable('company_worker_grants',{
 id:text('id').primaryKey().notNull(),companyId:text('company_id').notNull().references(()=>companies.id),actorId:text('actor_id').notNull(),membershipVersion:integer('membership_version').notNull(),companyVersion:integer('company_version').notNull(),runner:text('runner').notNull(),credentialSha256:text('credential_sha256').notNull(),status:text('status').notNull().default('active'),grantVersion:integer('grant_version').notNull().default(1),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('company_worker_grants_company_runner').on(t.companyId,t.runner).where(sql`${t.status} = 'active'`),uniqueIndex('company_worker_grants_credential').on(t.credentialSha256),check('company_worker_membership_version',sql`${t.membershipVersion}>0`),check('company_worker_company_version',sql`${t.companyVersion}>0`),check('company_worker_runner',sql`${t.runner} IN ('cloud','local')`),check('company_worker_credential',sql`length(${t.credentialSha256})=64`),check('company_worker_status',sql`${t.status} IN ('active','revoked')`),check('company_worker_version',sql`${t.grantVersion}>0`)]);
export const companyOperationGuard=sqliteTable('company_operation_guard',{
 slot:integer('slot').primaryKey(),storageOwner:text('storage_owner').notNull(),companyId:text('company_id'),actorId:text('actor_id').notNull(),contextVersion:integer('context_version'),membershipVersion:integer('membership_version'),action:text('action').notNull(),authorized:integer('authorized').notNull(),
},t=>[check('company_guard_singleton',sql`${t.slot}=1`),check('company_guard_authorized',sql`${t.authorized}=1`)]);

// Company coordination is additive. Existing financial records keep their keys.
export const companyBankSyncScopes=sqliteTable('company_bank_sync_scopes',{
 companyId:text('company_id').primaryKey().notNull(),owner:text('owner').notNull().unique(),evidenceId:text('evidence_id').notNull(),
 revision:integer('revision').notNull().default(1),referencePolicy:text('reference_policy'),createdAt:integer('created_at').notNull(),
});
export const companyBankSyncJobs=sqliteTable('company_bank_sync_jobs',{
 companyId:text('company_id').notNull(),accountKey:text('account_key').notNull(),owner:text('owner').notNull(),provider:text('provider').notNull(),connectionId:text('connection_id').notNull(),
 authorityHash:text('authority_hash').notNull(),generationHash:text('generation_hash').notNull(),authorityRevision:integer('authority_revision').notNull(),validUntil:integer('valid_until').notNull(),revoked:integer('revoked').notNull().default(0),
 leaseToken:text('lease_token').notNull().default(''),leaseUntil:integer('lease_until').notNull().default(0),leaseDeadline:integer('lease_deadline').notNull().default(0),fenceVersion:integer('fence_version').notNull().default(0),
 status:text('status').notNull().default('queued'),attempts:integer('attempts').notNull().default(0),lastAttemptAt:integer('last_attempt_at'),lastSuccessAt:integer('last_success_at'),
 nextAttemptAt:integer('next_attempt_at').notNull().default(0),retryBlocked:integer('retry_blocked').notNull().default(0),errorCode:text('error_code'),
 coverage:text('coverage').notNull().default('{"ais":"unknown","bankgiro":"unknown","paymentDataComplete":false}'),checkpoint:text('checkpoint'),
},t=>[primaryKey({columns:[t.companyId,t.accountKey]}),index('company_bank_sync_jobs_due').on(t.status,t.nextAttemptAt)]);
export const companyBankSyncRequests=sqliteTable('company_bank_sync_requests',{
 id:text('id').primaryKey().notNull(),companyId:text('company_id').notNull(),owner:text('owner').notNull(),accountKey:text('account_key').notNull(),
 connectionId:text('connection_id').notNull(),provider:text('provider').notNull(),reservedAt:integer('reserved_at').notNull(),
},t=>[index('company_bank_sync_requests_budget').on(t.companyId,t.accountKey,t.reservedAt),index('company_bank_sync_requests_connection_budget').on(t.companyId,t.provider,t.connectionId,t.reservedAt)]);
export const companyBankSyncReceipts=sqliteTable('company_bank_sync_receipts',{
 companyId:text('company_id').notNull(),owner:text('owner').notNull(),accountKey:text('account_key').notNull(),receiptKey:text('receipt_key').notNull(),
 sha256:text('sha256').notNull(),result:text('result').notNull(),committedAt:integer('committed_at').notNull(),
},t=>[primaryKey({columns:[t.companyId,t.accountKey,t.receiptKey]})]);
export const saasBankState = sqliteTable('saas_bank_state', {owner:text('owner').primaryKey().notNull(),revision:integer('revision').notNull(),payload:text('payload').notNull()});
