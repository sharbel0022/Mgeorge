// Independent reviewer probes. Appended only to a temporary byte-identical
// copy of banking-security.test.mjs, reusing its real service/SQLite fixture.
// Only names beginning with this prefix are selected by the reviewer runner.
const independentProjectionSecret = 'INDEPENDENT_SYNTHETIC_PRIVATE_92B6FEFE';
const independentProjectionPrefix = 'independent failure projection: ';

function independentProjectionPrivacy(f, result, logs = [], expectedStatus = 409) {
  const { error, body } = result;
  const response = f.service.bankFailure(error);
  assert.equal(response.status, expectedStatus);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  if (expectedStatus === 409) {
    assert.equal(body.code, 'BANK_ACCOUNT_SCOPE_INVALID');
    assert.equal(body.reason, 'ACCOUNT_USAGE_INVALID');
  } else {
    assert.equal(expectedStatus, 401);
    assert.deepEqual(Object.keys(body).sort(), ['error', 'signIn']);
    assert.equal(body.signIn, '/signin-with-chatgpt?return_to=%2Fbank');
  }
  const audit = f.sql.prepare('SELECT action,detail FROM audit_events').all();
  const visible = JSON.stringify([body, audit, logs]);
  const secrets = [independentProjectionSecret, remoteSession,
    ...f.retainedUsageAccounts.flatMap(a => [a.uid, a.identification_hash, a.account_id.other.identification])];
  for (const secret of secrets) assert.ok(!visible.includes(secret), 'private fixture value escaped');
  for (const event of audit) {
    assert.ok(!event.detail.includes('providerFailure'));
    assert.ok(!event.detail.includes('validationIssue'));
    assert.ok(!event.detail.includes('usageDetailsDiagnostic'));
  }
  assertNoFinancialEffects(f);
}

for (const [name, create, expected] of [
  ['registered network code defeats forged invalid-response metadata', () => {
    const e = new ProviderError('BANK_NETWORK_ERROR', independentProjectionSecret, 504, true);
    e.code = 'INVALID_PROVIDER_RESPONSE';
    e.validationIssue = { field: independentProjectionSecret, kind: independentProjectionSecret };
    return e;
  }, { code: 'BANK_NETWORK_ERROR' }],
  ['registered invalid-response without an adapter issue invents no field', () => {
    const e = new ProviderError('INVALID_PROVIDER_RESPONSE', independentProjectionSecret);
    e.code = 'BANK_TIMEOUT';
    e.validationIssue = { field: 'currency', kind: 'null', raw: independentProjectionSecret };
    return e;
  }, { code: 'INVALID_PROVIDER_RESPONSE' }],
  ['unknown constructor code cannot be promoted by public code', () => {
    const e = new ProviderError(independentProjectionSecret, independentProjectionSecret);
    e.code = 'BANK_TIMEOUT';
    return e;
  }, undefined],
  ['boxed constructor string does not acquire allowlist membership', () => {
    const e = new ProviderError(new String('BANK_TIMEOUT'), independentProjectionSecret);
    e.code = 'BANK_TIMEOUT';
    return e;
  }, undefined],
  ['registered code survives removal of the entire public prototype', () => {
    const e = new ProviderError('BANK_ACCOUNT_UNAVAILABLE', independentProjectionSecret);
    Object.setPrototypeOf(e, null);
    return e;
  }, { code: 'BANK_ACCOUNT_UNAVAILABLE' }],
]) test(independentProjectionPrefix + name, async t => {
  const f = await usageDetailsFixture(t), before = { ...f.connection() };
  const failure = create();
  f.provider.getAccountDetails = async () => { throw failure; };
  const result = await usageDetailsDenial(f);
  assertDetailsFailure(f, result.body, expected);
  independentProjectionPrivacy(f, result);
  assert.deepEqual({ ...f.connection() }, before);
});

