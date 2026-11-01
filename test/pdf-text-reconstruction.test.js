import test from 'node:test';
import assert from 'node:assert/strict';
import {extractInvoice} from '../src/invoice-extraction.js';
import {fragmentedInvoicePdf,fragmentedFacit} from './helpers/fragmented-pdf.mjs';
import {reconstructPdfText as nodeText} from '../src/pdf-text.js';

const context={direction:'supplier',direction_confident:true};
const engines={Node:bytes=>extractInvoice(bytes,'application/pdf',context)};
const item=(str,x,width,extra={})=>({str,transform:[14,0,0,14,x,100],width,height:14,hasEOL:false,...extra});

for(const [name,reconstruct] of Object.entries({Node:nodeText})){
  test(`${name}: reconstruction preserves adjacent glyphs, explicit spaces and EOL`,()=>{
    const items=[item('5',100,7.784),item('00,00',107.7,35),item(' ',142.7,4),item('SEK',146.7,28,{hasEOL:true}),item('2026-',40,35),item('10-24',75,35,{hasEOL:true})];
    assert.equal(reconstruct(items),'500,00 SEK\n2026-10-24\n');
  });
  test(`${name}: reconstruction never joins unmarked separate columns or baselines`,()=>{
    assert.equal(reconstruct([item('0606',40,30),item('0707',200,30)]),'0606 0707');
    assert.equal(reconstruct([item('0707',200,30),item('0606',40,30)]),'0707 0606');
    assert.equal(reconstruct([item('0606',40,30),item('0707',40,30,{transform:[14,0,0,14,40,80]})]),'0606\n0707');
    assert.equal(reconstruct([{str:'0606'},{str:'0707'}]),'0606 0707');
  });
}

for(const [name,extract] of Object.entries(engines))for(const logo of [false,true])test(`${name}: actual adjacent glyph fragments retain native invoice fields${logo?' with raster logo':''}`,async()=>{
  const bytes=fragmentedInvoicePdf({logo}),r=await extract(bytes);
  assert.equal(r.method,'pdf');assert.equal(r.level,'green',JSON.stringify(r.issues));
  for(const [field,value]of Object.entries(fragmentedFacit))assert.equal(r.fields[field].value,value,field);
  assert.match(r.text_excerpt,/Att betala: 500,00 SEK/);assert.match(r.text_excerpt,/Fakturanummer: 0606/);assert.match(r.text_excerpt,/Leverantör: Testbolaget AB/);assert.match(r.text_excerpt,/Fakturadatum: 2026-10-24/);
});

for(const [name,extract] of Object.entries(engines))for(const [option,field]of [['separateAmounts','total_cents'],['separateIdentifiers','invoice_number']])for(const reverseAmounts of [false,true])test(`${name}: actual separated ${field} columns stay ambiguous in ${reverseAmounts?'reverse':'forward'} content order`,async()=>{
  const r=await extract(fragmentedInvoicePdf({[option]:true,reverseAmounts}));
  assert.equal(r.method,'pdf');assert.notEqual(r.level,'green');assert.equal(r.fields[field].value,null);
  assert.ok(!r.text_excerpt.includes('500,00 SEK600,00 SEK'));assert.ok(!r.text_excerpt.includes('600,00 SEK500,00 SEK'));assert.ok(!r.text_excerpt.includes('06060707'));assert.ok(!r.text_excerpt.includes('07070606'));
});
