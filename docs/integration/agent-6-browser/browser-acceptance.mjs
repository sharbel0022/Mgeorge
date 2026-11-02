import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { candidates, emptyFixture, ids, manualLinkedFixture, overview, paymentFixture, repo, revision, verification } from './fixtures.mjs';

const requireRuntime = createRequire(import.meta.url);
const { chromium } = requireRuntime(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const scratch = process.env.MGEORGE_QA_SCRATCH || path.join(tmpdir(), 'mgeorge-payment-ui-qa');
const web = path.join(scratch, 'web');
const base = process.env.MGEORGE_QA_BASE || 'http://127.0.0.1:5173';
const baseAddress = new URL(base);
assert.equal(baseAddress.protocol, 'http:', 'Only the local HTTP QA host is allowed.');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(baseAddress.hostname), 'The QA origin must be loopback.');
const out = process.env.MGEORGE_QA_OUTPUT || path.join(scratch, 'output');
const browserRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(scratch, 'browsers');
const modes = process.argv.slice(2);
const runAll = !modes.length || modes.includes('all');
const runViewport = runAll || modes.includes('viewports');
const runStates = runAll || modes.includes('states');
const viewportWidths = (process.env.MGEORGE_QA_WIDTHS || '320,390,768,1024,1440').split(',').map(Number);
const record = { startedAt: new Date().toISOString(), origin: base, syntheticOnly: true, externalRequests: [], cases: [], viewportEvidence: [], screenshotFiles: [], requestEvidence: [] };
await fs.mkdir(out, { recursive: true });
const manifestPath = path.join(scratch, 'bundle-source-manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
await fs.copyFile(manifestPath, path.join(out, 'bundle-source-manifest.json'));
record.sourceManifestPath = 'bundle-source-manifest.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHash = async file => sha(await fs.readFile(file));
const ownedPath = (root, relative) => {
  const resolved = path.resolve(root, relative);
  assert.ok(!path.isAbsolute(relative) && resolved.startsWith(root + path.sep), 'Manifest path must remain inside its declared root.');
  return resolved;
};
const harnessRoot = path.dirname(fileURLToPath(import.meta.url));
record.harnessInputs = await Promise.all(['browser-acceptance.mjs', 'fixtures.mjs', 'build-harness.mjs', 'serve-harness.mjs'].map(async file => ({ path: file, sha256: await sourceHash(path.join(harnessRoot, file)) })));
async function verifyManifest() {
  assert.equal(manifest.sourceStableDuringBuild, true, 'The build did not attest stable source bytes.');
  for (const input of manifest.inputs) assert.equal(await sourceHash(ownedPath(repo, input.path)), input.sha256, 'Product source differs from the build: ' + input.path);
  for (const output of manifest.outputs) assert.equal(await sourceHash(ownedPath(web, output.path)), output.sha256, 'Emitted browser asset differs from the build: ' + output.path);
  for (const input of record.harnessInputs) assert.equal(await sourceHash(path.join(harnessRoot, input.path)), input.sha256, 'QA harness changed during the run: ' + input.path);
  return { productInputs: manifest.inputs.length, emittedAssets: manifest.outputs.length, harnessInputs: record.harnessInputs.length };
}
record.attestation = { before: await verifyManifest() };
const expectedAssets = new Map(manifest.outputs.map(item => [item.path, item.sha256]));
const servedAssets = new Map();
let executablePath = process.env.MGEORGE_QA_CHROMIUM;
if (!executablePath) {
  const defaultExecutable = chromium.executablePath();
  if (existsSync(defaultExecutable)) executablePath = defaultExecutable;
}
if (!executablePath && existsSync(browserRoot)) {
  for (const directory of readdirSync(browserRoot).filter(x => x.startsWith('chromium')).sort().reverse()) {
    for (const suffix of ['chrome-linux/headless_shell', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/chrome', 'chrome-linux64/chrome']) {
      const proposed = path.join(browserRoot, directory, suffix);
      if (existsSync(proposed)) { executablePath = proposed; break; }
    }
    if (executablePath) break;
  }
}
assert.ok(executablePath, 'No installed local Chromium executable was found.');
record.executablePath = executablePath;
const browser = await chromium.launch({ executablePath, headless: true });
record.browserVersion = browser.version();

const gate = () => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
};
async function screenshot(page, filename) {
  const destination = path.join(out, filename);
  await page.screenshot({ path: destination, fullPage: false, animations: 'disabled', caret: 'hide', timeout: 60000 });
  record.screenshotFiles.push(path.relative(out, destination).split(path.sep).join('/'));
}
async function fixture(width, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: width < 760 ? 844 : 1000 }, deviceScaleFactor: 1, locale: 'sv-SE', reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  const data = {
    context, page, width, state: options.state || (options.empty ? emptyFixture() : paymentFixture()), requests: [], errors: [], blockedExternal: [],
    stateMode: options.stateMode || 'ready', verificationMode: options.verificationMode || 'ready', stateGate: options.stateGate,
    verificationGates: options.verificationGates || {}, released: [], candidates: candidates(),
    allowSyntheticControlRun: options.allowSyntheticControlRun === true, controlGate: options.controlGate,
    assetChecks: [], assetErrors: [],
  };
  if (options.ignoreVerificationAbort) {
    await page.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes('/api/bank/verification') && init) {
          const forwarded = { ...init };
          delete forwarded.signal;
          return original(input, forwarded);
        }
        return original(input, init);
      };
    });
  }
  const observePage = observed => {
    observed.on('pageerror', error => data.errors.push(error.message));
    observed.on('response', response => {
      const address = new URL(response.url());
      if (address.origin !== baseAddress.origin || address.pathname.startsWith('/api/') || response.status() !== 200) return;
      const asset = address.pathname === '/' ? 'index.html' : decodeURIComponent(address.pathname.slice(1));
      const check = (async () => {
        assert.ok(expectedAssets.has(asset), 'The browser loaded an asset absent from the build manifest: ' + asset);
        const digest = sha(await response.body());
        assert.equal(digest, expectedAssets.get(asset), 'Browser-received bytes differ from the frozen build: ' + asset);
        const prior = servedAssets.get(asset);
        servedAssets.set(asset, { path: asset, sha256: digest, responseCount: (prior?.responseCount || 0) + 1 });
      })().catch(error => data.assetErrors.push(error.message));
      data.assetChecks.push(check);
    });
  };
  observePage(page);
  context.on('page', observePage);
  await context.route('**/*', async route => {
    const request = route.request(), address = new URL(request.url());
    if (address.origin !== new URL(base).origin) {
      data.blockedExternal.push({ url: address.origin + address.pathname, method: request.method() });
      await route.abort('blockedbyclient');
      return;
    }
    if (!address.pathname.startsWith('/api/')) return route.continue();
    const item = { path: address.pathname + address.search, method: request.method() };
    data.requests.push(item);
    const reply = async (body, status = 200) => {
      try { await route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) }); }
      catch (error) {
        if (!/closed|handled|cancel|aborted/i.test(error.message)) throw error;
      }
    };
    if (request.method() !== 'GET') {
      if (data.allowSyntheticControlRun && request.method() === 'POST' && address.pathname === '/api/payment-control/run') {
        const body = request.postDataJSON();
        item.hasRequestId = typeof body?.request_id === 'string' && body.request_id.length > 0;
        item.interceptedOnly = true;
        if (data.controlGate) await data.controlGate.promise;
        return reply({ job: { id: 'qa-intercepted-control-run', status: 'partial', steps: [], started_at: '2026-11-02T12:00:00.000Z', finished_at: '2026-11-02T12:00:01.000Z' } });
      }
      return reply({ error: 'Synthetic QA blocks every non-GET API request.' }, 405);
    }
    if (address.pathname === '/api/state') {
      if (data.stateGate) await data.stateGate.promise;
      if (data.stateMode === 'error') return reply({ error: 'Syntetiskt tillfälligt läsfel.' }, 503);
      if (data.stateMode === 'signed_out') return reply({ error: 'AUTH_REQUIRED' }, 401);
      if (data.stateMode === 'malformed') return reply({ state: { transactions: null }, revision: 'malformed' });
      if (data.stateMode === 'numeric_reference') {
        const invalid = structuredClone(data.state);
        invalid.transactions[0].payerReference = 599;
        return reply({ state: invalid, revision, audit: [] });
      }
      if (data.stateMode === 'nested_numeric_reference') {
        const invalid = structuredClone(data.state);
        invalid.transactions[0].original.payerReference = 599;
        return reply({ state: invalid, revision, audit: [] });
      }
      return reply({ state: data.state, revision, audit: [] });
    }
    if (address.pathname === '/api/payment-control/overview') return reply(overview(data.state));
    if (address.pathname === '/api/bank/invoice-candidates') return reply({ candidates: data.candidates });
    if (address.pathname === '/api/bank/history') return reply({ entries: [], next: null });
    if (address.pathname === '/api/bank/verification') {
      const transactionId = address.searchParams.get('transactionId');
      const pending = data.verificationGates[transactionId];
      if (pending) {
        await pending.promise;
        data.released.push(transactionId);
      }
      const body = verification(transactionId, data.verificationMode);
      if (pending?.stale) body.invoiceHint = { number: 'STALE-0599', proposal: true };
      return reply(body);
    }
    if (address.pathname === '/api/customer-messages/list') return reply({ items: [] });
    if (address.pathname === '/api/gmail/status') return reply({ connected: false, send_enabled: false, review: 0, processing: { pending: 0, error: 0 } });
    if (address.pathname === '/api/files') return reply({ error: 'Synthetic original intentionally unavailable.' }, 404);
    return reply({ error: 'No synthetic QA fixture for this endpoint.' }, 404);
  });
  data.open = async (view = 'bank') => {
    await page.goto(base + '/?view=' + view, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.locator('#main-content').waitFor({ state: 'visible', timeout: 60000 });
  };
  let captured = false;
  const capture = () => {
    if (captured) return;
    captured = true;
    record.requestEvidence.push({ width, requests: data.requests, pageErrors: data.errors, assetErrors: data.assetErrors });
    record.externalRequests.push(...data.blockedExternal);
  };
  context.on('close', capture);
  data.finish = async () => {
    await Promise.all(data.assetChecks);
    capture();
    assert.deepEqual(data.blockedExternal, [], 'The app requested an external destination.');
    const mutations = data.requests.filter(request => request.method !== 'GET');
    if (data.allowSyntheticControlRun) {
      assert.equal(mutations.length, 1, 'The dedicated primary-action test must dispatch exactly once.');
      assert.equal(mutations[0].path, '/api/payment-control/run');
      assert.equal(mutations[0].method, 'POST');
      assert.equal(mutations[0].interceptedOnly, true);
      assert.equal(mutations[0].hasRequestId, true);
    } else assert.equal(mutations.length, 0, 'Navigation or disclosures attempted an API mutation.');
    assert.deepEqual(data.errors, [], 'Unexpected browser JavaScript errors.');
    assert.deepEqual(data.assetErrors, [], 'The browser did not exercise the attested frontend assets.');
  };
  return data;
}

