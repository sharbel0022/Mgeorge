// Existing explicit recipient labels also delimit a preceding scalar value.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadInvoiceParsers} from './helpers/load-invoice-parsers.mjs';
const parsers=await loadInvoiceParsers();
const prefix='INVOICE\nSupplier: Synthetic Cobalt AB\nSupplier organization number: 556016-0680\nInvoice number: SIBLING-839\nIssue date: 2027-02-12\nDue date: 2027-03-12\nNet amount: 800.00 SEK\nVAT amount: 200.00 SEK\n';
const options={direction:'supplier',direction_confident:true,method:'ocr',ocrConfidence:99};
for(const[engine,parse]of Object.entries(parsers)){
  const read=tail=>parse(prefix+tail,options);
  for(const label of ['Bill to','Fakturamottagare']){
    test(engine+' original recipient colon bounds the preceding amount: '+label,()=>{
      const tail='Amount due: 1 000.00 SEK '+label+': Synthetic Buyer AB',r=read(tail);
      assert.equal(r.fields.total_cents.value,100000);assert.equal(r.details.recipient.name,'Synthetic Buyer AB');
      assert.equal(r.fields.party.value,'Synthetic Cobalt AB');assert.equal(r.fields.organization_number.value,'5560160680');
      assert.equal(r.text_excerpt,prefix+tail);assert.notEqual(r.level,'green');
    });
    test(engine+' a recipient alias without its original colon cannot truncate the amount: '+label,()=>{
      const r=read('Amount due: 1 000.00 SEK '+label+' Synthetic Buyer AB');
      assert.equal(r.fields.total_cents.value,null);assert.notEqual(r.level,'green');
    });
    test(engine+' unknown amount suffix before a recipient label is retained: '+label,()=>{
      const r=read('Amount due: 1 000.00 SEK unknown '+label+': Synthetic Buyer AB');
      assert.equal(r.fields.total_cents.value,null);assert.notEqual(r.level,'green');
    });
    test(engine+' an unowned organization after the recipient boundary remains unassigned: '+label,()=>{
      const r=read('Amount due: 1 000.00 SEK '+label+': Synthetic Buyer AB\n\nOrganization number: 556016-0789');
      assert.equal(r.fields.organization_number.value,null);assert.equal(r.details.recipient.organization_number,null);
    });
  }
  for(const label of ['ReBill to','Ref/Bill to','Bill to account','Fakturamottagaren','Ref/Fakturamottagare','Fakturamottagare account'])test(engine+' longer recipient label cannot truncate the amount: '+label,()=>{
    const r=read('Amount due: 1 000.00 SEK '+label+': Synthetic Buyer AB');
    assert.equal(r.fields.total_cents.value,null);assert.notEqual(r.level,'green');
  });
}
