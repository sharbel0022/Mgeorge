import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOpenPaymentsBankgiro } from '../lib/bankgiro-openpayments.js';
import { openPaymentsContext, openPaymentsChild, openPaymentsBooked, openPaymentsPage, OPENPAYMENTS_IBAN } from './helpers/openpayments-bankgiro-fixture.mjs';

const normalize = (pages = [openPaymentsPage()], context = openPaymentsContext()) => normalizeOpenPaymentsBankgiro(pages, context);

test('normalizes one fully evidenced incoming Bankgiro child without promoting trust', () => {
  const result = normalize();
  assert.equal(result.version, 'openpayments-bankgiro-v1');
  assert.equal(result.provider, 'openpayments');
  assert.equal(result.coverage.status, 'available');
  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.equal(row.kind, 'payment');
  assert.equal(row.specification, true);
  assert.equal(row.verified, false);
  assert.equal(row.amount, 62500);
  assert.equal(row.party, 'Synthetic customer AB');
  assert.equal(row.payerReference, '0599');
  assert.equal(row.bankReference, 'BANK-CHILD-1');
  assert.equal(row.parentBankReference, 'BANK-PARENT-1');
  assert.equal(row.recipientBankgiro, '123-4567');
  assert.equal(row.account, OPENPAYMENTS_IBAN);
  assert.equal(row.referenceEvidence.selected.kind, 'structured');
  assert.equal(row.bankgiroEnrichmentIssue, '');
  assert.equal(row.enrichmentEvidence.companyId, 'synthetic-company');
  assert.equal(result.groups[0].complete, true);
  assert.equal(result.groups[0].amount, 62500);
});

