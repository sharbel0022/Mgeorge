import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {emptyState,applyCommand,economicTransactions,balance} from '../lib/domain.ts';
import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';

const url=p=>new URL(p,import.meta.url).href;
function compiled(path,imports={}){
 let text=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const [name,target] of Object.entries({'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'./domain':url('../lib/domain.ts'),'@/lib/domain':url('../lib/domain.ts'),'./reconciliation-engine.js':url('../lib/reconciliation-engine.js'),'./payment-references.js':url('../lib/payment-references.js'),...imports}))for(const q of ['"',"'"])text=text.replaceAll(q+name+q,JSON.stringify(target));
 return 'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
}
const presentation=compiled('../lib/payment-presentation.ts'),view=await import(presentation);
const ui=await import(compiled('../components/bank-payments.tsx',{'@/lib/payment-presentation':presentation}));
const detail=await import(compiled('../components/bankgiro-link-review.tsx',{'react':import.meta.resolve('react')}));
function fixture(){
 const state=emptyState();
 const target=syntheticBankTransaction({id:'ais',amount:62500,date:'2026-10-26',account:'iban:SE3550000000054910000003',bankReference:'SYNTHETIC-DEPOSIT',description:'Bankgiro inbetalning',party:'',payerReference:'',kind:'batch'});
 const proof={version:'bank-file-original-v1',documentId:'xlsx-doc',sha256:'a'.repeat(64)};
 const report={id:'spec',date:target.date,amount:62500,currency:'SEK',party:'Syntetiska Bistro AB',payerReference:'0599',bankReference:'',description:'',account:target.account,kind:'payment',source:'Bankgiro Excel',externalId:'',verified:false,evidence:'bankgiro_file',duplicateOf:'',ignored:false,parentId:'',importId:'xlsx-import',createdAt:'',specification:true,specificationStatus:'review',specificationGroup:'synthetic-report',specificationCount:1,specificationTotal:62500,bankFileProof:proof,reportEvidence:{paymentCount:'1',totalCents:'62500'},recipientAccount:target.account};
 report.original=Object.fromEntries(['party','payerReference','description','amount','date','account','bankReference'].map(key=>[key,report[key]]));
 state.transactions.push(target,report);state.imports.push({id:'xlsx-import',hash:proof.sha256,documentId:proof.documentId,name:'Synthetic.xlsx',count:1,account:'Bankgiro',createdAt:''});
 state.invoices.push({id:'invoice',number:'0599',party:'Annan syntetisk kund AB',ocr:'',total:62500,currency:'SEK',direction:'receivable',issued:'2026-10-01',due:'2026-11-01',reviewed:true,voided:false});
 return {state,target,report};
}
test('unlinked report is labelled as non-economic review evidence and possible relation',()=>{
 const {state,target,report}=fixture();
 const html=renderToStaticMarkup(React.createElement(ui.default,{state,transactions:view.bankVisibleTransactions(state),open(){}}));
 assert.match(html,/Möjlig tillhörande Bankgirospecifikation/);
 assert.match(html,/Granskningsunderlag.*räknas inte/s);
 assert.equal(view.bankVisibleTransactions(state).length,2);assert.equal(economicTransactions(state).length,1);
 assert.equal(view.bankPaymentView(state,target).payer,'Betalare okänd');assert.equal(report.specificationStatus,'review');
});
test('review candidates apply only to incoming AIS rows with corresponding whole report amount and nearby date',()=>{
 const {state,target,report}=fixture();
 for(const other of [{...target,amount:-62500},{...target,amount:62600},{...target,date:'2026-09-26'},{...target,source:'Manuellt registrerad',evidence:'manual_verified',bankData:undefined,bankDataVersion:undefined,bankDataSha256:undefined},report]){
  const html=renderToStaticMarkup(React.createElement(detail.default,{state,transaction:other,busy:false,error:'',save(){}}));assert.equal(html,'');
 }
});
test('a legacy AIS source still shows the relevant blocked report candidate without an invented receipt',()=>{
 const {state,target}=fixture();delete target.evidence;delete target.bankDataSha256;delete target.bankDataVersion;
 const actual=view.bankPaymentView(state,target);assert.match(actual.candidateNote,/Möjlig tillhörande/);
 const html=renderToStaticMarkup(React.createElement(detail.default,{state,transaction:target,busy:false,error:'',save(){}}));assert.match(html,/ankomstkvitto/);assert.match(html,/disabled=""[^>]*>Bekräfta underlagskoppling/);
});
test('manual relation presents one main row and separate generic reference without changing economic facts',()=>{
 const {state,target}=fixture(),before=JSON.stringify(state.transactions),beforeBalance=balance(state,state.invoices[0]);
 const next=applyCommand(state,{type:'bankgiro.link',transactionId:'ais',specificationId:'spec',note:'Båda syntetiska originalen och mottagarkontot kontrollerade.',confirmOriginals:true,confirmAccount:true}).state;
 assert.equal(view.bankVisibleTransactions(next).length,1);
 const actual=view.bankPaymentView(next,next.transactions[0]);assert.equal(actual.payer,'Syntetiska Bistro AB');assert.equal(actual.reference.value,'0599');assert.equal(actual.reference.ocr,'');assert.equal(actual.invoiceNumbers.length,0);assert.equal(actual.verified,false);assert.equal(actual.status,'Fakturan behöver granskas');
 const html=renderToStaticMarkup(React.createElement(ui.default,{state:next,transactions:view.bankVisibleTransactions(next),open(){}}));
 assert.match(html,/Swedbank \+ Bankgiro Excel/);assert.match(html,/Manuellt verifierad underlagskoppling/);assert.doesNotMatch(html,/Enligt bankunderlag/);
 assert.equal(JSON.stringify(next.transactions),before);assert.equal(economicTransactions(next).reduce((n,t)=>n+t.amount,0),62500);assert.equal(balance(next,next.invoices[0]),beforeBalance);assert.equal(next.allocations.length,0);
});
test('a stale source relation stays visible for revocation without hiding the report',()=>{
 const {state}=fixture(),next=applyCommand(state,{type:'bankgiro.link',transactionId:'ais',specificationId:'spec',note:'Synthetic original review',confirmOriginals:true,confirmAccount:true}).state;
 delete next.transactions[0].bankDataSha256;
 assert.equal(view.bankVisibleTransactions(next).length,2);
 const html=renderToStaticMarkup(React.createElement(detail.default,{state:next,transaction:next.transactions[0],busy:false,error:'',save(){throw Error('No writes on render');}}));
 assert.match(html,/Underlagskopplingen behöver granskas/);assert.match(html,/Återta underlagskoppling/);
});
test('a metadata relation preserves a justified paid status and verified payment count',()=>{
 const {state}=fixture();state.transactions[0]=syntheticBankTransaction({id:'ais',amount:62500,date:'2026-10-26',account:state.transactions[0].account,bankReference:'SYNTHETIC-PAID',party:'Syntetiska Bistro AB',payerReference:'0599',kind:'payment',verified:true});state.invoices[0].party='Syntetiska Bistro AB';state.allocations.push({id:'allocation',invoiceId:'invoice',transactionId:'ais',amount:62500,effect:'payment',active:true,note:'Previously checked',createdAt:''});
 const before=view.bankPaymentView(state,state.transactions[0]),next=applyCommand(state,{type:'bankgiro.link',transactionId:'ais',specificationId:'spec',note:'Separate original review',confirmOriginals:true,confirmAccount:true}).state,after=view.bankPaymentView(next,next.transactions[0]);
 assert.equal(before.status,'Verifierad');assert.equal(after.status,before.status);assert.equal(after.verified,true);assert.equal(view.bankPaymentCounts(next).verified,1);
});
