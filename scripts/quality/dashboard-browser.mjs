import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanTestEnvironment, repositoryRoot as root, sha256, writeJson } from './core.mjs';
import { browserAssetsComplete, closeBrowserResources } from './browser-lifecycle.mjs';

// Exercise the actual merged Dashboard, CompanyWorkspace and production CSS.
// The existing isolated server owns only synthetic, in-memory API fixtures.
const output = process.env.MGEORGE_95_UI_QA;
if (!output) throw new Error('MGEORGE_95_UI_QA is required');
const require = createRequire(join(root, 'qa/browser/package.json'));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const origin = 'http://127.0.0.1:5195';
const manifest = JSON.parse(readFileSync(join(output, 'bundle-source-manifest.json'), 'utf8'));
function verify() {
  assert.equal(manifest.sourceStableDuringBuild, true);
  for (const item of [...manifest.inputs, ...manifest.harnessInputs]) assert.equal(sha256(readFileSync(join(root, item.path))), item.sha256, item.path);
  for (const item of manifest.outputs) assert.equal(sha256(readFileSync(join(output, 'web', item.path))), item.sha256, item.path);
}
const receipt = {
  syntheticOnly: true, realBankVerification: 'NOT_RUN', realAuthentication: 'NOT_RUN',
  scope: 'Actual Dashboard and CompanyWorkspace in Chromium with isolated synthetic HTTP fixtures; no production backend or provider.',
  results: [], externalRequests: [], forbiddenRequests: [], browserErrors: [], requests: [], assetChecks: [], runnerErrors: [],
};
let server, browser;
try {
  verify();
  server = spawn(process.execPath, ['--experimental-strip-types', 'docs/integration/95-ui-browser/serve-harness.mjs'], {
    cwd: root, env: { ...cleanTestEnvironment(), MGEORGE_95_UI_QA: output }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Synthetic dashboard server did not become ready')), 15_000);
    let text = '', diagnostics = '';
    server.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-2000); });
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Synthetic dashboard server exited ${code}: ${diagnostics}`)); });
    server.stdout.on('data', chunk => {
      text = (text + chunk).slice(-4000);
      if (text.includes('"origin":"' + origin + '"')) { clearTimeout(timer); resolve(); }
    });
  });
  browser = await chromium.launch({ headless: true, ...(process.env.MGEORGE_QA_CHROMIUM ? { executablePath: process.env.MGEORGE_QA_CHROMIUM } : {}) });
  receipt.browserVersion = browser.version();

  async function run(name, width, action, { view = 'overview', scenario = 'standard', path = '/', ready = true } = {}) {
    const started = performance.now();
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'sv-SE', reducedMotion: 'reduce', hasTouch: width < 760, serviceWorkers: 'block' });
    const page = await context.newPage(), pendingAssets = [], scenarioAssets = [];
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => receipt.browserErrors.push(error.message));
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { receipt.externalRequests.push(url.origin); return route.abort(); }
      if (url.pathname.startsWith('/api/')) {
        receipt.requests.push({ method: request.method(), path: url.pathname });
        // The tested journeys are read-only. Existing legacy auto-sync is a
        // documented synthetic no-op; no economic mutation reaches the server.
        if (request.method() !== 'GET' && !(request.method() === 'POST' && url.pathname === '/api/bank/auto-sync')) {
          receipt.forbiddenRequests.push({ method: request.method(), path: url.pathname });
          return route.abort();
        }
      }
      return route.continue();
    });
    page.on('response', response => {
      const pathname = new URL(response.url()).pathname;
      const assetPath = ['/', '/bank'].includes(pathname) ? 'index.html' : pathname.slice(1);
      const asset = manifest.outputs.find(item => item.path === assetPath);
      if (asset) {
        const record = match => {
          const check = { scenario: name, path: assetPath, match };
          scenarioAssets.push(check); receipt.assetChecks.push(check);
        };
        pendingAssets.push(response.body().then(bytes => record(sha256(bytes) === asset.sha256)).catch(() => record(false)));
      }
    });
    try {
      await page.goto(`${origin}${path}?scenario=${scenario}&view=${view}`);
      if (path === '/') {
        await page.getByRole('heading', { level: 1 }).waitFor();
        if (ready) await page.waitForFunction(() => document.querySelector('input[aria-label="Sök i arbetsytan"]')?.disabled === false);
      }
      await action(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Page overflows the real viewport');
      await page.screenshot({ path: join(output, `dashboard-${receipt.results.length + 1}-${width}.png`), animations: 'disabled' });
      await Promise.all(pendingAssets);
      assert.equal(browserAssetsComplete(scenarioAssets), true, 'Scenario must load matching production HTML, JavaScript and CSS');
      receipt.results.push({ name, passed: true, assetsVerified: true, width, durationMs: performance.now() - started });
    } catch (error) {
      receipt.results.push({ name, passed: false, width, error: String(error).slice(0, 2000), durationMs: performance.now() - started });
      await page.screenshot({ path: join(output, `failure-${receipt.results.length}-${width}.png`), animations: 'disabled' }).catch(() => {});
    } finally {
      await Promise.all(pendingAssets); await context.close();
    }
    console.log(`${receipt.results.at(-1).passed ? 'PASS' : 'FAIL'} ${name}`);
  }
  const headings = { overview: 'Ekonomiöversikt', receivable: 'Kundfakturor', bank: 'Bank', review: 'Behöver granskas' };
  for (const width of [320, 390, 768, 1024, 1440]) for (const view of Object.keys(headings)) {
    await run(`merged ${view} layout at ${width}px`, width, async page => {
      assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), headings[view]);
      assert.equal(await page.getByRole('combobox', { name: 'Aktivt företag', exact: true }).inputValue(), 'company-alpha');
      if (view === 'receivable') await page.getByRole('button', { name: 'Öppna faktura 0000599', exact: true }).waitFor();
      if (view === 'bank') await page.locator('.bank-open-payment:visible, .bank-payment-card:visible').first().waitFor();
      if (view === 'review') await page.getByRole('button', { name: 'Granska Saknat mottagarkonto', exact: true }).waitFor();
      if (view === 'overview') {
        await page.waitForFunction(() => document.querySelector('.economy-card')?.disabled === false);
        assert.match(await page.locator('.economy-cards').innerText(), /6\s*245/);
        assert.match(await page.locator('main').innerText(), /Inga verifierade betalningskopplingar/);
      }
    }, { view });
  }
  await run('administrator sees optional AI status without activating a provider', 390, async page => {
    const section = page.locator('.connection-setting').filter({ has: page.getByText('OpenAI', { exact: true }) });
    await section.getByRole('status').getByText('Avstängt', { exact: true }).waitFor();
    assert.ok((await section.innerText()).includes('Befintlig OCR används.'));
    await section.getByRole('button', { name: 'Hämta AI-status igen' }).click();
    await section.getByRole('status').getByText('Avstängt', { exact: true }).waitFor();
  }, { view: 'settings' });

  await run('global reference search uses native keyboard and restores stable focus', 1440, async page => {
    const input = page.getByRole('searchbox', { name: 'Sök i arbetsytan', exact: true });
    await input.fill('0000599');
    await page.getByRole('button', { name: /^Faktura 0000599\b/ }).waitFor();
    await input.press('ArrowDown');
    assert.match(await page.locator(':focus').innerText(), /Faktura 0000599/);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Faktura 0000599', exact: true });
    await dialog.waitFor();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await input.evaluate(element => element === document.activeElement), true);
  });
  await run('invoice search preserves zeroes, reset focus and payable navigation', 390, async page => {
    const search = page.getByRole('searchbox', { name: 'Sök fakturor', exact: true });
    await search.fill('0000599');
    const open = page.getByRole('button', { name: 'Öppna faktura 0000599', exact: true });
    await open.focus(); await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Faktura 0000599', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await search.fill('SAKNAS-000');
    await page.getByRole('button', { name: 'Rensa sökning och filter', exact: true }).click();
    assert.equal(await search.inputValue(), '');
    assert.equal(await search.evaluate(element => element === document.activeElement), true);
    assert.equal(await page.locator('.invoice-table tbody tr').count(), 5);
    await page.locator('main').getByRole('link', { name: 'Leverantörsfakturor', exact: true }).click();
    await page.getByRole('heading', { name: 'Leverantörsfakturor', exact: true }).waitFor();
    assert.equal(await page.locator('.invoice-table tbody tr').count(), 2);
  }, { view: 'receivable' });
  await run('bank payer and generic reference remain separate from invoice payment proof', 1440, async page => {
    await page.getByRole('button', { name: /^Visa betalning: Syntetisk Norrvik Studio AB,/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Syntetisk Norrvik Studio AB', exact: true });
    await dialog.locator('.payment-verification-steps').waitFor();
    assert.equal(await dialog.locator('.bank-reference strong').first().innerText(), '0000599');
    assert.match(await dialog.innerText(), /Bank-OCR saknas/);
    assert.equal(await dialog.locator('[data-verification-state="VERIFIED"]').count(), 0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Visa betalning: Betalare okänd,/ }).first().click();
    const unknown = page.getByRole('dialog', { name: 'Betalare okänd', exact: true });
    await unknown.waitFor();
    assert.equal(await unknown.locator('[data-verification-state="VERIFIED"]').count(), 0);
  }, { view: 'bank' });
  await run('mobile review selection and Back preserve keyboard focus', 320, async page => {
    const row = page.getByRole('button', { name: 'Granska Saknat mottagarkonto', exact: true });
    await row.focus(); await page.keyboard.press('Enter');
    const detail = page.getByRole('region', { name: 'Granskning: Saknat mottagarkonto', exact: true });
    await detail.waitFor();
    assert.equal(await detail.evaluate(element => element === document.activeElement), true);
    await detail.getByRole('button', { name: 'Tillbaka till listan', exact: true }).click();
    assert.equal(await row.evaluate(element => element === document.activeElement), true);
  }, { view: 'review' });
  for (const scenario of ['loading', 'error']) await run(`initial ${scenario} cannot invent zero financial totals`, 390, async page => {
    await page.getByText(scenario === 'loading' ? 'Hämtar ekonomiöversikten…' : /Uppgifterna kunde inte uppdateras/).waitFor();
    assert.equal(await page.getByRole('searchbox', { name: 'Sök i arbetsytan', exact: true }).isDisabled(), true);
    assert.deepEqual(await page.locator('.economy-card strong').allTextContents(), ['—', '—', '—', '—']);
    assert.equal(await page.locator('.economy-card:enabled').count(), 0);
  }, { scenario, ready: false });
  await run('loaded empty invoices have a truthful next action', 768, async page => {
    await page.getByRole('heading', { name: 'Lägg till din första faktura', exact: true }).waitFor();
    assert.equal(await page.locator('.invoice-table tbody tr').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Lägg till faktura', exact: true }).isEnabled(), true);
  }, { scenario: 'empty', view: 'receivable' });
  await run('overview 503 and explicit retry restore real saved fixture values', 390, async page => {
    await page.waitForFunction(() => document.querySelector('.economy-card')?.disabled === false);
    await page.getByRole('button', { name: 'Uppdatera', exact: true }).click();
    const retry = page.getByRole('button', { name: 'Hämta översikten igen', exact: true });
    await retry.waitFor();
    assert.deepEqual(await page.locator('.economy-card strong').allTextContents(), ['—', '—', '—', '—']);
    await retry.click();
    await page.waitForFunction(() => document.querySelector('.economy-card')?.disabled === false);
    assert.match(await page.locator('.economy-cards').innerText(), /6\s*245/);
  }, { scenario: 'error-after-first-read' });
  await run('mobile menu supports touch, Escape and focus return', 390, async page => {
    const open = page.getByRole('button', { name: 'Öppna menyn', exact: true });
    await open.tap();
    const menu = page.getByRole('dialog'); await menu.waitFor();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await menu.evaluate(element => element.contains(document.activeElement)), true);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    assert.equal(await open.evaluate(element => element === document.activeElement), true);
  });
  for (const scenario of ['legacy-unknown-expiry', 'legacy-expired']) await run(`${scenario} never claims a confirmed active consent`, 390, async page => {
    await page.getByText(scenario === 'legacy-unknown-expiry' ? 'Giltighet inte bekräftad' : /förnyas|gått ut/i).first().waitFor();
    assert.equal(await page.getByText('Aktivt medgivande', { exact: true }).count(), 0);
  }, { scenario, path: '/bank' });
  verify();
} catch (error) {
  receipt.runnerErrors.push(String(error).slice(0, 2000));
} finally {
  receipt.runnerErrors.push(...await closeBrowserResources({ browser, server }));
  receipt.passed = receipt.results.length === 31 && receipt.results.every(item => item.passed && item.assetsVerified === true) && receipt.runnerErrors.length === 0 && receipt.browserErrors.length === 0 && receipt.externalRequests.length === 0 && receipt.forbiddenRequests.length === 0 && browserAssetsComplete(receipt.assetChecks);
  writeJson(join(output, 'dashboard-results.json'), receipt);
  console.log(JSON.stringify({ passed: receipt.passed, tests: receipt.results.length, failures: receipt.results.filter(item => !item.passed).map(item => item.name) }));
}
if (!receipt.passed) process.exitCode = 1;
