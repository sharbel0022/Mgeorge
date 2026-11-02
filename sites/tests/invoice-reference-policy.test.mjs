import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../lib/invoice-reference-policy.js';
import {registerInvoiceReferencePolicyTests} from '../../test/helpers/invoice-reference-policy-cases.mjs';

registerInvoiceReferencePolicyTests(test, assert, policy);