for (const name of ['null-prototype accessors', 'all-traps proxy around registered error', 'revoked callable proxy', 'function with borrowed provider prototype']) {
  test(independentProjectionPrefix + name + ' remains generic without evaluating properties', async t => {
    const f = await usageDetailsFixture(t), before = { ...f.connection() };
    let reads = 0;
    const hostile = () => { reads++; throw Error(independentProjectionSecret); };
    let failure;
    if (name === 'null-prototype accessors') {
      failure = Object.create(null);
      for (const key of ['code', 'message', 'status', 'validationIssue', 'toJSON']) Object.defineProperty(failure, key, { get: hostile });
    } else if (name === 'all-traps proxy around registered error') {
      failure = new Proxy(new ProviderError('INVALID_PROVIDER_RESPONSE', independentProjectionSecret), {
        get: hostile, getPrototypeOf: hostile, ownKeys: hostile, getOwnPropertyDescriptor: hostile, has: hostile,
      });
    } else if (name === 'revoked callable proxy') {
      const p = Proxy.revocable(() => {}, { get: hostile, getPrototypeOf: hostile });
      p.revoke(); failure = p.proxy;
    } else {
      failure = () => {}; Object.setPrototypeOf(failure, ProviderError.prototype);
      Object.defineProperty(failure, 'code', { get: hostile });
    }
    f.provider.getAccountDetails = async () => { throw failure; };
    const result = await usageDetailsDenial(f);
    assertDetailsFailure(f, result.body, undefined);
    assert.equal(reads, 0);
    independentProjectionPrivacy(f, result);
    assert.deepEqual({ ...f.connection() }, before);
  });
}

for (const [name, failure] of [['undefined', undefined], ['symbol', Symbol(independentProjectionSecret)], ['bigint', 17n]]) {
  test(independentProjectionPrefix + 'thrown ' + name + ' is safely generic', async t => {
    const f = await usageDetailsFixture(t), before = { ...f.connection() };
    f.provider.getAccountDetails = async () => { throw failure; };
    const result = await usageDetailsDenial(f);
    assertDetailsFailure(f, result.body, undefined);
    independentProjectionPrivacy(f, result);
    assert.deepEqual({ ...f.connection() }, before);
  });
}

test(independentProjectionPrefix + 'actual adapter issue survives hostile public code and issue getters', async t => {
  const f = await usageDetailsFixture(t), before = { ...f.connection() }, logs = [];
  const actual = await import('../lib/banking/enable-banking.ts');
  const privateKeyPem = generateKeyPairSync('rsa', { modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } }).privateKey;
  let reads = 0, httpCalls = 0;
  t.mock.method(console, 'error', (...args) => logs.push(args));
  t.mock.method(globalThis, 'fetch', async (address, options) => {
    assert.equal(new URL(address).pathname, '/accounts/' + accountUid + '/details');
    assert.equal(options.method, 'GET'); httpCalls++;
    return Response.json({ currency: 'SEK', cash_account_type: null, raw: independentProjectionSecret });
  });
  f.provider.getAccountDetails = async (config, uid) => {
    try { return await actual.getAccountDetails({ applicationId: appId, privateKeyPem }, uid); }
    catch (error) {
      assert.equal(actual.providerErrorCode(error), 'INVALID_PROVIDER_RESPONSE');
      for (const key of ['code', 'message', 'status', 'validationIssue', 'providerFailure', 'toJSON']) {
        Object.defineProperty(error, key, { get() { reads++; throw Error(independentProjectionSecret); } });
      }
      throw error;
    }
  };
  const result = await usageDetailsDenial(f);
  assertDetailsFailure(f, result.body, { code: 'INVALID_PROVIDER_RESPONSE', validationIssue: { field: 'cash_account_type', kind: 'null' } });
  assert.equal(httpCalls, 1); assert.equal(reads, 0); assert.deepEqual(logs, []);
  independentProjectionPrivacy(f, result, logs);
  assert.deepEqual({ ...f.connection() }, before);
});

test(independentProjectionPrefix + 'fifth actual-adapter failure hides four mixed prior observations', async t => {
  const f = await usageDetailsFixture(t, 5, { actualProvider: true });
  for (const [i, usage] of ['ORGA', 'PRIV', undefined, 'ORGA'].entries()) {
    const value = f.usageDetails.get(f.retainedUsageAccounts[i].uid);
    if (usage === undefined) delete value.usage; else value.usage = usage;
  }
  f.usageDetails.get(f.retainedUsageAccounts[4].uid).account_id.other.identification = { raw: independentProjectionSecret };
  const before = { ...f.connection() }, result = await usageDetailsDenial(f);
  assertDetailsFailure(f, result.body, { code: 'INVALID_PROVIDER_RESPONSE', validationIssue: { field: 'account_id.other.identification', kind: 'object' } }, { size: 5, attempted: 5, observed: 4 });
  assert.ok(!JSON.stringify(result.body).includes('ORGA'));
  assert.ok(!JSON.stringify(result.body).includes('PRIV'));
  independentProjectionPrivacy(f, result);
  assert.deepEqual({ ...f.connection() }, before);
});

