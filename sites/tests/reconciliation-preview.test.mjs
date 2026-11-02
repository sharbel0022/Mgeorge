import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand} from '../lib/domain.ts';
import {apiPayerEvidence} from '../lib/payer-evidence.js';
import {syntheticBankRow} from './helpers/bank-api-fixture.mjs';
import {previewFixture,previewState,addPreviewReport,owner,iban} from './helpers/reconciliation-preview-fixture.mjs';

const selected=(preview,id)=>preview.decisions.find(decision=>decision.transactionId===id);
test('owned stored bank and invoice originals produce an exact read-only selected preview under explicit server policy',async t=>{
 const f=await previewFixture(t),before=f.read(),fetch=globalThis.fetch;
 globalThis.fetch=()=>{throw Error('Provider calls are forbidden in reconciliation preview');};
 try{
  const {response,body:routePreview}=await f.get(),body=await f.preview(),decision=selected(body,f.state.transactions[0].id);
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(selected(routePreview,f.state.transactions[0].id).status,'BLOCKED');assert.equal(selected(routePreview,f.state.transactions[0].id).allocations.length,0);
  assert.equal(body.mode,'preview');assert.equal(body.changed,false);assert.equal(body.writesAllowed,false);assert.equal(body.approvalRequired,true);
  assert.equal(body.transactionId,f.state.transactions[0].id);assert.equal(decision.status,'VERIFIED');assert.equal(decision.allocations.length,1);assert.equal(decision.allocations[0].amountMinor,62500);
  assert.ok(decision.references.some(reference=>reference.value==='0599'));assert.deepEqual(f.read(),before);assert.deepEqual(f.state,before.state);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);assert.equal(f.state.allocations.length,0);assert.equal(typeof f.route.POST,'undefined');
 }finally{globalThis.fetch=fetch;}
});

test('preview preserves leading zeros rather than matching a shortened invoice number',async t=>{
 const f=await previewFixture(t,{state:previewState({number:'599'})}),preview=await f.preview(),decision=selected(preview,f.state.transactions[0].id);
 assert.notEqual(decision.status,'VERIFIED');assert.equal(decision.allocations.length,0);assert.ok(decision.references.some(reference=>reference.value==='0599'));
});

test('manual payer and reference completion cannot replace the bank original in preview',async t=>{
 const state=previewState({reference:'0588',party:'Bank original payer AB'}),payment=state.transactions[0];
 state.invoices[0].party='Manually named customer AB';payment.party='Manually named customer AB';payment.payerReference='0599';payment.verification={party:payment.party,payerReference:'0599',note:'Synthetic separate manual observation',at:'2026-11-02T00:00:00.000Z'};
 const f=await previewFixture(t,{state}),before=structuredClone(f.state),preview=await f.preview(),decision=selected(preview,payment.id);
 assert.equal(decision.payer.name.value,'Bank original payer AB');assert.ok(decision.references.some(reference=>reference.value==='0588'));assert.ok(!decision.references.some(reference=>reference.value==='0599'));assert.notEqual(decision.status,'VERIFIED');assert.deepEqual(f.state,before);
});

for(const mode of ['missing-original','changed-original','no-consent'])test(mode+' fails closed without changing recorded balances',async t=>{
 const state=previewState();if(mode==='missing-original')delete state.transactions[0].bankDataSha256;if(mode==='changed-original')state.transactions[0].bankData.reference_number='9999';
 const f=await previewFixture(t,{state,consent:mode!=='no-consent'}),before=f.read(),preview=await f.preview();assert.equal(selected(preview,state.transactions[0].id).status,'BLOCKED');assert.deepEqual(f.read(),before);assert.equal(f.state.allocations.length,0);
});

