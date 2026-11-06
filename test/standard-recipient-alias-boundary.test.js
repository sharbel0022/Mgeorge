// A known separate heading/name pair must survive layout normalization.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadInvoiceParsers} from './helpers/load-invoice-parsers.mjs';
import {reconstructOcrLayout} from '../sites/lib/ocr-layout.js';
import {word,observation} from './helpers/ocr-layout-fixtures.mjs';
const parsers=await loadInvoiceParsers();
function row(text,y){let x=0;return text.split(' ').map(text=>{const token=word(text,x,y);x+=text.length*8+8;return token;});}
for(const[engine,parse]of Object.entries(parsers))for(const label of ['Bill to','Fakturamottagare'])test(engine+' layout preserves the already supported separate recipient heading: '+label,()=>{
  const source=observation([row(label,10),row('Synthetic Buyer AB',45)],{gap:'\n'});
  const options={direction:'supplier',direction_confident:true,method:'ocr',ocrConfidence:99};
  assert.equal(parse(source.text,options).details.recipient.name,'Synthetic Buyer AB');
  const result=reconstructOcrLayout(source.text,source.blocks),parsed=parse(result.text,options);
  assert.equal(parsed.details.recipient.name,'Synthetic Buyer AB');
  assert.equal(parsed.fields.party.value,null);assert.equal(parsed.fields.organization_number.value,null);
  assert.equal(result.text,source.text,'the new label census must not rewrite unsupported colonless inline roles');
});