test(independentProjectionPrefix + 'replaced read marker masks a trusted second failure and retains the replacement', async t => {
  const f = await usageDetailsFixture(t, 2), before = { ...f.connection() };
  const replacement = JSON.stringify({ status: 'pending', checkedAt: new Date().toISOString(), attemptId: 'independent-newer-marker' });
  f.provider.getAccountDetails = async (_config, uid) => {
    if (uid === accountUid) return structuredClone(f.usageDetails.get(uid));
    f.sql.prepare('UPDATE bank_connections SET account_evidence_retry=?').run(replacement);
    throw new ProviderError('BANK_TIMEOUT', independentProjectionSecret, 504, true);
  };
  const result = await usageDetailsDenial(f);
  assertDetailsFailure(f, result.body, undefined, { size: 2, attempted: 2, observed: 1 });
  assert.equal(f.connection().account_evidence_retry, replacement);
  assert.equal(accountReadCooldown(replacement).blocked, true);
  assert.deepEqual({ ...f.connection(), account_evidence_retry: before.account_evidence_retry }, before);
  independentProjectionPrivacy(f, result);
});

for (const mode of ['lost audit reply', 'owner lost after audit commit', 'application deactivated after audit commit']) {
  test(independentProjectionPrefix + mode + ' suppresses the complete diagnostic', async t => {
    const f = await usageDetailsFixture(t), before = { ...f.connection() }, batch = f.d1.batch.bind(f.d1);
    f.provider.getAccountDetails = async () => { throw new ProviderError('BANK_TIMEOUT', independentProjectionSecret, 504, true); };
    f.d1.batch = async statements => {
      const result = await batch(statements);
      if (failedAuditBatch(statements)) {
        if (mode === 'lost audit reply') throw Error(independentProjectionSecret);
        if (mode === 'owner lost after audit commit') f.user = null;
        if (mode === 'application deactivated after audit commit') f.sql.prepare('UPDATE bank_applications SET metadata=?').run(JSON.stringify({ ...f.info, active: false }));
      }
      return result;
    };
    let result;
    if (mode === 'owner lost after audit commit') {
      let error; try { await f.service.revalidateConsent(post('revalidate')); } catch (caught) { error = caught; }
      const response = f.service.bankFailure(error);
      assert.equal(response.status, 401);
      result = { error, body: await response.json() };
    } else result = await usageDetailsDenial(f);
    assert.deepEqual(f.calls.map(c => c.name), ['getSession', 'getAccountDetails']);
    assert.ok(!('usageDiagnostic' in result.body));
    assert.ok(!('usageDetailsDiagnostic' in result.body));
    assert.equal(f.sql.prepare("SELECT count(*) n FROM audit_events WHERE action='bank.consent.revalidation.failed'").get().n, 1);
    independentProjectionPrivacy(f, result, [], mode === 'owner lost after audit commit' ? 401 : 409);
    assert.deepEqual({ ...f.connection() }, before);
  });
}

test(independentProjectionPrefix + 'real 503 cooldown remains effective and cannot trigger a retry', async t => {
  const f = await usageDetailsFixture(t, 1, { actualProvider: true }), before = { ...f.connection() };
  f.detailsResponse = () => Response.json({ error: 'UNRECOGNIZED', message: independentProjectionSecret }, { status: 503, headers: { 'Retry-After': '600' } });
  const result = await usageDetailsDenial(f);
  assertDetailsFailure(f, result.body, { code: 'BANK_SERVICE_ERROR' });
  const marker = f.connection().account_evidence_retry;
  assert.equal(accountReadCooldown(marker).blocked, true);
  let retryError; try { await f.service.revalidateConsent(post('revalidate')); } catch (error) { retryError = error; }
  const retryResponse = f.service.bankFailure(retryError), retryBody = await retryResponse.json();
  assert.equal(retryResponse.status, 409);
  assert.ok(!('usageDetailsDiagnostic' in retryBody));
  assert.deepEqual(f.calls.map(c => c.name), ['getSession', 'getAccountDetails']);
  assert.equal(f.connection().account_evidence_retry, marker);
  assert.deepEqual({ ...f.connection(), account_evidence_retry: before.account_evidence_retry }, before);
  independentProjectionPrivacy(f, result);
});

test(independentProjectionPrefix + 'successful ORGA detail is still the original denied consent', async t => {
  const f = await usageDetailsFixture(t, 1, { actualProvider: true }), before = { ...f.connection() };
  const result = await usageDetailsDenial(f);
  assert.deepEqual(result.body.usageDetailsDiagnostic, usageDetailsObserved({ orga: 1 }));
  assert.ok(!('providerFailure' in result.body.usageDetailsDiagnostic));
  assert.deepEqual(f.calls.map(c => c.name), ['getSession', 'getAccountDetails']);
  independentProjectionPrivacy(f, result);
  assert.deepEqual({ ...f.connection() }, before);
});
