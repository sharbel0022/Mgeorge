import {activeBankgiroLink,bankgiroLinkCandidates,available,balance,individualParty,needsBankFileReview,needsBankFileValidation,needsPaymentSpecification,paymentInvoiceAssessment,paymentEvidenceConflict,paymentOriginalIssue,usablePaymentReference,type State,type Transaction} from './domain';
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
function referenceView(value:string,evidence:Transaction['referenceEvidence'],parts:Transaction['referenceParts']){
  if(!usablePaymentReference(value))return {value:'',kind:'missing' as const,ocr:''};
  const exact=evidence?.candidates.filter(c=>c.kind!=='message'&&c.value===value)||[];
  const matchingParts=parts?.filter(p=>p.value===value)||[];
  const ocr=exact.some(c=>c.kind==='ocr')||matchingParts.some(p=>p.kind==='ocr');
  const invoice=exact.some(c=>c.kind==='invoice')||matchingParts.some(p=>p.kind==='invoice');
  return {value,kind:ocr?'ocr' as const:invoice?'invoice' as const:'reference' as const,ocr:ocr?value:''};
}
export function bankPaymentReference(t:Transaction){
  if(!hasBankSource(t)&&!t.bankDetails?.payerReference)return {value:'',kind:'missing' as const,ocr:''};
  // Detail metadata and AIS referenceParts belong to different originals.
  if(t.bankDetails?.payerReference)return referenceView(t.bankDetails.payerReference,t.bankDetails.referenceEvidence,undefined);
  const value=(needsPaymentSpecification(t)?'':t.original?t.original.payerReference:t.verification?'':t.payerReference)||'';
  return referenceView(value,t.referenceEvidence,t.referenceParts);
}
type FieldSourceKind='report'|'detail'|'transaction';
const fieldSourceLabel=(kind:FieldSourceKind,t:Transaction)=>kind==='report'?'Kopplat Bankgirooriginal':kind==='detail'?'Bankens separata detaljoriginal':hasBankSource(t)?'Bankens transaktionsoriginal':'Sparad transaktionsuppgift · bankkälla ej verifierad';
/** One read-only source decision per displayed field. Never fall back to a
 * different original's identifiers or reference classifications. */
export function bankPaymentFieldSources(state:State,t:Transaction){
  const link=activeBankgiroLink(state,t.id),linkedRow=link?.rows.length===1?link.rows[0]:undefined;
  const linkedPayer=linkedRow?cleanParty(linkedRow.party):'',detailPayer=cleanParty(t.bankDetails?.party),payerKind:FieldSourceKind=linkedPayer?'report':detailPayer?'detail':'transaction';
  const payerRow=payerKind==='report'?linkedRow!:t,payerValue=linkedPayer||bankPayer(t);
  const linkedReference=linkedRow?referenceView(linkedRow.payerReference,linkedRow.referenceEvidence,linkedRow.referenceParts):undefined,referenceKind:FieldSourceKind=linkedReference?.value?'report':t.bankDetails?.payerReference?'detail':'transaction';
  const referenceRow=referenceKind==='report'?linkedRow!:t,referenceValue=linkedReference?.value?linkedReference:bankPaymentReference(t);
  return {
    payer:{kind:payerKind,label:fieldSourceLabel(payerKind,t),row:payerRow,value:payerValue,evidence:payerKind==='detail'?t.bankDetails?.payerEvidence:payerRow.payerEvidence},
    reference:{kind:referenceKind,label:fieldSourceLabel(referenceKind,t),row:referenceRow,value:referenceValue,evidence:referenceKind==='detail'?t.bankDetails?.referenceEvidence:referenceRow.referenceEvidence,parts:referenceKind==='detail'?undefined:referenceRow.referenceParts}
  };
}
/** Read-only invoice lookup for the displayed reference. Recorded allocations
 * remain separate historical facts; source selection never rewrites them. */
