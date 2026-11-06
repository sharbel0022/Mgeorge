import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const repo=resolve(process.env.PARTY_REVIEW_REPO || new URL('../../',import.meta.url).pathname);
const {interpretInvoice:nodeParser}=await import(pathToFileURL(resolve(repo,'src/invoice-extraction.js')).href);
const {loadInvoiceParser}=await import(pathToFileURL(resolve(repo,'sites/tests/helpers/invoice-module-loader.mjs')).href);
const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const {cases}=JSON.parse(readFileSync(new URL('./fixtures/review-party-boundary-cases.json',import.meta.url),'utf8'));
for(const [engine,parse]of [['Node',nodeParser],['Sites',sitesParser]])for(const method of ['pdf','ocr'])for(const item of cases){
 test(`${engine} ${method} independent ${item.group}: ${item.name}`,()=>{
  const actual=parse(item.text,{direction:item.direction,direction_confident:true,method,ocrConfidence:96});
  const role=item.direction==='supplier'?'supplier':'recipient',other=role==='supplier'?'recipient':'supplier';
  assert.equal(actual.fields.party.value,item.party,'A new ambiguous role must not become a composite name');
  assert.equal(actual.details[role].name,item.party,'The selected role must preserve the same bounded identity');
  assert.equal(actual.fields.organization_number.value,item.organization,'An unowned identity must not cross a role boundary');
  assert.equal(actual.details[role].organization_number,item.organization,'Role-specific evidence must not guess an owner');
  assert.equal(actual.details[other].name,item.otherName,'Bare roles must not manufacture another accepted identity');
  assert.equal(actual.text_excerpt,item.text,'The original source must remain unchanged');
  if(item.green){assert.deepEqual(actual.issues,[]);assert.equal(actual.level,method==='pdf'?'green':'yellow');}
  else assert.notEqual(actual.level,'green','An unresolved identity requires review');
 });
}
