import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { cleanTestEnvironment } from '../scripts/quality/core.mjs';

const helper = fileURLToPath(new URL('./helpers/quality-regressions-server.mjs', import.meta.url));
const isolation = fileURLToPath(new URL('../scripts/saas-test-isolation.mjs', import.meta.url));
const account = 'SE4280000890119146168423';
const csv = `Datum;Belopp;Valuta;Betalare;OCR;Bankreferens;IBAN\n2026-10-26;625.00;SEK;Syntetisk Kund AB;000018;SYNTHETIC-RECOVERY-PAYMENT;${account}\n`;
const bankRequest = {
  name: 'synthetic-recovery.csv', connection_id: 'synthetic-bank', account_uid: 'synthetic-account',
  content_base64: Buffer.from(csv).toString('base64'), confirm: true,
};

function invoicePdf() {
  const content = 'BT /F1 12 Tf 40 750 Td (Syntetisk Kund AB invoice 000018 SEK 625.00) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function startServer(filename) {
  const child = fork(helper, [filename], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: cleanTestEnvironment(process.env),
    execArgv: ['--import', isolation],
  });
  let diagnostics = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-12000); });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Synthetic server did not start: ${diagnostics}`));
    }, 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Synthetic server exited ${code}: ${diagnostics}`)); });
    child.on('message', message => { if (message.ready) { clearTimeout(timer); resolve(message.port); } });
  });
  let cookie = '';
  return {
    async request(path, method = 'GET', body) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const bytes = Buffer.from(await response.arrayBuffer());
      return { status: response.status, bytes, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(bytes.toString()) : null };
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.send('stop');
      const [code, signal] = await exited;
      clearTimeout(timer);
      assert.equal(code, 0, `Synthetic server must stop cleanly (${signal}): ${diagnostics}`);
    },
  };
}

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'mgeorge-quality-http-recovery-'));
  const filename = join(directory, 'synthetic.sqlite');
  let server;
  t.after(async () => {
    try { await server?.close(); } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  server = await startServer(filename);
  return {
    filename,
    get server() { return server; },
    async restart() { await server.close(); server = await startServer(filename); },
  };
}

function inspect(filename, callback) {
  const db = new DatabaseSync(filename);
  try { return callback(db); } finally { db.close(); }
}

async function createInvoiceWithOriginal(server) {
  const created = await server.request('/api/invoices', 'POST', {
    direction: 'customer', invoice_number: '000018', party: 'Syntetisk Kund AB',
    total_cents: 62500, reference: '000018', issued_at: '2026-10-01',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const original = await server.request('/api/documents', 'POST', {
    name: 'synthetic-invoice.pdf', invoice_id: created.body.id, content_base64: invoicePdf().toString('base64'),
  });
  assert.equal(original.status, 201, JSON.stringify(original.body));
  return created.body.id;
}

test('real HTTP invoice and retained CSV journey survives restart and replay without a second payment', { timeout: 45000 }, async t => {
  const context = await fixture(t);
  const invoiceId = await createInvoiceWithOriginal(context.server);
  const preview = await context.server.request('/api/import/preview', 'POST', bankRequest);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.count, 1);
  inspect(context.filename, db => {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n, 0, 'preview must not persist a bank payment');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n, 0, 'preview must not change the invoice balance');
  });
  const imported = await context.server.request('/api/import/commit', 'POST', bankRequest);
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.imported, 1);
  const original = await context.server.request(`/api/imports/${imported.body.import_id}/original`);
  assert.equal(original.status, 200);
  assert.deepEqual(original.bytes, Buffer.from(csv));
  assert.equal((await context.server.request('/api/reconciliation', 'POST', {})).status, 200);
  const before = inspect(context.filename, db => db.prepare('SELECT id, invoice_id, transaction_id, amount_cents FROM allocations').all().map(row => ({ ...row })));
  assert.equal(before.length, 1);
  assert.equal(before[0].amount_cents, 62500);
  assert.equal(before[0].invoice_id, invoiceId);

  await context.restart();
  const replay = await context.server.request('/api/import/commit', 'POST', bankRequest);
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.imported, 0);
  assert.equal(replay.body.duplicate, 1);
  assert.equal((await context.server.request('/api/reconciliation', 'POST', {})).status, 200);
  const invoices = await context.server.request('/api/invoices');
  assert.equal(invoices.status, 200);
  assert.equal(invoices.body.items.find(invoice => invoice.id === invoiceId).paid_cents, 62500);
  inspect(context.filename, db => {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n, 1);
    assert.deepEqual(db.prepare('SELECT id, invoice_id, transaction_id, amount_cents FROM allocations').all().map(row => ({ ...row })), before);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
  const retained = await context.server.request(`/api/imports/${imported.body.import_id}/original`);
  assert.equal(retained.status, 200);
  assert.deepEqual(retained.bytes, Buffer.from(csv));
});

test('real HTTP recovery rejects a corrupted retained CSV and cannot allocate its payment', { timeout: 45000 }, async t => {
  const context = await fixture(t);
  const invoiceId = await createInvoiceWithOriginal(context.server);
  const imported = await context.server.request('/api/import/commit', 'POST', bankRequest);
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.imported, 1);
  inspect(context.filename, db => {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n, 0);
    db.prepare('UPDATE import_jobs SET content = ? WHERE id = ?')
      .run(Buffer.from(csv.replace('625.00', '999.00')), imported.body.import_id);
  });
  await context.restart();
  const original = await context.server.request(`/api/imports/${imported.body.import_id}/original`);
  assert.equal(original.status, 409, 'a restart must not re-hash and trust a modified original');
  assert.equal((await context.server.request('/api/reconciliation', 'POST', {})).status, 200);
  const invoices = await context.server.request('/api/invoices');
  assert.equal(invoices.status, 200);
  assert.equal(invoices.body.items.find(invoice => invoice.id === invoiceId).paid_cents, 0);
  inspect(context.filename, db => {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n, 0, 'unverifiable original evidence cannot pay an invoice');
    assert.equal(db.prepare('SELECT amount_cents FROM bank_transactions').get().amount_cents, 62500, 'retained bank facts stay unchanged');
  });
});
