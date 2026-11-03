import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createBridge } from '../src/bridge.js';
import { startSftp } from './sftp-server.js';
import { createHttpsBankgiroSource } from '../../../sites/lib/bankgiro-http-source.js';

// Uses the actual shared adapter and actual SSH/SFTP/HTTP protocol boundaries.
// Only this injected test fetch maps the configured HTTPS origin to loopback.
test('actual shared HTTPS adapter accepts bridge authorization, sequence pages and exact retained SFTP bytes', async t => {
  const remote = await startSftp();
  const dir = await mkdtemp(join(tmpdir(), 'bridge-adapter-contract-'));
  let bridge;
  t.after(async () => { await bridge?.close(); await remote.close(); await rm(dir, { recursive: true, force: true }); });
  const token = 'fixture-server-credential-01234567890123456789';
  const entitlement = { status: 'VERIFIED', origin: 'provider_authorization', evidenceId: 'fixture-proof', checkedAt: '2026-11-03T00:00:00Z', validUntil: '2099-01-01T00:00:00Z', capabilities: ['bankgiro_reports:read'] };
  bridge = await createBridge({ enabled: true, spoolDirectory: join(dir, 'spool'), bearerToken: token,
    binding: { owner: 'fixture-owner', sourceId: 'fixture-source', companyId: 'fixture-company', bankgiro: '1234567', scopeId: 'fixture-scope', generation: '1', profileId: 'fixture-csv' },
    entitlement, allowedFormats: ['csv'],
    sftp: { host: '127.0.0.1', port: remote.port, username: 'reader', password: 'fixture-password', hostKeySha256: remote.hostKeySha256, remoteDirectory: '/reports' } });
  await bridge.syncOnce();
  const server = bridge.createHttpServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const loopback = `http://127.0.0.1:${server.address().port}`;
  const routes = [];
  const source = createHttpsBankgiroSource({
    registration: { id: 'fixture-source', owner: 'fixture-owner', companyId: 'fixture-company', bankgiro: '1234567', scopeId: 'fixture-scope', generation: '1', mode: 'production', enabled: true, transport: 'https-v1', baseUrl: 'https://reports.example.com/feed', tokenSecret: 'FIXTURE_BEARER', profileId: 'fixture-csv', allowedFormats: ['csv'], intervalMinutes: 15, entitlement },
    token,
    async fetchImpl(input, init) {
      const requested = new URL(input);
      assert.equal(requested.origin, 'https://reports.example.com');
      assert.equal(requested.pathname.startsWith('/feed/v1/'), true);
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      assert.equal(init.redirect, 'manual');
      routes.push(requested.pathname);
      const response = await fetch(loopback + requested.pathname.slice('/feed'.length) + requested.search, init);
      // Preserve status, headers and bounded streaming body; a new Response has no
      // loopback URL metadata, matching the injected normalized transport seam.
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
  });
  const authorization = await source.authorize({ owner: 'fixture-owner' });
  assert.equal(authorization.generation, '1');
  const page = await source.listReports({ owner: 'fixture-owner', authorization, limit: 1 });
  assert.equal(page.nextCursor, '1'); assert.equal(page.reports[0].byteLength, 26);
  const bytes = await source.fetchReport({ owner: 'fixture-owner', authorization, report: page.reports[0] });
  assert.equal(new TextDecoder().decode(bytes), 'reference,amount\n0599,100\n');
  assert.equal(page.reports[0].sha256, '71652527c921d05e6f8cabffc2a7f16a70f3caab52f76bda1f48e42d8d487c53');
  const empty = await source.listReports({ owner: 'fixture-owner', authorization, cursor: page.nextCursor, limit: 1 });
  assert.deepEqual(empty, { reports: [], nextCursor: '1' });
  assert.deepEqual(routes, ['/feed/v1/authorization', '/feed/v1/reports', `/feed/v1/reports/${page.reports[0].reportId}/content`, '/feed/v1/reports']);
});
