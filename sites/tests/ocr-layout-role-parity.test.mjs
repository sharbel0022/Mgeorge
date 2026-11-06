import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice as nodeParser} from '../../src/invoice-extraction.js';
import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';
import {reconstructOcrLayout} from '../lib/ocr-layout.js';
import {word,observation,allWords,textRows,totalReferenceMix} from '../../test/helpers/ocr-layout-fixtures.mjs';

const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const supplier='Syntetiska Lind Verkstad AB',recipient='Syntetiska Ek Handel AB';
const supplierWords=()=>[word('Syntetiska',0,50),word('Lind',90,50),word('Verkstad',130,50),word('AB',205,50)];
const recipientWords=()=>[word('Syntetiska',450,50),word('Ek',540,50),word('Handel',565,50),word('AB',620,50)];
function roleSource({extra=false,missing=false,merged=false}={}){
 const names=[...supplierWords(),...(!missing?recipientWords():[])];
 if(merged)for(let n=4;n<names.length;n++){const width=names[n].bbox.x1-names[n].bbox.x0;names[n].bbox.x0=240+(n-4)*80;names[n].bbox.x1=names[n].bbox.x0+width;}
 if(extra)names.push(word('Okänt',900,50),word('suffix',955,50));
 return observation([[word('Leverantör',0,10),word('Faktureras',450,10),word('till',540,10)],names],{gap:'\n\n'});
}
const rest='Fakturanummer: RL-4832\nFakturadatum: 2026-06-02\nFörfallodatum: 2026-07-02\nNetto: 418,00 SEK\nMomsbelopp: 104,50 SEK\nAtt betala: 522,50 SEK\nValuta: SEK';
function layout(source){
 const before=structuredClone(source),original=allWords(source.blocks),actual=reconstructOcrLayout(source.text,source.blocks);
 assert.deepEqual(source,before);const kept=allWords(actual.blocks);assert.equal(kept.length,original.length);assert.equal(new Set(kept).size,original.length);for(const item of original)assert.ok(kept.includes(item));
 return actual;
}

for(const [engine,parse]of [['Node',nodeParser],['Sites',sitesParser]]){
 const read=(text,direction='supplier')=>parse('FAKTURA\n'+text+'\n'+rest,{direction,direction_confident:true,method:'ocr',ocrConfidence:96});
 test(engine+' cross-axis ambiguity remains unassigned by the actual scalar consumer',()=>{
  const source=totalReferenceMix(),actual=layout(source);assert.equal(actual.text,source.text);
  const parsed=parse(actual.text,{method:'ocr',ocrConfidence:96});
  assert.equal(parsed.fields.total_cents.value,null);assert.equal(parsed.fields.reference.value,null);assert.notEqual(parsed.level,'green');
 });
 test(engine+' two complete role columns preserve both explicit roles',()=>{
  const actual=layout(roleSource());assert.equal(actual.reconstructed,true);
  assert.deepEqual(textRows(actual.text),['Leverantör '+supplier,'Faktureras till '+recipient]);
  const parsed=read(actual.text);assert.equal(parsed.details.supplier.name,supplier);assert.equal(parsed.details.recipient.name,recipient);assert.equal(parsed.fields.party.value,supplier);
  assert.equal(read(actual.text,'customer').fields.party.value,recipient);assert.notEqual(parsed.level,'green');
 });
 for(const option of ['extra','missing','merged'])test(engine+' incomplete role-name row is indivisible: '+option,()=>{
  const source=roleSource({[option]:true}),actual=layout(source);assert.equal(actual.text,source.text);assert.equal(actual.reconstructed,false);
  const parsed=read(actual.text);assert.equal(parsed.fields.party.value,null);assert.equal(parsed.details.recipient.name,null);
 });
 for(const label of ['Faktureras till: ','Faktureras till ','Faktureras till\n'])test(engine+' the exact explicit recipient alias is understood: '+JSON.stringify(label),()=>{
  const actual=read(label+recipient,'customer');assert.equal(actual.fields.party.value,recipient);assert.equal(actual.details.supplier.name,null);
 });
 for(const text of ['Faktureras tillfälle '+recipient,'Faktureras till\nAvtalsnr: SYN-592','Faktureras till saknas','Faktureras till '+recipient+' Leverantör '+supplier,recipient])test(engine+' ambiguous or absent recipient role stays unknown: '+text.split('\n')[0],()=>{
  const actual=read(text,'customer');assert.equal(actual.fields.party.value,null);assert.notEqual(actual.level,'green');
 });
 test(engine+' reordered role columns cannot claim an unowned following organization by output order',()=>{
  const actual=layout(roleSource()),parsed=read(actual.text+'Organisationsnummer: 556016-0680');
  assert.equal(parsed.details.supplier.organization_number,null);assert.equal(parsed.details.recipient.organization_number,null);
 });
 test(engine+' explicit owner-qualified organization survives the role-column reconstruction',()=>{
  const actual=layout(roleSource()),parsed=read(actual.text+'Leverantörens organisationsnummer: 556016-0680');
  assert.equal(parsed.details.supplier.organization_number,'5560160680');assert.equal(parsed.details.recipient.organization_number,null);
 });
 test(engine+' a mixed explicit role row cannot assign a following unowned organization to its last event',()=>{
  const parsed=read('Leverantör: '+supplier+' Faktureras till: '+recipient+'\nOrganisationsnummer: 556016-0680');
  assert.equal(parsed.details.supplier.organization_number,null);assert.equal(parsed.details.recipient.organization_number,null);
 });
}
