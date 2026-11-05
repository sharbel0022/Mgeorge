import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('loopback HTTP fixtures serve actual bundles and reject unknown routes, stale context and external origins', async t => {
  const port = 15195, origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('./serve-harness.mjs', import.meta.url))], { env: { ...process.env, MGEORGE_95_UI_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(() => { child.kill('SIGTERM'); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Synthetic server did not start: ' + stderr)), 10000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Synthetic server exited ${code}: ${stderr}`)); });
    child.stdout.once('data', chunk => { clearTimeout(timeout); assert.match(String(chunk), /syntheticOnly/); resolve(); });
  });
  const frame = await fetch(origin + '/qa-frame?width=320&height=900&scenario=standard&view=receivable');
  assert.equal(frame.status, 200);
  assert.match(frame.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const frameHtml = await frame.text();
  assert.match(frameHtml, /name="qa-app"/);
  assert.match(frameHtml, /width:320px;height:900px/);
  assert.match(frameHtml, /value="320" selected/);
  assert.match(frameHtml, /src="\/\?scenario=standard&amp;view=receivable"/);
  assert.doesNotMatch(frameHtml, /(?:transform|zoom)\s*:/);
  const bankFrame = await fetch(origin + '/qa-frame?width=1440&height=900&scenario=legacy-connected&view=bank-page');
  assert.equal(bankFrame.status, 200); assert.match(await bankFrame.text(), /src="\/bank\?scenario=legacy-connected"/);
  for (const query of ['width=321', 'height=239', 'scenario=unknown', 'view=%3Cscript%3E']) {
    const rejectedFrame = await fetch(origin + '/qa-frame?' + query);
    assert.equal(rejectedFrame.status, 400); await rejectedFrame.text();
  }
  const page = await fetch(origin + '/?scenario=standard');
  assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self'/); assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  const cookie = page.headers.get('set-cookie').split(';')[0], headers = { Cookie: cookie };
  assert.match(await page.text(), /\/app.js/);
  const asset = await fetch(origin + '/app.js'); assert.equal(asset.status, 200); assert.ok((await asset.text()).length > 10000);
  const companies = await fetch(origin + '/api/companies', { headers }); assert.equal(companies.status, 200); assert.equal((await companies.json()).companies.length, 2);
  const state = await fetch(origin + '/api/state', { headers }); assert.equal(state.status, 200); assert.equal((await state.json()).state.invoices.length, 7);
  const unexpected = await fetch(origin + '/api/unlisted?secret=not-logged', { headers }); assert.equal(unexpected.status, 404);
  const external = await fetch(origin + '/api/state', { headers: { ...headers, Origin: 'https://example.invalid' } }); assert.equal(external.status, 421);
  const stale = await fetch(origin + '/api/state', { headers: { ...headers, 'X-Company-Id': 'company-beta' } }); assert.equal(stale.status, 409);
  const mutation = await fetch(origin + '/api/state', { method: 'POST', headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(mutation.status, 404);
  const switched = await fetch(origin + '/api/companies/active', { method: 'POST', headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId: 'company-beta', contextVersion: 1 }) }); assert.equal(switched.status, 200);
  const current = await fetch(origin + '/api/state', { headers }); assert.equal((await current.json()).state.company.name, 'Exempel Beta AB');
  const retryPage = await fetch(origin + '/?scenario=error-after-first-read'), retryCookie = retryPage.headers.get('set-cookie').split(';')[0];
  await retryPage.text();
  const statuses = [];
  for (let n = 0; n < 3; n++) { const response = await fetch(origin + '/api/state', { headers: { Cookie: retryCookie } }); statuses.push(response.status); await response.text(); }
  assert.deepEqual(statuses, [200, 503, 200]);
  const stopped = once(child, 'exit'); child.kill('SIGTERM'); await stopped;
});
