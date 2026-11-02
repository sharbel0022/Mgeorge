import { createImportJobStatus } from './import-job-status.js';
import { prepareBankgiroImportSchedule } from './bankgiro-import-schedule.js';

type Row = Record<string, any>;
type Database = { prepare: (query: string) => any; batch: (statements: any[]) => Promise<{ results?: Row[] }[]> };
type Configuration = { backupEnabled?: boolean; backupConfigured?: boolean };
const permanentGmail = new Set(['renewal_required', 'missing_scope', 'access_denied', 'invalid_client', 'account_mismatch', 'invalid_tokens']);

/** Read one owner-scoped database snapshot. No services, queue claims or writes. */
export async function readImportJobStatuses(database: Database, owner: string, config: Configuration = {}, { now = Date.now() } = {}) {
  if (typeof owner !== 'string' || !owner) throw new TypeError('An authenticated owner is required');
  const statements = [
    'SELECT status,valid_until,last_synced_at,auto_sync_enabled,auto_last_attempt_at,auto_next_at,control_last_attempt_at,retry_after,sync_failures FROM bank_connections WHERE owner=?',
    "SELECT created_at FROM audit_events WHERE owner=? AND action='bank.job.started' ORDER BY created_at DESC,rowid DESC LIMIT 1",
    'SELECT expires_at FROM bank_locks WHERE owner=?',
    'SELECT last_synced,status,last_attempt,retry_after,sync_failures FROM gmail_connections WHERE owner=?',
    "SELECT created_at FROM gmail_runs WHERE owner=? AND status IN ('completed','completed_pending') ORDER BY created_at DESC,rowid DESC LIMIT 1",
    'SELECT expires_at FROM gmail_locks WHERE owner=?',
    'SELECT enabled FROM document_automation WHERE owner=?',
    `SELECT state,COUNT(*) count,MAX(lease_until) lease_until,MIN(available_at) available_at,
      SUM(CASE WHEN attempts<3 THEN 1 ELSE 0 END) retryable_count,
      SUM(CASE WHEN error_code='registration_aftercheck_pending' THEN 1 ELSE 0 END) pending_aftercheck
      FROM document_jobs WHERE owner=? AND EXISTS(SELECT 1 FROM gmail_sources s WHERE s.owner=document_jobs.owner AND s.document_id=document_jobs.document_id AND s.status<>'rejected') GROUP BY state`,
    'SELECT state,created_at,finished_at,lease_until,attempts,last_error FROM backup_runs WHERE owner=? ORDER BY created_at DESC,rowid DESC LIMIT 1',
    "SELECT finished_at FROM backup_runs WHERE owner=? AND state='complete' AND finished_at<>'' ORDER BY finished_at DESC,rowid DESC LIMIT 1",
    `SELECT MAX(e.created_at) completed_at FROM document_extractions e JOIN documents d ON d.owner=e.owner AND d.id=e.document_id
      WHERE e.owner=? AND json_extract(CASE WHEN json_valid(e.result) THEN e.result ELSE '{}' END,'$.processing.version')='document-worker-v3'
      AND json_extract(CASE WHEN json_valid(e.result) THEN e.result ELSE '{}' END,'$.processing.sha256')=d.sha256
      AND EXISTS(SELECT 1 FROM gmail_sources s WHERE s.owner=e.owner AND s.document_id=e.document_id AND s.status<>'rejected')`,
  ].map(query => database.prepare(query).bind(owner));
  const snapshot = await database.batch(statements);
  const first = (n: number): Row | undefined => snapshot[n]?.results?.[0];
  const bank = first(0), bankAttempt = first(1), bankLock = first(2);
  const gmail = first(3), gmailSuccess = first(4), gmailLock = first(5), automation = first(6);
  const documents = snapshot[7]?.results || [], backup = first(8), backupSuccess = first(9);
  const millis = (value: any): number => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  const latest = (...values: any[]) => values.filter(value => millis(value) > 0).sort((a, b) => millis(b) - millis(a))[0] || null;
  const live = (until: any) => millis(until) > now;

  const bankStarted = latest(bankAttempt?.created_at, bank?.auto_last_attempt_at, bank?.control_last_attempt_at);
  const bankFinished = bank?.last_synced_at || null;
  const bankPending = millis(bankStarted) > millis(bankFinished);
  const bankNext = latest(bank?.auto_next_at, bank?.retry_after);
  let bankState = 'queued', bankError: string | null = null;
  if (!bank || bank.status !== 'connected' || !live(bank.valid_until)) { bankState = 'blocked'; bankError = 'connection_required'; }
  // Bank/Gmail owner locks also cover OAuth and account-control operations.
  // They cannot certify which sync attempt owns them. Preserve that uncertainty.
  else if (bankPending && live(bankLock?.expires_at)) { bankState = 'retry_wait'; bankError = 'worker_unconfirmed'; }
  else if (bank.sync_failures >= 3) { bankState = 'blocked'; bankError = 'retry_exhausted'; }
  else if (bank.auto_sync_enabled !== 1) bankState = 'paused';
  // A stored wait also covers unavailable providers; it does not prove HTTP 429.
  else if (live(bank.retry_after)) bankState = 'retry_wait';
  // Durable failure evidence wins over equal or regressed wall-clock times.
  else if (bankPending || Number(bank.sync_failures) > 0) { bankState = 'retry_wait'; bankError = 'integration_interrupted'; }
  else if (bankFinished) bankState = 'succeeded';

  const gmailFinished = gmailSuccess?.created_at || gmail?.last_synced || null;
  const gmailPending = millis(gmail?.last_attempt) > millis(gmailFinished);
  let gmailState = 'queued', gmailError: string | null = null;
  if (!gmail || permanentGmail.has(gmail.status)) { gmailState = 'blocked'; gmailError = 'connection_required'; }
  else if (gmailPending && live(gmailLock?.expires_at)) { gmailState = 'retry_wait'; gmailError = 'worker_unconfirmed'; }
  else if (gmail.sync_failures >= 3 || gmail.status === 'blocked') { gmailState = 'blocked'; gmailError = 'retry_exhausted'; }
  else if (automation?.enabled !== 1) gmailState = 'paused';
  else if (live(gmail.retry_after)) gmailState = 'retry_wait';
  else if (gmailPending || Number(gmail.sync_failures) > 0 || gmail.status !== 'connected') { gmailState = 'retry_wait'; gmailError = 'integration_interrupted'; }
  else if (gmailFinished) gmailState = 'succeeded';

  const activeDocument = documents.find(row => row.state === 'processing' && live(row.lease_until));
  const pendingDocuments = documents.filter(row => ['queued', 'waiting_ocr', 'processing'].includes(row.state));
  const unfinished = pendingDocuments.filter(row => Number(row.retryable_count) > 0 || row.state === 'processing' && live(row.lease_until));
  // An immutable accepted OCR receipt survives retry/registration/aftercheck
  // state changes. A heartbeat or job.updated_at is never success evidence.
  const documentFinished = first(10)?.completed_at || null;
  const dueDocuments = unfinished.some(row => row.state === 'processing' || millis(row.available_at) <= now);
  const nextDocument = unfinished.map(row => row.available_at).filter(Boolean).sort()[0] || null;
  const aftercheck = documents.some(row => Number(row.pending_aftercheck) > 0);
  let documentState = 'queued', documentError: string | null = null;
  if (activeDocument) documentState = 'running';
  else if (automation?.enabled !== 1) documentState = 'paused';
  else if (unfinished.length) documentState = dueDocuments ? 'queued' : 'retry_wait';
  else if (pendingDocuments.length) { documentState = 'failed'; documentError = 'retry_exhausted'; }
  else if (documents.some(row => row.state === 'failed')) { documentState = 'failed'; documentError = 'queue_failed'; }
  else if (aftercheck) { documentState = 'retry_wait'; documentError = 'aftercheck_pending'; }
  else if (documentFinished) documentState = 'succeeded';

  let backupState = 'queued', backupError: string | null = null;
  if (!config.backupEnabled) backupState = 'paused';
  else if (!config.backupConfigured) { backupState = 'blocked'; backupError = 'configuration_required'; }
  else if (backup && backup.state !== 'complete' && live(backup.lease_until)) backupState = 'running';
  else if (backup?.state === 'failed') { backupState = Number(backup.attempts) >= 3 ? 'failed' : 'retry_wait'; backupError = 'job_failed'; }
  else if (backup?.state === 'complete') backupState = 'succeeded';

  // There is intentionally no configured real report adapter yet. This endpoint
  // accepts neither source claims nor activation flags from a browser request.
  const bankgiroPreparation = await prepareBankgiroImportSchedule({ owner, now });
  const jobs = [
    createImportJobStatus({ jobType: 'bank_sync', state: bankState, lastAttemptAt: bankStarted, lastSuccessAt: bankFinished, nextAttemptAt: bankNext, leaseExpiresAt: bankLock?.expires_at, errorCode: bankError }, { now }),
    createImportJobStatus({ jobType: 'gmail_sync', state: gmailState, lastAttemptAt: gmail?.last_attempt, lastSuccessAt: gmailFinished, nextAttemptAt: gmail?.retry_after, leaseExpiresAt: gmailLock?.expires_at, errorCode: gmailError }, { now }),
    createImportJobStatus({ jobType: 'document_ocr', state: documentState, lastSuccessAt: documentFinished, nextAttemptAt: nextDocument, leaseExpiresAt: activeDocument?.lease_until, errorCode: documentError }, { now }),
    createImportJobStatus({ jobType: 'backup', state: backupState, lastSuccessAt: backupSuccess?.finished_at, leaseExpiresAt: backup?.lease_until, errorCode: backupError }, { now }),
    bankgiroPreparation.jobStatus,
  ];
  return { contractVersion: '1.0', observedAt: new Date(now).toISOString(), jobs, bankgiroPreparation };
}
