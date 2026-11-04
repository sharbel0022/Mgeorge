import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { providerRequest } from '../lib/banking/enable-banking.ts';

// Exercise the real transport error path. The only replacement is the bank's
// HTTP boundary; all credentials and personal details below are fictional.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
});
const config = {
  applicationId: '11111111-1111-4111-8111-111111111111',
  privateKeyPem: privateKey,
};

const cases = [
  ['short credentials', 'access_token=short-token code=one-use-code', ['short-token', 'one-use-code']],
  ['personal identity', 'BankID personalNumber=19121212-1212 name=Synthetic Person', ['19121212-1212', 'Synthetic Person']],
  ['bank details', 'account=1234-567890 email=synthetic@example.test', ['1234-567890', 'synthetic@example.test']],
  ['log injection', 'connection failed\nBANK_CONSENT_APPROVED owner=foreign-owner', ['BANK_CONSENT_APPROVED', 'foreign-owner']],
  ['embedded payload', '{"refresh_token":"tiny","payer":"Synthetic Payer"}', ['tiny', 'Synthetic Payer']],
];

for (const [label, message, secrets] of cases) {
  test(`transport diagnostics never copy ${label} from an upstream exception`, async t => {
    const logs = [];
    t.mock.method(console, 'error', (...parts) => logs.push(parts));
    t.mock.method(globalThis, 'fetch', async () => { throw new Error(message); });

    await assert.rejects(providerRequest(config, '/application'), error => {
      assert.equal(error.code, 'BANK_NETWORK_ERROR');
      for (const secret of secrets) assert.ok(!error.message.includes(secret));
      return true;
    });

    const output = JSON.stringify(logs);
    assert.match(output, /BANK_PROVIDER_TRANSPORT_ERROR/, 'Operators still receive a stable failure event');
    for (const secret of secrets) assert.ok(!output.includes(secret), `Private ${label} reached the log sink`);
    assert.ok(!output.includes('\\n'), 'Upstream line breaks must not forge log records');
  });
}
