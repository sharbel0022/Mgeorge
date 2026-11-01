import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCAMT,parseCSV,normalizeBankApiTransaction} from '../src/importers.js';
import {parseBankgiroXML,parseBankgiroCSV} from '../sites/lib/bankgiro-parser.js';
import {corpus,account} from './payer-ocr-corpus.js';
import {apiPayerEvidence,normalizePayerEvidence,payerEvidenceConflict} from '../sites/lib/payer-evidence.js';
import {analyzeReconciliation} from '../src/reconciliation.js';
import {openDatabase,storeTransactions,listTransactions} from '../src/db.js';
import {bankFinancialReview} from '../src/bank-evidence.js';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
const sample=id=>corpus.find(c=>c.id===id).input;
for(const [name,parse,payer,org,evidence]of [
 ['Node',parseCAMT,r=>r.payer,r=>r.payer_organization_number,r=>r.payer_evidence],
 ['Sites',parseBankgiroXML,r=>r.party,r=>r.organizationNumber,r=>r.payerEvidence],
]){
 test(name+' preserves actual debtor role, exact raw name and indexed XML path',()=>{
  const input=sample('01-correct').replace('Syntetisk Kund AB','  Syntetisk Kund AB  '),r=parse(input)[0],e=evidence(r);
  assert.equal(payer(r),'Syntetisk Kund AB');assert.equal(e?.role,'debtor');
  assert.equal(e?.name?.rawValue,'  Syntetisk Kund AB  ');assert.match(e?.name?.source||'',/Ntfctn\[0\].*TxDtls\[0\].*Dbtr\[0\]\/Nm\[0\]$/);
  assert.equal(e?.scope,'individual');assert.equal(e?.origin,'bank_original');
 });
 test(name+' separates COID organisation numbers, customer identifiers and BIC',()=>{
  assert.equal(org(parse(sample('09-org-coid').replace('</Othr>','<Issr>SE</Issr></Othr>'))[0]),'5560000001');
  for(const id of ['10-bic-is-not-org','11-customer-id-not-org','12-unknown-id-not-org']){
   const r=parse(sample(id))[0];assert.equal(org(r)||'','');assert.ok(evidence(r)?.identifiers.length);
  }
 });
 test(name+' preserves repeated IDs and blocks contradictory organisation identity',()=>{
  const input=sample('09-org-coid').replace('</Othr>','</Othr><Othr><Id>5560000002</Id><SchmeNm><Cd>COID</Cd></SchmeNm></Othr>');
  const r=parse(input)[0];assert.equal(org(r)||'','');assert.equal(evidence(r)?.conflict,true);assert.equal(evidence(r)?.identifiers.length,2);
 });
 test(name+' retains postal address and never substitutes ultimate debtor or creditor',()=>{
  const r=parse(sample('01-correct').replace('</Dbtr>','<PstlAdr><Ctry>SE</Ctry><AdrLine>  Testgatan 1  </AdrLine></PstlAdr></Dbtr>'))[0];
  assert.equal(evidence(r)?.address?.fields.find(f=>f.source.endsWith('/AdrLine[0]'))?.rawValue,'  Testgatan 1  ');
  for(const id of ['14-ultimate-is-not-payer','17-foreign-name-not-payer'])assert.equal(payer(parse(sample(id))[0]),'');
 });
}
test('API debtor evidence keeps scheme and raw name without treating customer ID as organisation number',()=>{
 const base=sample('23-api-sebg');
 const r=normalizeBankApiTransaction({...base,debtor:{name:'  Syntetisk Kund AB  ',organisation_id:{identification:'556000-0001',scheme_name:'COID',issuer:'SE'}}},account);
 assert.equal(r.payer_organization_number,'5560000001');assert.equal(r.payer_evidence.name.rawValue,'  Syntetisk Kund AB  ');assert.equal(r.payer_evidence.name.source,'$.debtor.name');
 const other=normalizeBankApiTransaction({...base,debtor:{name:'Test',organisation_id:{identification:'1234567890',scheme_name:'CUST'}}},account);assert.equal(other.payer_organization_number,'');
});
test('both CSV importers preserve payer raw field, multiple typed reference columns and zeros',()=>{
 const input=sample('21-csv-both').replace('Syntetisk Kund AB','  Syntetisk Kund AB  ');
 for(const r of [parseCSV(input,account)[0],parseBankgiroCSV(input)[0]]){
  const e=r.payer_evidence||r.payerEvidence,refs=r.reference_evidence||r.referenceEvidence;
  assert.equal(e?.name?.rawValue,'  Syntetisk Kund AB  ');assert.ok(refs?.candidates.some(c=>c.kind==='ocr'&&c.value==='000018'));assert.ok(refs?.candidates.some(c=>c.kind==='invoice'&&c.value==='0594'));
 }
});
test('identifier source positions include skipped fields and malformed competing COID stays a conflict',()=>{
 const e=apiPayerEvidence({debtor:{organisation_id:[{}, {identification:'5560000001',scheme_name:'COID',issuer:'SE'}]}});
 assert.equal(e.identifiers[0].source,'$.debtor.organisation_id[1].identification');
 assert.equal(normalizePayerEvidence({identifiers:[{value:'5560000001',scheme:'COID',kind:'organization',issuer:'SE'},{value:'INVALID',scheme:'COID',kind:'organization',issuer:'SE'}]}).conflict,true);
});
test('payer conflicts cannot fall back to name and auto-match a bank payment',()=>{
 const r=normalizeBankApiTransaction({...sample('23-api-sebg'),debtor:{name:'Syntetisk Kund AB',organisation_id:[{identification:'5560000001',scheme_name:'COID',issuer:'SE'},{identification:'5560000002',scheme_name:'COID',issuer:'SE'}]}},account);
 const result=analyzeReconciliation({invoices:[{id:'i',invoice_number:'0594',reference:'000018',party:'Syntetisk Kund AB',direction:'customer',kind:'invoice',currency:'SEK',remaining_cents:62500}],transactions:[{...r,id:'t',verified:true,available_cents:62500}]});
 assert.equal(result.length,1);assert.equal(result[0].safe,false);assert.match(result[0].reason,/organisationsidentifierare/);
});
test('mixed direct and wrapped ISO payer identities fail closed',()=>{
 const input=sample('09-org-coid').replace('<Nm>Syntetisk Kund AB</Nm>','<Pty><Nm>Syntetisk Kund AB</Nm></Pty>');
 assert.throws(()=>parseCAMT(input),/tvetyd|blandad/i);assert.throws(()=>parseBankgiroXML(input),/tvetyd|blandad/i);
});
test('a stronger reversal reason survives a conflicting payer, including inheritance',()=>{
 const review=bankFinancialReview({description:'Payment reversal',payer_evidence:{conflict:true}});
 assert.equal(review.kind,'reversal');assert.equal(bankFinancialReview({ancestor_bank_financial_reviews:[review]}).kind,'reversal');
});
test('typed payer evidence survives SQLite and changed customer IDs retain a durable conflict',()=>{
 const folder=mkdtempSync(join(tmpdir(),'mg-payer-evidence-')),db=openDatabase(join(folder,'test.sqlite'));try{
  const raw=sample('23-api-sebg'),row=id=>normalizeBankApiTransaction({...raw,debtor:{name:'Syntetisk Kund AB',organisation_id:{identification:id,scheme_name:'CUST'}}},account);
  storeTransactions(db,[row('CUSTOMER-1')],'enablebanking');const before=listTransactions(db)[0];
  assert.equal(before.payer_evidence.identifiers[0].rawValue,'CUSTOMER-1');
  storeTransactions(db,[row('CUSTOMER-2')],'enablebanking');const after=listTransactions(db)[0];
  assert.equal(after.payer_evidence.identifiers[0].value,'CUSTOMER-1');assert.equal(listTransactions(db).length,1);assert.ok(after.bank_evidence_conflicts.some(c=>c.fields.includes('payer_evidence')));
 }finally{db.close();rmSync(folder,{recursive:true,force:true});}
});
test('multiple bank identifiers compare as sets on identical replay',()=>{
 const e=normalizePayerEvidence({identifiers:['A','B'].map(value=>({value,kind:'customer',scheme:'CUST',issuer:'SE'}))});
 assert.equal(e.conflict,false);assert.equal(payerEvidenceConflict(e,structuredClone(e)),false);
 assert.equal(payerEvidenceConflict(e,{...e,identifiers:[...e.identifiers].reverse()}),false);
 assert.equal(payerEvidenceConflict(e,{...e,identifiers:[{...e.identifiers[0],value:'C'}]}),true);
});
test('foreign or unscoped national company ID cannot override an unrelated invoice customer',()=>{
 const raw={...sample('23-api-sebg'),debtor:{name:'Unrelated foreign company',postal_address:{country:'GB'},organisation_id:{identification:'5560000001',scheme_name:'COID'}}};
 const r=normalizeBankApiTransaction(raw,account);assert.equal(r.payer_organization_number,'');
 const findings=analyzeReconciliation({invoices:[{id:'i',invoice_number:'0594',reference:'000018',party:'Swedish invoice customer',organization_number:'5560000001',direction:'customer',kind:'invoice',currency:'SEK',remaining_cents:62500}],transactions:[{...r,id:'t',verified:true,available_cents:62500}]});
 assert.ok(findings.every(f=>!f.safe));assert.equal(r.payer_evidence.identifiers[0].rawValue,'5560000001');
});
test('a payer conflict inherited from a completed bank aggregate remains a hard financial hold',()=>{
 const review=bankFinancialReview({payer_evidence:{conflict:true}});assert.equal(review.kind,'payer_conflict');
 assert.equal(bankFinancialReview({ancestor_bank_financial_reviews:[review]}).kind,'payer_conflict');
});
