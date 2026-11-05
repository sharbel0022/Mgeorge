import test from 'node:test';
import assert from 'node:assert/strict';
import {loadInvoiceImports} from './helpers/invoice-module-loader.mjs';

const {parseCSV, guessMapping, mapCSV} = await loadInvoiceImports();
const parse = text => {const parsed = parseCSV(text); return mapCSV(parsed, guessMapping(parsed.headers), 'synthetic.csv')[0];};

test('mapped CSV bank reference cannot compete with the actual OCR', () => {
  const row = parse('Datum;Belopp;Betalare;OCR;Referens;Valuta;Transaktions-id\n2026-10-26;625,00;Synthetic Customer AB;000018;0599;SEK;0577');
  assert.equal(row.bankReference, '0599'); assert.equal(row.externalId, '0577');
  assert.equal(row.payerReference, '000018');
  assert.deepEqual(row.referenceEvidence.candidates.map(c => c.value), ['000018']);
  assert.equal(row.referenceEvidence.candidates[0].source, '$.columns[3].OCR');
});

test('CSV containing only a bank reference does not acquire an invoice reference', () => {
  const row = parse('Datum;Belopp;Betalare;Referens;Valuta\n2026-10-26;625,00;Synthetic Customer AB;0599;SEK');
  assert.equal(row.bankReference, '0599'); assert.equal(row.payerReference, '');
  assert.deepEqual(row.referenceEvidence.candidates, []);
});

test('bank-ID separation preserves competing real invoice fields and invalid OCR', () => {
  const row = parse('Datum;Belopp;Betalare;OCR;Meddelande;Referens;Valuta\n2026-10-26;625,00;Synthetic Customer AB;000019;Faktura 0599;BANK-ID;SEK');
  assert.deepEqual(new Set(row.referenceEvidence.candidates.map(c => c.value)), new Set(['000019', '0599']));
  assert.ok(row.referenceEvidence.candidates.some(c => c.value === '000019' && c.validity === 'checksum_invalid'));
  assert.equal(row.bankReference, 'BANK-ID');
});
