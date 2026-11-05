import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {applyCommand,balance,paid,demoState,today,money} from '../lib/domain.ts';
import {genericCompanyState} from './helpers/reference-policy-fixture.mjs';
import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';
import {economySummary} from '../lib/economy-summary.js';

const file=path=>new URL(path,import.meta.url).href;
function compiled(path,imports={}){
  let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const aliases={'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'lucide-react':import.meta.resolve('lucide-react'),'@/lib/domain':file('../lib/domain.ts'),'./domain':file('../lib/domain.ts'),'./reconciliation-engine.js':file('../lib/reconciliation-engine.js'),'./payment-references.js':file('../lib/payment-references.js'),'@/lib/economy-summary.js':file('../lib/economy-summary.js'),...imports};
  for(const [name,url]of Object.entries(aliases))for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(url));
  return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
}
const {bankPaymentView}=await import(compiled('../lib/payment-presentation.ts'));
const {default:Overview}=await import(compiled('../components/economy-overview.tsx',{'./payment-control':compiled('../components/payment-control.tsx')}));
const noAction=()=>{throw Error('Reading the overview must not navigate, book or run controls');};
const at=today();

function booked({party='Bank payer AB',reference='00599',documentId='synthetic-invoice-original',reviewed=true,account='synthetic-account'}={}){
  const state=applyCommand(genericCompanyState(),{type:'invoice.save',invoice:{direction:'receivable',number:'00599',ocr:'00599',party:'Synthetic invoice customer AB',total:10000,issued:'2026-01-01',due:at,reviewed,documentId}}).state;
  state.transactions.push(syntheticBankTransaction({id:'synthetic-payment',date:at,amount:10000,party,payerReference:reference,account,kind:'payment',verified:true}));
  state.allocations.push({id:'synthetic-historical-allocation',invoiceId:state.invoices[0].id,transactionId:'synthetic-payment',amount:10000,effect:'payment',active:true,note:'Preserved historical decision',createdAt:at+'T00:00:00Z'});
  return state;
}
function held(state){
  const before=structuredClone(state),invoice=state.invoices[0],beforePaid=paid(state,invoice.id),beforeBalance=balance(state,invoice),summary=economySummary(state,at);
  assert.notEqual(bankPaymentView(state,state.transactions[0]).decision.code,'VERIFIED','The overview must not outrank the detail evidence decision');
  assert.equal(summary.valid,true);assert.equal(summary.received_month_cents,0);assert.equal(summary.refunded_month_cents,0);
  assert.equal(summary.unverified_allocation_count,1);assert.deepEqual(summary.recent_payments,[]);
  assert.equal(summary.remaining_cents,Math.max(0,beforeBalance));assert.equal(paid(state,invoice.id),beforePaid);assert.equal(balance(state,invoice),beforeBalance);
  assert.deepEqual(state,before,'Reading the summary cannot change original facts, allocations or balances');
  return summary;
}
function render(state,summary,demo){
  const data={economy:summary,counts:{processing:0,review:0},connections:{gmail:{},bank:{}},queue:[],run:null};
  return renderToStaticMarkup(React.createElement(Overview,{state,data,loading:false,error:'',demo,signedIn:!demo,busy:false,start:noAction,open:noAction,task:noAction,invoice:noAction,demoToggle:noAction}));
}

test('the real isolated demo keeps its booked money without claiming source-less verified receipts',()=>{
  const state=demoState(),before=structuredClone(state),summary=economySummary(state,at);
  assert.equal(state.allocations.filter(row=>row.active).reduce((sum,row)=>sum+row.amount,0),287500);
  for(const transaction of state.transactions.filter(row=>state.allocations.some(a=>a.active&&a.transactionId===row.id)))assert.notEqual(bankPaymentView(state,transaction).decision.code,'VERIFIED');
  assert.equal(summary.received_month_cents,0);assert.equal(summary.unverified_allocation_count,2);assert.deepEqual(summary.recent_payments,[]);
  assert.equal(summary.remaining_cents,state.invoices.filter(i=>i.direction==='receivable'&&i.reviewed&&!i.voided).reduce((sum,i)=>sum+Math.max(0,balance(state,i)),0));
  const html=render(state,summary,true);assert.doesNotMatch(html,/Verifierad betalningskoppling/);assert.match(html,/Äldre betalningskopplingar behöver verifieras/);assert.ok(html.includes('<span>Inbetalt denna månad</span><strong>'+money(0)+'</strong>'));
  assert.deepEqual(state,before);
});

for(const [name,options] of [
  ['missing bank payer',{party:''}],
  ['missing bank payment reference',{reference:''}],
  ['missing reviewed invoice original',{documentId:''}],
  ['invoice not reviewed',{reviewed:false}],
  ['missing receiving account',{account:''}],
])test('historical allocation stays booked while overview withholds verification: '+name,()=>held(booked(options)));

test('a legacy verified flag and typed original snapshot cannot manufacture bank provenance',()=>{
  const state=booked(),t=state.transactions[0];
  state.transactions[0]={id:t.id,date:t.date,amount:t.amount,currency:t.currency,account:t.account,party:t.party,payerReference:t.payerReference,kind:'payment',verified:true,evidence:'manual_verified',source:'Synthetic legacy import',original:{party:t.party,payerReference:t.payerReference},verification:{party:t.party,payerReference:t.payerReference,note:'Historical manual completion'}};
  held(state);
});

for(const demo of [false,true])test('overview rendering does not give historical missing evidence a verified badge: '+(demo?'demo':'signed in'),()=>{
  const state=booked({party:'',reference:'',documentId:''}),before=structuredClone(state),summary=economySummary(state,at),html=render(state,summary,demo);
  assert.doesNotMatch(html,/Verifierad betalningskoppling/);assert.match(html,/Äldre betalningskopplingar behöver verifieras/);
  assert.ok(html.includes('<span>Inbetalt denna månad</span><strong>'+money(0)+'</strong>'));assert.deepEqual(state,before);assert.equal(paid(state,state.invoices[0].id),10000);
});

test('complete saved bank facts and reviewed invoice original retain the verified receipt and exact source labels',()=>{
  const state=booked(),before=structuredClone(state),summary=economySummary(state,at);
  assert.equal(bankPaymentView(state,state.transactions[0]).decision.code,'VERIFIED');
  assert.equal(summary.received_month_cents,10000);assert.equal(summary.unverified_allocation_count,0);assert.equal(summary.remaining_cents,0);
  assert.equal(summary.recent_payments.length,1);assert.equal(summary.recent_payments[0].payer,'Bank payer AB');assert.equal(summary.recent_payments[0].customer,'Synthetic invoice customer AB');assert.equal(summary.recent_payments[0].reference,'00599');
  for(const demo of [false,true]){const html=render(state,summary,demo);assert.match(html,/Verifierad betalningskoppling/);assert.ok(html.includes('<span>Inbetalt denna månad</span><strong>'+money(10000)+'</strong>'));}
  assert.deepEqual(state,before);
});
