import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const transpile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join(' ') : typeof node === 'object' ? text(node.props?.children) : String(node);
const hasClass = (node, name) => node.props?.className?.split(/\s+/).includes(name);
const status = overrides => ({
  configured: true, storageReady: true, application: { environment: 'PRODUCTION', active: true },
  company: { id: 'synthetic-company', name: 'Exempelföretaget AB', canManageBank: true },
  connection: {
    id: 'synthetic-connection', bankName: 'Exempelbanken', environment: 'PRODUCTION', status: 'connected',
    validUntil: '2999-01-01T00:00:00Z', lastSyncedAt: null, lastError: null, dateFrom: '2026-11-01',
    accounts: [{ uid: 'synthetic-account', label: 'Företagskonto ••1234', currency: 'SEK', selected: true, importable: true }],
  },
  automatic: { enabled: false, intervalHours: 12, lastAttemptAt: null, nextAttemptAt: null },
  lastRun: null, ...overrides,
});

async function fixture(t, payload) {
  const f = { slots: [], cursor: 0, effects: [], closed: false, scheduled: false, requests: [] };
  const key = '__bank_ui_' + crypto.randomUUID().replaceAll('-', '');
  globalThis[key] = f;
  const equal = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  f.schedule = () => { if (f.closed || f.scheduled) return; f.scheduled = true; queueMicrotask(() => { f.scheduled = false; if (!f.closed) f.render(); }); };
  f.state = initial => { const index = f.cursor++; f.slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }; return [f.slots[index].value, next => { const value = typeof next === 'function' ? next(f.slots[index].value) : next; if (!Object.is(value, f.slots[index].value)) { f.slots[index].value = value; f.schedule(); } }]; };
  f.ref = initial => { const index = f.cursor++; f.slots[index] ??= { current: initial }; return f.slots[index]; };
  f.effect = (fn, deps) => { const index = f.cursor++; if (!equal(f.slots[index]?.deps, deps)) f.effects.push(() => { f.slots[index]?.cleanup?.(); f.slots[index] = { deps, cleanup: fn() }; }); };
  f.memo = (fn, deps) => { const index = f.cursor++; if (!equal(f.slots[index]?.deps, deps)) f.slots[index] = { deps, value: fn() }; return f.slots[index].value; };
  const react = data(`const f=globalThis[${JSON.stringify(key)}];export const useState=(...a)=>f.state(...a),useRef=(...a)=>f.ref(...a),useEffect=(...a)=>f.effect(...a),useCallback=(fn,deps)=>f.memo(()=>fn,deps),useId=()=>f.ref('bank-test').current;`);
  const oldWindow = globalThis.window, oldFetch = globalThis.fetch;
  globalThis.window = { location: { search: '' } };
  globalThis.fetch = async (input, init) => { f.requests.push({ input, init }); assert.equal(input, '/api/bank/status'); return Response.json(payload); };
  let source = transpile('../components/bank-connection.tsx');
  for (const [name, url] of Object.entries({
    react, 'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'), 'lucide-react': import.meta.resolve('lucide-react'),
    '@/lib/banking/status-view': data(transpile('../lib/banking/status-view.ts')),
    './use-bank-refresh': data('export const useBankRefresh=()=>{};'),
    './sync-recovery-notice': data('export default function SyncRecoveryNotice(){return null;}'),
  })) for (const quote of ['"', "'"]) source = source.replaceAll(quote + name + quote, JSON.stringify(url));
  const { default: BankConnection } = await import(data(source));
  f.render = () => { f.cursor = 0; f.tree = BankConnection({}); for (const effect of f.effects.splice(0)) effect(); };
  t.after(() => { f.closed = true; for (const slot of f.slots) slot?.cleanup?.(); globalThis.fetch = oldFetch; if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; delete globalThis[key]; });
  f.render();
  for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
  f.find = predicate => nodes(f.tree).find(predicate);
  return f;
}

test('missing consent expiry is explicitly unconfirmed and the page has one heading', async t => {
  const payload = status(); payload.connection.validUntil = '';
  const f = await fixture(t, payload);
  const fact = f.find(node => node.type === 'div' && text(node.props.children).startsWith('Medgivandet gäller till'));
  assert.match(text(fact), /Giltighet inte bekräftad/);
  assert.equal(nodes(f.tree).filter(node => node.type === 'h1').length, 1);
  assert.equal(text(f.find(node => node.type === 'h1')), 'Bankanslutning');
});

test('automatic fetch copy uses the returned interval without promising an unknown next attempt', async t => {
  const payload = status(); payload.automatic.enabled = true;
  const f = await fixture(t, payload);
  assert.match(text(f.tree), /12 timmars intervall/);
  assert.doesNotMatch(text(f.tree), /sjätte timme|Vid nästa automatiska kontroll/);
  assert.match(text(f.tree), /Ingen tidpunkt är bekräftad/);
});

test('missing automatic interval stays unknown and payer guidance is conditional', async t => {
  const payload = status(); payload.automatic.intervalHours = null;
  const f = await fixture(t, payload);
  assert.match(text(f.tree), /Hämtningsintervallet är inte bekräftat/);
  assert.match(text(f.tree), /Om betalardetaljer saknas/);
});

test('connected account has one primary action with secondary renewal and manual import', async t => {
  const f = await fixture(t, status());
  const primary = nodes(f.tree).filter(node => hasClass(node, 'primary'));
  assert.equal(primary.length, 1);
  assert.match(text(primary[0]), /Uppdatera bankhändelser/);
  const renew = f.find(node => node.type === 'button' && text(node).includes('Förnya anslutningen'));
  const manual = f.find(node => node.type === 'a' && node.props.href === '/?view=bank&import=1');
  assert.ok(hasClass(renew, 'bank-secondary'));
  assert.ok(hasClass(manual, 'bank-secondary'));
});

test('expired consent makes renewal the primary next step', async t => {
  const payload = status(); payload.connection.validUntil = '2000-01-01T00:00:00Z';
  const f = await fixture(t, payload);
  const primary = nodes(f.tree).filter(node => hasClass(node, 'primary'));
  assert.equal(primary.length, 1);
  assert.match(text(primary[0]), /Förnya anslutningen/);
  assert.equal(f.requests.length, 1);
});