function visibleRows(page) { return page.locator('.bank-desktop-list tr[data-economic="true"] .bank-open-payment:visible, .bank-mobile-list .bank-payment-card[data-economic="true"]:visible'); }
function paymentRows(page) { return page.locator('.bank-desktop-list tr[data-economic="true"]:visible, .bank-mobile-list .bank-payment-card[data-economic="true"]:visible'); }
async function loadedBank(page) { await visibleRows(page).first().waitFor({ timeout: 60000 }); }
async function openPayment(page, index) {
  const opener = visibleRows(page).nth(index);
  await opener.focus();
  assert.equal(await opener.evaluate(element => document.activeElement === element), true);
  await page.keyboard.press('Enter');
  await page.locator('dialog.modal[open]').waitFor({ timeout: 10000 });
  return opener;
}
async function closePayment(page, opener) {
  await page.keyboard.press('Escape');
  await page.locator('dialog.modal[open]').waitFor({ state: 'detached', timeout: 10000 });
  assert.equal(await opener.evaluate(element => document.activeElement === element), true, 'Escape did not restore the row opener.');
}
async function noPageOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    width: innerWidth, documentClient: document.documentElement.clientWidth, documentScroll: document.documentElement.scrollWidth,
    bodyScroll: document.body.scrollWidth,
    dialogs: Array.from(document.querySelectorAll('dialog[open]')).map(element => ({ client: element.clientWidth, scroll: element.scrollWidth, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right })),
  }));
  assert.ok(metrics.documentScroll <= metrics.width + 1, label + ' has page horizontal overflow: ' + JSON.stringify(metrics));
  for (const dialog of metrics.dialogs) assert.ok(dialog.scroll <= dialog.client + 1 && dialog.left >= -1 && dialog.right <= metrics.width + 1, label + ' has dialog horizontal overflow: ' + JSON.stringify(metrics));
  return metrics;
}
async function test(name, callback) {
  const start = Date.now();
  try {
    const evidence = await callback();
    record.cases.push({ name, outcome: 'passed', durationMs: Date.now() - start, ...(evidence ? { evidence } : {}) });
    console.log('PASS ' + name);
  } catch (error) {
    record.cases.push({ name, outcome: 'failed', durationMs: Date.now() - start, error: error.stack || error.message });
    console.error('FAIL ' + name + ': ' + error.message);
  }
  await fs.writeFile(path.join(out, 'acceptance-results.json'), JSON.stringify(record, null, 2));
}

