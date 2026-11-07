import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {setImmediate as immediate} from 'node:timers/promises';
import {runSitesOcr, sitesOcrFailure} from '../src/sites-ocr-pull.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function fixture(t, heartbeat) {
  t.mock.timers.enable({apis: ['setTimeout']});
  const token = randomBytes(32).toString('base64url');
  const bytes = Buffer.from('synthetic original for bounded heartbeat recovery');
  const job = {
    id: 'synthetic-heartbeat-job', lease: randomBytes(32).toString('base64url'),
    mime: 'image/png', size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), protocol: 2,
    lease_until: new Date(Date.now() + 180000).toISOString(),
  };
  job.run_id = createHash('sha256').update(JSON.stringify([
    'document-job-v1', 'synthetic-heartbeat-owner', job.id, job.lease,
  ])).digest('base64url');
  const f = {
    job, heartbeats: 0, activeHeartbeats: 0, maxActiveHeartbeats: 0,
    leases: 0, downloads: 0, extractions: 0, completions: [], heartbeatBodies: [],
    started: deferred(), finished: deferred(), extraction: deferred(),
  };
  const result = {text: 'Synthetic completed OCR result', method: 'ocr', confidence: 72};
  f.result = result;
  f.heartbeatResponse = () => Response.json({
    ok: true, run_id: job.run_id,
    lease_until: new Date(Date.now() + 180000).toISOString(),
  });
  t.after(() => f.extraction.resolve());
  const identity = {id: job.id, lease: job.lease, sha256: job.sha256};
  f.run = () => runSitesOcr({origin: 'https://synthetic.example', token, mode: 'local'}, {
    fetchImpl: async (url, options) => {
      const target = new URL(url);
      assert.equal(target.origin, 'https://synthetic.example');
      assert.equal(options.headers.Authorization, 'Bearer ' + token);
      assert.equal(options.redirect, 'manual');
      const action = target.pathname.split('/').pop();
      if (action === 'lease') {
        f.leases++;
        return Response.json({job: f.leases === 1 ? job : null});
      }
      if (action === 'document') {
        f.downloads++;
        assert.equal(target.searchParams.get('id'), job.id);
        assert.equal(options.headers['X-MG-OCR-Lease'], job.lease);
        return new Response(bytes);
      }
      const body = JSON.parse(options.body);
      assert.deepEqual({id: body.id, lease: body.lease, sha256: body.sha256}, identity);
      if (action === 'heartbeat') {
        f.heartbeats++;
        f.heartbeatBodies.push(body);
        f.activeHeartbeats++;
        f.maxActiveHeartbeats = Math.max(f.maxActiveHeartbeats, f.activeHeartbeats);
        try { return await heartbeat(f); }
        finally { f.activeHeartbeats--; }
      }
      if (action === 'complete') {
        assert.equal(f.activeHeartbeats, 0, 'completion waits for the last heartbeat');
        f.completions.push(body);
        return Response.json({state: 'needs_review'});
      }
      assert.fail('unexpected synthetic request: ' + action);
    },
    extract: async (input, mime) => {
      f.extractions++;
      assert.deepEqual(input, bytes);
      assert.equal(mime, job.mime);
      f.started.resolve();
      await f.extraction.promise;
      f.finished.resolve();
      return result;
    },
  });
  // Attach the rejection handler immediately, including while extraction and a
  // periodic heartbeat are intentionally held at independent barriers.
  f.start = () => f.run().then(value => ({value}), error => ({error}));
  return f;
}

async function periodicHeartbeat(t, f, outcome) {
  await Promise.race([
    f.started.promise,
    outcome.then(result => assert.fail('worker settled before extraction: ' + JSON.stringify(result))),
  ]);
  assert.equal(f.heartbeats, 1);
  t.mock.timers.tick(30000);
  await immediate();
  assert.equal(f.heartbeats, 2);
}

async function finishExtraction(f) {
  f.extraction.resolve();
  await f.finished.promise;
  await immediate();
}

async function assertStopped(t, f, expectedHeartbeats) {
  const before = {leases: f.leases, completions: f.completions.length};
  t.mock.timers.tick(120000);
  await immediate();
  assert.equal(f.heartbeats, expectedHeartbeats);
  assert.equal(f.activeHeartbeats, 0);
  assert.deepEqual({leases: f.leases, completions: f.completions.length}, before);
}