test('snapshot binds the complete workspace and consent ciphertext without exposing credentials',async t=>{
 const f=await previewFixture(t),first=await f.preview(),same=await f.preview();assert.equal(first.snapshot.sha256,same.snapshot.sha256);
 f.state.company.email='changed-synthetic@example.test';const changedWorkspace=await f.preview();assert.notEqual(first.snapshot.sha256,changedWorkspace.snapshot.sha256);
 f.sqlite.prepare("UPDATE bank_connections SET encrypted_session='different-synthetic-private-session'").run();const changedConsent=await f.preview();assert.notEqual(changedWorkspace.snapshot.sha256,changedConsent.snapshot.sha256);
 const serialized=JSON.stringify(changedConsent);assert.ok(!serialized.includes('synthetic-private-session'));assert.ok(!serialized.includes('synthetic-private-account'));assert.ok(!serialized.includes('encrypted_session'));assert.ok(!serialized.includes('encrypted_accounts'));
});

test('unchecked pending report preserves its declared count and sum without falsely claiming an incomplete report',async t=>{
 const state=previewState({batch:true}),f=await previewFixture(t,{state,report:addPreviewReport(state)}),child=f.state.transactions.find(row=>row.specification),preview=await f.preview();
 const decision=selected(preview,child.id);assert.equal(decision.status,'BLOCKED');assert.ok(decision.reasonCodes.includes('REPORT_ORIGINAL_MISSING_OR_INVALID'));assert.ok(!decision.reasonCodes.includes('REPORT_INCOMPLETE_OR_CONFLICTING'),JSON.stringify(decision.reasonCodes));assert.equal(f.state.allocations.length,0);
});

test('unrelated unverified observations stay explicit and invalidate the full snapshot',async t=>{
 const f=await previewFixture(t),first=await f.preview(),row=syntheticBankRow({account:'iban:'+iban,date:'2026-10-27',amount:72500,party:'Other synthetic customer AB',payerReference:'0777',bankReference:'SYNTHETIC-OTHER-PREVIEW',kind:'payment',verified:true});row.payerEvidence=apiPayerEvidence(row.bankData);
 f.state.transactions.push(...applyCommand(previewState(),{type:'transactions.import',trustedBankImport:true,rows:[row]}).state.transactions.filter(transaction=>transaction.bankReference==='SYNTHETIC-OTHER-PREVIEW'));
 const preview=await f.preview();assert.equal(preview.decisions.length,2);assert.equal(selected(preview,f.state.transactions[0].id).status,'VERIFIED');assert.equal(selected(preview,f.state.transactions[1].id).status,'BLOCKED');assert.notEqual(first.snapshot.sha256,preview.snapshot.sha256);
});

test('unknown company requires explicit server policy',async t=>{
 const f=await previewFixture(t,{state:previewState({company:'Unrelated synthetic company'})}),without=await f.preview({referencePolicy:null});assert.equal(selected(without,f.state.transactions[0].id).status,'BLOCKED');
 const withPolicy=await f.preview({referencePolicy:{version:'mgeorge-reconciliation-v1',companyId:'synthetic-company',invoiceNumberIsPaymentReference:true,preserveLeadingZeros:true,comparison:'exact',source:'Synthetic Agent 1 company policy'}});assert.equal(selected(withPolicy,f.state.transactions[0].id).status,'VERIFIED');
});

test('configured M.George name alone cannot supply a reference policy to the adapter or GET route',async t=>{
 const f=await previewFixture(t),id=f.state.transactions[0].id;
 const direct=await f.api.readReconciliationPreview(owner,f.state,f.revision,id),route=await f.get();
 assert.equal(selected(direct,id).status,'BLOCKED');assert.equal(route.response.status,200);assert.equal(selected(route.body,id).status,'BLOCKED');
 assert.equal(selected(direct,id).allocations.length,0);assert.equal(selected(route.body,id).allocations.length,0);
});

test('conflicting explicit invoice reference stays intact and prevents an invoice-number proposal',async t=>{
 const state=previewState();state.invoices[0].ocr='0588';
 const f=await previewFixture(t,{state}),before=structuredClone(f.state),preview=await f.preview(),decision=selected(preview,f.state.transactions[0].id);
 assert.equal(decision.status,'REVIEW');assert.equal(decision.allocations.length,0);assert.deepEqual(f.state,before);assert.equal(f.state.invoices[0].ocr,'0588');
});

