import {available,balance,individualParty,needsBankFileReview,needsBankFileValidation,needsPaymentSpecification,paymentInvoiceAssessment,paymentEvidenceConflict,paymentOriginalIssue,usablePaymentReference,type State,type Transaction} from './domain';
import {exactReference} from './reconciliation-engine.js';
import {matchingReferenceValues} from './payment-references.js';

type Candidate={number:string;party?:string};
const hasBankSource=(t:Transaction)=>['bank_api','bank_file','bankgiro_file'].includes(t.evidence||'')&&!needsBankFileValidation(t);
const cleanParty=(value?:string)=>{
  const name=String(value||'').trim();
  return individualParty(name)&&name.length<=200&&!/betalardetaljer|betalningsspecifikation|betalare\s+(?:saknas|okänd)|mottagare\s+okänd|inbetalning\s*[–-]|utbetalning\s*[–-]|^bankgiro\s+inbetalning/iu.test(name)?name:'';
};
/** Bank originals and manual completion are deliberately separate identities. */
export function bankPayer(t:Transaction){
  const detailed=cleanParty(t.bankDetails?.party);
  if(detailed)return detailed;
  if(needsPaymentSpecification(t))return '';
  if(!hasBankSource(t))return ''; // A typed name or a legacy snapshot alone is not bank evidence.
  if(t.original)return cleanParty(t.original.party);
  return t.verification?'':cleanParty(t.party);
}
export const payerLabel=(t:Transaction)=>bankPayer(t)||(t.amount<0?'Mottagare okänd':'Betalare okänd');
export function bankPaymentReference(t:Transaction){
  const evidence=t.bankDetails?.referenceEvidence||t.referenceEvidence;
  if(!hasBankSource(t)&&!t.bankDetails?.payerReference)return {value:'',kind:'missing' as const,ocr:''};
  const value=t.bankDetails?.payerReference||(needsPaymentSpecification(t)?'':t.original?t.original.payerReference:t.verification?'':t.payerReference)||'';
  if(!usablePaymentReference(value))return {value:'',kind:'missing' as const,ocr:''};
  const exact=evidence?.candidates.filter(c=>c.kind!=='message'&&c.value===value)||[];
  const parts=t.referenceParts?.filter(p=>p.value===value)||[];
  const ocr=exact.some(c=>c.kind==='ocr')||parts.some(p=>p.kind==='ocr');
  const invoice=exact.some(c=>c.kind==='invoice')||parts.some(p=>p.kind==='invoice');
  return {value,kind:ocr?'ocr' as const:invoice?'invoice' as const:'reference' as const,ocr:ocr?value:''};
}
export function bankPaymentView(state:State,t:Transaction,candidates:Candidate[]=[]){
  const assessment=paymentInvoiceAssessment(state,t),reference=bankPaymentReference(t),requiresSpecification=needsPaymentSpecification(t);
  const allocations=state.allocations.filter(a=>a.active&&a.transactionId===t.id),invoices=allocations.map(a=>state.invoices.find(i=>i.id===a.invoiceId)).filter(i=>!!i);
  const invoiceNumbers=[...new Set(invoices.map(i=>i.number))];
  const possible=[...new Set([...candidates.map(c=>c.number),...(assessment.status!=='verified'&&assessment.invoice?[assessment.invoice.number]:[])])];
  const evidence=t.bankDetails?.referenceEvidence||t.referenceEvidence;
  const references=matchingReferenceValues(evidence,t.payerReference);
  const owners=new Set(state.invoices.filter(i=>!i.voided&&references.some(value=>[i.number,i.ocr].some(actual=>actual&&exactReference(value,actual)))).map(i=>i.id));
  const contradictory=references.length>1&&!state.invoices.some(i=>references.every(value=>[i.number,i.ocr].some(actual=>actual&&exactReference(value,actual))));
  const bankConflict=paymentEvidenceConflict(state,t),conflict=bankConflict||!!evidence?.incomplete||!!evidence?.candidates.some(c=>c.validity==='checksum_invalid')||owners.size>1||contradictory;
  let status='Behöver granskas',verified=false;
  if(t.ignored)status='Undantagen';
  else if(t.duplicateOf)status='Möjlig dubblett';
  else if(bankConflict)status='Motstridigt bankunderlag';
  else if(paymentOriginalIssue(state,t))status='Original behöver verifieras';
  else if(needsBankFileValidation(t))status='Original behöver verifieras';
  else if(requiresSpecification)status='Specifikation saknas';
  else if(conflict)status='Konflikt';
  else if(t.specificationStatus==='review'||!t.verified||needsBankFileReview(t))status='Behöver granskas';
  else if(allocations.length){
    verified=true;
    status=invoices.some(i=>balance(state,i)>0)?'Delbetalning':available(state,t)>0?'Överbetalning':'Verifierad';
  }else if(possible.length)status='Möjlig matchning';
  const manualPayer=t.verification?.party||(t.evidence==='verified_specification'?t.party:''),manualReference=t.verification?.payerReference||(t.evidence==='verified_specification'?t.payerReference:'');
  return {payer:payerLabel(t),payerKnown:!!bankPayer(t),reference,invoice:invoiceNumbers.length?invoiceNumbers.join(', '):possible.length?'Möjlig: '+possible.join(', '):'Saknas',invoiceVerified:invoiceNumbers.length>0&&!bankConflict&&!paymentOriginalIssue(state,t),invoiceNumbers,possible,status,verified,requiresSpecification,manualPayer,manualReference};
}
export function bankVisibleTransactions(state:State){
  return state.transactions.filter(t=>{
    const children=state.transactions.filter(c=>c.parentId===t.id&&!c.ignored&&!c.duplicateOf);
    return !children.length||!children.every(c=>c.specificationStatus!=='review'&&c.account===t.account&&c.currency===t.currency)||children.reduce((n,c)=>n+c.amount,0)!==t.amount;
  });
}
export function bankPaymentCounts(state:State){
  const rows=bankVisibleTransactions(state);
  const views=rows.filter(t=>!t.ignored&&t.amount>0).map(t=>bankPaymentView(state,t));
  return {verified:views.filter(v=>v.verified).length,specifications:views.filter(v=>v.requiresSpecification).length,review:views.filter(v=>!v.verified&&!v.requiresSpecification).length};
}
