import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { boundedBody, runSitesOcr } from '../src/sites-ocr-pull.js';

function fixture({ download, extract, completion, leaseFailureAfter, jobs = 1 } = {}) {
  const token = randomBytes(32).toString('base64url');
  const lease = randomBytes(32).toString('base64url');
  const bytes = Buffer.from('complete synthetic original');
  const job = { id: 'synthetic-transport', lease, mime: 'image/png', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const calls = [];
  const completions = [];
  let leaseCalls = 0;
  let downloadCalls = 0;
  let extractCalls = 0;
  const fetchImpl = async (url, options) => {
    const target = new URL(url);
    assert.equal(target.origin, 'https://synthetic.example');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.redirect, 'manual');
    calls.push(target.pathname);
    if (target.pathname.endsWith('/lease')) {
      leaseCalls++;
      if (leaseFailureAfter !== undefined && leaseCalls > leaseFailureAfter) return new Response('unavailable', { status: 503 });
      return Response.json({ job: leaseCalls <= jobs ? job : null });
    }
    if (target.pathname.endsWith('/document')) {
      assert.equal(options.method, 'GET');
      assert.equal(options.headers['X-MG-OCR-Lease'], lease);
      downloadCalls++;
      return download ? download({ attempt: downloadCalls, bytes, options }) : new Response(bytes);
    }
    if (target.pathname.endsWith('/complete')) {
      const result = JSON.parse(options.body);
      assert.equal(result.id, job.id);
      assert.equal(result.lease, lease);
      assert.equal(result.sha256, job.sha256);
      completions.push(result);
      return completion ? completion(result) : Response.json(result.error ? { ok: true } : { state: 'needs_review' });
    }
    throw Error('unexpected synthetic request');
  };
  return {
    calls, completions,
    get downloadCalls() { return downloadCalls; },
    get extractCalls() { return extractCalls; },
    run: () => runSitesOcr({ origin: 'https://synthetic.example', token, mode: 'local' }, { fetchImpl, extract: async (data, mime) => {
      extractCalls++;
      assert.deepEqual(data, bytes);
      assert.equal(mime, job.mime);
      return extract ? extract(extractCalls) : { text: 'Synthetic OCR', method: 'ocr', confidence: 90 };
    } }),
  };
}

function interruptedBody(bytes) {
  let read = false;
  return new Response(new ReadableStream({
    pull(controller) {
      if (!read) { read = true; controller.enqueue(bytes.subarray(0, 5)); }
      else controller.error(Error('synthetic interrupted stream'));
    },
  }));
}

test('a transient document HTTP failure retries the same lease before OCR', async () => {
  const worker = fixture({ download: ({ attempt, bytes }) => attempt === 1 ? new Response('unavailable', { status: 503 }) : new Response(bytes) });
  assert.deepEqual(await worker.run(), { processed: 1, failed: 0 });
  assert.equal(worker.downloadCalls, 2);
  assert.equal(worker.extractCalls, 1);
  assert.equal(worker.completions.length, 1);
  assert.equal(worker.completions[0].error, undefined);
});

test('a partial download is discarded and a fresh complete original is hashed before OCR', async () => {
  const worker = fixture({ download: ({ attempt, bytes }) => attempt === 1 ? interruptedBody(bytes) : new Response(bytes) });
  assert.deepEqual(await worker.run(), { processed: 1, failed: 0 });
  assert.equal(worker.downloadCalls, 2);
  assert.equal(worker.extractCalls, 1);
  assert.equal(worker.completions.length, 1);
  assert.equal(worker.completions[0].error, undefined);
});

for (const kind of ['network', 'stream']) {
  test(`persistent ${kind} interruption stays bounded and never becomes an OCR failure acknowledgement`, async () => {
    const worker = fixture({ download: ({ bytes }) => {
      if (kind === 'network') throw Error('synthetic network unavailable');
      return interruptedBody(bytes);
    } });
    await assert.rejects(worker.run());
    assert.equal(worker.downloadCalls, 2);
    assert.equal(worker.extractCalls, 0);
    assert.equal(worker.completions.length, 0);
    assert.equal(worker.calls.filter(path => path.endsWith('/lease')).length, 1);
  });
}

for (const status of [401, 403, 302, 429]) {
  test(`document HTTP ${status} is neither retried nor acknowledged as an OCR failure`, async () => {
    const worker = fixture({ download: () => new Response('rejected', { status }) });
    await assert.rejects(worker.run());
    assert.equal(worker.downloadCalls, 1);
    assert.equal(worker.extractCalls, 0);
    assert.equal(worker.completions.length, 0);
  });
}

