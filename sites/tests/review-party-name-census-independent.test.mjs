import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const {interpretInvoice:nodeParse}=await import(pathToFileURL(root+'/src/invoice-extraction.js'));
const {loadInvoiceParser}=await import(pathToFileURL(root+'/sites/tests/helpers/invoice-module-loader.mjs'));
const {interpretInvoice:sitesParse}=await loadInvoiceParser();
const tail='\nFakturanummer: INDEPENDENT-701\nFakturadatum: 2026-06-03\nFörfallodatum: 2026-07-03\nNetto: 480,00 SEK\nMomsbelopp: 120,00 SEK\nAtt betala: 600,00 SEK\nValuta: SEK';
const cases=[
 {id:'literal opposite role inside name and independent owner',head:'Leverantör: North Customer Support AB\nLeverantörens organisationsnummer: 556016-0680',party:'North Customer Support AB',org:'5560160680',clean:true},
 {id:'unknown inline colon cannot be hidden inside explicit name',head:'Leverantör: North Customer Support AB Avsändare: Other Firm AB\nLeverantörens organisationsnummer: 556016-0680',party:null,org:'5560160680',clean:false},
 {id:'unowned identical valid duplicate never donates an owner',head:'Leverantör: North Customer Support AB\n\nAvsändare: Different Firm AB\nOrganisationsnummer: 556016-0680',party:'North Customer Support AB',org:null,clean:false},
 {id:'equal duplicate preserves an independently owned identity',head:'Leverantör: North Customer Support AB\nLeverantörens organisationsnummer: 556016-0680\n\nOrganisationsnummer: 556016-0680',party:'North Customer Support AB',org:'5560160680',clean:true},
 {id:'bad unowned occurrence before owned identity remains in census',head:'Organisationsnummer: 556016-0681\n\nLeverantör: North Customer Support AB\nLeverantörens organisationsnummer: 556016-0680',party:'North Customer Support AB',org:null,clean:false},
 {id:'different unowned occurrence after scalar boundary holds identity',head:'Leverantör: North Customer Support AB\nLeverantörens organisationsnummer: 556016-0680\nFakturadatum: 2026-06-03\nOrganisationsnummer: 559762-3114',party:'North Customer Support AB',org:null,clean:false},
];
for(const [engine,parse] of [['Node',nodeParse],['Sites',sitesParse]])for(const c of cases)test(engine+' independent '+c.id,()=>{
 const text='FAKTURA\n'+c.head+tail;
 const r=parse(text,{direction:'supplier',direction_confident:true,method:'pdf'});
 assert.equal(r.fields.party.value,c.party);assert.equal(r.fields.organization_number.value,c.org);
 assert.equal(r.details.recipient.organization_number,null);assert.equal(r.text_excerpt,text);
 if(c.clean){assert.deepEqual(r.issues,[]);assert.equal(r.level,'green');}else assert.notEqual(r.level,'green');
});
