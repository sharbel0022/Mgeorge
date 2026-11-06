// Independently specified synthetic geometry and values, not a holdout image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstructOcrLayout } from '../sites/lib/ocr-layout.js';
import { word, observation, allWords } from './helpers/ocr-layout-fixtures.mjs';
import { loadInvoiceParsers } from './helpers/load-invoice-parsers.mjs';
const parsers = await loadInvoiceParsers();
function row(text, x, y) {
  return text.split(' ').map(text => { const result = word(text, x, y); x += text.length * 8 + 8; return result; });
}
function summary({ english = false, damagedVat = false, numericVatTail = false, labelX = 350, aside = '', suffix = '', competing = false, obstruction = false, wrongBaseline = false, malformedAmount = false, wrongTotal = false, amounts: printedAmounts = null, extra = [] } = {}) {
  const labels = english ? ['Net amount', 'VAT amount', 'Amount due'] : ['Summa exkl. moms', numericVatTail ? 'Moms 25' : damagedVat ? 'Moms (25 ?)' : 'Momsbelopp', 'Att betala'];
  const amounts = printedAmounts || [malformedAmount ? '1672,8O' : '1672,80', '418,20', wrongTotal ? '2092,00 SEK' : '2091,00 SEK'];
  return observation([
    [...row('Description', 0, 10), ...row('Qty', 250, 10), ...row('Amount', 950, 10)],
    [...row('Synthetic service', 0, 80), ...row('1', 250, 80), ...row('1672,80', 950, 80)],
    ...labels.map((label, index) => [...(index === 0 && aside ? row(aside, 0, 250) : []), ...row(label, labelX, 250 + index * 60)]),
    ...amounts.map((amount, index) => [...row(amount, 950, 250 + index * 60 + (wrongBaseline && index === 0 ? 40 : 0)), ...(index === 0 && suffix ? row(suffix, 1250, 250) : [])]),
    ...(competing ? [row('1650,00', 750, 250)] : []),
    ...(obstruction ? [row('2', 700, 250)] : []),
    ...extra,
  ], { gap: '\n\n', trailing: '\n\n' });
}
function apply(source) {
  const before = structuredClone(source), originals = allWords(source.blocks);
  const result = reconstructOcrLayout(source.text, source.blocks), retained = allWords(result.blocks);
  assert.deepEqual(source, before);
  assert.equal(retained.length, originals.length); assert.equal(new Set(retained).size, originals.length);
  for (const item of originals) assert.ok(retained.includes(item), 'original OCR tokens and confidence survive exactly once');
  assert.deepEqual(result.text.trim().split(/\s+/).sort(), source.text.trim().split(/\s+/).sort());
  return result;
}
for (const [engine, parse] of Object.entries(parsers)) {
  const read = text => parse(text, { method: 'ocr', ocrConfidence: 99, direction: 'supplier', direction_confident: true });
  for (const labels of ['Netto\n\nMomsbelopp\n\nAtt betala', 'Amount due\n\nNet amount\n\nVAT amount']) test(engine + ' plain text cannot assign the first number after a stack of empty summary headings: ' + labels.replaceAll('\n', ' '), () => {
    const result = read(labels + '\n\n1672,80\n\n418,20\n\n2091,00 SEK');
    for (const field of ['net_cents', 'vat_cents', 'total_cents']) assert.equal(result.fields[field].value, null);
    assert.notEqual(result.level, 'green');
  });
  for (const [name, options, vat] of [
    ['Swedish closed summary', {}, 41820],
    ['English closed summary', { english: true }, 41820],
    ['damaged percentage stays unresolved', { damagedVat: true }, null],
    ['numeric rate-looking tail cannot become thousands grouping', { numericVatTail: true }, null],
    ['separate left prose retains its own negative VAT occurrence', { aside: 'Moms enligt avtalet.' }, null],
    ['separate explicit currency stays independent', { aside: 'Valuta: SEK' }, 41820],
  ]) test(engine + ' typed summary cells preserve exact printed values: ' + name, () => {
    const source = summary(options);
    assert.equal(read(source.text).fields.net_cents.value, null);
    const result = read(apply(source).text);
    assert.equal(result.fields.net_cents.value, 167280);
    assert.equal(result.fields.vat_cents.value, vat);
    assert.equal(result.fields.total_cents.value, 209100);
    assert.notEqual(result.level, 'green');
    if (options.damagedVat) assert.ok(result.text_excerpt.includes('Moms (25 ?)'));
  });
  for (const [name, options] of [
    ['article description column', { labelX: 0 }],
    ['an untyped source-row suffix', { suffix: 'eller 2092,00' }],
    ['another monetary candidate', { competing: true }],
    ['an article quantity in the cell corridor', { obstruction: true }],
    ['an incompatible value baseline', { wrongBaseline: true }],
    ['an unreadable monetary token', { malformedAmount: true }],
    ['untyped left content', { aside: 'Okänt innehåll' }],
    ['an unowned left numeric value ending in punctuation', { aside: '1672,80.' }],
    ['a competing aligned heading', { extra: [row('Avtalsnr:', 950, 210)] }],
  ]) test(engine + ' typed summaries refuse ' + name, () => {
    const result = read(apply(summary(options)).text);
    assert.equal(result.fields.net_cents.value, null);
    assert.equal(result.fields.total_cents.value, null);
    assert.notEqual(result.level, 'green');
  });
  test(engine + ' summary geometry does not calculate or correct inconsistent totals', () => {
    const result = read(apply(summary({ wrongTotal: true })).text);
    assert.equal(result.fields.net_cents.value, 167280);
    assert.equal(result.fields.vat_cents.value, 41820);
    assert.equal(result.fields.total_cents.value, 209200);
    assert.ok(result.issues.some(issue => /Momsberäkningen/.test(issue)));
    assert.notEqual(result.level, 'green');
  });
  test(engine + ' thousands grouping within a whole printed VAT value stays valid', () => {
    const result = read(apply(summary({ amounts: ['101 672,80', '25 418,20', '127 091,00 SEK'] })).text);
    assert.equal(result.fields.net_cents.value, 10167280);
    assert.equal(result.fields.vat_cents.value, 2541820);
    assert.equal(result.fields.total_cents.value, 12709100);
  });
  test(engine + ' a later invalid amount still blocks the full field census', () => {
    const result = read(apply(summary({ extra: [row('Netto: unreadable', 0, 1000)] })).text);
    assert.equal(result.fields.net_cents.value, null);
    assert.notEqual(result.level, 'green');
  });
}
