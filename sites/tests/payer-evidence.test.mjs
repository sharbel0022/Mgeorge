import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
import {emptyState,applyCommand,paymentOriginalIssue,parseMoney} from '../lib/domain.ts';
import {parseBankgiroXML} from '../lib/bankgiro-parser.js';
import {syntheticCamt} from './helpers/camt-integrity.mjs';
const url=p=>new URL(p,import.meta.url).href;
function compiled(path,imports){let code=stripTypeScriptTypes(readFileSync(new URL(path,import.meta.url),'utf8'),{mode:'transform'});for(const [name,target]of Object.entries(imports))for(const q of ['"',"\x27"])code=code.replaceAll(q+name+q,JSON.stringify(target));return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');}
const domain=url('../lib/domain.ts');
const {normalizeTransactions}=await import(compiled('../lib/banking/transactions.ts',{'../domain':domain,'../payment-references.js':url('../lib/payment-references.js'),'../payer-evidence.js':url('../lib/payer-evidence.js')}));
const {analyze}=await import(compiled('../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':url('../lib/reconciliation-engine.js')}));
const account='iban:SE4280000890119146168423',raw=debtor=>({status:'BOOK',booking_date:'2026-10-26',credit_debit_indicator:'CRDT',transaction_amount:{amount:'625.00',currency:'SEK'},entry_reference:'SYNTHETIC-PAYER',reference_number:'000018',reference_number_schema:'SEBG',debtor});
async function imported(debtor){const normalized=await normalizeTransactions([raw(debtor)],{accountKey:account,accountLabel:'Synthetic',bankName:'Synthetic',dateFrom:'2026-10-01',dateTo:'2026-10-31'});return applyCommand(emptyState(),{type:'transactions.import',trustedBankImport:true,rows:normalized.rows}).state;}
test('API typed payer facts survive import and cannot be changed behind the bank original',async()=>{
 const s=await imported({name:'  Synthetic payer AB  ',organisation_id:{identification:'556000-0001',scheme_name:'COID',issuer:'SE'}}),t=s.transactions[0];
 assert.equal(t.payerEvidence.name.rawValue,'  Synthetic payer AB  ');assert.equal(t.organizationNumber,'5560000001');assert.equal(paymentOriginalIssue(s,t),'');
 t.payerEvidence.name.rawValue='Other';assert.match(paymentOriginalIssue(s,t),/stämmer inte/);
});
test('foreign unscoped organization cannot identify an unrelated customer',async()=>{
 let s=await imported({name:'Foreign company',postal_address:{country:'GB'},organisation_id:{identification:'5560000001',scheme_name:'COID'}});
 s=applyCommand(s,{type:'invoice.save',invoice:{direction:'receivable',party:'Swedish invoice customer',number:'0594',ocr:'000018',organizationNumber:'5560000001',total:62500,issued:'2026-10-01',reviewed:true}}).state;
 assert.equal(s.transactions[0].organizationNumber,'');assert.ok(analyze(s).every(f=>!f.safe));
});
test('conflicting bank payer IDs remain a hold despite matching name and OCR',async()=>{
 const s=await imported({name:'Synthetic payer AB',organisation_id:[{identification:'5560000001',scheme_name:'COID',issuer:'SE'},{identification:'5560000002',scheme_name:'COID',issuer:'SE'}]});
 assert.match(paymentOriginalIssue(s,s.transactions[0]),/motstridiga organisationsidentifierare/);
});
test('actual ISO importer keeps transaction-indexed reference path and exact whitespace',()=>{
 const [r]=parseBankgiroXML(syntheticCamt.replace('000018</Ref>','  000018  </Ref>'));
 const c=r.referenceEvidence.candidates.find(c=>c.kind==='ocr');assert.match(c.source,/Ntfctn\[0\].*Ntry\[0\].*TxDtls\[0\].*CdtrRefInf/);assert.equal(c.rawValue,'  000018  ');
});
test('Unicode minus stays supported after evidence changes',()=>{assert.equal(parseMoney('−625,00'),-62500);});