for(const linked of [false,true])test((linked?'complete bank-identified':'manually associated')+' report preserves count, relation and economic membership',async t=>{
 const state=previewState({batch:true}),report=addPreviewReport(state,{linked,manual:!linked}),f=await previewFixture(t,{state,report}),before=f.read(),target=linked?f.state.transactions.find(row=>row.specification):f.state.transactions[0],preview=await f.preview({transactionId:target.id}),decision=selected(preview,target.id);
 assert.equal(decision.status,linked?'VERIFIED':'BLOCKED',JSON.stringify(decision));if(!linked){assert.equal(decision.allocations.length,0);assert.ok(decision.reasonCodes.includes('MANUAL_REPORT_RELATION'));assert.ok(decision.reasonCodes.includes('BANK_PAYMENT_ID_REQUIRED'));}assert.deepEqual(f.read(),before);assert.equal(f.state.allocations.length,0);
 const child=f.state.transactions.find(row=>row.specification);delete child.specificationCount;const missingMetadata=await f.preview({transactionId:target.id});assert.equal(selected(missingMetadata,target.id).status,'BLOCKED');
});

for(const missing of ['batch','count'])test('retained CAMT with missing '+missing+' cannot use an inferred imported payment count',async t=>{
 const state=previewState({batch:true}),report=addPreviewReport(state,{linked:true});
 const xml=new TextDecoder().decode(report.bytes).replace(missing==='batch'?/<Btch>[\s\S]*?<\/Btch>/:/<NbOfTxs>[\s\S]*?<\/NbOfTxs>/,'');
 report.bytes=new TextEncoder().encode(xml);
 const f=await previewFixture(t,{state,report}),child=f.state.transactions.find(row=>row.specification),before=structuredClone(f.state);
 assert.equal(child.specificationCount,1,'Legacy import inferred this count from rows, not explicit bank evidence');
 const preview=await f.preview({transactionId:child.id}),decision=selected(preview,child.id);
 assert.equal(decision.status,'BLOCKED');assert.equal(decision.allocations.length,0);assert.deepEqual(f.state,before);assert.equal(f.state.allocations.length,0);
});

test('GET requires owned transaction scope before reading originals',async t=>{
 const f=await previewFixture(t);
 for(const [id,status]of [[null,400],['bad/id',400],['foreign-id',404]]){const result=await f.get(id);assert.equal(result.response.status,status);assert.equal(f.originalReads.length,0);}
 f.control.authenticated=false;const denied=await f.get();assert.equal(denied.response.status,401);assert.equal(f.originalReads.length,0);
});

test('GET rejects extra and duplicate parameters instead of accepting browser policy or approval fields',async t=>{
 const f=await previewFixture(t),id=f.state.transactions[0].id;
 for(const query of ['transactionId='+id+'&approved=true','transactionId='+id+'&transactionId='+id,'transactionId='+id+'&referencePolicy=mgeorge']){
  const response=await f.route.GET(new Request('https://mg.test/api/reconciliation/preview?'+query));assert.equal(response.status,400);
 }
 assert.equal(f.originalReads.length,0);
});

test('report metadata cannot replace original payer or reference while reusing the original file hash',async t=>{
 const state=previewState({batch:true}),f=await previewFixture(t,{state,report:addPreviewReport(state,{linked:true})});
 const child=f.state.transactions.find(row=>row.specification);
 child.party='Forged synthetic payer AB';child.original.party=child.party;child.payerEvidence.name.value=child.party;child.payerEvidence.name.rawValue=child.party;
 f.state.invoices[0].party=child.party;
 const before=structuredClone(f.state),preview=await f.preview({transactionId:child.id});
 assert.equal(selected(preview,child.id).status,'BLOCKED');assert.equal(selected(preview,child.id).allocations.length,0);assert.deepEqual(f.state,before);
});

test('a workspace change while originals are read returns a stale preview instead of current approval evidence',async t=>{
 const f=await previewFixture(t);let changed=false;f.control.beforeRead=()=>{if(!changed){changed=true;f.sqlite.prepare('UPDATE workspaces SET revision=revision+1 WHERE owner=?').run(owner);}};
 const result=await f.get();assert.equal(changed,true);assert.equal(result.response.status,409);assert.equal(result.body.changed,false);assert.equal(result.body.writesAllowed,false);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
});