if (runViewport) {
  for (const width of viewportWidths) {
    await test('actual viewport ' + width + ': bank list, 0599, missing account, keyboard disclosure and Escape focus', async () => {
      const f = await fixture(width);
      try {
        await f.open(); await loadedBank(f.page);
        const dimensions = await f.page.evaluate(() => ({ innerWidth, clientWidth: document.documentElement.clientWidth, devicePixelRatio, mobileCards: matchMedia('(max-width:760px)').matches, userAgent: navigator.userAgent }));
        assert.equal(dimensions.innerWidth, width, 'Requested viewport was not applied by the browser.');
        record.viewportEvidence.push(dimensions);
        await f.page.keyboard.press('Tab');
        assert.equal(await f.page.evaluate(() => document.activeElement.classList.contains('skip-link')), true, 'First Tab did not expose the skip link.');
        await f.page.keyboard.press('Enter');
        assert.equal(await f.page.evaluate(() => document.activeElement.id), 'main-content', 'Skip link did not focus main content.');
        const before = await noPageOverflow(f.page, 'Bank list at ' + width);
        const referenceRow = paymentRows(f.page).first();
        assert.deepEqual(await referenceRow.locator('.bank-reference > strong.mono').allTextContents(), ['0599'], 'The target economic row lost its exact bank reference.');
        assert.deepEqual(await referenceRow.locator('.bank-reference > .bank-reference-note').allTextContents(), ['Bank-OCR saknas.'], 'The target row must explicitly distinguish generic reference from missing bank OCR.');
        assert.equal(await visibleRows(f.page).count(), 4, 'Report observations must be outside the four economic payment rows.');
        assert.equal(await f.page.getByRole('button', { name: 'Kontrollera alla betalningar', exact: true }).count(), 1);
        await visibleRows(f.page).first().scrollIntoViewIfNeeded();
        await screenshot(f.page, 'bank-list-' + width + '.png');
        const opener = await openPayment(f.page, 1);
        const dialog = f.page.locator('dialog.modal[open]');
        await dialog.locator('.payment-verification-steps').waitFor();
        assert.equal(await dialog.locator('.payment-verification-steps summary').count(), 11);
        assert.match(await dialog.locator('.payment-verification').innerText(), /Mottagarkontot saknas/);
        assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
        const summary = dialog.locator('.payment-verification-steps summary').nth(3);
        await summary.focus(); await f.page.keyboard.press('Enter');
        assert.equal(await summary.evaluate(element => element.parentElement.open), true, 'Enter did not expand the native evidence disclosure.');
        assert.equal(await summary.evaluate(element => element.matches(':focus-visible') && parseFloat(getComputedStyle(element).outlineWidth) >= 2), true, 'Evidence disclosure has no visible keyboard focus indicator.');
        await f.page.keyboard.press('Space');
        assert.equal(await summary.evaluate(element => element.parentElement.open), false, 'Space did not collapse the native evidence disclosure.');
        const close = dialog.getByRole('button', { name: 'Stäng dialog', exact: true });
        await close.focus(); await f.page.keyboard.press('Shift+Tab');
        assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'Native dialog failed to keep reverse Tab focus inside.');
        await f.page.keyboard.press('Tab');
        assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'Native dialog failed to keep Tab focus inside.');
        const detail = await noPageOverflow(f.page, 'Missing-account detail at ' + width);
        await screenshot(f.page, 'missing-account-dialog-' + width + '.png');
        await closePayment(f.page, opener);
        await f.finish();
        return { dimensions, list: before, detail };
      } catch (error) {
        await screenshot(f.page, 'failure-viewport-' + width + '.png').catch(() => {});
        throw error;
      } finally { await f.context.close(); }
    });
  }
  await test('desktop to mobile resize while dialog is open restores focus to visible main content', async () => {
    const f = await fixture(1440);
    try {
      await f.open(); await loadedBank(f.page); await openPayment(f.page, 0);
      await f.page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await f.page.evaluate(() => innerWidth), 390);
      await f.page.keyboard.press('Escape');
      await f.page.locator('dialog.modal[open]').waitFor({ state: 'detached' });
      assert.equal(await f.page.evaluate(() => document.activeElement.id), 'main-content');
      await f.finish();
    } finally { await f.context.close(); }
  });
}

