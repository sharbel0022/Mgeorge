import {reconciliationContractFixture} from './reconciliation-contract-cases.mjs';

// Independently labelled acceptance cases. Every bank/account/original object
// comes from a synthetic fixture; these values are never production evidence.
export const paymentAcceptanceCases=[
 {id:'single-exact',expected:'VERIFIED',allocations:1,amounts:[73100]},
 {id:'two-invoices-exact-ore',expected:'REVIEW',allocations:2,amounts:[30001,43099]},
 {id:'three-invoices-exact-ore',expected:'REVIEW',allocations:3,amounts:[10001,20002,43097]},
 {id:'multi-one-ore-short',expected:'BLOCKED',allocations:0},
 {id:'multi-one-ore-excess',expected:'BLOCKED',allocations:0},
 {id:'multi-conflicting-customer',expected:'BLOCKED',allocations:0},
 {id:'multi-unregistered-reference',expected:'BLOCKED',allocations:0},
 {id:'multi-incomplete-reference',expected:'BLOCKED',allocations:0},
 {id:'multi-invalid-ocr',expected:'BLOCKED',allocations:0},
 {id:'multi-missing-payer',expected:'BLOCKED',allocations:0},
 {id:'multi-manual-payer-only',expected:'BLOCKED',allocations:0},
 {id:'multi-foreign-account',expected:'BLOCKED',allocations:0},
 {id:'multi-expired-consent',expected:'BLOCKED',allocations:0},
 {id:'multi-missing-bank-original',expected:'BLOCKED',allocations:0},
 {id:'multi-missing-invoice-original',expected:'BLOCKED',allocations:0},
 {id:'multi-non-economic-observation',expected:'BLOCKED',allocations:0},
 {id:'multi-fractional-ore',expected:'BLOCKED',allocations:0},
 {id:'multi-competing-payment',expected:'REVIEW',allocations:0},
 {id:'multi-ambiguous-subset-sum',expected:'BLOCKED',allocations:0},
 {id:'single-leading-zero-mismatch',expected:'REVIEW',allocations:0},
 {id:'single-reference-owner-collision',expected:'BLOCKED',allocations:0},
];
export function paymentAcceptanceInput(id){
 const input=reconciliationContractFixture(),payment=input.transactions[0];
 const addInvoice=(number,total)=>input.invoices.push({...structuredClone(input.invoices[0]),id:'invoice-'+(input.invoices.length+1),number,totalMinor:total});
 const addReference=value=>payment.references.push({kind:'invoice',value,rawValue:value,source:'$.remittance_information['+payment.references.length+']',validity:'unchecked'});
 if(id.startsWith('multi-')||id==='two-invoices-exact-ore'){
  input.invoices[0].totalMinor=30001;addInvoice('00043',43099);addReference('00043');
 }
 switch(id){
  case 'three-invoices-exact-ore':input.invoices[0].totalMinor=10001;addInvoice('00043',20002);addInvoice('00044',43097);addReference('00043');addReference('00044');break;
  case 'multi-one-ore-short':payment.amountMinor--;break;
  case 'multi-one-ore-excess':payment.amountMinor++;break;
  case 'multi-conflicting-customer':input.invoices[1].customerOrganizationNumber='2222222222';break;
  case 'multi-unregistered-reference':addReference('00999');break;
  case 'multi-incomplete-reference':payment.referenceIncomplete=true;break;
  case 'multi-invalid-ocr':payment.references[1].kind='ocr';payment.references[1].validity='checksum_invalid';break;
  case 'multi-missing-payer':payment.payerEvidence=null;break;
  case 'multi-manual-payer-only':payment.payerEvidence.origin='manual';break;
  case 'multi-foreign-account':payment.accountEvidence.accountId='SYNTHETIC-OTHER-ACCOUNT';break;
  case 'multi-expired-consent':payment.accountEvidence.validUntil=input.checkedAt;break;
  case 'multi-missing-bank-original':payment.original.status='BLOCKED';break;
  case 'multi-missing-invoice-original':input.invoices[1].evidenceIssue='Synthetic missing invoice original';break;
  case 'multi-non-economic-observation':payment.economic=false;break;
  case 'multi-fractional-ore':payment.amountMinor=73100.5;break;
  case 'multi-ambiguous-subset-sum':addInvoice('00044',30001);addInvoice('00045',43099);payment.references=[];break;
  case 'multi-competing-payment':input.transactions.push({...structuredClone(payment),id:'competing-payment',bankId:'SYNTHETIC-COMPETING-BANK-ID',original:{...payment.original,id:'synthetic-other-original',sha256:'b'.repeat(64)}});break;
  case 'single-leading-zero-mismatch':payment.references[0].value='42';payment.references[0].rawValue='42';break;
  case 'single-reference-owner-collision':addInvoice('00042',73100);break;
 }
 return input;
}