test('keeps multiple individual payers and their exact references inside one deposit',()=>{
 const children=[openPaymentsChild({transactionId:'A',transactionAmount:{amount:'125.00',currency:'SEK'},debtorName:'Synthetic A',remittanceInformationStructured:'0599'}),openPaymentsChild({transactionId:'B',transactionAmount:{amount:'500.00',currency:'SEK'},debtorName:'Synthetic B',remittanceInformationStructured:'599'})];
 const result=normalize([openPaymentsPage({children})]);
 assert.equal(result.coverage.status,'available');assert.equal(result.groups[0].paymentCount,2);
 assert.deepEqual(result.rows.map(r=>[r.party,r.amount,r.payerReference]),[['Synthetic A',12500,'0599'],['Synthetic B',50000,'599']]);
 assert.ok(result.rows.every(r=>r.referenceEvidence.selected.kind==='structured'));
});
test('deduplicates the same actual child ID across pages while keeping all source paths',()=>{
 const first=openPaymentsPage({next:{href:'/next'}}),last=openPaymentsPage();
 const result=normalize([first,last]);assert.equal(result.coverage.status,'available');assert.equal(result.rows.length,1);assert.equal(result.rows[0].enrichmentEvidence.sourcePaths.length,2);
});
test('different genuine IDs with identical facts and generated list IDs remain two payments',()=>{
 const base=openPaymentsChild({aggregateAmount:'1250.00',transactionListId:'SAME-GENERATED-LIST-ID'});
 const result=normalize([openPaymentsPage({children:[base,{...base,transactionId:'CHILD-2'}],booked:[openPaymentsBooked({transactionAmount:{amount:'1250.00',currency:'SEK'}})]})]);
 assert.equal(result.coverage.status,'available');assert.equal(result.rows.length,2);assert.notEqual(result.rows[0].externalId,result.rows[1].externalId);
});
test('same stable child ID with changed original facts is a conflict',()=>{
 assert.throws(()=>normalize([openPaymentsPage({children:[openPaymentsChild(),openPaymentsChild({additionalInformation:'Changed original'})]})]),{code:'IDENTITY_CONFLICT'});
});
test('scoped identities are bounded and separate owner, company, source, scope and provider account',()=>{
 const context=openPaymentsContext({owner:'o'.repeat(180),companyId:'c'.repeat(180),sourceId:'s'.repeat(180),scopeId:'p'.repeat(180)}),row=normalize(undefined,context).rows[0];
 assert.ok(row.externalId.length<=300);assert.ok(row.parentKey.length<=300);assert.ok(row.key.length<=300);
 for(const key of ['owner','companyId','sourceId','scopeId','accountId'])assert.notEqual(normalize().rows[0].externalId,normalize(undefined,openPaymentsContext({[key]:'another-'+key})).rows[0].externalId);
});
test('only actual fields populate settlement date, payer account, message and address',()=>{
 const child=openPaymentsChild({valueDate:'2026-10-27',debtorOrganisationId:'556123-4567',debtorAccount:{iban:'SE3550000000054910000003'},debtorAddress:{streetName:'Synthetic street',townName:'Synthetic town'},remittanceInformationUnstructured:'Bank message',unknownBankField:{untouched:true}});
 const original=openPaymentsPage({children:[child]}),before=JSON.stringify(original),row=normalize([original]).rows[0];
 assert.equal(row.settlementDate,'2026-10-27');assert.equal(row.payerAccount,'•••• 0003');assert.equal(row.remittanceMessage,'Bank message');assert.equal(row.organizationNumber,'');
 assert.ok(row.payerEvidence.identifiers.some(x=>x.kind==='organization'&&x.rawValue==='556123-4567'&&x.scheme===''));
 assert.ok(row.payerEvidence.address.fields.some(x=>x.rawValue==='Synthetic street'));assert.deepEqual(row.rawBankData,child);assert.equal(JSON.stringify(original),before);
 row.rawBankData.unknownBankField.untouched=false;assert.equal(original.transactions.bankgiro[0].unknownBankField.untouched,true);
});
for(const [amount,expected] of [['0.01',1],['12.3',1230],['625.00',62500]])test('parses exact decimal öre: '+amount,()=>{
 const result=normalize([openPaymentsPage({children:[openPaymentsChild({transactionAmount:{amount,currency:'SEK'},aggregateAmount:amount})],booked:[openPaymentsBooked({transactionAmount:{amount,currency:'SEK'}})]})]);assert.equal(result.rows[0].amount,expected);assert.equal(result.coverage.status,'available');
});
for(const amount of ['1e3','625,00','0.001','90071992547409.92',625])test('rejects malformed or unsafe monetary data: '+amount,()=>{
 assert.throws(()=>normalize([openPaymentsPage({children:[openPaymentsChild({transactionAmount:{amount,currency:'SEK'}})]})]),{code:'INVALID_ORIGINAL'});
});
test('missing Bankgiro details and empty details are explicitly unavailable',()=>{
 for(const bankgiro of [undefined,[]]){const page=openPaymentsPage();page.transactions.bankgiro=bankgiro;if(bankgiro===undefined)delete page.transactions.bankgiro;const result=normalize([page]);assert.equal(result.coverage.status,'unavailable');assert.equal(result.rows.length,0);}
});
for(const debtorName of ['', ' ', 'Bankgiro', 'Bankgiroinbetalningar', 'Bankgiro insättning', 'NOTPROVIDED','unknown'])test('missing or collective payer stays on review: '+JSON.stringify(debtorName),()=>{
 const result=normalize([openPaymentsPage({children:[openPaymentsChild({debtorName})]})]);assert.equal(result.coverage.status,'partial');assert.ok(result.rows[0].bankgiroEnrichmentIssue);assert.equal(result.rows[0].rawBankData.debtorName,debtorName);
});
for(const [field,value] of [['transactionId','NOTPROVIDED'],['aggregateTransactionId','UNKNOWN']])test('placeholder '+field+' cannot establish a complete group',()=>{
 const result=normalize([openPaymentsPage({children:[openPaymentsChild({[field]:value})]})]);assert.equal(result.coverage.status,'partial');assert.equal(result.groups[0].complete,false);
});
test('a placeholder bank entry reference never becomes deposit linkage evidence',()=>{
 const result=normalize([openPaymentsPage({booked:[openPaymentsBooked({entryReference:'NOTPROVIDED'})]})]);assert.equal(result.coverage.status,'partial');assert.equal(result.rows[0].parentBankReference,'');
});
test('missing IDs use separate review observations, even when generated list IDs agree',()=>{
 const base=openPaymentsChild({transactionId:undefined,transactionListId:'COLLISION',aggregateAmount:'1250.00'});delete base.transactionId;
 const result=normalize([openPaymentsPage({children:[base,{...base}],booked:[openPaymentsBooked({transactionAmount:{amount:'1250.00',currency:'SEK'}})]})]);
 assert.equal(result.coverage.status,'partial');assert.equal(result.rows.length,2);assert.notEqual(result.rows[0].key,result.rows[1].key);assert.ok(result.rows.every(r=>r.externalId===''));
});
test('a genuine provider ID cannot collide with a missing-ID observation namespace',()=>{
 const missing=openPaymentsChild({aggregateAmount:'1250.00'});delete missing.transactionId;
 const real=openPaymentsChild({transactionId:'observation:synthetic-report:0:0',aggregateAmount:'1250.00'});
 const result=normalize([openPaymentsPage({children:[missing,real],booked:[openPaymentsBooked({transactionAmount:{amount:'1250.00',currency:'SEK'}})]})]);
 assert.equal(result.rows.length,2);assert.notEqual(result.rows[0].key,result.rows[1].key);
});
test('a reported aggregate serial must be a safe non-negative integer',()=>{
 for(const aggregateId of [{id:1},1.5,Number.MAX_SAFE_INTEGER+1,'1',-1])assert.throws(()=>normalize([openPaymentsPage({children:[openPaymentsChild({aggregateId})]})]),{code:'INVALID_ORIGINAL'});
});
test('a null aggregate serial stays missing in normalized fields and present in raw evidence',()=>{
 const row=normalize([openPaymentsPage({children:[openPaymentsChild({aggregateId:null})]})]).rows[0];
 assert.equal(row.reportEvidence.sequence,'');assert.equal(row.rawBankData.aggregateId,null);
});
for(const location of ['response','child','parent'])test('rejects a conflicting recipient account at '+location,()=>{
 const page=openPaymentsPage(),foreign='SE3550000000054910000003';
 if(location==='response')page.account.iban=foreign;else if(location==='child')page.transactions.bankgiro[0].creditorAccount.iban=foreign;else page.transactions.booked[0].creditorAccount={iban:foreign};
 assert.throws(()=>normalize([page]),{code:'ACCOUNT_MISMATCH'});
});
for(const location of ['child','parent'])test('a conflicting '+location+' Bankgiro is held for review',()=>{
 const page=openPaymentsPage(),account={iban:OPENPAYMENTS_IBAN,bankgiroNumber:'765-4321'};
 (location==='child'?page.transactions.bankgiro[0]:page.transactions.booked[0]).creditorAccount=account;
 assert.equal(normalize([page]).coverage.status,'partial');
});
test('partial total and incomplete pagination never look like complete deposits',()=>{
 for(const page of [openPaymentsPage({children:[openPaymentsChild({transactionAmount:{amount:'125.00',currency:'SEK'}})]}),openPaymentsPage({next:{href:'/next'}}),openPaymentsPage({download:{href:'/file'}})])assert.equal(normalize([page]).coverage.status,'partial');
});
test('a parent present on a later page can prove a complete multi-page group',()=>{
 const first=openPaymentsPage({children:[openPaymentsChild({transactionId:'A',transactionAmount:{amount:'125.00',currency:'SEK'}})],booked:[],next:{href:'/next'}}),last=openPaymentsPage({children:[openPaymentsChild({transactionId:'B',transactionAmount:{amount:'500.00',currency:'SEK'}})]});
 const result=normalize([first,last]);assert.equal(result.coverage.status,'available');assert.equal(result.groups[0].paymentCount,2);
});
test('two distinct API parents claiming the same bank deposit are ambiguous',()=>{
 const result=normalize([openPaymentsPage({children:[openPaymentsChild(),openPaymentsChild({transactionId:'CHILD-2',aggregateTransactionId:'PARENT-2'})],booked:[openPaymentsBooked(),openPaymentsBooked({transactionId:'PARENT-2'})]})]);
 assert.equal(result.coverage.status,'partial');assert.ok(result.groups.every(g=>!g.complete));
});
test('two distinct proved bank deposits keep their separate groups',()=>{
 const result=normalize([openPaymentsPage({children:[openPaymentsChild(),openPaymentsChild({transactionId:'CHILD-2',aggregateTransactionId:'PARENT-2'})],booked:[openPaymentsBooked(),openPaymentsBooked({transactionId:'PARENT-2',entryReference:'BANK-PARENT-2'})]})]);
 assert.equal(result.coverage.status,'available');assert.equal(result.groups.length,2);
});
test('unsupported nested reference shapes stay raw and cannot become formal OCR',()=>{
 const child=openPaymentsChild({remittanceInformationStructuredArray:[{creditorReferenceInformation:{reference:{value:'0599'}}}]});
 const result=normalize([openPaymentsPage({children:[child]})]);assert.equal(result.coverage.status,'partial');assert.equal(result.rows[0].referenceEvidence.selected.kind,'structured');assert.deepEqual(result.rows[0].rawBankData,child);
});
test('non-SEK, unconfirmed enrichment and malformed dates cannot be normalized into trusted SEK',()=>{
 for(const patch of [{transactionAmount:{amount:'625.00',currency:'EUR'}},{isEnriched:false},{isAliasPayin:false},{isAliasPayout:true}])assert.equal(normalize([openPaymentsPage({children:[openPaymentsChild(patch)]})]).coverage.status,'partial');
 assert.throws(()=>normalize([openPaymentsPage({children:[openPaymentsChild({bookingDate:'2026-02-30'})]})]),{code:'INVALID_ORIGINAL'});
});
test('bounds all original pages together and the total booked-record count',()=>{
 const pages=[openPaymentsPage({padding:'x'.repeat(7_600_000)}),openPaymentsPage({padding:'y'.repeat(7_600_000)})];
 assert.throws(()=>normalize(pages),{code:'INVALID_ORIGINAL'});
 assert.throws(()=>normalize([openPaymentsPage({booked:Array.from({length:10001},(_,i)=>({transactionId:'P'+i}))})]),{code:'INVALID_ORIGINAL'});
 assert.throws(()=>normalize([openPaymentsPage({children:Array.from({length:1001},()=>openPaymentsChild())})]),{code:'INVALID_ORIGINAL'});
});