if (runStates) {
  await test('multiple report payers remain separate from the aggregate payer and 0599 stays exact', async () => {
    const f = await fixture(390);
    try {
      await f.open(); await loadedBank(f.page);
      const opener = await openPayment(f.page, 2);
      const dialog = f.page.locator('dialog.modal[open]');
      await dialog.locator('.payment-verification-steps').waitFor();
      assert.equal(await dialog.locator('header h2').first().innerText(), 'Betalare okänd');
      const step = dialog.locator('.payment-verification-steps summary').nth(5);
      await step.focus(); await f.page.keyboard.press('Enter');
      const text = await dialog.innerText();
      for (const expected of ['Flera betalare', 'Syntetisk betalare Bravo AB', 'Syntetisk betalare Charlie AB', '0599']) assert.ok(text.includes(expected), 'Missing separate report evidence: ' + expected);
      assert.equal(await dialog.locator('.bank-status.is-verified').count(), 0);
      await noPageOverflow(f.page, 'Multiple payer detail');
      await screenshot(f.page, 'multiple-payers-390.png');
      await closePayment(f.page, opener); await f.finish();
    } finally { await f.context.close(); }
  });
  await test('missing Bankgiro detail remains blocked and no bank-detail request runs on open', async () => {
    const f = await fixture(1440);
    try {
      await f.open(); await loadedBank(f.page);
      const opener = await openPayment(f.page, 3);
      const dialog = f.page.locator('dialog.modal[open]');
      await dialog.locator('.payment-verification-steps').waitFor();
      assert.match(await dialog.innerText(), /Bankgirodetaljer saknas/);
      assert.equal(f.requests.some(item => item.path.startsWith('/api/bank/details') || item.path.startsWith('/api/bank/account-evidence')), false);
      assert.equal(await dialog.locator('.bank-status.is-verified').count(), 0);
      await screenshot(f.page, 'missing-bankgiro-1440.png');
      await closePayment(f.page, opener); await f.finish();
    } finally { await f.context.close(); }
  });
  await test('pending workspace read stays loading until a genuine loaded empty result', async () => {
    const pending = gate(), f = await fixture(320, { empty: true, stateGate: pending });
    try {
      await f.open();
      await f.page.getByText('Hämtar bankhändelser…', { exact: true }).waitFor({ timeout: 30000 });
      const before = await f.page.locator('#main-content').innerText();
      assert.doesNotMatch(before, /Inga bankhändelser/);
      await screenshot(f.page, 'workspace-loading-320.png');
      pending.release();
      await f.page.getByRole('heading', { name: 'Inga bankhändelser ännu', exact: true }).waitFor();
      await screenshot(f.page, 'workspace-empty-320.png');
      await f.finish();
    } finally { pending.release(); await f.context.close(); }
  });
  await test('failed workspace read shows unavailable state and explicit read-only retry', async () => {
    const f = await fixture(390, { stateMode: 'error' });
    try {
      await f.open();
      const retry = f.page.getByRole('button', { name: 'Hämta uppgifter igen', exact: true });
      await retry.waitFor();
      assert.equal(await visibleRows(f.page).count(), 0);
      assert.doesNotMatch(await f.page.locator('#main-content').innerText(), /Inga bankhändelser/);
      await screenshot(f.page, 'workspace-error-390.png');
      f.stateMode = 'ready'; await retry.click(); await loadedBank(f.page);
      await f.finish();
    } finally { await f.context.close(); }
  });
  await test('malformed stored verification shows an error without a verified result or bank action', async () => {
    const f = await fixture(390, { verificationMode: 'malformed' });
    try {
      await f.open(); await loadedBank(f.page);
      const opener = await openPayment(f.page, 1), panel = f.page.locator('dialog.modal[open] .payment-verification');
      await panel.locator('[role="alert"]').waitFor();
      assert.equal(await panel.locator('.payment-verification-steps').count(), 0);
      assert.equal(await panel.getByRole('button', { name: 'Kontrollera mottagarkonto hos banken' }).count(), 0);
      await screenshot(f.page, 'verification-malformed-390.png');
      f.verificationMode = 'ready'; await panel.getByRole('button', { name: 'Försök igen' }).click();
      await panel.locator('.payment-verification-steps').waitFor();
      await closePayment(f.page, opener); await f.finish();
    } finally { await f.context.close(); }
  });
  for (const malformed of ['malformed', 'numeric_reference', 'nested_numeric_reference']) {
    await test('invalid workspace response is unavailable instead of trusted: ' + malformed, async () => {
      const f = await fixture(390, { stateMode: malformed });
      try {
        await f.open();
        const retry = f.page.getByRole('button', { name: 'Hämta uppgifter igen', exact: true });
        await retry.waitFor();
        assert.equal(await visibleRows(f.page).count(), 0);
        assert.doesNotMatch(await f.page.locator('#main-content').innerText(), /Inga bankhändelser/);
        await screenshot(f.page, 'workspace-invalid-' + malformed + '-390.png');
        f.stateMode = 'ready'; await retry.click(); await loadedBank(f.page);
        assert.deepEqual(await paymentRows(f.page).first().locator('.bank-reference > strong.mono').allTextContents(), ['0599']);
        await f.finish();
      } finally { await f.context.close(); }
    });
  }
  await test('late prior-payment response cannot replace the current report even when transport ignores abort', async () => {
    const pending = gate(); pending.stale = true;
    const f = await fixture(390, { verificationGates: { [ids.missingAccount]: pending }, ignoreVerificationAbort: true });
    try {
      await f.open(); await loadedBank(f.page);
      const first = await openPayment(f.page, 1);
      await f.page.locator('dialog.modal[open]').getByText('Kontrollerar bevarade underlag…', { exact: true }).waitFor();
      await closePayment(f.page, first);
      const second = await openPayment(f.page, 2);
      await f.page.locator('dialog.modal[open] .payment-verification-steps').waitFor();
      const oldResponsePromise = f.page.waitForResponse(response => response.url().includes('/api/bank/verification?transactionId=' + ids.missingAccount), { timeout: 15000 });
      pending.release();
      const oldResponse = await oldResponsePromise;
      await oldResponse.finished();
      await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.doesNotMatch(await f.page.locator('dialog.modal[open] .payment-verification').innerText(), /STALE-0599/);
      assert.match(await f.page.locator('dialog.modal[open] .payment-verification').innerText(), /Flera betalare/);
      await screenshot(f.page, 'verification-current-after-stale-390.png');
      await closePayment(f.page, second); await f.finish();
      return { priorResponseCompleted: true, ignoredAbortInSyntheticTransport: true, currentTransactionId: ids.multiple };
    } finally { pending.release(); await f.context.close(); }
  });
  await test('mobile review keyboard selection focuses labelled details and Back restores its row', async () => {
    const f = await fixture(390);
    try {
      await f.open('review');
      const row = f.page.getByRole('button', { name: 'Granska Saknat mottagarkonto', exact: true });
      await row.waitFor(); await row.focus(); await f.page.keyboard.press('Enter');
      const detail = f.page.getByRole('region', { name: 'Granskning: Saknat mottagarkonto', exact: true });
      await detail.waitFor();
      assert.equal(await detail.evaluate(element => document.activeElement === element), true);
      const back = detail.getByRole('button', { name: 'Tillbaka till listan', exact: true });
      await back.focus(); await f.page.keyboard.press('Enter');
      assert.equal(await row.evaluate(element => document.activeElement === element), true);
      await f.finish();
    } finally { await f.context.close(); }
  });
  await test('Verifierade filter excludes a manually linked REVIEW payment with a historical allocation', async () => {
    const manual = manualLinkedFixture(), before = JSON.stringify(manual.state);
    const f = await fixture(1440, { state: manual.state });
    try {
      await f.open(); await loadedBank(f.page);
      const row = f.page.locator('.bank-desktop-list tr[data-economic="true"]').first();
      assert.equal(await row.locator('[data-verification-state]').getAttribute('data-verification-state'), 'REVIEW');
      assert.equal(await row.locator('.bank-status-copy > .bank-status').innerText(), 'Behöver granskas');
      assert.equal((await row.locator('.bank-status-copy > small').allTextContents()).includes('Verifierad'), false);
      const verified = f.page.locator('.bank-payment-panel .filter-tabs').getByRole('button', { name: 'Verifierade', exact: true });
      await verified.focus(); await f.page.keyboard.press('Enter');
      await f.page.getByText('Inga bankhändelser matchar ditt filter.', { exact: true }).waitFor();
      assert.equal(await visibleRows(f.page).count(), 0);
      assert.equal(JSON.stringify(manual.state), before, 'The historical fixture changed while filtering.');
      await screenshot(f.page, 'manual-link-excluded-from-verified-1440.png');
      await f.finish();
      return { decision: 'REVIEW', originalAllocationCount: manual.state.allocations.length, fixtureUnchanged: true };
    } finally { await f.context.close(); }
  });
  await test('primary control keyboard activation dispatches one existing action into the synthetic interceptor only', async () => {
    const pending = gate(), f = await fixture(390, { allowSyntheticControlRun: true, controlGate: pending });
    try {
      await f.open(); await loadedBank(f.page);
      const button = f.page.getByRole('button', { name: 'Kontrollera alla betalningar', exact: true });
      assert.equal(await button.count(), 1);
      await f.page.waitForFunction(() => {
        const button = document.querySelector('.payment-control-button');
        return button && !button.disabled;
      });
      await button.focus(); await f.page.keyboard.press('Enter');
      const busy = f.page.getByRole('button', { name: 'Kontrollen pågår', exact: true });
      await busy.waitFor();
      assert.equal(await busy.isDisabled(), true);
      assert.equal(await busy.getAttribute('aria-busy'), 'true');
      await f.page.keyboard.press('Enter');
      assert.equal(f.requests.filter(item => item.path === '/api/payment-control/run').length, 1);
      pending.release();
      await f.page.getByRole('button', { name: 'Kontrollera alla betalningar', exact: true }).waitFor();
      assert.equal(f.requests.filter(item => item.path === '/api/payment-control/run').length, 1);
      assert.equal(f.requests.some(item => item.path === '/api/payment-control/advance'), false);
      await f.finish();
      return { syntheticInterceptedPost: '/api/payment-control/run', dispatchCount: 1, deliveredToBackend: false, automaticAdvance: false };
    } finally { pending.release(); await f.context.close(); }
  });
  await test('explicit invoice reference remains distinct from bank reference and its conflict stays REVIEW', async () => {
    const state = paymentFixture();
    state.invoices[0].ocr = '0000599';
    const f = await fixture(390, { state });
    try {
      await f.open(); await loadedBank(f.page);
      const row = paymentRows(f.page).first();
      assert.deepEqual(await row.locator('.bank-intended-reference strong.mono').allTextContents(), ['0000599']);
      assert.deepEqual(await row.locator('.bank-reference > strong.mono').allTextContents(), ['0599']);
      assert.match(await row.locator('.bank-intended-reference').innerText(), /Fakturans uttryckliga referens/);
      assert.deepEqual(await row.locator('.bank-reference > .bank-reference-note').allTextContents(), ['Bank-OCR saknas.']);
      assert.doesNotMatch(await row.locator('.bank-reference').innerText(), /Formell OCR/);
      assert.equal(await row.locator('[data-verification-state]').getAttribute('data-verification-state'), 'REVIEW');
      assert.match(await row.locator('.bank-status-copy').innerText(), /uttryckliga referens.*avviker/s);
      await row.scrollIntoViewIfNeeded();
      await screenshot(f.page, 'explicit-reference-conflict-390.png');
      await f.finish();
      return { intendedReference: '0000599', bankReportedReference: '0599', status: 'REVIEW', formalBankOcrClaimed: false };
    } finally { await f.context.close(); }
  });
}

