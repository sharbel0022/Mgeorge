import test from 'node:test';
import assert from 'node:assert/strict';
import { companies, ownerFixture } from './helpers/saas-owner-fixture.mjs';

const fileRequest = (id, owner) => new Request('https://mg.test/api/files?id=' + id + (owner ? '&owner=' + owner : ''), { headers: { 'x-company-id': owner || 'attacker-supplied' } });
const snapshot = f => JSON.stringify(f.sqlite.prepare('SELECT owner,revision,payload FROM workspaces ORDER BY owner').all());

for (const company of companies) {
  test(`company ${company.label} reads only its workspace and original although all invoice numbers match`, async t => {
    const f = await ownerFixture(t); f.as(company);
    const own = f.records.get(company.owner), foreign = companies.find(other => other !== company);
    const before = snapshot(f);
    const response = await f.state.GET(new Request('https://mg.test/api/state?owner=' + foreign.owner));
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(value.revision, 3);
    assert.equal(value.state.company.name, 'Synthetic company ' + company.label);
    assert.equal(value.state.invoices.length, 1);
    assert.equal(value.state.invoices[0].number, '000018');
    assert.equal(value.state.invoices[0].documentId, own.invoice.id);
    const original = await f.files.GET(fileRequest(own.invoice.id, foreign.owner));
    assert.equal(original.status, 200);
    assert.deepEqual(new Uint8Array(await original.arrayBuffer()), own.invoice.bytes);
    assert.equal(original.headers.get('cache-control'), 'private, no-store');
    assert.equal(snapshot(f), before);
  });
}

for (const actor of companies) for (const victim of companies.filter(other => other !== actor)) {
  test(`company ${actor.label} cannot read or attach company ${victim.label}'s original`, async t => {
    const f = await ownerFixture(t); f.as(actor);
    const original = f.records.get(victim.owner).invoice;
    const before = snapshot(f), objectCount = f.objects.size;
    assert.equal((await f.files.GET(fileRequest(original.id, victim.owner))).status, 404);
    await assert.rejects(f.server.readInvoiceOriginalBytes(actor.owner, original.id), /aktuell[ae] ägaren/);
    assert.deepEqual(f.reads, [], 'foreign metadata must fail before any object read');
    const attempt = await f.state.POST(new Request('https://mg.test/api/state', {
      method: 'POST', headers: { origin: 'https://mg.test', 'content-type': 'application/json' },
      body: JSON.stringify({ owner: victim.owner, companyId: victim.owner, role: 'administrator', revision: 3, requestId: 'synthetic-cross-owner-attachment', command: { type: 'invoice.save', invoice: { documentId: original.id } } }),
    }));
    assert.equal(attempt.status, 400);
    assert.match((await attempt.json()).error, /Bilagan kunde inte hittas/);
    assert.equal(snapshot(f), before);
    assert.equal(f.objects.size, objectCount);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM audit_events').get().n, 0);
  });
}

test('identical upload bytes deduplicate within each company without sharing document IDs or R2 objects', async t => {
  const f = await ownerFixture(t), before = f.objects.size, ids = new Map();
  for (const company of companies) {
    f.as(company);
    for (const repeated of [false, true]) {
      const form = new FormData(); form.set('file', new File(['same synthetic bytes for all companies'], 'synthetic.txt'));
      form.set('owner', companies[0].owner);
      const response = await f.files.POST(new Request('https://mg.test/api/files', { method: 'POST', headers: { origin: 'https://mg.test' }, body: form }));
      assert.equal(response.status, 200); const value = await response.json();
      if (repeated) { assert.equal(value.duplicate, true); assert.equal(value.id, ids.get(company.owner)); }
      else { assert.ok(!value.duplicate); ids.set(company.owner, value.id); }
    }
  }
  assert.equal(new Set(ids.values()).size, 3);
  assert.equal(f.objects.size, before + 3);
  for (const [owner, id] of ids) assert.ok(f.objects.has(owner + '/' + id));
});

test('Bankgiro data retained for A never appears in B or C and grants no automatic allocation', async t => {
  const f = await ownerFixture(t), report = f.records.get(companies[0].owner).report;
  assert.ok(report);
  for (const company of companies) {
    f.as(company);
    const value = await (await f.state.GET()).json();
    assert.equal(value.state.transactions.filter(row => row.specification).length, company.label === 'A' ? 1 : 0);
    assert.equal(value.state.allocations.length, 0, 'a retained report is not a verified payment');
    const response = await f.files.GET(fileRequest(report.id));
    assert.equal(response.status, company.label === 'A' ? 200 : 404);
  }
  assert.deepEqual(f.reads, [companies[0].owner + '/' + report.id]);
});

test('missing or modified invoice originals fail closed without changing stored balances', async t => {
  const f = await ownerFixture(t), [a, b, c] = companies, before = snapshot(f);
  f.objects.delete(a.owner + '/' + f.records.get(a.owner).invoice.id);
  const changed = f.records.get(b.owner).invoice;
  f.objects.set(b.owner + '/' + changed.id, new Uint8Array(changed.bytes.length).fill(120));
  await assert.rejects(f.server.readInvoiceOriginalBytes(a.owner, f.records.get(a.owner).invoice.id), /saknas/);
  await assert.rejects(f.server.readInvoiceOriginalBytes(b.owner, changed.id), /kontrollsumma/);
  assert.deepEqual(new Uint8Array((await f.server.readInvoiceOriginalBytes(c.owner, f.records.get(c.owner).invoice.id)).bytes), f.records.get(c.owner).invoice.bytes);
  assert.equal(snapshot(f), before);
});

test('lost platform identity denies state and originals even with an injected company ID', async t => {
  const f = await ownerFixture(t); f.as(null);
  assert.equal((await f.state.GET()).status, 401);
  assert.equal((await f.files.GET(fileRequest(f.records.get(companies[0].owner).invoice.id, companies[0].owner))).status, 401);
  assert.deepEqual(f.reads, []);
});

test('three synthetic bank/consent records and a reused selector retain owner and purpose bound encryption', async t => {
  const f = await ownerFixture(t);
  for (const company of companies) {
    const row = await f.store.connection(company.owner), expected = f.records.get(company.owner);
    assert.equal(row.bank_name, company.bank); assert.equal(row.status, company.consent); assert.equal(row.valid_until, company.until);
    assert.equal(await f.store.sessionId(row), expected.session);
    assert.deepEqual(await f.store.accounts(row), [expected.account]);
    for (const other of companies.filter(other => other !== company)) {
      await assert.rejects(f.store.decrypt(other.owner, 'session:' + row.id, row.encrypted_session));
      await assert.rejects(f.store.accounts({ ...row, owner: other.owner }));
    }
    await assert.rejects(f.store.decrypt(company.owner, 'accounts:' + row.id, row.encrypted_session));
  }
  assert.equal(await f.store.connection('synthetic-non-member'), null);
});

test('concurrent bank work is serialized for A while B has an independent valid lease', async t => {
  const f = await ownerFixture(t), [a, b] = companies;
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const running = f.store.withBankLock(a.owner, async lease => { entered(); await gate; await lease.assert(); });
  await started;
  try {
    await assert.rejects(f.store.withBankLock(a.owner, async () => assert.fail('duplicate A work started')), /BANK_BUSY/);
    await f.store.withBankLock(b.owner, async lease => {
      await lease.assert();
      assert.equal(f.sqlite.prepare('SELECT count(*) n FROM bank_locks').get().n, 2);
    });
  } finally { release(); await running; }
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM bank_locks').get().n, 0);
});
