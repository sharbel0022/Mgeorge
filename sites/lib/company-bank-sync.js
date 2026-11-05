import { validateCompanySyncContext, companySyncError } from './company-bank-sync-store.js';

const MAX_TIME = 253402300799999;
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 300;
const count = value => Number.isSafeInteger(value) && value >= 0;
const selectors = new Set(['companyId', 'connectionId', 'accountKey', 'expectedGeneration', 'expectedRevision']);
const authorityKeys = ['companyId', 'owner', 'connectionId', 'provider', 'accountKey', 'accountUid', 'consentId', 'generation', 'revision', 'validUntil', 'bankgiroEnabled'];
const authorizationErrors = new Set(['AUTHORIZATION_CHANGED', 'AUTHORIZATION_UNVERIFIED', 'CONSENT_EXPIRED', 'BANK_CONSENT_EXPIRED', 'BANK_CONSENT_INVALID', 'BANK_STATE_CHANGED', 'CONSENT_NOT_VALID', 'RESOURCE_EXPIRED', 'BANK_SESSION_INVALID', 'BANK_ACCOUNT_UNAVAILABLE', 'BANK_ACTION_REQUIRED', 'BANK_RECONNECT_REQUIRED', 'BANK_AUTHORIZATION_EXPIRED', 'NO_LINKED_ACCOUNTS', 'PROVIDER_AUTHORIZATION_FAILED', 'PROVIDER_ACCESS_DENIED', 'renewal_required', 'access_denied', 'missing_scope', 'application_access_denied', 'authorization_failed', 'account_unavailable', 'action_required']);
const blockedErrors = new Set(['COMPANY_SCOPE_MISMATCH', 'BACKGROUND_POLICY_UNVERIFIED', 'ACCOUNT_MISMATCH', 'IMPORT_IDENTITY_CONFLICT', 'IMPORT_RECEIPT_MISSING', 'INVALID_IMPORT_RECEIPT', 'INVALID_JOB_REQUEST', 'RETRY_AFTER_UNKNOWN', 'JOB_BLOCKED']);
const emptyCoverage = () => ({ ais: 'unknown', bankgiro: 'unknown', paymentDataComplete: false });

