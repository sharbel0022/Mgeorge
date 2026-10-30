import {syntheticBankRow} from './helpers/bank-api-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {emptyState,applyCommand,paid,balance} from '../lib/domain.ts';

const url=path=>new URL(path,import.meta.url).href;
function compiled(path,imports){
 let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const [key,value]of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+key+quote,JSON.stringify(value));
 return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
}
const domain=url('../lib/domain.ts'),reconciliation=compiled('../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':url('../lib/reconciliation-engine.js')});
const {default:InvoiceEvidence}=await import(compiled('../components/invoice-evidence.tsx',{'@/lib/domain':domain,'@/lib/reconciliation':reconciliation,...Object.fromEntries(['react','react/jsx-runtime','lucide-react'].map(name=>[name,import.meta.resolve(name)]))}));
function checkedState(){
 let state=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',number:'SYN-1',ocr:'000018',total:62500,issued:'2026-10-01',due:'2026-10-20',reviewed:true}}).state;
 state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({date:'2026-10-26',amount:10000,party:'Unrelated synthetic sender',payerReference:'OTHER-REF',bankReference:'Q8-UI-BANK',externalId:'Q8-UI-BANK',account:'Synthetic account',source:'Enable Banking · Synthetic'})]}).state;
 return applyCommand(state,{type:'invoice.reconcile',id:state.invoices[0].id,confirm:true,note:'Synthetic account-period review.'}).state;
}
const render=state=>renderToStaticMarkup(React.createElement(InvoiceEvidence,{state,invoice:state.invoices[0],demo:true,onMessage(){throw Error('No action during rendering.');},openTransaction(){throw Error('No action during rendering.');}}));
test('Q8 absence UI: an intact explicit absence check does not display the unverified-absence caution',()=>{
 const state=checkedState();assert.doesNotMatch(render(state),/Detta bevisar inte att fakturan är obetald/);
});
for(const compact of [false,true])test(`Q8 absence UI: ${compact?'compact hold':'retained conflict'} displays the caution despite a prior absence timestamp`,()=>{
 let state=checkedState();
 if(compact)state.bankEvidenceHold={at:'2026-10-30T00:00:00.000Z',auditEventId:'synthetic-audit',fingerprint:'a'.repeat(64)};
 else state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({...state.transactions[0],party:'Contradictory synthetic sender'})]}).state;
 const before=structuredClone(state);assert.match(render(state),/Detta bevisar inte att fakturan är obetald/);assert.deepEqual(state,before);
});
for(const compact of [false,true])test(`Q8 payment proof UI: ${compact?'compact hold':'retained conflict'} withholds a verified VAT-payment claim while retaining the allocation`,()=>{
 let state=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',number:'SYN-VAT',ocr:'000018',total:312500,vat:62500,net:250000,issued:'2026-10-01',due:'2026-10-20',reviewed:true}}).state;
 state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({date:'2026-10-26',amount:250000,party:'Synthetic customer AB',payerReference:'000018',bankReference:'Q8-UI-BANK',externalId:'Q8-UI-BANK',account:'Synthetic account',source:'Enable Banking · Synthetic'})]}).state;
 state=applyCommand(state,{type:'match.create',invoiceId:state.invoices[0].id,transactionId:state.transactions[0].id,amount:250000,note:'Synthetic exact reference and payer check.'}).state;
 assert.match(render(state),/Verifierat betalt är/);
 if(compact)state.bankEvidenceHold={at:'2026-10-30T00:00:00.000Z',auditEventId:'synthetic-audit',fingerprint:'a'.repeat(64)};
 else state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({...state.transactions[0],party:'Contradictory synthetic sender'})]}).state;
 const before=structuredClone(state),html=render(state);assert.doesNotMatch(html,/Verifierat betalt är/);assert.match(html,/motstridiga/);assert.equal(paid(state,state.invoices[0].id),250000);assert.equal(balance(state,state.invoices[0]),62500);assert.deepEqual(state,before);
});