for (const kind of ['transport', 'HTTP 503']) {
  test('a single periodic ' + kind + ' failure retains the already finished OCR result', {timeout: 5000}, async t => {
    const held = deferred();
    const f = fixture(t, f => f.heartbeats === 2 ? held.promise : f.heartbeatResponse());
    t.after(() => held.resolve(f.heartbeatResponse()));
    const outcome = f.start();
    await periodicHeartbeat(t, f, outcome);
    await finishExtraction(f);
    assert.equal(f.completions.length, 0);
    if (kind === 'transport') held.reject(Error('synthetic transient heartbeat transport failure'));
    else held.resolve(new Response('synthetic unavailable', {status: 503}));
    await immediate();
    t.mock.timers.tick(250);
    await immediate();
    assert.deepEqual(await outcome, {value: {processed: 1, failed: 0}});
    assert.equal(f.heartbeats, 3);
    assert.equal(f.maxActiveHeartbeats, 1);
    assert.equal(f.extractions, 1);
    assert.equal(f.downloads, 1);
    assert.equal(f.leases, 2);
    assert.deepEqual(f.completions, [{
      id: f.job.id, lease: f.job.lease, sha256: f.job.sha256, ...f.result,
    }]);
    assert.deepEqual(f.heartbeatBodies, Array.from({length: 3}, () => ({
      id: f.job.id, lease: f.job.lease, sha256: f.job.sha256,
    })));
    await assertStopped(t, f, 3);
  });
}

test('repeated periodic transport failures stop after one retry without completion or another claim', {timeout: 5000}, async t => {
  const held = deferred();
  const failure = Error('synthetic repeated heartbeat transport failure');
  const f = fixture(t, f => {
    if (f.heartbeats === 1) return f.heartbeatResponse();
    if (f.heartbeats === 2) return held.promise;
    throw failure;
  });
  t.after(() => held.resolve(f.heartbeatResponse()));
  const outcome = f.start();
  await periodicHeartbeat(t, f, outcome);
  await finishExtraction(f);
  held.reject(failure);
  await immediate();
  t.mock.timers.tick(250);
  await immediate();
  assert.equal((await outcome).error, failure);
  assert.equal(f.heartbeats, 3);
  assert.equal(f.maxActiveHeartbeats, 1);
  assert.equal(f.extractions, 1);
  assert.equal(f.completions.length, 0);
  assert.equal(f.leases, 1);
  await assertStopped(t, f, 3);
});

test('a slow periodic heartbeat stays single-flight and completion joins it before teardown', {timeout: 5000}, async t => {
  const held = deferred();
  const f = fixture(t, f => f.heartbeats === 2 ? held.promise : f.heartbeatResponse());
  t.after(() => held.resolve(f.heartbeatResponse()));
  const outcome = f.start();
  await periodicHeartbeat(t, f, outcome);
  for (let n = 0; n < 3; n++) {
    t.mock.timers.tick(30000);
    await immediate();
    assert.equal(f.heartbeats, 2);
    assert.equal(f.activeHeartbeats, 1);
  }
  await finishExtraction(f);
  assert.equal(f.completions.length, 0);
  held.resolve(f.heartbeatResponse());
  assert.deepEqual(await outcome, {value: {processed: 1, failed: 0}});
  assert.equal(f.heartbeats, 2);
  assert.equal(f.maxActiveHeartbeats, 1);
  assert.equal(f.completions.length, 1);
  assert.equal(f.extractions, 1);
  await assertStopped(t, f, 2);
});

for (const [status, retryAfter] of [[409], [401], [403], [302], [429], [503, '120']]) {
  test('periodic heartbeat HTTP ' + status + (retryAfter ? ' with Retry-After' : '') + ' stops without retry or failure acknowledgement', {timeout: 5000}, async t => {
    const f = fixture(t, f => f.heartbeats === 1 ? f.heartbeatResponse() : new Response('synthetic rejected heartbeat', {
      status, ...(retryAfter ? {headers: {'Retry-After': retryAfter}} : {}),
    }));
    const outcome = f.start();
    await periodicHeartbeat(t, f, outcome);
    const result = await outcome;
    assert.ok(result.error);
    assert.equal(sitesOcrFailure(result.error).http_status, status);
    assert.equal(f.heartbeats, 2);
    assert.equal(f.leases, 1);
    assert.equal(f.completions.length, 0);
    // A late extractor result must not resurrect work after ownership/auth loss.
    await finishExtraction(f);
    await assertStopped(t, f, 2);
    assert.equal(f.completions.length, 0);
  });
}
