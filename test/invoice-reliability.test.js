import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice} from '../src/invoice-extraction.js';
import {reliabilityTests,reliabilityBoundaryTests} from './helpers/invoice-reliability-cases.mjs';
reliabilityTests(test,assert,interpretInvoice);
reliabilityBoundaryTests(test,assert,interpretInvoice);