export function bankPaymentInvoiceAssessment(state:State,t:Transaction,fields=bankPaymentFieldSources(state,t)){
  const reference=fields.reference.value.value,direction=t.amount>0?'receivable':'payable';
  const registered=reference?state.invoices.filter(i=>!i.voided&&i.direction===direction&&[i.number,i.ocr].some(value=>value&&exactReference(reference,value))):[];
  const bookedIds=[...new Set(state.allocations.filter(a=>a.active&&a.transactionId===t.id).map(a=>a.invoiceId))],bookedInvoices=bookedIds.flatMap(id=>{const invoice=state.invoices.find(i=>i.id===id);return invoice?[invoice]:[];});
  const allocationConflict=!!reference&&bookedIds.some(id=>!registered.some(invoice=>invoice.id===id));
  const invoice=registered.length===1?registered[0]:!reference&&bookedInvoices.length===1?bookedInvoices[0]:undefined;
  const current=paymentInvoiceAssessment(state,t),issue=current.status==='review'?current.message:'';
  const status=allocationConflict?'conflict' as const:issue?'review' as const:registered.length>1?'ambiguous' as const:invoice?bookedIds.length?'verified' as const:'possible' as const:'missing' as const;
  const message=allocationConflict?`Bokad koppling till faktura ${bookedInvoices.map(i=>i.number).join(', ')||'som saknas i registret'} avviker från den visade betalningsreferensen ${reference}. Granska historiken; inga saldon ändras.`:issue|| (registered.length>1?'Flera fakturor har den visade referensen. Granska fakturaidentiteten.':invoice?bookedIds.length?'Betalningen är registrerad mot fakturan.':`Den visade referensen ${reference} finns i faktura ${invoice.number}. Kund och betalningsunderlag behöver kontrolleras separat.`:reference?`Ingen entydig registerfaktura med den visade betalningsreferensen ${reference} hittades.`:'Betalningsreferens och faktura behöver identifieras.');
  return {invoice,status,message,registered,bookedInvoices,bookedIds,allocationConflict,reference};
}
const referenceLabel=(kind:string)=>kind==='ocr'?'OCR':kind==='invoice'?'Fakturareferens':'Betalningsreferens';
export function paymentEvidenceView(t:Transaction){
  // A later manual verification says nothing about the earlier snapshot's
  // origin. Only explicit manual entry/split provenance supports that label.
  const manual=t.evidence==='verified_specification'||(!t.evidence||t.evidence==='manual_verified')&&t.source==='Manuellt registrerad';
  const source=hasBankSource(t)?'bank':manual?'manual':'unknown';
  const reference=bankPaymentReference(t),originalReference=source==='bank'?referenceView(t.original?.payerReference||'',t.referenceEvidence,t.referenceParts):{kind:'reference'};
  return {payer:payerLabel(t),payerKnown:!!bankPayer(t),reference,referenceLabel:referenceLabel(reference.kind),manualPayer:t.verification?.party||(t.evidence==='verified_specification'?t.party:''),manualReference:t.verification?.payerReference||(t.evidence==='verified_specification'?t.payerReference:''),original:{source,label:source==='bank'?'Bankens ursprungliga uppgifter':source==='manual'?'Manuellt registrerade ursprungsuppgifter':'Sparade ursprungsuppgifter · källan är inte verifierad',referenceLabel:referenceLabel(originalReference.kind)}};
}
export function bankPaymentView(state:State,t:Transaction,candidates:Candidate[]=[]){
  const sourceLink=activeBankgiroLink(state,t.id),fieldSources=bankPaymentFieldSources(state,t);
  const assessment=bankPaymentInvoiceAssessment(state,t,fieldSources),evidenceView=paymentEvidenceView(t),requiresSpecification=needsPaymentSpecification(t);
  const allocations=state.allocations.filter(a=>a.active&&a.transactionId===t.id),invoices=allocations.map(a=>state.invoices.find(i=>i.id===a.invoiceId)).filter(i=>!!i);
  const invoiceNumbers=[...new Set(invoices.map(i=>i.number))];
  const selectedReference=fieldSources.reference.value.value,sourceCandidates=candidates.filter(c=>!selectedReference||exactReference(selectedReference,c.number)||state.invoices.some(i=>i.number===c.number&&i.ocr&&exactReference(selectedReference,i.ocr)));
  const possible=[...new Set([...sourceCandidates.map(c=>c.number),...(assessment.status!=='verified'&&assessment.invoice?[assessment.invoice.number]:[])])];
  const evidence=fieldSources.reference.evidence;
  const references=matchingReferenceValues(evidence,fieldSources.reference.value.value);
  const owners=new Set(state.invoices.filter(i=>!i.voided&&references.some(value=>[i.number,i.ocr].some(actual=>actual&&exactReference(value,actual)))).map(i=>i.id));
  const contradictory=references.length>1&&!state.invoices.some(i=>references.every(value=>[i.number,i.ocr].some(actual=>actual&&exactReference(value,actual))));
  const bankConflict=paymentEvidenceConflict(state,t),conflict=bankConflict||!!evidence?.incomplete||!!evidence?.candidates.some(c=>c.validity==='checksum_invalid')||owners.size>1||contradictory;
  let status='Behöver granskas',verified=false;
  if(t.ignored)status='Undantagen';
  else if(t.duplicateOf)status='Möjlig dubblett';
  else if(bankConflict)status='Motstridigt bankunderlag';
  else if(paymentOriginalIssue(state,t))status='Original behöver verifieras';
  else if(needsBankFileValidation(t))status='Original behöver verifieras';
  else if(assessment.allocationConflict)status='Referenskonflikt';
  else if(sourceLink&&!allocations.length)status='Fakturan behöver granskas';
  else if(requiresSpecification)status='Specifikation saknas';
  else if(conflict)status='Konflikt';
  else if(t.specificationStatus==='review'||!t.verified||needsBankFileReview(t))status='Behöver granskas';
  else if(allocations.length){
    verified=true;
    status=invoices.some(i=>balance(state,i)>0)?'Delbetalning':available(state,t)>0?'Överbetalning':'Verifierad';
  }else if(possible.length)status='Möjlig matchning';
  const sources=sourceLink?'Swedbank + Bankgiro '+(sourceLink.rows.some(row=>/xlsx|excel/i.test(row.format||row.source||''))?'Excel':'specifikation'):'';
  const candidateNote=!sourceLink&&bankgiroLinkCandidates(state,t).length?'Möjlig tillhörande Bankgirospecifikation – kontrollera.':'';
  return {...evidenceView,payer:fieldSources.payer.value||(t.amount<0?'Mottagare okänd':'Betalare okänd'),payerKnown:!!fieldSources.payer.value,reference:fieldSources.reference.value,referenceLabel:referenceLabel(fieldSources.reference.value.kind),fieldSources,sourceLink,sources,candidateNote,sourceLabel:sourceLink?'Manuellt verifierad underlagskoppling':t.specificationStatus==='review'?'Granskningsunderlag · räknas inte som pengar':'',invoice:invoiceNumbers.length?invoiceNumbers.join(', '):possible.length?'Möjlig: '+possible.join(', '):'Saknas',invoiceVerified:invoiceNumbers.length>0&&!assessment.allocationConflict&&assessment.status!=='ambiguous'&&!bankConflict&&!paymentOriginalIssue(state,t),invoiceNumbers,possible,status,verified,requiresSpecification};
}
export function bankVisibleTransactions(state:State){
  const linkedSpecifications=new Set((state.bankgiroLinks||[]).flatMap(link=>activeBankgiroLink(state,link.transactionId)?.rows.map(row=>row.id)||[]));
  return state.transactions.filter(t=>{
    if(t.specificationStatus==='review'&&linkedSpecifications.has(t.id))return false;
    const children=state.transactions.filter(c=>c.parentId===t.id&&!c.ignored&&!c.duplicateOf);
    return !children.length||!children.every(c=>c.specificationStatus!=='review'&&c.account===t.account&&c.currency===t.currency)||children.reduce((n,c)=>n+c.amount,0)!==t.amount;
  });
}
export function bankPaymentCounts(state:State){
  const rows=bankVisibleTransactions(state);
  const views=rows.filter(t=>!t.ignored&&t.amount>0).map(t=>bankPaymentView(state,t));
  return {verified:views.filter(v=>v.verified).length,specifications:views.filter(v=>v.requiresSpecification).length,review:views.filter(v=>!v.verified&&!v.requiresSpecification).length};
}
