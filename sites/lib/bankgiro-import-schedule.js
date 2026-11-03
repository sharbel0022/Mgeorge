import { createImportJobStatus } from './import-job-status.js';

/**
 * Preparatory, internal contract for Agent 3's future source integration.
 * adapters MUST be a server-owned registry, never parsed from a request.
 * No real provider adapter is registered here. AIS is not a report source.
 * This function neither downloads reports nor creates/edits an automation.
 */
export async function prepareBankgiroImportSchedule({
  owner, sourceStatus, intervalMinutes=60, source = null, adapters = new Map(), requestedEnabled = false, now = Date.now,
}) {
  if (typeof owner !== 'string' || !owner) throw new TypeError('An authenticated owner is required');
  const clock = typeof now === 'function' ? now : () => now;
  let at = clock();
  if(sourceStatus){
    const live=sourceStatus.authorization?.status==='VERIFIED'&&Date.parse(sourceStatus.authorization.validUntil)>at;
    const errorCode=!sourceStatus.enabled?'source_not_configured':!live?'source_not_authorized':sourceStatus.lastError||(sourceStatus.state==='BLOCKED'?'queue_failed':null);
    const state=!sourceStatus.enabled||!live||sourceStatus.state==='BLOCKED'?'blocked':sourceStatus.state==='RUNNING'?'running':sourceStatus.state==='BACKOFF'?'retry_wait':errorCode?'blocked':sourceStatus.lastSuccessAt?'succeeded':'queued';
    return {contractVersion:'1.0',jobType:'bankgiro_import',timezone:'Europe/Stockholm',intervalMinutes,enabled:sourceStatus.enabled&&live,activationAllowed:live,externalScheduleCreated:false,jobStatus:createImportJobStatus({jobType:'bankgiro_import',state,lastSuccessAt:sourceStatus.lastSuccessAt,nextAttemptAt:sourceStatus.nextPollAt,leaseExpiresAt:sourceStatus.leaseExpiresAt,errorCode},{now:at})};
  }

  if (!Number.isFinite(at)) throw new TypeError('Invalid preparation clock');
  let errorCode = null;
  if (!source?.id || !source?.adapterId) errorCode = 'source_not_configured';
  const adapter = errorCode ? null : adapters.get(source.adapterId);
  if (!errorCode && (typeof adapter?.verifySource !== 'function' || typeof adapter?.readReports !== 'function')) {
    errorCode = 'source_adapter_unavailable';
  }
  if (!errorCode) {
    try {
      // Agent-owned internal names, not invented fields in a bank's API.
      // A configured adapter must resolve these from authoritative source/consent evidence.
      const evidence = await adapter.verifySource({ owner, sourceId: source.id });
      at = clock();
      if (evidence?.owner !== owner || evidence?.sourceId !== source.id) errorCode = 'source_scope_mismatch';
      else if (evidence.status !== 'VERIFIED' || evidence.origin !== 'provider_authorization'
        || typeof evidence.evidenceId !== 'string' || !evidence.evidenceId.trim()) errorCode = 'source_not_authorized';
      else if (!Array.isArray(evidence.capabilities) || !evidence.capabilities.includes('bankgiro_reports:read')) errorCode = 'source_capability_missing';
      else {
        const checkedAt = Date.parse(evidence.checkedAt), validUntil = Date.parse(evidence.validUntil);
        if (!Number.isFinite(at) || !Number.isFinite(checkedAt) || checkedAt > at || at - checkedAt > 5 * 60_000
          || !Number.isFinite(validUntil) || validUntil <= at) errorCode = 'source_evidence_expired';
      }
    } catch {
      // Authorization failures must not leak URLs, credentials or provider bodies.
      errorCode = 'source_not_authorized';
    }
  }
  const activationAllowed = errorCode === null;
  const enabled = activationAllowed && requestedEnabled === true;
  return {
    contractVersion: '1.0', jobType: 'bankgiro_import',
    timezone: 'Europe/Stockholm', intervalMinutes: 60,
    enabled, activationAllowed, externalScheduleCreated: false,
    jobStatus: createImportJobStatus({ jobType: 'bankgiro_import', state: errorCode ? 'blocked' : enabled ? 'queued' : 'paused', errorCode }, { now: at }),
  };
}
