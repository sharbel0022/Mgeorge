import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,createPaymentPresentationReferenceMatcher,invoiceReferenceMatches,invoiceReferenceMatchIssue} from '../lib/domain.ts';
import {genericCompanyState} from './helpers/reference-policy-fixture.mjs';
import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';
import {extractPaymentReferences} from '../lib/payment-references.js';

const identifiers=['00599','599','00-599','00 599','000018','AB/12','AB12','AB-12','ABC','abc','ÅB_12','ＡＢ/１２','FaKtUrA 00599','NOTPROVIDED',' 00599 ','A\u0308B/12'];
const queries=[...identifiers,'Faktura: 00599','Fakturanummer#00599','Faktura nr 00599','Invoice no: AB/12','OCR-referens: 00599','OCR 00-599','X00599','UNKNOWN','', '００５９９'];
function census(strict){
 const state=strict?emptyState():genericCompanyState();
 for(const direction of ['receivable','payable'])for(const [n,number] of identifiers.entries())state.invoices.push({id:direction+'-'+n,direction,number,ocr:n%2?'':number,party:'Synthetic customer',total:n%3?10000:0,currency:'SEK',issued:'2026-01-01',due:'2026-11-05',reviewed:n%3!==0,voided:n===5,documentId:'synthetic-original-'+n});
 state.invoices.push({id:'held-original-owner',direction:'receivable',number:'00600',ocr:'00600',referenceOriginal:{invoice_number:'00600',reference:'00599'},party:'Synthetic held customer',total:10000,currency:'SEK',reviewed:false,voided:false});
 return state;
}
for(const strict of [false,true])for(const direction of ['receivable','payable'])test('projection owner lookup matches the full authoritative census: '+(strict?'scoped':'generic')+' '+direction,()=>{
 const state=census(strict),before=structuredClone(state),lookup=createPaymentPresentationReferenceMatcher(state);
 for(const value of queries){
  const expected=state.invoices.filter(i=>!i.voided&&i.direction===direction&&invoiceReferenceMatches(state,i,value,true)).map(i=>i.id).sort();
  assert.deepEqual(lookup.owners(direction,[value]).map(i=>i.id).sort(),expected,JSON.stringify(value));
 }
 assert.deepEqual(state,before);
});
for(const strict of [false,true])test('all source reference observations retain the authoritative policy outcome: '+(strict?'scoped':'generic'),()=>{
 const state=strict?emptyState():genericCompanyState(),invoice={id:'synthetic-invoice',direction:'receivable',number:'00599',ocr:'00599',party:'Synthetic customer',total:10000,currency:'SEK',reviewed:true,documentId:'synthetic-original'};
 state.invoices.push(invoice,{...invoice,id:'held-other-owner',number:'00600',ocr:'00600',reviewed:false,referenceOriginal:{invoice_number:'00600',reference:'000018'}});
 const lookup=createPaymentPresentationReferenceMatcher(state);
 for(const [reference,detailReference,incomplete] of [['00599','',false],['00599','00599',false],['00600','00599',false],['00599','',true],['000018','00599',false]]){
  const transaction=syntheticBankTransaction({id:'synthetic-payment',date:'2026-11-05',amount:10000,party:'Synthetic bank payer',payerReference:reference,account:'synthetic-account',kind:'payment',verified:true});
  transaction.bankDetails={status:detailReference?'identified':'missing',party:'Synthetic detail payer',payerReference:detailReference,documentId:'synthetic-detail-original',referenceEvidence:{...extractPaymentReferences({reference_number:detailReference}),incomplete}};
  const before=structuredClone(transaction);
  assert.equal(lookup.policyIssue(invoice,transaction),invoiceReferenceMatchIssue(state,invoice,transaction),JSON.stringify({reference,detailReference,incomplete}));
  assert.deepEqual(transaction,before);
 }
});
