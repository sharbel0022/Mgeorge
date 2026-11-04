import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import ts from 'typescript';
import { applyCommand, emptyState } from '../../lib/domain.ts';
import { parseSpecificationBytes } from '../../lib/bankgiro-parser.js';
import { randomToken } from '../../lib/banking/security.ts';

const data = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const local = path => new URL('../../' + path, import.meta.url).href;
const unavailable = (...names) => data(names.map(name => `export function ${name}(){throw Error('Unexpected unrelated mutation: ${name}');}`).join('\n'));
function compiled(path, imports) {
  let code = ts.transpileModule(readFileSync(new URL('../../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [name, url] of Object.entries(imports)) for (const quote of ['"', "'"]) code = code.replaceAll(quote + name + quote, JSON.stringify(url));
  return data(code);
}

export const companies = [
  { label: 'A', owner: 'synthetic-company-a-owner', bank: 'Synthetic North Bank', consent: 'connected', until: '2099-01-01T00:00:00Z' },
  { label: 'B', owner: 'synthetic-company-b-owner', bank: 'Synthetic South Bank', consent: 'connected', until: '2000-01-01T00:00:00Z' },
  { label: 'C', owner: 'synthetic-company-c-owner', bank: 'Synthetic East Bank', consent: 'disconnected', until: '2099-01-01T00:00:00Z' },
];

// Real production SQL, domain, encryption, storage and routes. Only platform
// identity, D1 transport and R2 transport are replaced. There is no company/RBAC
// model in this baseline: these companies are labels for separate owner rows.
export async function ownerFixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL('../../drizzle/' + file, import.meta.url), 'utf8'));
  }
  const f = { sqlite, objects: new Map(), reads: [], records: new Map(), user: null };
  const DB = {
    prepare(query) {
      return {
        args: [], bind(...args) { this.args = args; return this; },
        async first() { return sqlite.prepare(query).get(...this.args) || null; },
        async all() { return { results: sqlite.prepare(query).all(...this.args) }; },
        execute() { return { success: true, meta: { changes: Number(sqlite.prepare(query).run(...this.args).changes) } }; },
        async run() { return this.execute(); },
      };
    },
    async batch(items) {
      sqlite.exec('BEGIN');
      try { const results = items.map(item => item.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  f.env = {
    DB, BANK_DATA_ENCRYPTION_KEY: randomToken(),
    BUCKET: {
      async put(key, value) { f.objects.set(key, new Uint8Array(value).slice()); },
      async get(key) { f.reads.push(key); const bytes = f.objects.get(key); return bytes ? { size: bytes.length, body: bytes.slice(), arrayBuffer: async () => bytes.slice().buffer } : null; },
      async delete(key) { f.objects.delete(key); },
    },
  };
  const key = '__saas_owner_' + randomUUID().replaceAll('-', '');
  globalThis[key] = f;
  t.after(() => { sqlite.close(); delete globalThis[key]; });
  t.mock.method(globalThis, 'fetch', async () => { throw Error('No external network in owner acceptance'); });
  const ref = `globalThis[${JSON.stringify(key)}]`;
  const environment = data(`export const env=${ref}.env;`);
  const auth = data(`export async function getChatGPTUser(){return ${ref}.user;}`);
  const domain = local('lib/domain.ts');
  const server = compiled('lib/server.ts', { 'cloudflare:workers': environment, '@/app/chatgpt-auth': auth, './domain': domain });
  f.server = await import(server);
  f.files = await import(compiled('app/api/files/route.ts', { 'cloudflare:workers': environment, '@/lib/server': server, '@/lib/domain': domain }));
  f.state = await import(compiled('app/api/state/route.ts', {
    '@/lib/server': server, '@/lib/domain': domain,
    '@/lib/reconciliation-evidence': unavailable('reconcileWithOriginals', 'assertPaymentOriginal', 'writePaymentState'),
    '@/lib/customer-messages': unavailable('reconcileAndPrepare'),
    '@/lib/bankgiro-service': unavailable('readBankgiroOriginal', 'prepareBankgiroLinkCommand'),
    '@/lib/bankgiro-invoice-search': unavailable('searchBankgiroInvoice'),
  }));
  f.store = await import(compiled('lib/banking/store.ts', {
    'cloudflare:workers': environment, '@/lib/server': server,
    './security': local('lib/banking/security.ts'), './runtime-config': local('lib/banking/runtime-config.ts'),
  }));
  f.as = company => { f.user = company ? { userId: company.owner, email: `company-${company.label.toLowerCase()}@example.test`, displayName: 'Synthetic ' + company.label } : null; };
  f.retain = (owner, filename, content) => {
    const id = randomUUID(), bytes = new TextEncoder().encode(content), sha256 = createHash('sha256').update(bytes).digest('hex');
    f.objects.set(owner + '/' + id, bytes);
    sqlite.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, owner, filename, filename.endsWith('.csv') ? 'text/csv' : 'text/plain', bytes.length, sha256, '2026-11-01T00:00:00Z');
    return { id, bytes, sha256, filename };
  };
  for (const [index, company] of companies.entries()) {
    const invoice = f.retain(company.owner, 'synthetic-invoice.txt', 'Synthetic original for company ' + company.label);
    let state = applyCommand(emptyState(), { type: 'invoice.save', invoice: {
      direction: 'receivable', party: 'Synthetic customer ' + company.label, number: '000018', ocr: '', total: 62500 + index * 10000,
      issued: '2026-10-01', due: '2026-11-01', reviewed: true, documentId: invoice.id,
    } }).state;
    state.company.name = 'Synthetic company ' + company.label;
    let report;
    if (company.label === 'A') {
      report = f.retain(company.owner, 'synthetic-bankgiro.csv', 'Betalningsdatum;Avsändare;Betalningsreferens;Bankgironummer/Avinummer;Belopp;Valuta;Mottagarkonto\n2026-10-26;Synthetic customer A;000018;987-6543;625,00;SEK;12345678');
      state = applyCommand(state, { type: 'bankgiro.import', documentId: report.id, hash: report.sha256, name: report.filename, rows: parseSpecificationBytes(report.bytes, report.filename) }).state;
    }
    sqlite.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,?,?,?)').run(company.owner, 3, JSON.stringify(state), '2026-11-01T00:00:00Z');
    const id = randomUUID();
    const account = { uid: 'same-provider-selector', currency: 'SEK', account_id: { other: 'synthetic-account-' + company.label } };
    const session = 'synthetic-session-' + company.label;
    const row = { id, owner: company.owner, app_generation: 'synthetic-generation', environment: 'SANDBOX', bank_name: company.bank, country: 'SE',
      encrypted_session: await f.store.encrypt(company.owner, 'session:' + id, session),
      encrypted_accounts: await f.store.encrypt(company.owner, 'accounts:' + id, [account]), selected_accounts: JSON.stringify([account.uid]),
      valid_until: company.until, date_from: '2026-10-01', status: company.consent, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' };
    const columns = Object.keys(row);
    sqlite.prepare('INSERT INTO bank_connections(' + columns.join(',') + ') VALUES(' + columns.map(() => '?').join(',') + ')').run(...Object.values(row));
    f.records.set(company.owner, { invoice, report, state, connection: row, account, session });
  }
  return f;
}
