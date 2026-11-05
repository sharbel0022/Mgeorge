import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sourceInvoiceNumbers} from '../lib/document-triage.js';
import {invoiceEvidenceTests} from '../../test/helpers/invoice-evidence-cases.mjs';

let source=readFileSync(new URL('../lib/invoice-fields.js',import.meta.url),'utf8');
for(const [name,path] of [['./domain','../lib/domain.ts'],['./document-triage.js','../lib/document-triage.js'],['./invoice-details.js','../lib/invoice-details.js'],['./ocr-bankgiro-evidence.js','../lib/ocr-bankgiro-evidence.js']])source=source.replaceAll(JSON.stringify(name),JSON.stringify(new URL(path,import.meta.url).href)).replaceAll("'"+name+"'",JSON.stringify(new URL(path,import.meta.url).href));
const {interpretInvoice}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
invoiceEvidenceTests(test,assert,interpretInvoice,sourceInvoiceNumbers);
