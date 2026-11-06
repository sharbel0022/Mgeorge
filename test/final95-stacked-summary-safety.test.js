import test from 'node:test';
import assert from 'node:assert/strict';
import { loadInvoiceParsers } from './helpers/load-invoice-parsers.mjs';
const parsers = await loadInvoiceParsers();
for (const [engine, parse] of Object.entries(parsers)) for (const method of ['pdf', 'ocr']) {
  const read = text => parse(text, { method, ocrConfidence: 99, direction: 'supplier', direction_confident: true });
  for (const damaged of ['Moms 25 Yo', 'VAT (25 90)', 'Moms: unreadable']) {
    test(engine + ' ' + method + ' damaged middle summary cannot transfer unowned numbers: ' + damaged, () => {
      const text = 'Netto\n\n' + damaged + '\n\nAtt betala\n\n1000,00\n\n250,00\n\n1250,00 SEK';
      const result = read(text);
      for (const field of ['net_cents', 'vat_cents', 'total_cents']) assert.equal(result.fields[field].value, null);
      assert.notEqual(result.level, 'green');
      assert.equal(result.text_excerpt, text);
    });
    test(engine + ' ' + method + ' an explicitly bound total survives a damaged earlier summary: ' + damaged, () => {
      const result = read('Netto\n\n' + damaged + '\n\nAtt betala: 1250,00 SEK');
      assert.equal(result.fields.total_cents.value, 125000);
      assert.equal(result.fields.net_cents.value, null);
      assert.equal(result.fields.vat_cents.value, null);
      assert.notEqual(result.level, 'green');
    });
  }
  test(engine + ' ' + method + ' separately labelled wrapped amounts keep their own values', () => {
    const result = read('Netto\n1000,00\nMomsbelopp\n250,00\nAtt betala\n1250,00 SEK');
    assert.equal(result.fields.net_cents.value, 100000);
    assert.equal(result.fields.vat_cents.value, 25000);
    assert.equal(result.fields.total_cents.value, 125000);
  });
  test(engine + ' ' + method + ' a direct later VAT label cannot inherit an earlier missing net amount', () => {
    const result = read('Netto\nMomsbelopp: 250,00\nAtt betala: 1250,00 SEK');
    assert.equal(result.fields.net_cents.value, null);
    assert.equal(result.fields.vat_cents.value, 25000);
    assert.equal(result.fields.total_cents.value, 125000);
  });
}
