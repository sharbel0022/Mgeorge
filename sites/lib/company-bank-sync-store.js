/** Durable company/account coordination, shared by Node SQLite and Sites D1.
 * Configuration and adapters are trusted server code; this is not an enrollment API.
 * No credentials, provider payloads, or guessed entitlement are persisted here.
 */
const MAX_TIME = 253402300799999;
const text = (value, max = 300) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const integer = value => Number.isSafeInteger(value) && value > 0;
export const companySyncError = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });
const fail = code => { throw companySyncError(code); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const json = (value, max = 32768) => {
  let output;
  try { output = JSON.stringify(value); } catch { fail('INVALID_JOB_RESULT'); }
  if (!output || output.length > max) fail('INVALID_JOB_RESULT');
  return output;
};
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
const scopeKeys = value => {
  if (!record(value) || !text(value.companyId) || !text(value.owner)) fail('COMPANY_SCOPE_MISMATCH');
  return [value.companyId, value.owner];
};

/** VERIFIED is the trusted resolver's current transaction-read authorization
 * for this exact company/account. An actor login or active provider application
 * alone does not satisfy it; optional remote response fields do not grant it. */
export function validateCompanySyncContext(value, at = Date.now()) {
  scopeKeys(value);
  for (const key of ['connectionId', 'provider', 'accountKey', 'accountUid', 'consentId', 'generation']) if (!text(value[key])) fail('AUTHORIZATION_UNVERIFIED');
  if (!integer(value.revision) || value.authorizationStatus !== 'VERIFIED') fail('AUTHORIZATION_UNVERIFIED');
  const expires = typeof value.validUntil === 'string' ? Date.parse(value.validUntil) : NaN;
  if (!Number.isSafeInteger(expires) || expires <= at || expires > MAX_TIME) fail('CONSENT_EXPIRED');
  const policy = value.ratePolicy;
  if (!record(policy) || policy.verified !== true || !text(policy.evidenceId) || !integer(policy.maxRequests) || policy.maxRequests > 1_000_000 || !integer(policy.windowMs) || policy.windowMs > 366 * 86400000 || policy.scope !== undefined && !['account', 'connection'].includes(policy.scope)) fail('BACKGROUND_POLICY_UNVERIFIED');
  if (typeof value.bankgiroEnabled !== 'boolean') fail('AUTHORIZATION_UNVERIFIED');
  return { ...value, validUntil: new Date(expires).toISOString(), ratePolicy: { verified: true, evidenceId: policy.evidenceId, maxRequests: policy.maxRequests, windowMs: policy.windowMs, scope: policy.scope ?? 'account' } };
}

const authority = async value => ({
  context: value,
  expires: Date.parse(value.validUntil),
  hash: await hash(json([value.companyId, value.owner, value.provider, value.connectionId, value.accountKey, value.accountUid, value.consentId, value.generation, value.revision, value.validUntil, value.ratePolicy, value.bankgiroEnabled])),
  generation: await hash(json([value.consentId, value.generation])),
});
const coverage = value => {
  if (value == null) return { ais: 'unknown', bankgiro: 'unknown', paymentDataComplete: false };
  if (!record(value) || !['complete', 'partial', 'unknown'].includes(value.ais) || !['verified', 'unavailable', 'unknown', 'partial', 'disabled'].includes(value.bankgiro) || value.paymentDataComplete === true) fail('COVERAGE_UNVERIFIED');
  // A coordinator cannot certify completeness of all payments from a job receipt.
  return { ais: value.ais, bankgiro: value.bankgiro, paymentDataComplete: false };
};
const SAFE_CODES = new Set(['PROVIDER_429', 'PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_BUDGET_EXHAUSTED', 'AUTHORIZATION_CHANGED', 'AUTHORIZATION_UNVERIFIED', 'CONSENT_EXPIRED', 'COMPANY_SCOPE_MISMATCH', 'BACKGROUND_POLICY_UNVERIFIED', 'ACCOUNT_MISMATCH', 'BANKGIRO_UNAVAILABLE', 'BANKGIRO_PARTIAL', 'IMPORT_FAILED', 'IMPORT_RECEIPT_MISSING', 'IMPORT_IDENTITY_CONFLICT', 'RECONCILIATION_HELD', 'INTERRUPTED', 'RETRY_AFTER_UNKNOWN', 'LEASE_LOST']);
const safeCode = code => SAFE_CODES.has(code) ? code : 'IMPORT_FAILED';

/** Database implements D1 prepare().bind().first/all/run and atomic batch(). */
export function createCompanyBankSyncStore(database, { now = Date.now, leaseMs = 300000, maxRunMs = 900000 } = {}) {
  if (!integer(leaseMs) || !integer(maxRunMs) || maxRunMs < leaseMs || maxRunMs > 3600000) throw new TypeError('Invalid company sync lease');
  const statement = (query, ...args) => database.prepare(query).bind(...args);
  // A queued D1 write must use the execution clock, not an old JS timestamp.
  const clock = now === Date.now ? "max(?, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))" : '?';
  const job = value => statement('SELECT * FROM company_bank_sync_jobs WHERE company_id=? AND account_key=?', value.companyId, value.accountKey).first();
  const scope = async value => {
    const [companyId, owner] = scopeKeys(value);
    const found = await statement('SELECT * FROM company_bank_sync_scopes WHERE company_id=? AND owner=?', companyId, owner).first();
    if (!found) fail('COMPANY_SCOPE_MISMATCH');
    return { companyId, owner, evidenceId: found.evidence_id, revision: found.revision };
  };
  const scopeFence = value => statement("SELECT CASE WHEN EXISTS(SELECT 1 FROM company_bank_sync_scopes WHERE company_id=? AND owner=?) THEN 1 ELSE json('COMPANY_SCOPE_MISMATCH') END", value.companyId, value.owner);
  const readReceipt = (value, key) => statement('SELECT sha256,result FROM company_bank_sync_receipts WHERE company_id=? AND account_key=? AND receipt_key=?', value.companyId, value.accountKey, key).first();
  const budgetScope = value => value.ratePolicy.scope === 'connection'
    ? { where: 'company_id=? AND provider=? AND connection_id=?', keys: [value.companyId, value.provider, value.connectionId] }
    : { where: 'company_id=? AND provider=? AND account_key=?', keys: [value.companyId, value.provider, value.accountKey] };

  async function bindScope(value) {
    const [companyId, owner] = scopeKeys(value);
    if (!text(value.evidenceId)) fail('COMPANY_SCOPE_MISMATCH');
    try {
      await statement('INSERT INTO company_bank_sync_scopes(company_id,owner,evidence_id,created_at) VALUES(?,?,?,?) ON CONFLICT(company_id) DO NOTHING', companyId, owner, value.evidenceId, now()).run();
    } catch (error) {
      const existing = await statement('SELECT company_id FROM company_bank_sync_scopes WHERE owner=?', owner).first();
      if (existing && existing.company_id !== companyId) fail('COMPANY_SCOPE_MISMATCH');
      throw error;
    }
    return scope(value);
  }

  async function setReferencePolicy(value) {
    await scope(value);
    if (!integer(value.revision) || !text(value.companyName) || !['invoice_number', 'explicit_only', 'ocr'].includes(value.mode) || !text(value.evidenceId)) fail('REFERENCE_POLICY_UNVERIFIED');
    const policy = { companyId: value.companyId, owner: value.owner, revision: value.revision, companyName: value.companyName, mode: value.mode, evidenceId: value.evidenceId };
    const previous = await referencePolicy(value), payload = json(policy);
    if (previous && (previous.revision > value.revision || previous.revision === value.revision && json(previous) !== payload)) fail('REFERENCE_POLICY_CHANGED');
    await database.batch([
      scopeFence(value),
      statement("SELECT CASE WHEN (SELECT reference_policy FROM company_bank_sync_scopes WHERE company_id=? AND owner=?) IS ? THEN 1 ELSE json('REFERENCE_POLICY_CHANGED') END", value.companyId, value.owner, previous ? json(previous) : null),
      statement('UPDATE company_bank_sync_scopes SET reference_policy=? WHERE company_id=? AND owner=?', payload, value.companyId, value.owner),
    ]);
    return policy;
  }
  async function referencePolicy(value) {
    await scope(value);
    const row = await statement('SELECT reference_policy FROM company_bank_sync_scopes WHERE company_id=? AND owner=?', value.companyId, value.owner).first();
    return row.reference_policy ? JSON.parse(row.reference_policy) : null;
  }

  async function register(input) {
    const value = validateCompanySyncContext(input, now());
    await scope(value);
    const binding = await authority(value), previous = await job(value);
    if (previous) {
      if (previous.owner !== value.owner || previous.provider !== value.provider || previous.connection_id !== value.connectionId) fail('COMPANY_SCOPE_MISMATCH');
      if (previous.authority_revision > value.revision || previous.authority_revision === value.revision && previous.authority_hash !== binding.hash || previous.revoked && (previous.generation_hash === binding.generation || previous.authority_revision >= value.revision)) fail('AUTHORIZATION_CHANGED');
      if (previous.authority_hash === binding.hash) return;
      const updated = await statement(`UPDATE company_bank_sync_jobs SET authority_hash=?,generation_hash=?,authority_revision=?,valid_until=?,revoked=0,
        lease_token='',lease_until=0,lease_deadline=0,fence_version=fence_version+1,
        status=CASE WHEN retry_blocked=2 THEN 'blocked' WHEN next_attempt_at>? THEN 'retry' ELSE 'queued' END,
        retry_blocked=CASE WHEN retry_blocked=2 THEN 2 ELSE 0 END
        WHERE company_id=? AND account_key=? AND authority_hash=? AND authority_revision=?`, binding.hash, binding.generation, value.revision, binding.expires, now(), value.companyId, value.accountKey, previous.authority_hash, previous.authority_revision).run();
      if (updated.meta.changes !== 1) fail('AUTHORIZATION_CHANGED');
      return;
    }
    await statement(`INSERT INTO company_bank_sync_jobs(company_id,account_key,owner,provider,connection_id,authority_hash,generation_hash,authority_revision,valid_until)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id,account_key) DO NOTHING`, value.companyId, value.accountKey, value.owner, value.provider, value.connectionId, binding.hash, binding.generation, value.revision, binding.expires).run();
    const current = await job(value);
    if (current.authority_hash !== binding.hash || current.revoked) fail('AUTHORIZATION_CHANGED');
  }

  async function revoke(input) {
    // Denial is allowed after expiry; canonicalize the original snapshot without
    // treating it as a fresh grant of access.
    const value = validateCompanySyncContext(input, 0);
    await scope(value);
    const current = await job(value);
    if (!current || current.owner !== value.owner) fail('COMPANY_SCOPE_MISMATCH');
    // A late revocation of an old generation must not revoke a newer consent.
    const binding = await authority(value);
    const result = await statement(`UPDATE company_bank_sync_jobs SET revoked=1,status='blocked',error_code='AUTHORIZATION_CHANGED',
      lease_token='',lease_until=0,lease_deadline=0,fence_version=fence_version+1
      WHERE company_id=? AND account_key=? AND authority_hash=?`, value.companyId, value.accountKey, binding.hash).run();
    if (result.meta.changes !== 1) fail('AUTHORIZATION_CHANGED');
  }

  async function status(value) {
    await scope(value);
    if (!text(value.accountKey)) fail('ACCOUNT_MISMATCH');
    const row = await job(value);
    if (!row) return null;
    if (row.owner !== value.owner) fail('COMPANY_SCOPE_MISMATCH');
    return {
      companyId: row.company_id, owner: row.owner, accountKey: row.account_key, connectionId: row.connection_id,
      status: row.status === 'running' && row.lease_until <= now() ? 'retry' : row.status,
      attempts: row.attempts, lastAttemptAt: row.last_attempt_at, lastSuccessAt: row.last_success_at,
      nextAttemptAt: row.retry_blocked ? null : row.next_attempt_at || null,
      code: row.status === 'running' && row.lease_until <= now() ? 'INTERRUPTED' : row.error_code,
      coverage: JSON.parse(row.coverage), checkpoint: row.checkpoint ? JSON.parse(row.checkpoint) : null,
    };
  }

  async function receipt(value, key) {
    await scope(value);
    if (!text(value.accountKey) || !text(key, 1000)) fail('INVALID_IMPORT_RECEIPT');
    const row = await readReceipt(value, key);
    return row ? { key, sha256: row.sha256, result: JSON.parse(row.result) } : null;
  }

  /** An observed provider denial is a restriction, not a new authorization.
   * Retain it even if consent was revoked while this reserved request awaited
   * its response. A later generation must not erase a provider embargo.
   */
  async function noteProviderCooldown(input, { requestId, nextAttemptAt, code }) {
    const value = validateCompanySyncContext(input, 0);
    await scope(value);
    if (!text(requestId) || !['PROVIDER_429', 'PROVIDER_UNAVAILABLE', 'RETRY_AFTER_UNKNOWN'].includes(code)) fail('INVALID_JOB_RESULT');
    const invalid = !Number.isSafeInteger(nextAttemptAt) || nextAttemptAt < 0 || nextAttemptAt > MAX_TIME;
    const budget = budgetScope(value);
    await database.batch([
      scopeFence(value),
      statement("SELECT CASE WHEN EXISTS(SELECT 1 FROM company_bank_sync_requests WHERE id=? AND company_id=? AND owner=? AND account_key=? AND provider=? AND connection_id=?) THEN 1 ELSE json('UNRESERVED_PROVIDER_REQUEST') END", requestId, value.companyId, value.owner, value.accountKey, value.provider, value.connectionId),
      statement(`UPDATE company_bank_sync_jobs SET next_attempt_at=MAX(next_attempt_at,?),retry_blocked=MAX(retry_blocked,?),
        status=CASE WHEN status='running' THEN status WHEN revoked=1 OR retry_blocked>0 OR ?=1 THEN 'blocked' ELSE 'retry' END,
        error_code=CASE WHEN revoked=1 THEN error_code ELSE ? END WHERE ${budget.where} AND owner=?`, invalid ? 0 : nextAttemptAt, invalid ? 2 : 0, Number(invalid), invalid ? 'RETRY_AFTER_UNKNOWN' : code, ...budget.keys, value.owner),
    ]);
  }

  async function claim(input) {
    const value = validateCompanySyncContext(input, now());
    await scope(value);
    const binding = await authority(value), token = crypto.randomUUID(), at = now();
    const acquired = await statement(`UPDATE company_bank_sync_jobs SET lease_token=?,lease_until=?,lease_deadline=?,fence_version=fence_version+1,
      status='running',last_attempt_at=?,attempts=attempts+1,error_code=NULL
      WHERE company_id=? AND account_key=? AND owner=? AND authority_hash=? AND revoked=0 AND valid_until>${clock}
      AND (lease_token='' OR lease_until<=?) AND next_attempt_at<=? AND retry_blocked=0`, token, at + leaseMs, at + maxRunMs, at, value.companyId, value.accountKey, value.owner, binding.hash, at, at, at).run();
    const owned = await job(value);
    if (acquired.meta.changes !== 1) {
      if (!owned || owned.authority_hash !== binding.hash || owned.revoked) fail('AUTHORIZATION_CHANGED');
      if (owned.lease_token && owned.lease_until > at) fail('ACCOUNT_BUSY');
      if (owned.retry_blocked) fail(owned.retry_blocked === 2 ? 'RETRY_AFTER_UNKNOWN' : 'JOB_BLOCKED');
      throw companySyncError('RETRY_NOT_DUE', { nextAttemptAt: owned.next_attempt_at });
    }
    const version = owned.fence_version, guards = [];
    let finished = false;
    const check = async (requireAuthorization = true) => {
      const row = await job(value);
      if (!row || row.authority_hash !== binding.hash || row.revoked) fail('AUTHORIZATION_CHANGED');
      if (finished || row.status !== 'running' || row.lease_token !== token || row.fence_version !== version || row.lease_until <= now() || row.lease_deadline <= now()) fail('LEASE_LOST');
      if (requireAuthorization && row.valid_until <= now()) fail('CONSENT_EXPIRED');
      if (requireAuthorization) for (const guard of guards) await guard.assert();
      return row;
    };
    const fence = (requireAuthorization = true, terminal = false) => statement(`SELECT CASE WHEN EXISTS(SELECT 1 FROM company_bank_sync_jobs
      WHERE company_id=? AND account_key=? AND owner=? AND authority_hash=? AND revoked=0 AND lease_token=? AND fence_version=?
      ${terminal ? '' : "AND status='running'"} AND lease_until>${clock} AND lease_deadline>${clock}${requireAuthorization ? ` AND valid_until>${clock}` : ''})
      THEN 1 ELSE json('COMPANY_SYNC_FENCE') END`, value.companyId, value.accountKey, value.owner, binding.hash, token, version, now(), now(), ...(requireAuthorization ? [now()] : []));
    const guardedWrite = async (statements, requireAuthorization = true, terminal = false) => {
      await check(requireAuthorization);
      const extra = requireAuthorization ? guards.map(guard => guard.fence()) : [];
      try {
        const results = await database.batch([scopeFence(value), fence(requireAuthorization), ...extra, ...statements, ...extra, fence(requireAuthorization, terminal)]);
        return results.slice(2 + extra.length, 2 + extra.length + statements.length);
      } catch (error) { await check(requireAuthorization); throw error; }
    };
    const lease = {
      context: value,
      deadline: at + maxRunMs,
      assert: () => check(),
      fence: () => fence(),
      addGuard(guard) {
        if (!guard || typeof guard.assert !== 'function' || typeof guard.fence !== 'function') throw new TypeError('A current SQL guard is required');
        guards.push(guard);
      },
      write: statements => guardedWrite(statements),
      async renew() {
        await check();
        await guardedWrite([statement('UPDATE company_bank_sync_jobs SET lease_until=MIN(?,lease_deadline) WHERE company_id=? AND account_key=?', now() + leaseMs, value.companyId, value.accountKey)]);
      },
      async reserveRequest() {
        const { maxRequests, windowMs } = value.ratePolicy, at = now();
        const { where, keys } = budgetScope(value), id = crypto.randomUUID();
        try {
          await guardedWrite([
            statement(`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM company_bank_sync_jobs WHERE ${where} AND (retry_blocked=2 OR next_attempt_at>${clock})) THEN 1 ELSE json('PROVIDER_COOLDOWN') END`, ...keys, at),
            statement(`SELECT CASE WHEN (SELECT count(*) FROM company_bank_sync_requests WHERE ${where} AND reserved_at>(${clock}-?))<? THEN 1 ELSE json('PROVIDER_BUDGET_EXHAUSTED') END`, ...keys, at, windowMs, maxRequests),
            statement(`INSERT INTO company_bank_sync_requests(id,company_id,owner,account_key,connection_id,provider,reserved_at) VALUES(?,?,?,?,?,?,${clock})`, id, value.companyId, value.owner, value.accountKey, value.connectionId, value.provider, at),
          ]);
          return { id };
        } catch (error) {
          await check();
          const cooldown = await statement(`SELECT max(next_attempt_at) until,max(CASE WHEN retry_blocked=2 THEN 1 ELSE 0 END) unknown FROM company_bank_sync_jobs WHERE ${where}`, ...keys).first();
          if (cooldown.unknown) fail('RETRY_AFTER_UNKNOWN');
          if (cooldown.until > now()) throw companySyncError('PROVIDER_429', { nextAttemptAt: cooldown.until });
          const row = await statement(`SELECT count(*) n,min(reserved_at) first FROM company_bank_sync_requests WHERE ${where} AND reserved_at>?`, ...keys, now() - windowMs).first();
          if (row.n >= maxRequests) throw companySyncError('PROVIDER_BUDGET_EXHAUSTED', { nextAttemptAt: row.first + windowMs });
          throw error;
        }
      },
      async commit({ key, sha256, statements, result, checkpoint }) {
        if (!text(key, 1000) || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) || !Array.isArray(statements) || statements.length > 1000) fail('INVALID_IMPORT_RECEIPT');
        const payload = json(result), checkPayload = checkpoint === undefined ? undefined : json(checkpoint);
        await check();
        const duplicate = receipt => {
          if (receipt.sha256 !== sha256) fail('IMPORT_IDENTITY_CONFLICT');
          return { duplicate: true, result: JSON.parse(receipt.result) };
        };
        const previous = await readReceipt(value, key);
        if (previous) return duplicate(previous);
        try {
          await guardedWrite([
            statement("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM company_bank_sync_receipts WHERE company_id=? AND account_key=? AND receipt_key=?) THEN 1 ELSE json('DUPLICATE_RECEIPT') END", value.companyId, value.accountKey, key),
            ...statements,
            statement('INSERT INTO company_bank_sync_receipts(company_id,owner,account_key,receipt_key,sha256,result,committed_at) VALUES(?,?,?,?,?,?,?)', value.companyId, value.owner, value.accountKey, key, sha256, payload, now()),
            ...(checkPayload === undefined ? [] : [statement('UPDATE company_bank_sync_jobs SET checkpoint=? WHERE company_id=? AND account_key=?', checkPayload, value.companyId, value.accountKey)]),
          ]);
          return { duplicate: false, result: JSON.parse(payload) };
        } catch (error) {
          const committed = await readReceipt(value, key);
          if (committed) { await check(); return duplicate(committed); }
          throw error;
        }
      },
      /** Node-only bridge: the facade runs synchronous canonical financial work
       * between these SQL guards and writes the actual result in the same txn.
       * D1 adapters use commit(statements) and never emulate an async transaction.
       */
      async commitWork({ key, sha256, work, checkpoint }) {
        if (typeof database.batchWork !== 'function' || typeof work !== 'function' || !text(key, 1000) || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) fail('INVALID_IMPORT_RECEIPT');
        const checkPayload = checkpoint === undefined ? undefined : json(checkpoint);
        await check();
        const duplicate = receipt => {
          if (receipt.sha256 !== sha256) fail('IMPORT_IDENTITY_CONFLICT');
          return { duplicate: true, result: JSON.parse(receipt.result) };
        };
        const previous = await readReceipt(value, key);
        if (previous) return duplicate(previous);
        const extra = guards.map(guard => guard.fence());
        try {
          const result = await database.batchWork([
            scopeFence(value), fence(), ...extra,
            statement("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM company_bank_sync_receipts WHERE company_id=? AND account_key=? AND receipt_key=?) THEN 1 ELSE json('DUPLICATE_RECEIPT') END", value.companyId, value.accountKey, key),
          ], () => {
            const result = work();
            if (result && typeof result.then === 'function') throw new TypeError('Company financial work must be synchronous');
            return result;
          }, result => [
            statement('INSERT INTO company_bank_sync_receipts(company_id,owner,account_key,receipt_key,sha256,result,committed_at) VALUES(?,?,?,?,?,?,?)', value.companyId, value.owner, value.accountKey, key, sha256, json(result), now()),
            ...(checkPayload === undefined ? [] : [statement('UPDATE company_bank_sync_jobs SET checkpoint=? WHERE company_id=? AND account_key=?', checkPayload, value.companyId, value.accountKey)]),
            ...extra, fence(),
          ]);
          return { duplicate: false, result };
        } catch (error) {
          const committed = await readReceipt(value, key);
          if (committed) { await check(); return duplicate(committed); }
          await check();
          throw error;
        }
      },
      async finish({ status: outcome, code = null, nextAttemptAt = 0, coverage: evidence = null }) {
        if (!['success', 'partial', 'blocked', 'retry'].includes(outcome)) fail('INVALID_JOB_RESULT');
        const invalidRetry = !Number.isSafeInteger(nextAttemptAt) || nextAttemptAt < 0 || nextAttemptAt > MAX_TIME;
        const blocked = invalidRetry ? 2 : outcome === 'blocked' ? 1 : 0;
        if (invalidRetry) { outcome = 'blocked'; code = 'RETRY_AFTER_UNKNOWN'; nextAttemptAt = 0; }
        const evidenceJson = json(coverage(evidence));
        await guardedWrite([statement(`UPDATE company_bank_sync_jobs SET status=?,error_code=?,next_attempt_at=MAX(next_attempt_at,?),retry_blocked=MAX(retry_blocked,?),coverage=?,
          last_success_at=CASE WHEN ?='success' THEN ? ELSE last_success_at END WHERE company_id=? AND account_key=?`, outcome, code === null ? null : safeCode(code), nextAttemptAt, blocked, evidenceJson, outcome, now(), value.companyId, value.accountKey)], outcome === 'success' || outcome === 'partial', true);
        await statement("UPDATE company_bank_sync_jobs SET lease_token='',lease_until=0,lease_deadline=0 WHERE company_id=? AND account_key=? AND lease_token=? AND fence_version=?", value.companyId, value.accountKey, token, version).run();
        finished = true;
      },
      async release() {
        await statement(`UPDATE company_bank_sync_jobs SET status=CASE WHEN status='running' THEN 'retry' ELSE status END,
          error_code=CASE WHEN status='running' THEN 'INTERRUPTED' ELSE error_code END,lease_token='',lease_until=0,lease_deadline=0
          WHERE company_id=? AND account_key=? AND lease_token=? AND fence_version=?`, value.companyId, value.accountKey, token, version).run();
        finished = true;
      },
    };
    return lease;
  }
  return { bindScope, scope, setReferencePolicy, referencePolicy, register, revoke, status, receipt, noteProviderCooldown, claim };
}
