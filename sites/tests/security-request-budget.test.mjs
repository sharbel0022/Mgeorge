import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const data = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
let code = ts.transpileModule(readFileSync(new URL('../lib/server.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
for (const [from, to] of Object.entries({
  'cloudflare:workers': data('export const env={};'),
  '@/app/chatgpt-auth': data('export async function getChatGPTUser(){return null;}'),
  './domain': new URL('../lib/domain.ts', import.meta.url).href,
  './company-storage.js': new URL('../lib/company-storage.js', import.meta.url).href,
})) for (const quote of ['"', "'"]) code = code.replaceAll(quote + from + quote, JSON.stringify(to));
const { withCompanyRequest } = await import(data(code));
const jsonLimit = 65_536;

function streamedRequest(path, parts, headers = {}) {
  let reads = 0, cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      reads++;
      if (parts.length) controller.enqueue(parts.shift());
      else controller.close();
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const request = new Request('https://synthetic.test' + path, {
    method: 'POST', body, duplex: 'half',
    headers: { Origin: 'https://synthetic.test', 'Content-Type': 'application/json', ...headers },
  });
  return { request, reads: () => reads, cancelled: () => cancelled };
}

for (const length of [undefined, '1']) test(`actual streamed JSON bytes are bounded with content-length ${length ?? 'missing'}`, async () => {
  let writes = 0;
  const handler = withCompanyRequest(async req => {
    await req.json();
    writes++;
    return Response.json({ ok: true });
  });
  const f = streamedRequest('/api/gmail/connect', [
    new TextEncoder().encode('{"padding":"'), new Uint8Array(jsonLimit).fill(120),
    new TextEncoder().encode('"}'),
  ], length === undefined ? {} : { 'Content-Length': length });
  const result = await handler(f.request);
  assert.equal(result.status, 413);
  assert.equal(writes, 0, 'Oversize input must not reach mutation code');
  assert.ok(f.cancelled(), 'The remainder of the client stream must be cancelled');
});

test('declared oversized JSON is rejected without pulling or dispatching the body', async () => {
  let dispatched = 0;
  const f = streamedRequest('/api/companies', [new TextEncoder().encode('{}')], { 'Content-Length': '999999999' });
  const result = await withCompanyRequest(async req => {
    dispatched++;
    await req.json();
    return Response.json({ ok: true });
  })(f.request);
  assert.equal(result.status, 413);
  assert.equal(dispatched, 0);
  assert.equal(f.reads(), 0);
});

test('request clones cannot bypass the state command byte budget', async () => {
  let writes = 0;
  const raw = JSON.stringify({ command: { type: 'settings.save', name: 'x'.repeat(1_500_000) } });
  const request = new Request('https://synthetic.test/api/state', { method: 'POST', body: raw });
  const result = await withCompanyRequest(async req => {
    // The real authorization layer clones a state command to determine its role.
    await req.clone().json();
    await req.json();
    writes++;
    return Response.json({ ok: true });
  })(request);
  assert.equal(result.status, 413);
  assert.equal(writes, 0);
});

test('body budgets count UTF-8 bytes rather than JavaScript characters', async () => {
  const raw = JSON.stringify({ text: 'å'.repeat(40_000) });
  assert.ok(raw.length < jsonLimit && Buffer.byteLength(raw) > jsonLimit);
  const result = await withCompanyRequest(async req => Response.json(await req.json()))(
    new Request('https://synthetic.test/api/gmail/connect', { method: 'POST', body: raw }),
  );
  assert.equal(result.status, 413);
});

test('ordinary JSON, request headers, URL and method survive the ingress wrapper', async () => {
  const raw = JSON.stringify({ name: 'Syntetiskt företag', n: 1 });
  const result = await withCompanyRequest(async req => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, 'https://synthetic.test/api/companies?test=1');
    assert.equal(req.headers.get('x-company-id'), 'synthetic-company');
    assert.deepEqual(await req.clone().json(), JSON.parse(raw));
    return new Response(await req.text());
  })(new Request('https://synthetic.test/api/companies?test=1', {
    method: 'POST', body: raw, headers: { 'X-Company-Id': 'synthetic-company' },
  }));
  assert.equal(result.status, 200);
  assert.equal(await result.text(), raw);
});

test('authentication denial does not eagerly read an anonymous upload', async () => {
  const f = streamedRequest('/api/files', [new Uint8Array(100)]);
  const result = await withCompanyRequest(async () => Response.json({ error: 'denied' }, { status: 401 }))(f.request);
  assert.equal(result.status, 401);
  assert.equal(f.reads(), 0);
});

test('an exact JSON byte limit is accepted and one additional byte is rejected', async () => {
  const raw = '{"padding":"' + 'x'.repeat(65_522) + '"}';
  assert.equal(Buffer.byteLength(raw), 65_536);
  const handler = withCompanyRequest(async req => { await req.json(); return Response.json({ ok: true }); });
  for (const [body, status] of [[raw, 200], [raw + ' ', 413]]) {
    assert.equal((await handler(new Request('https://synthetic.test/api/gmail/connect', { method: 'POST', body }))).status, status);
  }
});

for (const length of ['-1', 'many', '1, 2']) test(`malformed body length ${length} fails before dispatch`, async () => {
  let dispatched = false;
  const f = streamedRequest('/api/companies', [new TextEncoder().encode('{}')], { 'Content-Length': length });
  const result = await withCompanyRequest(async () => { dispatched = true; return new Response(); })(f.request);
  assert.equal(result.status, 400);
  assert.equal(dispatched, false);
  assert.equal(f.reads(), 0);
});

test('upstream stream failures return a fixed error without reflecting private exception text', async () => {
  const request = new Request('https://synthetic.test/api/companies', {
    method: 'POST', duplex: 'half', body: new ReadableStream({
      pull(controller) { controller.error(new Error('synthetic-private-token-and-account')); },
    }),
  });
  const result = await withCompanyRequest(async req => new Response(await req.text()))(request);
  assert.equal(result.status, 400);
  assert.equal((await result.json()).code, 'REQUEST_BODY_UNREADABLE');
});

test('a stalled body is cancelled at its deadline and cannot reach mutation code', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started, cancelled = false, writes = 0;
  const pulling = new Promise(resolve => { started = resolve; });
  const request = new Request('https://synthetic.test/api/companies', {
    method: 'POST', duplex: 'half', body: new ReadableStream({
      pull() { started(); }, cancel() { cancelled = true; },
    }, { highWaterMark: 0 }),
  });
  const result = withCompanyRequest(async req => { await req.json(); writes++; return new Response(); })(request);
  await pulling;
  t.mock.timers.tick(30_001);
  const response = await result;
  assert.equal(response.status, 408);
  assert.equal((await response.json()).code, 'REQUEST_BODY_TIMEOUT');
  assert.equal(writes, 0);
  assert.equal(cancelled, true);
});

test('client abort cancels the pending read without disclosing the abort reason', async () => {
  const abort = new AbortController();
  let started, cancelled = false;
  const pulling = new Promise(resolve => { started = resolve; });
  const request = new Request('https://synthetic.test/api/companies', {
    method: 'POST', duplex: 'half', signal: abort.signal, body: new ReadableStream({
      pull() { started(); }, cancel() { cancelled = true; },
    }, { highWaterMark: 0 }),
  });
  const result = withCompanyRequest(async req => new Response(await req.text()))(request);
  await pulling;
  abort.abort(new Error('synthetic-private-abort-reason'));
  const response = await result;
  assert.equal(response.status, 400);
  assert.doesNotMatch(await response.text(), /synthetic-private/);
  assert.equal(cancelled, true);
});
