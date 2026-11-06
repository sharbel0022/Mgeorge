// Post-diff additions, separately frozen before execution. Original failures
// remain unchanged; these inputs supply explicit local ownership correctly.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadInvoiceParsers} from '../../../test/helpers/load-invoice-parsers.mjs';
const root=resolve(process.env.ALIAS_REVIEW_ROOT||resolve(dirname(fileURLToPath(import.meta.url)),'../../..'));
const parsers=await loadInvoiceParsers(root);
const {reconstructOcrLayout}=await import(pathToFileURL(join(root,'sites/lib/ocr-layout.js')).href);
const context='FAKTURA\nSupplier: Syntetisk Nordverk AB\nSupplier organization number: 992000-0008\nInvoice number: SYN-72991\nInvoice date: 2027-02-04\nDue date: 2027-03-06\nNet amount: 800.00 SEK\nVAT: 200.00 SEK\nAmount due: 1000.00 SEK\nCurrency: SEK\n';
const options={direction:'supplier',direction_confident:true,method:'ocr',ocrConfidence:96};
function sample(label,value,gap='\n\n'){
  const lines=[label,value].map((text,index)=>{let x=12;const words=text.split(' ').map(text=>{const word={text,confidence:93,bbox:{x0:x,y0:20+index*42,x1:x+text.length*7,y1:40+index*42}};x=word.bbox.x1+7;return word;});return {text,words};});
  return {text:label+gap+value+'\n',blocks:[{paragraphs:[{lines}]}]};
}
function apply(input){
  const before=structuredClone(input),words=input.blocks[0].paragraphs[0].lines.flatMap(line=>line.words);
  const out=reconstructOcrLayout(input.text,input.blocks);
  assert.deepEqual(input,before);
  const after=out.blocks.flatMap(block=>block.paragraphs.flatMap(p=>p.lines.flatMap(line=>line.words)));
  assert.equal(after.length,words.length);assert.equal(new Set(after).size,words.length);assert.ok(after.every(word=>words.includes(word)));
  return out;
}
for(const[engine,parse]of Object.entries(parsers)){
  for(const label of ['Organization number:','Organisation number:'])test(`${engine} local owned ${label}`,()=>{
    const out=apply(sample(label,'992000-0008'));
    assert.equal(out.reconstructed,true);
    const result=parse(context+'Supplier: Syntetisk Nordverk AB\n'+out.text,options);
    assert.equal(result.fields.organization_number.value,'9920000008');
    assert.equal(result.details.supplier.organization_number,'9920000008');
    assert.equal(result.details.recipient.organization_number,null);
  });
  for(const label of ['Bill to','Fakturamottagare']){
    test(`${engine} printed recipient colon ${label}`,()=>{
      const input=sample(label+':','Syntetisk Sydhandel AB');
      const out=apply(input);assert.equal(out.reconstructed,true);
      const result=parse(context+out.text+'Customer organization number: 993000-0006\n',options);
      assert.equal(result.details.recipient.name,'Syntetisk Sydhandel AB');
      assert.equal(result.details.recipient.organization_number,'9930000006');
      assert.equal(result.fields.party.value,'Syntetisk Nordverk AB');
      assert.equal(result.fields.organization_number.value,'9920000008');
    });
    test(`${engine} original colonless recipient ${label}`,()=>{
      const input=sample(label,'Syntetisk Sydhandel AB','\n');
      const before=parse(context+input.text,options),out=apply(input),after=parse(context+out.text,options);
      assert.equal(before.details.recipient.name,'Syntetisk Sydhandel AB');
      assert.equal(out.reconstructed,false);assert.equal(out.text,input.text);
      assert.deepEqual(after.details,before.details);assert.deepEqual(after.fields,before.fields);
    });
  }
  test(`${engine} layout organization stays in foreign local party`,()=>{
    const out=apply(sample('Organization number:','993000-0006'));
    assert.equal(out.reconstructed,true);
    const result=parse(context+'Bill to: Syntetisk Sydhandel AB\n'+out.text,options);
    assert.equal(result.details.recipient.organization_number,'9930000006');
    assert.equal(result.details.supplier.organization_number,'9920000008');
    assert.equal(result.fields.organization_number.value,'9920000008');
  });
}
