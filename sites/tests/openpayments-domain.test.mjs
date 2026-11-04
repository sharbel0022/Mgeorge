import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand,specificationPreview,economicTransactions,paymentEvidenceIssue,bankgiroLinkCandidates} from '../lib/domain.ts';
import {seedState,account} from './helpers/bankgiro-ingest-fixture.mjs';
import {syntheticBankRow} from './helpers/bank-api-fixture.mjs';
function observation(patch={}){return {kind:'payment',date:'2026-10-26',amount:62500,currency:'SEK',party:'Synthetic customer AB',payerReference:'0599',bankReference:'PAYMENT-1',parentBankReference:'SYNTHETIC-DEPOSIT',externalId:'opbg-company-a-account-a-payment-1',key:'child-1',account,source:'Open Payments Bankgiro',format:'Open Payments Bankgiro JSON',specification:true,enrichmentEvidence:{version:'openpayments-bankgiro-v1',provider:'openpayments',owner:'synthetic-owner',companyId:'company-a',sourceId:'source-a',scopeId:'scope-a',accountId:'account-a',transactionId:'payment-1',parentTransactionId:'parent-1'},rawBankData:{transactionId:'payment-1',unmappedOriginalField:'keep me'},...patch};}
const command=rows=>({type:'bankgiro.import',documentId:'synthetic-capture',hash:'a'.repeat(64),name:'capture.opbg.json',rows});
test('provider rows require the explicit selected company even when every bank fact matches',()=>{
 const state=seedState();state.company.id='company-a';
 const row=observation({enrichmentEvidence:{...observation().enrichmentEvidence,companyId:'company-b'}});
 assert.throws(()=>applyCommand(state,command([row])),/företag/i);
 delete state.company.id;assert.throws(()=>applyCommand(state,command([observation()])),/företag/i);
});
test('provider completeness holds prevent existing identity matching and survive durable projection',()=>{
 const state=seedState();state.company.id='company-a';const row=observation({bankgiroEnrichmentIssue:'API-underlaget är ofullständigt.'});
 assert.equal(specificationPreview(state,[row]).linked,0);
 const result=applyCommand(state,command([row])).state,payment=result.transactions.find(t=>t.specification);
 assert.equal(payment.bankgiroEnrichmentIssue,'API-underlaget är ofullständigt.');assert.equal(payment.parentId,'');
 assert.equal(paymentEvidenceIssue(result,payment),'API-underlaget är ofullständigt.');assert.equal(economicTransactions(result).length,1);
});
test('native provider evidence and unknown original fields survive a specification import',()=>{
 const state=seedState();state.company.id='company-a';const row=observation(),next=applyCommand(state,command([row])).state;
 const payment=next.transactions.find(t=>t.specification);
 assert.deepEqual(payment.enrichmentEvidence,row.enrichmentEvidence);assert.deepEqual(payment.rawBankData,row.rawBankData);
 assert.equal(payment.parentId,state.transactions[0].id);assert.equal(next.allocations.length,0);
});
test('two genuine provider payment identities preserve otherwise identical payment details',()=>{
 const state=seedState();state.company.id='company-a';
 const rows=['payment-a','payment-b'].map(id=>observation({amount:31250,externalId:'opbg-'+id,enrichmentEvidence:{...observation().enrichmentEvidence,transactionId:id},rawBankData:{transactionId:id}}));
 assert.equal(specificationPreview(state,rows).linked,1);
 const next=applyCommand(state,command(rows)).state;
 assert.equal(next.transactions.filter(row=>row.specification).length,2);
 assert.equal(economicTransactions(next).reduce((sum,row)=>sum+row.amount,0),62500);
});
test('fresh captures of the same held payment preserve receipts without duplicating observations',()=>{
 const state=seedState({parent:false});state.company.id='company-a';
 const first=applyCommand(state,command([observation()])).state;
 const next=applyCommand(first,{...command([observation()]),documentId:'second-capture',hash:'b'.repeat(64)}).state;
 assert.equal(next.transactions.length,1);assert.equal(next.imports.length,2);assert.equal(economicTransactions(next).length,0);
});
test('changed raw original under the same provider payment identity remains a conflict',()=>{
 const state=seedState();state.company.id='company-a';const first=applyCommand(state,command([observation()])).state;
 const changed=observation({rawBankData:{...observation().rawBankData,unmappedOriginalField:'changed'}});
 const next=applyCommand(first,{...command([changed]),documentId:'second-capture',hash:'b'.repeat(64)}).state;
 const original=next.transactions.find(row=>row.specification);
 assert.ok(original.bankEvidenceConflicts?.length);assert.match(paymentEvidenceIssue(next,original),/motstridig|olika|konflikt/i);
 assert.equal(next.allocations.length,0);
});
test('an earlier partial capture cannot falsify or block a later complete group',()=>{
 const state=seedState();state.company.id='company-a';
 const a=observation({amount:12500,externalId:'opbg-a',enrichmentEvidence:{...observation().enrichmentEvidence,transactionId:'a'},rawBankData:{transactionId:'a'}});
 const b=observation({amount:50000,externalId:'opbg-b',enrichmentEvidence:{...observation().enrichmentEvidence,transactionId:'b'},rawBankData:{transactionId:'b'}});
 const first=applyCommand(state,command([{...a,bankgiroEnrichmentIssue:'Ofullständig täckning från banken.'}])).state;
 const next=applyCommand(first,{...command([a,b]),documentId:'complete-capture',hash:'b'.repeat(64)}).state;
 assert.equal(next.transactions.filter(row=>row.specificationStatus==='linked').length,2);
 assert.equal(economicTransactions(next).reduce((sum,row)=>sum+row.amount,0),62500);
 const held=next.transactions.find(row=>row.bankgiroEnrichmentIssue);assert.ok(held);assert.equal(held.parentId,'');
 assert.equal(next.allocations.length,0);
});
test('manual metadata linking cannot bypass the common bank identifier for API enrichment',()=>{
 const initial=seedState();initial.company.id='company-a';
 const state=applyCommand(initial,command([observation({parentBankReference:'OTHER-BANK-DEPOSIT'})])).state,target=state.transactions[0],specification=state.transactions.find(row=>row.specification);
 const [candidate]=bankgiroLinkCandidates(state,target);assert.equal(candidate.canLink,false);assert.match(candidate.reason,/bankidentifierare/);
 assert.throws(()=>applyCommand(state,{type:'bankgiro.link',transactionId:target.id,specificationId:specification.id,confirmAccount:true,confirmOriginals:true,note:'Syntetisk granskning av underlagen.'}),/bankidentifierare/);
 assert.equal(economicTransactions(state).reduce((sum,row)=>sum+row.amount,0),62500);
});
function secondPayment(patch={}){return observation({externalId:'opbg-payment-2',key:'child-2',bankReference:'PAYMENT-2',enrichmentEvidence:{...observation().enrichmentEvidence,transactionId:'payment-2',parentTransactionId:'parent-2'},rawBankData:{transactionId:'payment-2'},...patch});}
function twoDeposits(){let state=seedState();state.company.id='company-a';state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account,date:'2026-10-26',amount:62500,bankReference:'DEPOSIT-2',party:'',payerReference:'',description:'Bankgiro inbetalning',kind:'batch'})]}).state;return applyCommand(state,command([observation()])).state;}
test('distinct genuine payments under different proved deposits do not collapse by payer and reference',()=>{
 const state=twoDeposits(),row=secondPayment({parentBankReference:'DEPOSIT-2'});
 assert.equal(specificationPreview(state,[row]).linked,1);
 const next=applyCommand(state,{...command([row]),documentId:'second-capture',hash:'b'.repeat(64)}).state;
 assert.equal(next.transactions.filter(row=>row.specificationStatus==='linked').length,2);assert.equal(economicTransactions(next).reduce((sum,row)=>sum+row.amount,0),125000);assert.equal(next.allocations.length,0);
});
test('distinct API IDs do not bypass cross-source ambiguity or an equal bank payment reference',()=>{
 const state=twoDeposits(),base=secondPayment({parentBankReference:'DEPOSIT-2'});
 for(const row of [{...base,enrichmentEvidence:{...base.enrichmentEvidence,sourceId:'different-source'}},{...base,bankReference:'PAYMENT-1'}])assert.equal(specificationPreview(state,[row]).review,1);
});
test('a reused bank reference on a later date with a distinct provider parent does not poison retained evidence',()=>{
 const state=seedState({parent:false});state.company.id='company-a';const first=applyCommand(state,command([observation()])).state;
 const row=secondPayment({date:'2026-10-27'}),next=applyCommand(first,{...command([row]),documentId:'next-day-capture',hash:'b'.repeat(64)}).state;
 assert.equal(next.transactions.length,2);assert.ok(next.transactions.every(row=>!row.bankEvidenceConflicts?.length));assert.equal(economicTransactions(next).length,0);
});
test('changed dates under the same scoped provider parent still conflict',()=>{
 const state=seedState({parent:false});state.company.id='company-a';const first=applyCommand(state,command([observation()])).state;
 const row=secondPayment({date:'2026-10-27',enrichmentEvidence:{...secondPayment().enrichmentEvidence,parentTransactionId:'parent-1'}}),next=applyCommand(first,{...command([row]),documentId:'changed-parent-capture',hash:'b'.repeat(64)}).state;
 assert.ok(next.transactions.find(row=>row.enrichmentEvidence.transactionId==='payment-1').bankEvidenceConflicts?.length);assert.equal(economicTransactions(next).length,0);
});
