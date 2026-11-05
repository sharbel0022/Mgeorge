import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createBankgiroSourceRegistry } from '../sites/lib/bankgiro-source-registry.js';

test('Bankgiro HTTPS contract preserves opaque report IDs without changing the configured content route', async () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const iso = offset => new Date(now + offset).toISOString();
  const token = 'synthetic-contract-token';
  const bytes = Buffer.from('Datum;Belopp;OCR\n2026-10-26;625.00;000018\n');
  // These characters are data supplied by a report source, never path/query syntax.
  const reportId = '../v1/authorization?owner=foreign#0599/%2F + Café';
  const descriptor = {
    reportId, filename: 'synthetic-contract.csv', byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const receipt = {
    status: 'VERIFIED', origin: 'provider_authorization', owner: 'synthetic-owner',
    sourceId: 'synthetic-source', companyId: 'synthetic-company', bankgiro: '0599',
    scopeId: 'synthetic-scope', generation: 'synthetic-generation', profileId: 'synthetic-profile',
    evidenceId: 'synthetic-remote-evidence', checkedAt: iso(-1000), validUntil: iso(60000),
    capabilities: ['bankgiro_reports:read'],
  };
  const requests = [];
  const source = createBankgiroSourceRegistry({
    now: () => now,
    configuration: {
      version: 1, revision: 1, registrations: [{
        id: receipt.sourceId, owner: receipt.owner, companyId: receipt.companyId,
        bankgiro: receipt.bankgiro, scopeId: receipt.scopeId, generation: receipt.generation,
        profileId: receipt.profileId, mode: 'production', enabled: true, transport: 'https-v1',
        baseUrl: 'https://reports.example.com/feed', tokenSecret: 'SYNTHETIC_REPORT_TOKEN',
        allowedFormats: ['csv'], intervalMinutes: 15,
        entitlement: { ...receipt, evidenceId: 'synthetic-local-evidence' },
      }],
    },
    secrets: { SYNTHETIC_REPORT_TOKEN: token },
    // Explicit protocol fixture: this callback never opens a network connection.
    fetchImpl: async (input, init) => {
      const url = new URL(input);
      requests.push(url.href);
      assert.equal(url.origin, 'https://reports.example.com');
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      assert.equal(init.redirect, 'manual');
      if (url.pathname === '/feed/v1/authorization') return Response.json(receipt);
      if (url.pathname === '/feed/v1/reports') {
        assert.equal(url.searchParams.get('cursor'), 'synthetic cursor /?');
        return Response.json({ reports: [descriptor], nextCursor: null });
      }
      assert.equal(url.pathname, `/feed/v1/reports/${encodeURIComponent(reportId)}/content`);
      assert.equal(url.search, '');
      assert.equal(url.hash, '');
      return new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } });
    },
  }).resolve(receipt.owner);
  const authorization = await source.authorize({ owner: receipt.owner });
  const page = await source.listReports({ owner: receipt.owner, authorization, cursor: 'synthetic cursor /?', limit: 1 });
  assert.equal(page.reports[0].reportId, reportId);
  const retained = await source.fetchReport({ owner: receipt.owner, authorization, report: page.reports[0] });
  assert.deepEqual(Buffer.from(retained), bytes);
  assert.equal(requests.length, 3);
});
