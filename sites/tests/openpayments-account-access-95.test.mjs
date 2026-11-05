import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenPaymentsProvider } from '../lib/banking/openpayments-provider.js';
import { NOW, CONFIG, CONTEXT, ACCOUNT, ACCOUNT_ID, TX, json, fixtureTransport } from './helpers/openpayments-fixture.mjs';

const path = '/psd2/accountinformation/v1/accounts';
const range = { dateFrom: '2026-11-01', dateTo: '2026-11-04' };
function setup(overrides = {}) {
  const fixture = fixtureTransport(overrides);
  const provider = new OpenPaymentsProvider(CONFIG, { transport: fixture.transport, now: () => NOW });
  return { ...fixture, connection: provider.forCompany(CONTEXT, fixture.dependencies) };
}
async function consent(connection) {
  return (await connection.createConsent({ validUntil: '2026-12-01' })).handle;
}
async function account(connection) {
  return (await connection.listAccounts(await consent(connection))).accounts[0].handle;
}

for (const status of ['blocked', 'deleted']) {
  test('Open Payments refuses a ' + status + ' account before it can become a selectable resource', async () => {
    const f = setup({ ['GET ' + path]: () => json({ accounts: [{ ...ACCOUNT, status }] }) });
    await assert.rejects(f.connection.listAccounts(await consent(f.connection)), { code: 'BANK_ACCOUNT_UNAVAILABLE' });
    assert.equal(f.calls.some(call => call.url.includes('/transactions')), false);
  });
  test('Open Payments rejects a selected account that became ' + status, async () => {
    const f = setup({ ['GET ' + path + '/' + ACCOUNT_ID]: () => json({ ...ACCOUNT, status }) });
    await assert.rejects(f.connection.getAccount(await account(f.connection)), { code: 'BANK_ACCOUNT_UNAVAILABLE' });
  });
}

for (const patch of [{ usage: null }, { usage: 'UNKNOWN' }, { usage: {} }, { status: null }, { status: 'UNKNOWN' }, { status: {} }]) {
  test('Open Payments does not accept malformed account access metadata ' + JSON.stringify(patch), async () => {
    const f = setup({ ['GET ' + path]: () => json({ accounts: [{ ...ACCOUNT, ...patch }] }) });
    await assert.rejects(f.connection.listAccounts(await consent(f.connection)), { code: 'PROVIDER_RESPONSE_INVALID' });
  });
}

test('Open Payments transaction page cannot override a blocked account with matching identity', async () => {
  const f = setup({ ['GET ' + path + '/' + ACCOUNT_ID + '/transactions']: () => json({
    account: { iban: ACCOUNT.iban, status: 'blocked' }, transactions: { booked: [TX], _links: {} },
  }) });
  await assert.rejects(f.connection.getTransactions(await account(f.connection), range), { code: 'BANK_ACCOUNT_UNAVAILABLE' });
});

test('documented omitted account usage/status and explicit enabled business account remain compatible', async () => {
  for (const patch of [{ usage: undefined, status: undefined }, { usage: 'ORGA', status: 'enabled' }]) {
    const f = setup({ ['GET ' + path]: () => json({ accounts: [{ ...ACCOUNT, ...patch }] }) });
    const handle = await account(f.connection);
    assert.equal((await f.connection.getTransactions(handle, range)).booked.length, 1);
  }
});
