import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { directoryFixture, snapshotFixture } from '../../sites/tests/helpers/saas-onboarding-fixture.mjs';
import { startServer } from '../../docs/integration/saas-onboarding-browser/serve-harness.mjs';
import { sha256, writeJson, repositoryRoot as root } from './core.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH);
const output = process.env.MGEORGE_ONBOARDING_QA;
if (!output) throw new Error('MGEORGE_ONBOARDING_QA is required');
const base = 'http://127.0.0.1:5178';
const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
const verify = () => {
  for (const item of manifest.inputs) assert.equal(sha256(readFileSync(join(root, item.path))), item.sha256, item.path);
  for (const item of manifest.outputs) assert.equal(sha256(readFileSync(join(output, 'web', item.path))), item.sha256, item.path);
};
let browser, server;
const receipt = { syntheticOnly: true, scope: 'Actual CompanyWorkspace plus BankPage; synthetic intercepted API contract', realBankVerification: 'NOT_RUN', results: [], externalRequests: [], browserErrors: [], requests: [], assetChecks: [], runnerErrors: [] };
try {
  verify(); server = await startServer();
  browser = await chromium.launch({ headless: true, ...(process.env.MGEORGE_QA_CHROMIUM ? { executablePath: process.env.MGEORGE_QA_CHROMIUM } : {}) });
  receipt.browserVersion = browser.version();
  async function scenario(width = 390) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const state = { active: 'company-alpha', version: 1, revoked: false, reads: 0, posts: [] };
    const companies = directoryFixture().companies;
    const companyContext = () => ({ version: 'company-context-v1', companyId: state.active, storageOwner: 'synthetic-owner-' + state.active, actorId: 'synthetic-actor', role: companies.find(item => item.id === state.active).role, membershipVersion: 1, companyVersion: 1, contextVersion: state.version });
    page.on('pageerror', error => receipt.browserErrors.push(error.message));
    const assetPromises = [];
    page.on('response', response => {
      const pathname = new URL(response.url()).pathname, name = pathname === '/bank' ? 'index.html' : pathname.slice(1);
      const asset = manifest.outputs.find(item => item.path === name);
      if (asset) assetPromises.push(response.body().then(bytes => receipt.assetChecks.push({ path: name, match: sha256(bytes) === asset.sha256 })).catch(() => receipt.assetChecks.push({ path: name, match: false })));
    });
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== base) { receipt.externalRequests.push(url.origin); return route.abort(); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      receipt.requests.push({ method: req.method(), path: url.pathname });
      const reply = (value, status = 200) => route.fulfill({ status, json: value });
      if (url.pathname === '/api/companies' && req.method() === 'GET') {
        state.reads++;
        if (state.revoked) return reply({ error: 'Synthetic membership revoked' }, 403);
        return reply({ version: 'company-context-v1', companies: companies.map(item => ({ ...item, membershipVersion: 1 })), activeCompanyId: state.active, contextVersion: state.version, context: companyContext() });
      }
      if (url.pathname === '/api/companies/active' && req.method() === 'POST') {
        const body = req.postDataJSON(), headers = req.headers();
        state.posts.push({ path: url.pathname, body, headers });
        if (body.contextVersion !== state.version || headers['x-company-id'] !== state.active || headers['x-company-context-version'] !== String(state.version) || !companies.some(item => item.id === body.companyId)) return reply({ error: 'Stale synthetic context' }, 409);
        state.active = body.companyId; state.version++;
        return reply({ context: companyContext() });
      }
      if (req.headers()['x-company-id'] !== state.active || req.headers()['x-company-context-version'] !== String(state.version)) return reply({ error: 'Missing active company context' }, 403);
      if (url.pathname === '/api/onboarding/companies') return reply({ ...directoryFixture(), activeCompanyId: state.active, contextVersion: state.version, legacy: false });
      const match = url.pathname.match(/^\/api\/companies\/([^/]+)\/bank-onboarding$/);
      if (match && match[1] === state.active) {
        const snapshot = snapshotFixture(state.active, Date.now());
        snapshot.payments[0].reference.value = state.active === 'company-alpha' ? '0000599' : '0000600';
        return reply(snapshot);
      }
      return reply({ error: 'Unexpected synthetic request' }, 400);
    });
    await page.goto(base + '/bank');
    await page.getByRole('heading', { name: 'Konton för Exempel Alfa AB' }).waitFor();
    return { context, page, state, finish: async () => { await Promise.all(assetPromises); await context.close(); } };
  }
  async function run(name, width, fn) {
    const start = performance.now(); let fixture;
    try { fixture = await scenario(width); await fn(fixture); receipt.results.push({ name, passed: true, durationMs: performance.now() - start }); }
    catch (error) { receipt.results.push({ name, passed: false, error: String(error).slice(0, 1600), durationMs: performance.now() - start }); }
    finally { if (fixture) await fixture.finish(); }
    console.log(`${receipt.results.at(-1).passed ? 'PASS' : 'FAIL'} ${name}`);
  }
  for (const width of [320, 390, 1440]) await run(`integrated workspace preserves typed form across context revalidation at ${width}px`, width, async ({ page }) => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.equal(await page.getByRole('combobox', { name: 'Aktivt företag', exact: true }).inputValue(), 'company-alpha');
    await page.getByRole('button', { name: 'Lägg till företag', exact: true }).click();
    const name = page.getByRole('textbox', { name: 'Företagsnamn' });
    await name.pressSequentially('Syntetiskt Företag');
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/companies');
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await refreshed;
    await name.pressSequentially(' AB');
    assert.equal(await name.inputValue(), 'Syntetiskt Företag AB');
    await page.screenshot({ path: join(output, `workspace-${width}.png`) });
  });
  await run('integrated company switch uses previous context then reloads only the new company', 390, async ({ page, state }) => {
    await page.getByRole('combobox', { name: 'Välj företag', exact: true }).selectOption('company-beta');
    await page.waitForURL('**/bank?company=company-beta');
    await page.getByRole('heading', { name: 'Konton för Exempel Beta AB' }).waitFor();
    assert.equal(state.posts.length, 1);
    assert.deepEqual(state.posts[0].body, { companyId: 'company-beta', contextVersion: 1 });
    assert.equal(state.posts[0].headers['x-company-id'], 'company-alpha');
    assert.equal(await page.getByRole('combobox', { name: 'Aktivt företag', exact: true }).inputValue(), 'company-beta');
    assert.equal(await page.getByText('0000599', { exact: true }).count(), 0);
    await page.getByText('0000600', { exact: true }).waitFor();
  });
  await run('integrated membership revocation clears the whole private workspace', 390, async ({ page, state }) => {
    await page.getByText('0000599', { exact: true }).waitFor(); state.revoked = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('heading', { name: 'Företagsåtkomsten behöver kontrolleras' }).waitFor();
    assert.equal(await page.getByText('0000599', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('combobox').count(), 0);
    assert.equal(state.posts.length, 0);
  });
  verify();
} catch (error) {
  receipt.runnerErrors.push(String(error).slice(0, 2000));
} finally {
  receipt.passed = receipt.runnerErrors.length === 0 && receipt.results.length === 5 && receipt.results.every(item => item.passed) && receipt.externalRequests.length === 0 && receipt.browserErrors.length === 0 && receipt.assetChecks.length > 0 && receipt.assetChecks.every(item => item.match);
  writeJson(join(output, 'workspace-results.json'), receipt);
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
if (!receipt.passed) process.exitCode = 1;
