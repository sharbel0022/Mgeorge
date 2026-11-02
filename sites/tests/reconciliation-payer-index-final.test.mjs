import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {analyzeReconciliation} from '../lib/reconciliation-engine.js';
import {emptyState,balance} from '../lib/domain.ts';
import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';
import {payerIndexContracts} from '../../test/helpers/reconciliation-payer-index.mjs';
payerIndexContracts(test,analyzeReconciliation);

let source=stripTypeScriptTypes(readFileSync(new URL('../lib/reconciliation.ts',import.meta.url),'utf8'),{mode:'transform'});
for(const [name,path]of [['./domain','../lib/domain.ts'],['./reconciliation-engine.js','../lib/reconciliation-engine.js']])source=source.replaceAll("'"+name+"'",JSON.stringify(new URL(path,import.meta.url).href));
const {analyze,reconcileState}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const learnedState=()=>{
 const state=emptyState();
 state.invoices=['SYN-17','SYN-18'].map((id,k)=>({id,direction:'receivable',party:'Invoice Owner',email:'',number:id,ocr:id,total:10000+k,currency:'SEK',issued:'2026-01-01',due:'2026-10-30',reviewed:true,voided:false,note:'',bankgiro:'',documentId:'',source:'synthetic',createdAt:'2026-10-01T00:00:00Z'}));
 state.transactions=state.invoices.map(i=>syntheticBankTransaction({id:i.id,amount:i.total,party:'External Payer',payerReference:i.ocr,date:'2026-10-01',kind:'payment',verified:true,bankReference:i.id}));
 state.allocations=[{id:'learned',invoiceId:'SYN-17',transactionId:'SYN-17',amount:10000,effect:'payment',active:true,createdAt:'2026-10-01T00:00:00Z',note:'Synthetic confirmed customer relation'}];
 return state;
};
test('domain reanalysis learns the current allocation and pays the later invoice once',()=>{
 const state=learnedState(),before=structuredClone(state),result=reconcileState(state);
 assert.equal(result.state.allocations.length,2);assert.ok(result.state.invoices.every(i=>balance(result.state,i)===0));
 assert.equal(reconcileState(result.state).state.allocations.length,2);
 assert.deepEqual(state,before);assert.deepEqual(result.state.transactions,state.transactions);
});
test('revoked allocation and changed retained original cannot supply a learned payer link',()=>{
 for(const revoke of [s=>s.allocations[0].active=false,s=>s.transactions[0].bankData.debtor.name='Changed retained original']){
  const state=learnedState();revoke(state);const before=structuredClone(state);
  assert.equal(analyze(state).find(f=>f.invoice_id==='SYN-18').safe,false);
  const result=reconcileState(state);assert.equal(balance(result.state,result.state.invoices[1]),10001);
  assert.deepEqual(state,before);assert.deepEqual(result.state.transactions,state.transactions);
 }
});
