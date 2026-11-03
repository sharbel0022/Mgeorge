/** Versioned operational status. This never certifies financial/source evidence. */
export const IMPORT_JOB_STATUS_VERSION = '1.0';
export const IMPORT_JOB_TYPES = Object.freeze(['bank_sync', 'gmail_sync', 'document_ocr', 'backup', 'bankgiro_import']);
export const IMPORT_JOB_STATES = Object.freeze(['queued', 'running', 'retry_wait', 'succeeded', 'blocked', 'paused', 'failed']);

const errorCodes = new Set([
  'provider_rate_limited', 'rate_limited', 'provider_error', 'connection_error',
  'timeout', 'lease_lost', 'integration_interrupted', 'integration_failed',
  'retry_exhausted', 'source_not_configured', 'source_not_authorized',
  'source_evidence_expired', 'source_adapter_unavailable', 'source_capability_missing',
  'source_scope_mismatch', 'connection_required', 'configuration_required',
  'queue_failed', 'aftercheck_pending', 'job_failed', 'invalid_status', 'success_unverified',
  'retry_after_unknown', 'worker_unconfirmed',
]);
const aliases = new Map([
  ['RATE_LIMITED', 'provider_rate_limited'], ['SOURCE_UNAVAILABLE','provider_error'], ['TIMEOUT','timeout'], ['BANK_RATE_LIMIT', 'provider_rate_limited'], ['BANK_LEASE_LOST', 'lease_lost'],
  ['integration_lease_lost', 'lease_lost'], ['gmail_lease_lost', 'lease_lost'],
  ['lease_expired', 'lease_lost'], ['backup_lease_lost', 'lease_lost'],
  ['BANK_TIMEOUT', 'timeout'], ['parse_timeout', 'timeout'],
  ['registration_aftercheck_pending', 'aftercheck_pending'],
]);

/** Omit arbitrary exception messages, URLs, provider bodies and identifiers. */
export function importJobErrorCode(value) {
  if (value === null || value === undefined || value === '') return null;
  if (aliases.has(value)) return aliases.get(value);
  return errorCodes.has(value) ? value : 'job_failed';
}

function timestamp(value, at, pastOnly = false) {
  if (value === null || value === undefined || value === '' || value === 0) return null;
  const parsed = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 253402300799999 || pastOnly && parsed > at) return null;
  const normalized = new Date(parsed).toISOString();
  if (typeof value === 'string' && normalized.slice(0, 19) !== value.slice(0, 19)) return null;
  return normalized;
}

/**
 * Inputs come from persisted server state, not provider JSON or client claims.
 * Missing counters are intentionally null for existing queues without them.
 */
export function createImportJobStatus(input, { now = Date.now() } = {}) {
  const at = typeof now === 'function' ? now() : now;
  if (!Number.isFinite(at)) throw new TypeError('Invalid job status clock');
  if (!IMPORT_JOB_TYPES.includes(input?.jobType)) throw new TypeError('Unknown import job type');
  let state = input.state;
  let errorCode = importJobErrorCode(input.errorCode);
  const lastAttemptAt = timestamp(input.lastAttemptAt, at, true);
  const lastSuccessAt = timestamp(input.lastSuccessAt, at, true);
  const nextAttemptAt = timestamp(input.nextAttemptAt, at);
  const leaseExpiresAt = timestamp(input.leaseExpiresAt, at);
  if (!IMPORT_JOB_STATES.includes(state)) { state = 'blocked'; errorCode = 'invalid_status'; }
  if (state === 'running' && (!leaseExpiresAt || Date.parse(leaseExpiresAt) <= at)) {
    state = 'retry_wait'; errorCode = 'lease_lost';
  }
  if (state === 'succeeded' && !lastSuccessAt) { state = 'blocked'; errorCode = 'success_unverified'; }
  if (state === 'succeeded' && lastAttemptAt && lastSuccessAt && lastAttemptAt > lastSuccessAt) {
    state = 'retry_wait'; errorCode = 'integration_interrupted';
  }
  const counter = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  return {
    contractVersion: IMPORT_JOB_STATUS_VERSION,
    jobType: input.jobType,
    state,
    evidenceStatus: state === 'blocked' || state === 'failed' ? 'BLOCKED' : 'REVIEW',
    lastAttemptAt, lastSuccessAt, nextAttemptAt, leaseExpiresAt,
    running: state === 'running',
    attemptCount: counter(input.attemptCount),
    fenceVersion: counter(input.fenceVersion),
    errorCode,
  };
}
