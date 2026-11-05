import test from 'node:test';
import assert from 'node:assert/strict';
import {reconciliationContractFixture} from './reconciliation-contract-cases.mjs';
import {buildReconciliationPreview,validateReconciliationApproval} from '../../sites/lib/reconciliation-contract.js';

export function manualFixture(amounts=[30001,43099]){
 const input=reconciliationContractFixture(),invoice=input.invoices[0],reference=input.transactions[0].references[0];
 input.invoices=amounts.map((totalMinor,index)=>({...structuredClone(invoice),id:`invoice-${index+1}`,number:`0004${index+2}`,totalMinor}));
 input.transactions[0].references=input.invoices.map(invoice=>({...reference,value:invoice.number,rawValue:invoice.number}));
 input.transactions[0].amountMinor=amounts.reduce((sum,value)=>sum+value,0);
 return input;
}
export const manualRequest=input=>({transactionId:input.transactions[0].id,allocations:input.invoices.map(invoice=>({invoiceId:invoice.id,amountMinor:invoice.totalMinor})),note:'Synthetic explicit review of every preserved bank and invoice original.'});

export function registerManualMultipleCases(label,api){
 const method=name=>{assert.equal(typeof api[name],'function',`${name} must implement the separate manual contract`);return api[name];};
 const plan=async(input,request=manualRequest(input))=>method('manualMultiplePlan')(input,await buildReconciliationPreview(input),request);
 test(`${label}: canonical binding keeps scalar, sentinel, array and object types distinct`,()=>{
  const values=[undefined,null,NaN,Infinity,-Infinity,0,-0,1,'1',true,'true',['undefined'],['nonfinite','NaN'],['number',1],[],{}, {value:undefined},{value:['undefined']}];
  const encoded=values.map(value=>method('canonicalManualValue')(value));assert.equal(new Set(encoded).size,values.length);
  assert.notEqual(method('canonicalManualValue')(Array(1)),method('canonicalManualValue')([undefined]));
 });
 test(`${label}: canonical binding rejects objects outside the data contract`,()=>{
  for(const value of [new Date(0),new Map(),()=>1,Symbol('synthetic'),1n,Object.defineProperty({},'hidden',{value:1}),{get dynamic(){return 1;}}])assert.throws(()=>method('canonicalManualValue')(value),{code:'MANUAL_INVALID_DATA'});
  assert.equal(method('canonicalManualValue')({b:2,a:1}),method('canonicalManualValue')({a:1,b:2}));
 });
 for(const amounts of [[30001,43099],[10001,20002,43097]])test(`${label}: complete ${amounts.length}-invoice odd-cent vector is an explicit manual plan, never a C4 approval`,async()=>{
  const input=manualFixture(amounts),before=structuredClone(input),preview=await buildReconciliationPreview(input);
  const value=method('manualMultiplePlan')(input,preview,manualRequest(input));
  assert.equal(value.mode,'manual_review');assert.equal(value.method,'manual_multiple');assert.equal(value.availableMinor,73100);assert.equal(value.allocatedMinor,73100);assert.equal(value.paymentRemainingMinor,0);
  assert.deepEqual(value.allocations.map(row=>row.amountMinor),amounts);assert.ok(value.allocations.every(row=>row.invoiceRemainingAfterMinor===0));
  assert.equal(preview.decisions[0].status,'REVIEW');assert.equal(preview.writesAllowed,false);
  const approval={contractVersion:preview.contractVersion,source:'stored_business_approval',ownerId:input.ownerId,approvedBy:'synthetic-reviewer',approved:true,requestId:'synthetic-manual-request',expiresAt:new Date(Date.parse(input.checkedAt)+1800000).toISOString(),snapshotSha256:preview.snapshot.sha256,revision:preview.snapshot.revision,decisions:[{transactionId:input.transactions[0].id,allocations:preview.decisions[0].allocations.map(({invoiceId,amountMinor,currency})=>({invoiceId,amountMinor,currency}))}]};
  const automatic=validateReconciliationApproval(preview,approval,{ownerId:input.ownerId,now:input.checkedAt,consumedRequestIds:[]});assert.equal(automatic.valid,false);assert.ok(automatic.reasonCodes.includes('DECISION_NOT_VERIFIED'));assert.deepEqual(input,before);
 });
 test(`${label}: underpayment consumes the entire payment and preserves each exact invoice remainder`,async()=>{
  const input=manualFixture();input.transactions[0].amountMinor=73100-100;
  const request=manualRequest(input);request.allocations[1].amountMinor-=100;
  const value=await plan(input,request);assert.equal(value.paymentRemainingMinor,0);assert.deepEqual(value.allocations.map(row=>row.invoiceRemainingAfterMinor),[0,100]);
 });
 test(`${label}: overpayment settles every referenced invoice and preserves excess bank money`,async()=>{
  const input=manualFixture();input.transactions[0].amountMinor+=101;
  const value=await plan(input);assert.equal(value.paymentRemainingMinor,101);assert.ok(value.allocations.every(row=>row.invoiceRemainingAfterMinor===0));
 });
 test(`${label}: leaving both bank money and invoice debt requires a different operation`,async()=>{
  const input=manualFixture(),request=manualRequest(input);request.allocations[1].amountMinor--;
  await assert.rejects(plan(input,request),{code:'MANUAL_BOTH_REMAINDERS'});
 });
 for(const [name,change]of [
  ['omitted referenced invoice',request=>request.allocations.pop()],
  ['duplicate invoice row',request=>request.allocations[1]={...request.allocations[0]}],
  ['unreferenced invoice',request=>request.allocations[1].invoiceId='foreign-invoice'],
  ['fractional minor unit',request=>request.allocations[0].amountMinor+=0.5],
  ['zero amount',request=>request.allocations[0].amountMinor=0],
  ['negative amount',request=>request.allocations[0].amountMinor=-1],
  ['amount above invoice debt',request=>{request.allocations[0].amountMinor++;request.allocations[1].amountMinor--;}],
  ['sum above payment',request=>request.allocations[1].amountMinor++],
  ['missing explicit note',request=>request.note=''],
 ])test(`${label}: rejects ${name} without changing inputs`,async()=>{
  const input=manualFixture(),request=manualRequest(input);change(request);const before=structuredClone(input);
  await assert.rejects(plan(input,request),error=>error.status===409||error.status===400);assert.deepEqual(input,before);
 });
 for(const [name,change]of [
  ['missing bank original',i=>i.transactions[0].original.status='BLOCKED'],
  ['expired account consent',i=>i.transactions[0].accountEvidence.validUntil='2000-01-01T00:00:00Z'],
  ['foreign account owner',i=>i.transactions[0].accountEvidence.ownerId='another-owner'],
  ['manual payer value',i=>i.transactions[0].payerEvidence.origin='manual'],
  ['missing bank payer',i=>i.transactions[0].payerEvidence=null],
  ['conflicting payer organization',i=>i.transactions[0].payerEvidence.organizationNumber='2222222222'],
  ['missing invoice original',i=>i.invoices[1].evidenceIssue='Synthetic missing original'],
  ['incomplete preserved references',i=>i.transactions[0].referenceIncomplete=true],
  ['invalid OCR checksum',i=>i.transactions[0].references[0].validity='checksum_invalid'],
  ['unregistered preserved reference',i=>i.transactions[0].references.push({...i.transactions[0].references[0],value:'UNREGISTERED',rawValue:'UNREGISTERED'})],
  ['lost leading zero',i=>{i.transactions[0].references[0].value='42';i.transactions[0].references[0].rawValue='42';}],
  ['closed competing owner',i=>i.invoices.push({...i.invoices[0],id:'closed-owner',voided:true})],
  ['conflicting original claim',i=>i.invoices.push({...i.invoices[1],id:'held-owner',number:'OTHER',reviewed:false,evidenceIssue:'Conflict',referenceClaims:['00042']})],
  ['competing payment',i=>i.transactions.push({...structuredClone(i.transactions[0]),id:'competing',bankId:'OTHER-BANK-PAYMENT'})],
  ['reversal',i=>i.transactions[0].reversal=true],
  ['non-economic observation',i=>i.transactions[0].economic=false],
 ])test(`${label}: no manual label bypasses ${name}`,async()=>{
  const input=manualFixture();change(input);const before=structuredClone(input);
  await assert.rejects(plan(input),{code:'MANUAL_EVIDENCE_REQUIRED'});assert.deepEqual(input,before);
 });
 test(`${label}: complete binding changes with one minor unit, original, source version, invoice debt or consent`,async()=>{
  const input=manualFixture(),request=manualRequest(input),value=await plan(input),binding=method('manualMultipleBinding')(input,value);
  const reordered=await plan(input,{...request,allocations:[...request.allocations].reverse()});assert.equal(method('manualMultipleBinding')(input,reordered),binding);
  for(const change of [i=>i.transactions[0].original.sha256='b'.repeat(64),i=>i.transactions[0].accountEvidence.proofId='changed-consent',i=>i.invoices[1].totalMinor++,i=>i.evidenceContext={sourceVersion:'changed'},i=>i.revision++,i=>i.ownerId='other-owner']){
   const modified=structuredClone(input);change(modified);assert.notEqual(method('manualMultipleBinding')(modified,value),binding);
  }
  const changed=structuredClone(value);changed.allocations[0].amountMinor++;assert.notEqual(method('manualMultipleBinding')(input,changed),binding);
 });
 test(`${label}: an already allocated pair cannot create an unresumable top-up`,async()=>{
  const input=manualFixture();input.allocations=[{id:'earlier',transactionId:input.transactions[0].id,invoiceId:input.invoices[0].id,amountMinor:1,active:true,effect:'payment'}];
  await assert.rejects(plan(input),{code:'MANUAL_EVIDENCE_REQUIRED'});
 });
}
