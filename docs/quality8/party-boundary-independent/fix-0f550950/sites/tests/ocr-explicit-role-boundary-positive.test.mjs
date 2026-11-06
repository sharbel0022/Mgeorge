import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice as nodeParser} from '../../src/invoice-extraction.js';
import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';

const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const recipient='Syntetiska Ö & Å AB',supplier='Syntetiska Kundservice AB';
const fields=`Fakturanummer: ROLE-5824
Fakturadatum: 2026-06-03
Förfallodatum: 2026-07-03
Netto: 736,00 SEK
Momsbelopp: 184,00 SEK
Att betala: 920,00 SEK
Valuta: SEK`;
const cases=[
 {name:'colon recipient',line:'Faktureras till: '+recipient,direction:'customer',want:recipient,org:'Kundens organisationsnummer: 556016-0680'},
 {name:'colonless recipient',line:'Faktureras till '+recipient,direction:'customer',want:recipient,org:'Kundens organisationsnummer: 556016-0680'},
 {name:'supplier with a role-prefix inside a real name',line:'Leverantör: '+supplier,direction:'supplier',want:supplier,org:'Leverantörens organisationsnummer: 556016-0680'},
 {name:'two separately explicit colon roles',line:'Leverantör: '+supplier+' Faktureras till: '+recipient,direction:'customer',want:recipient,org:'Kundens organisationsnummer: 556016-0680'},
];
for(const [engine,parse]of [['Node',nodeParser],['Sites',sitesParser]])for(const method of ['pdf','ocr'])for(const item of cases)test(engine+' '+method+' retains legitimate '+item.name,()=>{
 const text='FAKTURA\n'+item.line+'\n'+item.org+'\n'+fields;
 const actual=parse(text,{direction:item.direction,direction_confident:true,method,ocrConfidence:96});
 assert.equal(actual.fields.party.value,item.want);
 assert.equal(actual.fields.organization_number.value,'5560160680');
 assert.equal(actual.text_excerpt,text);
 assert.deepEqual(actual.issues,[]);
 assert.equal(actual.level,method==='pdf'?'green':'yellow');
 if(item.name==='two separately explicit colon roles'){
  assert.equal(actual.details.supplier.name,supplier);
  assert.equal(actual.details.recipient.name,recipient);
 }
});