for (const retryAfter of ['120', 'Thu, 01 Jan 2099 00:00:00 GMT']) {
  test(`a 503 with Retry-After ${retryAfter} defers instead of retrying immediately`, async () => {
    const worker = fixture({ download: () => new Response('unavailable', { status: 503, headers: { 'Retry-After': retryAfter } }) });
    await assert.rejects(worker.run());
    assert.equal(worker.downloadCalls, 1);
    assert.equal(worker.extractCalls, 0);
    assert.equal(worker.completions.length, 0);
  });
}

test('an oversized download is rejected without retry or an OCR failure acknowledgement', async () => {
  const worker = fixture({ download: () => new Response('oversized', { headers: { 'Content-Length': '15000001' } }) });
  await assert.rejects(worker.run());
  assert.equal(worker.downloadCalls, 1);
  assert.equal(worker.extractCalls, 0);
  assert.equal(worker.completions.length, 0);
});

for (const limitSource of ['declared', 'streamed']) {
  for (const cleanup of ['never settles', 'rejects']) {
    test(`an oversized ${limitSource} body preserves response_limit when cleanup ${cleanup}`, async () => {
      let cancelled = 0;
      const response = new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(9)); },
        cancel() {
          cancelled++;
          return cleanup === 'never settles' ? new Promise(() => {}) : Promise.reject(Error('private cancellation failure'));
        },
      }), { headers: limitSource === 'declared' ? { 'Content-Length': '9' } : {} });
      let timer;
      try {
        await assert.rejects(Promise.race([
          boundedBody(response, 8),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Error('size rejection waited for cleanup')), 150); }),
        ]), { message: 'response_limit' });
        assert.equal(cancelled, 1);
      } finally { clearTimeout(timer); }
    });
  }
}

for (const [size, declared] of [[7, 7], [8, 8], [8, null]]) {
  test(`a ${size}-byte body with declared size ${declared} remains readable within the limit`, async () => {
    const bytes = Uint8Array.from({ length: size }, (_, index) => index + 1);
    let cancelled = 0;
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes.subarray(0, 4)); controller.enqueue(bytes.subarray(4)); controller.close(); },
      cancel() { cancelled++; },
    }), { headers: declared === null ? {} : { 'Content-Length': String(declared) } });
    assert.deepEqual(await boundedBody(response, 8), Buffer.from(bytes));
    assert.equal(cancelled, 0);
  });
}

test('an accepted OCR failure survives a later lease interruption in the partial-run counts', async () => {
  const worker = fixture({ extract: () => { throw Error('synthetic OCR failed'); }, leaseFailureAfter: 1 });
  assert.deepEqual(await worker.run(), { processed: 0, failed: 1, status_unknown: true });
  assert.equal(worker.completions.length, 1);
  assert.equal(worker.completions[0].error, true);
});

test('an acknowledged failed document does not prevent processing the next healthy document', async () => {
  const worker = fixture({ jobs: 2, extract: call => {
    if (call === 1) throw Error('synthetic bad document');
    return { text: 'Synthetic healthy document', method: 'ocr', confidence: 90 };
  } });
  assert.deepEqual(await worker.run(), { processed: 1, failed: 1 });
  assert.equal(worker.extractCalls, 2);
  assert.equal(worker.completions.length, 2);
});

for (const priorFailure of [false, true]) {
  for (const rejectedCompletion of ['lost', 'ignored']) {
    test(`a ${rejectedCompletion} failure acknowledgement counts only the prior accepted ${priorFailure ? 'failure' : 'success'}`, async () => {
      let completionCalls = 0;
      const worker = fixture({ jobs: 2, extract: call => {
        if (priorFailure || call === 2) throw Error('synthetic OCR failure');
        return { text: 'Synthetic accepted document', method: 'ocr', confidence: 90 };
      }, completion: result => {
        completionCalls++;
        if (completionCalls === 1) return Response.json(result.error ? { ok: true } : { state: 'needs_review' });
        if (rejectedCompletion === 'lost') throw Error('synthetic lost acknowledgement');
        return Response.json({ ignored: true });
      } });
      assert.deepEqual(await worker.run(), { processed: priorFailure ? 0 : 1, failed: priorFailure ? 1 : 0, status_unknown: true });
      assert.equal(worker.extractCalls, 2);
      assert.equal(worker.completions.length, 2);
      assert.equal(worker.completions[1].error, true);
      assert.equal(worker.calls.filter(path => path.endsWith('/lease')).length, 2);
    });
  }
}
