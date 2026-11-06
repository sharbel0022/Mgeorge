import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadInvoiceParsers} from '../../test/helpers/load-invoice-parsers.mjs';
import {reliabilityTests,reliabilityBoundaryTests} from '../../test/helpers/invoice-reliability-cases.mjs';
const {sites}=await loadInvoiceParsers(fileURLToPath(new URL('../../',import.meta.url)));
reliabilityTests(test,assert,sites);
reliabilityBoundaryTests(test,assert,sites);
