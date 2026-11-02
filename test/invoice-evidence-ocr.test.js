import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice} from '../src/invoice-extraction.js';
import {sourceInvoiceNumbers} from '../src/document-triage.js';
import {invoiceEvidenceTests} from './helpers/invoice-evidence-cases.mjs';

invoiceEvidenceTests(test,assert,interpretInvoice,sourceInvoiceNumbers);