function selection(value) {
  if (!isRecord(value) || Object.keys(value).some(key => !selectors.has(key)) || !text(value.companyId) || !text(value.connectionId) || !text(value.accountKey)) throw companySyncError('INVALID_JOB_REQUEST');
  return { ...value };
}
function retryTime(error, at) {
  if (error?.nextAttemptAt !== undefined) return Number.isSafeInteger(error.nextAttemptAt) && error.nextAttemptAt >= at && error.nextAttemptAt <= MAX_TIME ? error.nextAttemptAt : Infinity;
  const raw = error?.retryAfter;
  if (raw === undefined || raw === null) return at + 60000;
  let result;
  if (typeof raw === 'number') result = Number.isFinite(raw) && raw >= 0 ? at + Math.ceil(raw * 1000) : Infinity;
  else if (typeof raw === 'string' && raw.trim()) {
    const trimmed = raw.trim();
    result = /^\d+(?:\.\d+)?$/.test(trimmed) ? at + Math.ceil(Number(trimmed) * 1000) : Date.parse(trimmed);
    if (!Number.isFinite(result)) result = Infinity;
  } else result = Infinity;
  return Number.isSafeInteger(result) && result <= MAX_TIME ? Math.max(at + 1000, result) : Infinity;
}
function classification(error, at) {
  if (error?.status === 429 || error?.statusCode === 429 || error?.code === 'PROVIDER_429' || error?.code === 'BANK_RATE_LIMITED' || error?.code === 'rate_limited') {
    const nextAttemptAt = error.retryBlocked === true ? Infinity : retryTime(error, at);
    return { status: Number.isFinite(nextAttemptAt) ? 'retry' : 'blocked', code: Number.isFinite(nextAttemptAt) ? 'PROVIDER_429' : 'RETRY_AFTER_UNKNOWN', nextAttemptAt };
  }
  if ((error?.status >= 500 || error?.statusCode >= 500 || error?.code === 'bank_unavailable' || error?.code === 'BANK_SERVICE_ERROR') && (error?.retryAfter !== undefined || error?.nextAttemptAt !== undefined || error?.retryBlocked === true)) {
    const nextAttemptAt = error.retryBlocked === true ? Infinity : retryTime(error, at);
    return { status: Number.isFinite(nextAttemptAt) ? 'retry' : 'blocked', code: Number.isFinite(nextAttemptAt) ? 'PROVIDER_UNAVAILABLE' : 'RETRY_AFTER_UNKNOWN', nextAttemptAt };
  }
  if (error?.code === 'PROVIDER_BUDGET_EXHAUSTED' || error?.code === 'RETRY_NOT_DUE') return { status: 'retry', code: error.code === 'RETRY_NOT_DUE' ? 'PROVIDER_429' : error.code, nextAttemptAt: retryTime(error, at) };
  if (['BANK_USER_CONTEXT_REQUIRED', 'background_access_denied'].includes(error?.code)) return { status: 'blocked', code: 'BACKGROUND_POLICY_UNVERIFIED', nextAttemptAt: 0 };
  // Concrete provider adapters can map upstream 401/403 or expired sessions to
  // a safe application 400/409. That mapping must not turn denied access into
  // another unattended retry.
  if (authorizationErrors.has(error?.code) || [error?.status, error?.statusCode, error?.providerStatus].some(status => status === 401 || status === 403)) return { status: 'blocked', code: 'AUTHORIZATION_CHANGED', nextAttemptAt: 0, revoke: true };
  if (blockedErrors.has(error?.code)) return { status: 'blocked', code: error.code, nextAttemptAt: error.code === 'RETRY_AFTER_UNKNOWN' ? Infinity : 0 };
  if (error?.code === 'ACCOUNT_BUSY' || error?.code === 'LEASE_LOST') return { status: 'retry', code: error.code, nextAttemptAt: at + 60000 };
  return { status: 'retry', code: ['PROVIDER_TIMEOUT', 'BANK_TIMEOUT', 'bank_timeout'].includes(error?.code) || error?.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE', nextAttemptAt: at + 60000 };
}

/** Runs once from the existing scheduler. It neither starts a timer nor grants access.
 * resolveContext/currentGuard are trusted server adapters, never request fields.
 * request(fn) is mandatory around each actual provider request, including pages
 * and current remote-consent checks. Only the financial sink may use the lease.
 */
export function createCompanyBankSyncRunner({ store, resolveContext, currentGuard, sync, enrich, reconcile, now = Date.now, requestTimeoutMs = 20000, maxRunMs = 240000 }) {
  if (!store || typeof resolveContext !== 'function' || typeof currentGuard !== 'function' || typeof sync !== 'function' || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || !Number.isSafeInteger(maxRunMs) || maxRunMs < requestTimeoutMs || maxRunMs > 900000) throw new TypeError('Invalid company sync adapter');
  async function run(input) {
    let chosen, context, lease, timer;
    let active = true, imported = 0, duplicate = 0, receiptKey = null;
    const evidence = emptyCoverage(), controller = new AbortController();
    const stopped = () => { if (!active || controller.signal.aborted) throw companySyncError('PROVIDER_TIMEOUT'); };
    const publicResult = (status, code = null, nextAttemptAt = null, extra = {}) => ({ companyId: context?.companyId ?? chosen?.companyId ?? null, connectionId: context?.connectionId ?? chosen?.connectionId ?? null, status, code, nextAttemptAt: Number.isFinite(nextAttemptAt) && nextAttemptAt > 0 ? nextAttemptAt : null, imported, duplicate, coverage: { ...evidence }, ...extra });
    try {
      chosen = selection(input);
      context = validateCompanySyncContext(await resolveContext(chosen), now());
      if (context.companyId !== chosen.companyId || context.connectionId !== chosen.connectionId || context.accountKey !== chosen.accountKey) throw companySyncError('ACCOUNT_MISMATCH');
      if (chosen.expectedGeneration !== undefined && chosen.expectedGeneration !== context.generation || chosen.expectedRevision !== undefined && chosen.expectedRevision !== context.revision) throw companySyncError('AUTHORIZATION_CHANGED');
      await store.register(context);
      lease = await store.claim(context);
      const guard = await currentGuard(context);
      lease.addGuard(guard);
      const assertCurrent = async () => {
        stopped();
        const current = validateCompanySyncContext(await resolveContext(chosen), now());
        if (authorityKeys.some(key => current[key] !== context[key]) || JSON.stringify(current.ratePolicy) !== JSON.stringify(context.ratePolicy)) throw companySyncError('AUTHORIZATION_CHANGED');
        await lease.assert();
        stopped();
      };
      const deadline = Math.min(now() + maxRunMs, lease.deadline);
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { active = false; controller.abort(); reject(companySyncError('PROVIDER_TIMEOUT')); }, Math.max(1, deadline - now()));
      });
      const bounded = async (operation, milliseconds) => {
        const local = new AbortController();
        let localTimer;
        const abort = () => local.abort();
        controller.signal.addEventListener('abort', abort, { once: true });
        try {
          return await Promise.race([
            Promise.resolve().then(() => operation({ signal: local.signal, deadline })),
            new Promise((_, reject) => { localTimer = setTimeout(() => { local.abort(); reject(companySyncError('PROVIDER_TIMEOUT')); }, milliseconds); }),
            timeout,
          ]);
        } finally { clearTimeout(localTimer); controller.signal.removeEventListener('abort', abort); }
      };
      const request = async operation => {
        if (typeof operation !== 'function') throw new TypeError('Provider request must be a function');
        await assertCurrent();
        const reservation = await lease.reserveRequest();
        let result;
        const observedOperation = async input => {
          try { return await operation(input); }
          catch (error) {
            const observed = classification(error, now());
            if (observed.code === 'PROVIDER_429' || observed.code === 'RETRY_AFTER_UNKNOWN' || observed.code === 'PROVIDER_UNAVAILABLE' && (error?.retryAfter !== undefined || error?.nextAttemptAt !== undefined)) {
              // Observation follows the actual request, even if its timeout has
              // already returned or consent was renewed. This only tightens a
              // restriction proven by an existing reservation; it grants no
              // permission and cannot revive an expired financial writer.
              await store.noteProviderCooldown(context, { requestId: reservation.id, nextAttemptAt: observed.nextAttemptAt, code: observed.code });
            }
            throw error;
          }
        };
        try { result = await bounded(observedOperation, Math.max(1, Math.min(requestTimeoutMs, deadline - now()))); }
        catch (error) {
          // A rejected request can race revocation just as a successful one can.
          // Its provider restriction was persisted first, so renewal cannot skip it.
          await assertCurrent();
          throw error;
        }
        await assertCurrent();
        return result;
      };
      const stage = { context, lease, request, deadline, signal: controller.signal, assertCurrent };
      const work = async () => {
        await assertCurrent();
        const result = await sync(stage);
        await assertCurrent();
        if (!result || typeof result.complete !== 'boolean' || !text(result.receiptKey) || !count(result.imported) || !count(result.duplicate) || !await store.receipt(context, result.receiptKey)) throw companySyncError('IMPORT_RECEIPT_MISSING');
        imported = result.imported; duplicate = result.duplicate; receiptKey = result.receiptKey;
        evidence.ais = result.complete ? 'complete' : 'partial';
        evidence.bankgiro = 'unavailable';
        let outcome = result.complete ? 'success' : 'partial', code = null;
        if (context.bankgiroEnabled) {
          const detail = enrich ? await enrich(stage) : { state: 'unavailable' };
          await assertCurrent();
          if (!detail || !['verified', 'partial', 'unavailable'].includes(detail.state)) throw companySyncError('BANKGIRO_UNAVAILABLE');
          evidence.bankgiro = detail.state;
          if (detail.state !== 'verified') { outcome = 'partial'; code = 'BANKGIRO_UNAVAILABLE'; }
        }
        if (result.complete && reconcile) {
          await assertCurrent();
          const review = await reconcile(stage);
          await assertCurrent();
          if (!review || !['completed', 'held', 'stale'].includes(review.status)) throw companySyncError('RECONCILIATION_HELD');
          if (review.status !== 'completed') { outcome = 'partial'; code = 'RECONCILIATION_HELD'; }
        }
        await assertCurrent();
        await lease.finish({ status: outcome, code, coverage: evidence });
        return publicResult(outcome, code);
      };
      return await Promise.race([work(), timeout]);
    } catch (error) {
      const outcome = classification(error, now());
      controller.abort();
      active = false;
      if (context && outcome.revoke) {
        try { await store.revoke(context); } catch { /* A newer authority remains authoritative. */ }
      } else if (lease) {
        // A durable AIS receipt remains valid if a later stage cannot finish.
        // A held/revoked authority still reports blocked rather than full success.
        if (receiptKey && outcome.status === 'retry') outcome.status = 'partial';
        try { await lease.finish({ status: outcome.status, code: outcome.code, nextAttemptAt: outcome.nextAttemptAt, coverage: evidence }); }
        catch { /* Lost authority/lease must not be reacquired merely to write a status. */ }
      }
      return publicResult(outcome.status, outcome.code, outcome.nextAttemptAt);
    } finally {
      active = false; controller.abort(); clearTimeout(timer);
      if (lease) { try { await lease.release(); } catch { /* Expiry safely fences a failed release. */ } }
    }
  }
  return { run };
}

/** Bounded fan-out called by the current scheduler; not another schedule. */
export async function runCompanyBankSyncBatch({ jobs, run, maxConcurrent = 4, maxJobs = 100 }) {
  if (!Array.isArray(jobs) || typeof run !== 'function' || !Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 20 || !Number.isSafeInteger(maxJobs) || maxJobs < 1 || maxJobs > 1000) throw new TypeError('Invalid company sync batch');
  const selected = jobs.slice(0, maxJobs), results = new Array(selected.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(maxConcurrent, selected.length) }, async () => {
    while (next < selected.length) {
      const index = next++;
      try { results[index] = await run(selected[index]); }
      catch { results[index] = { companyId: selected[index]?.companyId ?? null, connectionId: selected[index]?.connectionId ?? null, status: 'retry', code: 'PROVIDER_UNAVAILABLE' }; }
    }
  }));
  return { results, remaining: Math.max(0, jobs.length - selected.length) };
}
