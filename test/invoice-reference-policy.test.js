import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../src/invoice-reference-policy.js';
import * as sitesPolicy from '../sites/lib/invoice-reference-policy.js';
import {registerInvoiceReferencePolicyTests} from './helpers/invoice-reference-policy-cases.mjs';

registerInvoiceReferencePolicyTests(test, assert, policy);

test('Node and Sites use the same policy implementation and export contract', () => {
  assert.deepEqual(Object.keys(policy), Object.keys(sitesPolicy));
  for (const key of Object.keys(policy)) assert.equal(policy[key], sitesPolicy[key]);
});