if (modes.includes('diagnose320')) {
  await test('320px dialog overflow descendants', async () => {
    const f = await fixture(320);
    try {
      await f.open(); await loadedBank(f.page); await openPayment(f.page, 1);
      const dialog = f.page.locator('dialog.modal[open]');
      await dialog.locator('.payment-verification-steps').waitFor();
      const descendants = await dialog.evaluate(element => {
        const boundary = element.getBoundingClientRect();
        return Array.from(element.querySelectorAll('*')).map(node => {
          const box = node.getBoundingClientRect(), style = getComputedStyle(node);
          return { tag: node.tagName, className: node.className, text: node.textContent?.trim().slice(0, 140), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, left: box.left, right: box.right, overflowX: style.overflowX, whiteSpace: style.whiteSpace, visible: !!node.getClientRects().length };
        }).filter(item => item.visible && (item.right > boundary.right + 1 || item.scrollWidth > item.clientWidth + 1)).slice(0, 30);
      });
      console.log(JSON.stringify({ dialogOverflowDescendants: descendants }, null, 2));
      await screenshot(f.page, 'dialog-overflow-diagnostic-320.png');
      await f.finish();
      return descendants;
    } finally { await f.context.close(); }
  });
}

record.finishedAt = new Date().toISOString();
try {
  record.attestation.after = await verifyManifest();
  record.attestation.stable = true;
} catch (error) {
  record.attestation.stable = false;
  record.attestation.error = error.message;
  console.error('FAIL frozen source/assets: ' + error.message);
}
record.browserReceivedAssets = [...servedAssets.values()];
record.passed = record.cases.filter(item => item.outcome === 'passed').length;
record.failed = record.cases.filter(item => item.outcome === 'failed').length + (record.attestation.stable ? 0 : 1);
await fs.writeFile(path.join(out, 'acceptance-results.json'), JSON.stringify(record, null, 2));
await browser.close();
console.log(JSON.stringify({ passed: record.passed, failed: record.failed, browser: record.browserVersion, output: path.join(out, 'acceptance-results.json') }));
process.exitCode = record.failed ? 1 : 0;
