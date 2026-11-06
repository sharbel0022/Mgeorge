// Independent synthetic observations; no corpus names, image coordinates or gold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstructOcrLayout } from '../sites/lib/ocr-layout.js';
import { word, observation, allWords } from './helpers/ocr-layout-fixtures.mjs';
import { loadInvoiceParsers } from './helpers/load-invoice-parsers.mjs';

const parsers = await loadInvoiceParsers();
function row(text, x, y, height = 20) {
  return text.split(' ').map(text => { const result = word(text, x, y, { height }); x += text.length * 8 + 8; return result; });
}
function block({ english = false, street = 'Provbacken 14', postal = '654 32 Provvik', orgY = 170, orgX = 0, addressX = 0, extra = [] } = {}) {
  return observation([
    row(english ? 'Supplier:' : 'Leverantör', 0, 10),
    row('Syntetiska Ängslyckan Test AB', 0, 50),
    row(street, addressX, 90), row(postal, addressX, 130),
    row(english ? 'Organization number: 556016-0680' : 'Org.nr: 556016-0680', orgX, orgY),
    ...extra,
  ], { gap: '\n\n', trailing: '\n\n' });
}
function reconstruct(source) {
  const before = structuredClone(source), originals = allWords(source.blocks);
  const result = reconstructOcrLayout(source.text, source.blocks), retained = allWords(result.blocks);
  assert.deepEqual(source, before);
  assert.equal(retained.length, originals.length);
  assert.equal(new Set(retained).size, originals.length);
  for (const item of originals) assert.ok(retained.includes(item), 'the exact original word/bbox/confidence is retained once');
  assert.deepEqual(result.text.trim().split(/\s+/).sort(), source.text.trim().split(/\s+/).sort());
  return result;
}
for (const [engine, parse] of Object.entries(parsers)) {
  const read = text => parse(text, { method: 'ocr', ocrConfidence: 99, direction: 'supplier', direction_confident: true });
  for (const [name, options] of [
    ['Swedish street and postcode', {}],
    ['English label and leading house number', { english: true, street: '14 Orchard Road' }],
    ['postal box address', { street: 'Box 84' }],
  ]) test(engine + ' explicit party block joins only typed address continuity: ' + name, () => {
    const source = block(options);
    assert.equal(read(source.text).fields.organization_number.value, null, 'plain text paragraph breaks do not prove ownership');
    const result = read(reconstruct(source).text);
    assert.equal(result.fields.party.value, 'Syntetiska Ängslyckan Test AB');
    assert.equal(result.fields.organization_number.value, '5560160680');
    assert.notEqual(result.level, 'green');
  });
  for (const [name, options] of [
    ['untyped prose', { street: 'Kontrollera andra uppgifter' }],
    ['a new legal entity', { street: 'Syntetiska Björkdal Test AB' }],
    ['a labelled buyer', { street: 'Buyer: Synthetic Second Ltd' }],
    ['a labelled customer', { street: 'Kund: Syntetiska Björkdal AB' }],
    ['an account heading', { street: 'Bankgiro: 123-4567' }],
    ['an amount heading', { street: 'Att betala: 620,00' }],
    ['an earlier organization occurrence', { street: 'Org.nr: 556016-0680' }],
    ['an unknown explicit heading', { street: 'Koncern: Syntetiska Björkdal AB' }],
    ['a different column', { addressX: 80 }],
    ['an organization in a different column', { orgX: 400 }],
    ['a footer at the same x position', { orgY: 1700 }],
    ['a postcode without a street', { street: '654 32 Provvik' }],
    ['a street without a postcode', { postal: 'Ytterligare information' }],
  ]) test(engine + ' party ownership remains unresolved across ' + name, () => {
    const result = read(reconstruct(block(options)).text);
    assert.equal(result.fields.organization_number.value, null);
    assert.notEqual(result.level, 'green');
  });
  test(engine + ' a geometrically intervening buyer from another OCR block stops address continuity', () => {
    const source = block({ extra: [row('Buyer: Synthetic Second Ltd', 40, 114, 12)] });
    assert.equal(read(reconstruct(source).text).fields.organization_number.value, null);
  });
  test(engine + ' a later invalid organization remains in the complete conflict census', () => {
    const source = block({ extra: [row('Org.nr: unreadable', 0, 500)] });
    const result = read(reconstruct(source).text);
    assert.equal(result.fields.organization_number.value, null);
    assert.ok(result.issues.some(issue => /organisationsnummer/i.test(issue)));
  });
  test(engine + ' an unlabelled company header cannot acquire supplier ownership from an address', () => {
    const source = block();
    source.blocks[0].paragraphs[0].lines.shift();
    source.text = source.text.replace(/^Leverantör\n\n/, '');
    const result = read(reconstruct(source).text);
    assert.equal(result.fields.party.value, null);
  });
}
