import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { directoryFixture, snapshotFixture, authorizationFixture } from '../../../sites/tests/helpers/saas-onboarding-fixture.mjs';
import { startServer } from './serve-harness.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '', 'playwright'));
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = process.env.MGEORGE_ONBOARDING_QA || path.join(tmpdir(), 'mgeorge-saas-onboarding-qa');
const output = path.join(scratch, 'results'), base = 'http://127.0.0.1:5178';
const sha = value => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(await fs.readFile(path.join(scratch, 'manifest.json'), 'utf8'));
async function verifyAssets() {
  for (const entry of manifest.inputs) assert.equal(sha(await fs.readFile(path.join(repo, entry.path))), entry.sha256, 'Changed product source: ' + entry.path);
  for (const entry of manifest.outputs) assert.equal(sha(await fs.readFile(path.join(scratch, 'web', entry.path))), entry.sha256, 'Changed product asset: ' + entry.path);
}
await fs.mkdir(output, { recursive: true });
const launch = { headless: true, args: ['--no-sandbox'] };
if (process.env.MGEORGE_QA_CHROMIUM) launch.executablePath = process.env.MGEORGE_QA_CHROMIUM;
let server, browser;
const results = [], requests = [], browserErrors = [], externalRequests = [], assetChecks = [], contexts = [], runnerErrors = [], omitted = [];
const noConnection = (id, now) => {
  const s = snapshotFixture(id, now); s.connection = null; s.accounts = []; s.payments = [];
  s.sync = { state: 'never', automaticEnabled: false, lastSuccessAt: null, nextAllowedAt: null, errorCode: null }; return s;
};
async function scenario(config = {}) {
  const context = await browser.newContext({ viewport: { width: config.width || 390, height: 900 }, serviceWorkers: 'block' }); contexts.push(context);
  if (config.init) await context.addInitScript(config.init);
  const page = await context.newPage(), posts = [], reads = new Map(), state = { disconnected: false, created: false, selected: null, queued: false };
  if (config.clock) await page.clock.install({ time: new Date() });
  page.on('pageerror', error => browserErrors.push(error.message));
  const checked = new Set();
  page.on('response', async response => {
    const file = new URL(response.url()).pathname.slice(1), entry = manifest.outputs.find(item => item.path === file);
    if (entry && !checked.has(file)) { checked.add(file); try { assetChecks.push({ file, match: sha(await response.body()) === entry.sha256 }); } catch { assetChecks.push({ file, match: false }); } }
  });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    if (url.origin !== base) { externalRequests.push({ origin: url.origin, method }); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push({ method, path: url.pathname });
    const reply = (json, status = 200) => route.fulfill({ status, json });
    if (url.pathname === '/api/onboarding/companies') {
      if (method === 'POST') { posts.push({ path: url.pathname, body: req.postDataJSON(), headers: req.headers() }); state.created = true; return reply({ version: 1, company: { id: 'company-new', name: 'Nytt Exempelföretag AB', organizationNumber: null, role: 'owner' } }, config.createStatus || 201); }
      const d = config.directory ? config.directory() : directoryFixture();
      if (state.created) d.companies.push({ id: 'company-new', name: 'Nytt Exempelföretag AB', organizationNumber: null, role: 'owner' });
      return reply(d, config.directoryStatus || 200);
    }
    const read = url.pathname.match(/^\/api\/companies\/([^/]+)\/bank-onboarding$/);
    if (read && method === 'GET') {
      const id = read[1], n = (reads.get(id) || 0) + 1; reads.set(id, n);
      const s = (config.snapshot || snapshotFixture)(id, Date.now(), n, state);
      if (state.disconnected && s.connection) { s.connection.status = 'revoked'; s.connection.revocationStatus = 'pending'; }
      if (state.selected) { s.accounts.forEach(a => a.selected = state.selected.includes(a.id)); s.sync.state = 'queued'; s.sync.lastSuccessAt = null; }
      if (state.queued) s.sync.state = 'queued';
      return reply(s, config.snapshotStatus || 200);
    }
    if (/^\/api\/companies\/[^/]+\/bank\/authorizations\/[^/]+\/redirect$/.test(url.pathname) && method === 'GET') {
      const send = () => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="sv"><head><title>Bankens identifiering</title></head><body><h1>Bankens identifiering (syntetiskt)</h1></body></html>' });
      // 204 leaves the initiating document visible, like a handoff that has not
      // replaced it yet, without hanging the browser test on an unfinished load.
      if (config.holdRedirect) return route.fulfill({ status: 204, body: '' }); return send();
    }
    const action = url.pathname.match(/^\/api\/companies\/([^/]+)\/bank\/(connect|renew|disconnect|accounts|sync)$/);
    if (action && method === 'POST') {
      posts.push({ path: url.pathname, body: req.postDataJSON(), headers: req.headers() });
      if (['connect', 'renew'].includes(action[2])) return reply((config.authorization || authorizationFixture)(action[1], Date.now()));
      if (action[2] === 'disconnect') state.disconnected = true;
      if (action[2] === 'accounts' && !config.ignoreSelection) state.selected = req.postDataJSON().accountIds;
      if (action[2] === 'sync') state.queued = true;
      return reply({ version: 1, companyId: action[1], accepted: true });
    }
    if (url.pathname === '/api/bank/status' && method === 'GET') return reply({ configured: false, storageReady: true, application: null, connection: null, lastRun: null });
    if (url.pathname === '/api/bankgiro/source/status' && method === 'GET') return reply({ enabled: false, sourceId: null, state: 'DISABLED', reason: 'SOURCE_NOT_CONFIGURED', nextPollAt: null, missingReportIds: [], counts: { PENDING: 0, RETRY: 0, IMPORTED: 0, REVIEW: 0, DUPLICATE: 0, BLOCKED: 0 }, jobs: [], lastError: null });
    throw Error('Unexpected request: ' + method + ' ' + url.pathname);
  });
  await page.goto(base + '/bank' + (config.query || '')); return { page, posts, reads, state };
}
const ready = (page, name = 'Exempel Alfa AB') => page.getByRole('heading', { name: 'Konton för ' + name }).waitFor({ timeout: 5000 });
async function shot(page, name) {
  // Capture fixed-position elements from a consistent viewport origin after
  // keyboard testing has scrolled the page. No product elements are hidden.
  await page.evaluate(() => new Promise(resolve => { window.scrollTo({ top: 0, behavior: 'instant' }); requestAnimationFrame(resolve); }));
  return page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
}
async function test(name, fn) {
  if (process.env.MGEORGE_QA_FILTER && !new RegExp(process.env.MGEORGE_QA_FILTER).test(name)) { omitted.push(name); return; }
  const start = Date.now(); let timeout;
  try { await Promise.race([fn(), new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Scenario exceeded 20 seconds')), 20000); })]); results.push({ name, passed: true, durationMs: Date.now() - start }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, passed: false, error: String(error), durationMs: Date.now() - start }); console.log('FAIL ' + name + ': ' + String(error).slice(0, 450)); }
  finally { clearTimeout(timeout); for (const context of contexts.splice(0)) await context.close(); }
}
try {
  await verifyAssets(); server = await startServer(); browser = await chromium.launch(launch);
  for (const width of [320, 390, 768, 1024, 1440]) await test('responsive keyboard and semantics at ' + width + 'px', async () => {
    const { page, posts } = await scenario({ width }); await ready(page);
    assert.equal(await page.evaluate(() => window.innerWidth), width);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'horizontal page overflow');
    assert.equal(await page.getByRole('combobox', { name: 'Välj företag' }).inputValue(), 'company-alpha');
    await page.getByText('0000599', { exact: true }).first().waitFor(); assert.ok(await page.getByRole('checkbox').count());
    await page.getByRole('link', { name: 'Hoppa till bankanslutningen' }).focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'onboarding-content');
    const button = page.getByRole('button', { name: 'Koppla bort banken', exact: true }); await button.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog'); await dialog.waitFor();
    assert.equal(await page.getByRole('button', { name: 'Behåll anslutningen' }).evaluate(el => el === document.activeElement), true);
    for (let n = 0; n < 4; n++) { await page.keyboard.press('Tab'); assert.ok(await dialog.evaluate(el => el.contains(document.activeElement))); }
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'horizontal dialog overflow');
    await page.keyboard.press('Escape'); assert.equal(await dialog.count(), 0); assert.ok(await button.evaluate(el => el === document.activeElement));
    await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'));
    assert.ok(await page.getByRole('link', { name: 'Hoppa till bankanslutningen' }).evaluate(el => el.getBoundingClientRect().bottom <= 0), 'skip link must leave the viewport when focus moves away');
    assert.equal(posts.length, 0); await shot(page, 'onboarding-' + width);
  });
  await test('provider start uses scoped server redirect and required read scopes', async () => {
    const { page, posts } = await scenario({ snapshot: noConnection });
    await page.getByRole('radio', { name: /Exempelbanken/ }).check(); await page.getByRole('button', { name: 'Öppna bankens identifiering' }).click();
    await page.getByRole('heading', { name: 'Bankens identifiering (syntetiskt)' }).waitFor();
    assert.equal(posts.length, 1); assert.deepEqual(posts[0].body, { bankId: 'test-bank', permissions: ['accounts:read', 'transactions:read'], expectedRevision: 3 });
    assert.ok(posts[0].headers['x-csrf-token']); assert.ok(posts[0].headers['idempotency-key']);
    assert.equal(new URL(page.url()).pathname, '/api/companies/company-alpha/bank/authorizations/authorization-123/redirect');
  });
  for (const [result, expected] of [['cancelled', /avbröts/i], ['failed', /kunde inte|misslyckades/i], ['expired', /gått ut/i]]) await test('callback ' + result + ' remains retryable', async () => {
    const { page } = await scenario({ query: '?company=company-alpha&result=' + result, snapshot: noConnection });
    await page.getByRole('radio', { name: /Exempelbanken/ }).waitFor(); assert.match(await page.locator('.onboarding-live').textContent(), expected);
    assert.equal(await page.getByText('Konton för Exempel Alfa AB').count(), 0);
  });
  await test('connected query alone cannot announce success', async () => {
    const { page } = await scenario({ query: '?result=connected', snapshot: noConnection }); await page.getByRole('radio', { name: /Exempelbanken/ }).waitFor();
    assert.doesNotMatch(await page.locator('.onboarding-live').textContent(), /bekräftat|ansluten/i);
  });
  await test('expired consent blocks account changes and sync', async () => {
    const { page, posts } = await scenario({ snapshot: (id, now) => { const s = snapshotFixture(id, now); s.connection.validUntil = new Date(now - 1000).toISOString(); return s; } }); await ready(page);
    assert.equal(await page.getByRole('button', { name: 'Uppdatera betalningsöversikten' }).count(), 0);
    assert.equal(await page.getByRole('checkbox').first().isDisabled(), true); assert.equal(posts.length, 0);
  });
  await test('AIS without Bankgiro does not invent missing payer or reference', async () => {
    const { page } = await scenario({ snapshot: (id, now) => { const s = snapshotFixture(id, now); s.payments[0].reference = null; return s; } }); await ready(page);
    assert.match(await page.locator('.onboarding-shell').textContent(), /Bankgiro/);
    assert.match(await page.locator('.onboarding-shell').textContent(), /saknas|avtal|separat/i);
    assert.equal(await page.getByText('0000599', { exact: true }).count(), 0); await shot(page, 'missing-bankgiro-reference');
  });
  await test('company switch replaces all private payment facts', async () => {
    const { page, reads } = await scenario({ snapshot: (id, now) => { const s = snapshotFixture(id, now); s.payments[0].payerName = id === 'company-alpha' ? 'ALFA PAYER' : 'BETA PAYER'; return s; } }); await ready(page);
    await page.getByRole('combobox', { name: 'Välj företag' }).selectOption('company-beta'); await ready(page, 'Exempel Beta AB');
    assert.equal(await page.getByText('ALFA PAYER', { exact: true }).count(), 0); await page.getByText('BETA PAYER', { exact: true }).waitFor(); assert.equal(reads.get('company-beta'), 1);
  });
  await test('late A to B to A response is rejected even when abort is ignored', async () => {
    const { page } = await scenario({ init: () => { const native = window.fetch.bind(window); let held = false; window.fetch = async (url, options) => {
      if (String(url).endsWith('/company-alpha/bank-onboarding') && !held) { held = true; const response = await native(url, { ...options, signal: undefined }); const body = await response.text(); return new Promise(resolve => { window.releaseOldRead = () => resolve(new Response(body, { headers: { 'Content-Type': 'application/json' } })); }); } return native(url, options);
    }; }, snapshot: (id, now, count) => { const s = snapshotFixture(id, now); s.payments[0].payerName = id === 'company-alpha' ? count === 1 ? 'STALE ALFA' : 'CURRENT ALFA' : 'BETA'; return s; } });
    await page.waitForFunction(() => typeof window.releaseOldRead === 'function'); await page.getByRole('combobox', { name: 'Välj företag' }).selectOption('company-beta'); await ready(page, 'Exempel Beta AB');
    await page.getByRole('combobox', { name: 'Välj företag' }).selectOption('company-alpha'); await ready(page);
    await page.evaluate(async () => { window.releaseOldRead(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    await page.getByText('CURRENT ALFA', { exact: true }).waitFor(); assert.equal(await page.getByText('STALE ALFA').count(), 0);
  });
  await test('late mutation never redirects after a company switch', async () => {
    const { page, posts } = await scenario({ snapshot: noConnection, init: () => { const native = window.fetch.bind(window); window.fetch = async (url, options) => {
      if (String(url).endsWith('/company-alpha/bank/connect')) { const response = await native(url, { ...options, signal: undefined }); const body = await response.text(); return new Promise(resolve => { window.releaseOldMutation = () => resolve(new Response(body, { headers: { 'Content-Type': 'application/json' } })); }); } return native(url, options);
    }; } });
    await page.getByRole('radio', { name: /Exempelbanken/ }).check(); await page.getByRole('button', { name: 'Öppna bankens identifiering' }).click(); await page.waitForFunction(() => typeof window.releaseOldMutation === 'function');
    await page.getByRole('combobox', { name: 'Välj företag' }).selectOption('company-beta'); await page.getByRole('radio', { name: /Exempelbanken/ }).waitFor();
    await page.evaluate(async () => { window.releaseOldMutation(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    assert.equal(new URL(page.url()).pathname, '/bank'); assert.equal(new URL(page.url()).searchParams.get('company'), 'company-beta'); assert.equal(posts.length, 1);
  });
  for (const code of [401, 403]) await test('HTTP ' + code + ' clears company UI without legacy fallback', async () => {
    const { page } = await scenario({ snapshotStatus: code });
    await page.getByRole(code === 401 ? 'link' : 'button', { name: code === 401 ? 'Logga in och fortsätt' : 'Läs in företagslistan igen' }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Välj företag' }).count(), 0); assert.equal(await page.getByText('Exempel Alfa AB', { exact: true }).count(), 0); assert.equal(await page.getByText('Din befintliga bankanslutning', { exact: true }).count(), 0);
  });
  for (const corrupt of ['account', 'payment', 'reference', 'stale']) await test('invalid ' + corrupt + ' projection is hidden before rendering', async () => {
    const { page } = await scenario({ snapshot: (id, now) => { const s = snapshotFixture(id, now); s.payments[0].payerName = 'LEAKED PAYER';
      if (corrupt === 'account') s.accounts[0].companyId = 'company-other'; if (corrupt === 'payment') s.payments[0].companyId = 'company-other';
      if (corrupt === 'reference') s.payments[0].reference.value = 599; if (corrupt === 'stale') s.checkedAt = new Date(now - 301000).toISOString(); return s;
    } }); await page.getByRole('button', { name: 'Läs in aktuell status' }).waitFor();
    assert.equal(await page.getByText('LEAKED PAYER', { exact: true }).count(), 0); assert.equal(await page.getByRole('heading', { name: 'Konton för Exempel Alfa AB' }).count(), 0);
  });
  await test('unsupported bank has no fake authentication button', async () => {
    const { page, posts } = await scenario({ snapshot: (id, now) => { const s = noConnection(id, now); s.banks[0].available = false; s.banks[0].authorization = 'unavailable'; s.banks[0].unavailableReason = 'unsupported_bank'; return s; } });
    await page.getByRole('radio', { name: /Exempelbanken/ }).waitFor(); assert.ok(await page.getByRole('radio', { name: /Exempelbanken/ }).isDisabled());
    assert.equal(await page.getByRole('button', { name: /BankID|Öppna bankens identifiering/ }).count(), 0); assert.equal(posts.length, 0);
  });
  await test('untrusted redirect is rejected without external navigation', async () => {
    const { page } = await scenario({ snapshot: noConnection, authorization: (id, now) => { const a = authorizationFixture(id, now); a.authorization.redirectPath = 'https://evil.invalid/'; return a; } });
    await page.getByRole('radio', { name: /Exempelbanken/ }).check(); await page.getByRole('button', { name: 'Öppna bankens identifiering' }).click();
    await page.getByRole('button', { name: 'Läs in aktuell status' }).waitFor(); assert.equal(new URL(page.url()).pathname, '/bank');
  });
  await test('decoupled authorization waits for bank confirmation', async () => {
    const { page } = await scenario({ snapshot: noConnection, authorization: (id, now) => { const a = authorizationFixture(id, now); a.authorization.mode = 'decoupled'; a.authorization.redirectPath = null; return a; } });
    await page.getByRole('radio', { name: /Exempelbanken/ }).check(); await page.getByRole('button', { name: 'Öppna bankens identifiering' }).click();
    await page.getByRole('heading', { name: 'Fortsätt hos banken' }).waitFor(); assert.equal(new URL(page.url()).pathname, '/bank'); assert.match(await page.locator('.onboarding-live').textContent(), /inväntar/i);
  });
  await test('renewal uses scoped consent endpoint without disconnecting first', async () => {
    const { page, posts } = await scenario(); await ready(page); await page.getByRole('button', { name: 'Förnya anslutningen' }).click();
    await page.getByRole('heading', { name: 'Bankens identifiering (syntetiskt)' }).waitFor(); assert.equal(posts.length, 1); assert.equal(posts[0].path, '/api/companies/company-alpha/bank/renew');
  });
  await test('disconnect requires confirmation and fresh server status', async () => {
    const { page, posts } = await scenario(); await ready(page); await page.getByRole('button', { name: 'Koppla bort banken', exact: true }).click(); assert.equal(posts.length, 0);
    await page.getByRole('button', { name: 'Ja, koppla bort banken' }).click(); await page.getByRole('button', { name: 'Läs in status', exact: true }).waitFor();
    assert.equal(posts.length, 1); assert.equal(posts[0].path, '/api/companies/company-alpha/bank/disconnect'); assert.doesNotMatch(await page.locator('.onboarding-shell').textContent(), /Banken har bekräftat återkallandet/);
  });
  await test('viewer cannot change bank consent or accounts', async () => {
    const { page, posts } = await scenario({ directory: () => { const d = directoryFixture(); d.companies[0].role = 'viewer'; return d; } }); await ready(page);
    assert.ok(await page.getByRole('button', { name: 'Förnya anslutningen' }).isDisabled()); assert.ok(await page.getByRole('button', { name: 'Koppla bort banken', exact: true }).isDisabled()); assert.ok(await page.getByRole('checkbox').first().isDisabled()); assert.equal(posts.length, 0);
  });
  await test('company creation reloads membership before selecting returned company', async () => {
    const { page, posts } = await scenario(); await ready(page); await page.getByRole('button', { name: 'Lägg till företag', exact: true }).click();
    await page.getByRole('textbox', { name: 'Företagsnamn' }).fill('Nytt Exempelföretag AB'); await page.getByRole('button', { name: 'Skapa företag' }).click(); await ready(page, 'Nytt Exempelföretag AB');
    assert.equal(posts.length, 1); assert.equal(posts[0].path, '/api/onboarding/companies'); assert.deepEqual(posts[0].body, { name: 'Nytt Exempelföretag AB', confirmEmptyCompany: true }); assert.equal(await page.getByRole('combobox', { name: 'Välj företag' }).inputValue(), 'company-new');
  });
  await test('initial missing directory retains the existing bank connection', async () => {
    const { page, posts } = await scenario({ directoryStatus: 404 }); await page.getByText('Din befintliga bankanslutning', { exact: true }).waitFor(); await page.getByRole('heading', { name: 'Bankanslutning', exact: true }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Välj företag' }).count(), 0); assert.equal(posts.length, 0);
  });
  await test('forged company query never causes an unauthorized company request', async () => {
    const { page, reads } = await scenario({ query: '?company=company-intruder' }); await page.getByRole('heading', { name: 'Välj företag för att fortsätta' }).waitFor(); assert.equal(reads.size, 0);
  });
  await test('company-specific navigation never falls back into the unscoped owner workspace', async () => {
    const { page } = await scenario({ query: '?company=company-alpha', directoryStatus: 404 });
    await page.getByRole('button', { name: 'Läs in företagslistan igen' }).waitFor();
    assert.equal(await page.getByText('Din befintliga bankanslutning', { exact: true }).count(), 0);
  });
  await test('redirect handoff remains locked until navigation completes', async () => {
    const { page, posts, state } = await scenario({ snapshot: noConnection, holdRedirect: true });
    await page.getByRole('radio', { name: /Exempelbanken/ }).check();
    const navigation = page.waitForRequest(request => request.url().endsWith('/redirect'));
    const button = page.getByRole('button', { name: 'Öppna bankens identifiering' });
    await button.evaluate(el => el.click()); await navigation;
    await page.waitForLoadState('domcontentloaded');
    assert.ok(await page.getByRole('button', { name: /Startar bankens identifiering|Öppna bankens identifiering/ }).isDisabled());
    assert.equal(posts.length, 1);
  });
  await test('uncertain company creation requires a directory refresh before resubmission', async () => {
    const { page, posts } = await scenario({ createStatus: 500 }); await ready(page);
    await page.getByRole('button', { name: 'Lägg till företag', exact: true }).click();
    await page.getByRole('textbox', { name: 'Företagsnamn' }).fill('Nytt Exempelföretag AB');
    await page.getByRole('button', { name: 'Skapa företag' }).click();
    await page.getByRole('button', { name: 'Läs in företagslistan' }).waitFor({ timeout: 4000 });
    assert.ok(await page.getByRole('button', { name: 'Skapa företag' }).isDisabled());
    await page.getByRole('button', { name: 'Läs in företagslistan' }).click();
    await page.getByRole('combobox', { name: 'Välj företag' }).waitFor();
    assert.match(await page.getByRole('combobox', { name: 'Välj företag' }).textContent(), /Nytt Exempelföretag/); assert.equal(posts.length, 1);
  });
  await test('account acknowledgment does not claim a selection missing from the fresh read', async () => {
    const { page, posts } = await scenario({ ignoreSelection: true, snapshot: (id, now) => { const s = snapshotFixture(id, now); s.accounts[0].selected = false; return s; } }); await ready(page);
    await page.getByRole('checkbox').first().check(); await page.getByRole('button', { name: 'Bekräfta valda konton' }).click();
    await page.getByRole('button', { name: 'Läs in aktuell status' }).waitFor({ timeout: 4000 });
    assert.doesNotMatch(await page.locator('.onboarding-live').textContent(), /Kontovalet har bekräftats/); assert.equal(posts.length, 1);
  });
  await test('revision regression hides old bank data after refresh', async () => {
    const { page } = await scenario({ snapshot: (id, now, count) => { const s = snapshotFixture(id, now); s.revision = count > 1 ? 2 : 3; s.payments[0].payerName = 'PRIVATE PAYMENT'; return s; } }); await ready(page);
    await page.getByRole('button', { name: 'Läs in status', exact: true }).click(); await page.getByRole('button', { name: 'Läs in aktuell status' }).waitFor();
    assert.equal(await page.getByText('PRIVATE PAYMENT', { exact: true }).count(), 0);
  });
  await test('account selection and first successful sync produce the overview automatically', async () => {
    const { page, posts, state } = await scenario({ clock: true, snapshot: (id, now, _count, state) => { const s = snapshotFixture(id, now); s.accounts[0].selected = !!state.completed;
      if (!state.completed) { s.sync.state = 'never'; s.sync.lastSuccessAt = null; s.sync.nextAllowedAt = null; s.payments = []; } return s;
    } }); await ready(page);
    await page.getByRole('checkbox').first().check(); await page.getByRole('button', { name: 'Bekräfta valda konton' }).click();
    await page.getByText('Kontovalet har bekräftats.', { exact: false }).waitFor();
    assert.deepEqual(posts[0].body.accountIds, ['account-alpha']); assert.equal(await page.getByText('0000599', { exact: true }).count(), 0);
    state.selected = null; state.completed = true;
    await page.clock.fastForward(31000); await page.getByText('0000599', { exact: true }).first().waitFor();
    assert.equal(posts.length, 1, 'status polling must not initiate extra bank mutations');
  });
  await test('slow pending authorization reads settle without polling starvation', async () => {
    const { page, reads } = await scenario({ clock: true, init: () => { const native = window.fetch.bind(window); let count = 0; window.fetch = async (url, options) => {
      const response = await native(url, { ...options, signal: undefined });
      if (String(url).endsWith('/bank-onboarding') && ++count > 1) { window.slowReads = (window.slowReads || 0) + 1; await new Promise(resolve => setTimeout(resolve, 6000)); }
      return response;
    }; }, snapshot: (id, now, count) => {
      const s = count === 1 ? noConnection(id, now) : snapshotFixture(id, now);
      s.authorization = { ...authorizationFixture(id, now).authorization, mode: 'decoupled', state: count === 1 ? 'pending' : 'completed', redirectPath: null }; return s;
    } });
    await page.getByRole('heading', { name: 'Fortsätt hos banken' }).waitFor();
    await page.clock.fastForward(5001); await page.waitForFunction(() => window.slowReads > 0);
    await page.clock.fastForward(6001); await ready(page);
    assert.equal(reads.get('company-alpha'), 2, 'overlapping timer should coalesce instead of replacing the slow request');
  });
  for (const [terminal, expected] of [['completed', /bekräftat/i], ['cancelled', /avbröts/i], ['failed', /misslyckades/i]]) await test('decoupled ' + terminal + ' replaces temporary waiting instructions', async () => {
    const { page, state } = await scenario({ snapshot: (id, now, _count, state) => {
      const s = state.terminal === 'completed' ? snapshotFixture(id, now) : noConnection(id, now);
      if (state.terminal) s.authorization = { ...authorizationFixture(id, now).authorization, mode: 'decoupled', state: state.terminal, redirectPath: null };
      return s;
    }, authorization: (id, now) => ({ ...authorizationFixture(id, now), authorization: { ...authorizationFixture(id, now).authorization, mode: 'decoupled', redirectPath: null } }) });
    await page.getByRole('radio', { name: /Exempelbanken/ }).check(); await page.getByRole('button', { name: 'Öppna bankens identifiering' }).click();
    await page.getByRole('heading', { name: 'Fortsätt hos banken' }).waitFor(); state.terminal = terminal;
    await page.getByRole('button', { name: 'Kontrollera anslutningen' }).click();
    await page.getByRole('heading', { name: 'Fortsätt hos banken' }).waitFor({ state: 'hidden' });
    assert.match(await page.locator('.onboarding-live').textContent(), expected);
    assert.doesNotMatch(await page.locator('.onboarding-live').textContent(), /inväntar|fortsätt i bankens app/i);
  });
  await test('selected account that lost import support cannot show an enabled sync action', async () => {
    const { page, posts } = await scenario({ snapshot: (id, now) => { const s = snapshotFixture(id, now); s.accounts[0].importable = false; s.sync.nextAllowedAt = null; return s; } }); await ready(page);
    assert.ok(await page.getByRole('button', { name: 'Uppdatera betalningsöversikten' }).isDisabled());
    assert.match(await page.locator('.onboarding-shell').textContent(), /konto som stöder import/i); assert.equal(posts.length, 0);
  });
} catch (error) {
  runnerErrors.push(String(error));
} finally {
  try { await verifyAssets(); } catch (error) { runnerErrors.push(String(error)); }
  const success = results.length > 0 && results.every(r => r.passed) && !runnerErrors.length && !browserErrors.length && !externalRequests.length && !omitted.length && assetChecks.length > 0 && assetChecks.every(r => r.match);
  const receipt = { finishedAt: new Date().toISOString(), success, browserVersion: browser?.version() ?? null, results, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, omitted, runnerErrors, requests, browserErrors, externalRequests, assetChecks, sourceManifest: manifest };
  try { await fs.writeFile(path.join(output, 'acceptance-results.json'), JSON.stringify(receipt, null, 2)); }
  finally { try { if (browser) await browser.close(); } finally { if (server) await new Promise(resolve => server.close(resolve)); } }
}
assert.deepEqual(runnerErrors, [], 'browser startup, source or runner failures');
assert.ok(results.length > 0, 'no browser cases executed');
assert.equal(results.filter(r => !r.passed).length, 0, 'browser acceptance failures');
assert.deepEqual(browserErrors, [], 'JavaScript errors'); assert.deepEqual(externalRequests, [], 'external requests'); assert.ok(assetChecks.length > 0 && assetChecks.every(r => r.match), 'served asset mismatch');
console.log(JSON.stringify({ passed: results.length, failed: 0, interceptedRequests: requests.length, browserErrors: 0, externalRequests: 0 }));
