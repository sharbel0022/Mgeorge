import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice as nodeParser} from './snapshot/src/invoice-extraction.js';
import {loadInvoiceParser} from './snapshot/sites/tests/helpers/invoice-module-loader.mjs';
const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const a='5560160680',b='5597623114';
const tail='\nFakturanummer: EXTRA-982\nFakturadatum: 2026-11-01\nFörfallodatum: 2026-12-01\nNetto: 480,00 SEK\nMomsbelopp: 120,00 SEK\nAtt betala: 600,00 SEK\nValuta: SEK';
const ambiguous='Faktureras till: Oberoende Norr AB Leverantör Oberoende Söder AB';
const cases=[
 {name:'square bracket before bare role',head:'Faktureras till: Independent North [AB] supplier Independent South AB',orgs:'Mottagarens organisationsnummer: 556016-0680',party:null,recipient:a,supplier:null},
 {name:'adjacent parenthesis before bare role',head:'Faktureras till: Independent North(AB) supplier Independent South AB',orgs:'Mottagarens organisationsnummer: 556016-0680',party:null,recipient:a,supplier:null},
 {name:'period inside closing parenthesis',head:'Faktureras till: Independent North (AB.) supplier Independent South AB',orgs:'Mottagarens organisationsnummer: 556016-0680',party:null,recipient:a,supplier:null},
 {name:'comma following closing bracket',head:'Faktureras till: Independent North [AB], supplier Independent South AB',orgs:'Mottagarens organisationsnummer: 556016-0680',party:null,recipient:a,supplier:null},
 {name:'different unowned value remains in census after an explicit owner',head:ambiguous,orgs:'Mottagarens organisationsnummer: 556016-0680\nOrganisationsnummer: 559762-3114',party:null,recipient:null,supplier:null},
 {name:'equal unowned value confirms only an independently explicit owner',head:ambiguous,orgs:'Mottagarens organisationsnummer: 556016-0680\nOrganisationsnummer: 556016-0680',party:null,recipient:a,supplier:null},
 {name:'opposite explicit owner does not donate to selected recipient',head:ambiguous,orgs:'Leverantörens organisationsnummer: 559762-3114',party:null,recipient:null,supplier:b},
 {name:'literal role word followed by bracketed form stays one name',direction:'supplier',head:'Leverantör: Original supplier [AB]',orgs:'Leverantörens organisationsnummer: 556016-0680',party:'Original supplier [AB]',recipient:null,supplier:a},
];
for(const [engine,parse]of [['Node',nodeParser],['Sites',sitesParser]])for(const method of ['pdf','ocr'])for(const row of cases)test(`${engine} ${method} recheck extra: ${row.name}`,()=>{
 const direction=row.direction||'customer',text='FAKTURA\n'+row.head+'\n'+row.orgs+tail;
 const actual=parse(text,{direction,direction_confident:true,method,ocrConfidence:96});
 assert.equal(actual.fields.party.value,row.party);
 assert.equal(actual.fields.organization_number.value,direction==='customer'?row.recipient:row.supplier);
 assert.equal(actual.details.recipient.organization_number,row.recipient);
 assert.equal(actual.details.supplier.organization_number,row.supplier);
 assert.equal(actual.details[direction==='customer'?'recipient':'supplier'].name,row.party);
 assert.equal(actual.details[direction==='customer'?'supplier':'recipient'].name,null,'No guessed second identity may be manufactured');
 assert.equal(actual.text_excerpt,text);
 if(row.party!==null){assert.deepEqual(actual.issues,[]);assert.equal(actual.level,method==='pdf'?'green':'yellow');}
 else assert.notEqual(actual.level,'green');
});
