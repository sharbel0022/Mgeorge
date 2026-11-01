import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,applyCommand,balance} from '../lib/domain.ts';
import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';

function fixture(direction='receivable'){
  return applyCommand(emptyState(),{type:'invoice.save',invoice:{direction,party:'Synthetic customer AB',number:'SYN-1',ocr:'000018',total:62500,issued:'2026-10-01',due:'2026-10-30',reviewed:true}}).state;
}
function addPayment(state,description,amount=62500){
  state.transactions.push(syntheticBankTransaction({id:'payment-'+state.transactions.length,party:'Synthetic customer AB',payerReference:'000018',bankReference:'SYNTHETIC-BANK-'+state.transactions.length,amount,kind:'payment',verified:true,description}));
  return state.transactions.at(-1).id;
}
const match=(state,transactionId,effect='payment',amount=62500)=>applyCommand(state,{type:'match.create',invoiceId:state.invoices[0].id,transactionId,amount,effect,note:'Checked the retained synthetic bank original'}).state;

for(const description of ['Reversal','Återföring','Refund','Återbetalning'])for(const direction of ['receivable','payable'])test(`${description} cannot manually pay an ordinary ${direction} invoice`,()=>{
  const state=fixture(direction),id=addPayment(state,description,direction==='receivable'?62500:-62500),before=structuredClone(state);
  assert.throws(()=>match(state,id),/återbetal|återför/i);
  assert.deepEqual(state,before);assert.equal(balance(state,state.invoices[0]),62500);
});

test('an explicit refund can settle an existing credit without treating it as an ordinary payment',()=>{
  let state=fixture(),id=addPayment(state,'Kontoöverföring');state=match(state,id);
  state=applyCommand(state,{type:'credit.add',invoiceId:state.invoices[0].id,amount:10000,number:'SYN-CREDIT-1',date:'2026-10-26',note:'Synthetic return'}).state;
  assert.equal(balance(state,state.invoices[0]),-10000);
  id=addPayment(state,'Refund',-10000);state=match(state,id,'refund',10000);
  assert.equal(balance(state,state.invoices[0]),0);assert.equal(state.allocations.at(-1).effect,'refund');
});

test('an explicit reversal cannot masquerade as a refund of a credit',()=>{
  let state=fixture(),id=addPayment(state,'Kontoöverföring');state=match(state,id);
  state=applyCommand(state,{type:'credit.add',invoiceId:state.invoices[0].id,amount:10000,number:'SYN-CREDIT-1',date:'2026-10-26',note:'Synthetic return'}).state;
  id=addPayment(state,'Reversal',-10000);assert.throws(()=>match(state,id,'refund',10000),/återför/i);
  assert.equal(balance(state,state.invoices[0]),-10000);
});

test('a manually split payment inherits the original collection reversal restriction',()=>{
  let state=fixture();state.transactions.push(syntheticBankTransaction({id:'parent',party:'',payerReference:'',bankReference:'SYNTHETIC-COLLECTION',amount:62500,kind:'batch',verified:false,description:'Bankgiro reversal'}));
  state=applyCommand(state,{type:'transaction.split',id:'parent',rows:[{amount:62500,party:'Synthetic customer AB',payerReference:'000018'}]}).state;
  assert.throws(()=>match(state,state.transactions[1].id),/återför/i);assert.equal(balance(state,state.invoices[0]),62500);
});
