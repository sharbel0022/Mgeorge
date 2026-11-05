import {activeBankgiroLink,bankgiroLinkCandidates,available,balance,economicTransactions,bankPayerName,bankPaymentSourceFacts,bankPaymentReviewReason,recordedPaymentSourceIssue,paymentPresentationAccountIssue,needsBankFileReview,needsBankFileValidation,needsPaymentSpecification,paymentInvoiceAssessment,paymentEvidenceConflict,paymentOriginalIssue,usablePaymentReference,invoiceReferenceMatches,invoiceReferenceDecision,type Invoice,type State,type Transaction} from './domain';
import {exactReference} from './reconciliation-engine.js';
import {matchingReferenceValues,ocrChecksum} from './payment-references.js';

type Candidate={number:string;party?:string;identifiers?:{field:string;value:string}[];referenceFields?:{field:string;value:string}[]};
/** Consume the existing scoped policy without rewriting invoice or bank facts. */
export const invoiceIntendedReference=(state:State,invoice:Pick<Invoice,'direction'|'number'|'ocr'|'referenceOriginal'>)=>invoiceReferenceDecision(state,invoice).intendedPaymentReference||'';
type PaymentDisplayDecision={code:'VERIFIED'|'REVIEW'|'BLOCKED';label:string;reason:string;next:string};
const hasBankSource=(t:Transaction)=>['bank_api','bank_file','bankgiro_file'].includes(t.evidence||'')&&!needsBankFileValidation(t);
const cleanParty=bankPayerName;
/** Bank originals and manual completion are deliberately separate identities. */
export function bankPayer(t:Transaction){
  return bankPaymentSourceFacts(t).payer;
}
export const payerLabel=(t:Transaction)=>bankPayer(t)||(t.amount<0?'Mottagare okänd':'Betalare okänd');
type ReferenceDisplay={value:string;kind:'missing'|'ocr'|'invoice'|'reference';ocr:string;ocrIssue?:string};
function referenceView(value:string,evidence:Transaction['referenceEvidence'],parts:Transaction['referenceParts']):ReferenceDisplay{
  if(!usablePaymentReference(value))return {value:'',kind:'missing',ocr:''};
  const exact=evidence?.candidates.filter(c=>c.kind!=='message'&&c.value===value)||[];
  const matchingParts=parts?.filter(p=>p.value===value)||[];
  const ocr=exact.some(c=>c.kind==='ocr')||matchingParts.some(p=>p.kind==='ocr');
  const conflicting=matchingReferenceValues(evidence,value).some(reference=>reference!==value);
  const ocrIssue=!ocr?'':evidence?.incomplete?'Bankrapporterad OCR har ofullständigt underlag.':conflicting?'Bankens OCR- och referensuppgifter är motstridiga.':!ocrChecksum(value)||evidence?.candidates.some(c=>c.validity==='checksum_invalid')?'Bankrapporterad OCR har ogiltig kontrollsiffra.':!exact.some(c=>c.kind==='ocr'&&c.validity==='checksum_valid')?'Bankrapporterad OCR är inte validerad.':'';
  const invoice=exact.some(c=>c.kind==='invoice')||matchingParts.some(p=>p.kind==='invoice');
  return {value,kind:ocr?'ocr':invoice?'invoice':'reference',ocr:ocr&&!ocrIssue?value:'',...(ocrIssue?{ocrIssue}:{})};
}
export function bankPaymentReference(t:Transaction):ReferenceDisplay{
  const facts=bankPaymentSourceFacts(t);
  return referenceView(facts.reference,facts.referenceEvidence,facts.referenceParts);
}
type FieldSourceKind='report'|'detail'|'transaction';
const fieldSourceLabel=(kind:FieldSourceKind,t:Transaction)=>kind==='report'?'Kopplat Bankgirooriginal':kind==='detail'?'Bankens separata detaljoriginal':hasBankSource(t)?'Bankens transaktionsoriginal':'Sparad transaktionsuppgift · bankkälla ej verifierad';
/** One read-only source decision per displayed field. Never fall back to a
 * different original's identifiers or reference classifications. */
export function bankPaymentFieldSources(state:State,t:Transaction){
  const link=activeBankgiroLink(state,t.id),linkedRow=link?.rows.length===1?link.rows[0]:undefined;
  const facts=bankPaymentSourceFacts(t),linkedPayer=linkedRow?cleanParty(linkedRow.party):'',payerKind:FieldSourceKind=linkedPayer?'report':facts.payerSource;
  const payerRow=payerKind==='report'?linkedRow!:t,payerValue=linkedPayer||facts.payer;
  const linkedReference=linkedRow?referenceView(linkedRow.payerReference,linkedRow.referenceEvidence,linkedRow.referenceParts):undefined,referenceKind:FieldSourceKind=linkedReference?.value?'report':facts.referenceSource;
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
  const registered=reference?state.invoices.filter(i=>!i.voided&&i.direction===direction&&invoiceReferenceMatches(state,i,reference)):[];
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
  const selectedReference=fieldSources.reference.value.value,sourceCandidates=candidates.filter(c=>!selectedReference||exactReference(selectedReference,c.number)||(c.identifiers||c.referenceFields||[]).some(identifier=>exactReference(selectedReference,identifier.value))||state.invoices.some(i=>i.number===c.number&&i.ocr&&exactReference(selectedReference,i.ocr)));
  const possible=[...new Set([...sourceCandidates.map(c=>c.number),...(assessment.status!=='verified'&&assessment.invoice?[assessment.invoice.number]:[])])];
  const evidence=fieldSources.reference.evidence;
  const references=matchingReferenceValues(evidence,fieldSources.reference.value.value);
  const direction=t.amount>0?'receivable':'payable',scoped=state.invoices.some(i=>i.direction===direction&&invoiceReferenceDecision(state,i).applies);
  const owners=new Set(state.invoices.filter(i=>!i.voided&&(!scoped||i.direction===direction)&&references.some(value=>invoiceReferenceMatches(state,i,value,true))).map(i=>i.id));
  const contradictory=references.length>1&&!state.invoices.some(i=>references.every(value=>invoiceReferenceMatches(state,i,value)));
  const bankConflict=paymentEvidenceConflict(state,t),originalIssue=paymentOriginalIssue(state,t),conflict=bankConflict||!!evidence?.incomplete||!!evidence?.candidates.some(c=>c.validity==='checksum_invalid')||owners.size>1||contradictory;
  const sourceIssue=sourceLink?'':allocations.map(allocation=>{const invoice=invoices.find(item=>item.id===allocation.invoiceId);return invoice?recordedPaymentSourceIssue(state,t,invoice,allocation.effect):'Den registrerade fakturan saknas.';}).find(Boolean)||'';
  // A chargeback/refund type is a review instruction, not an absent-original
  // error. Keep all independent source/account/reference holds ahead of it.
  const paymentTypeReview=!!sourceIssue&&assessment.status==='review'&&sourceIssue===bankPaymentReviewReason(t,state);
  const detailIssue=bankPaymentSourceFacts(t).detailIssue;
  let status='Behöver granskas',verified=false;
  if(t.ignored)status='Undantagen';
  else if(t.duplicateOf)status='Möjlig dubblett';
  else if(bankConflict)status='Motstridigt bankunderlag';
  else if(originalIssue)status='Original behöver verifieras';
  else if(needsBankFileValidation(t))status='Original behöver verifieras';
  else if(assessment.status==='review')status='Behöver granskas';
  else if(assessment.allocationConflict)status='Referenskonflikt';
  else if(sourceIssue)status='Behöver granskas';
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
  const intendedInvoices=assessment.bookedInvoices.length?assessment.bookedInvoices:assessment.registered.length===1?assessment.registered:[];
  const intendedReferences=[...new Map(intendedInvoices.map(invoice=>{
    const reference=invoiceReferenceDecision(state,invoice),value=reference.intendedPaymentReference||'';
    return [invoice.id,{number:invoice.number,value,proposal:!assessment.bookedIds.includes(invoice.id),source:reference.source==='invoice_number_policy'?'Företagets fakturanummerregel':value?'Fakturans uttryckliga referens':'Ingen uttrycklig referens',conflict:!!value&&!!selectedReference&&!(reference.applies?invoiceReferenceMatches(state,invoice,selectedReference):exactReference(value,selectedReference)),...(reference.status==='BLOCKED'?{issue:reference.reason}:{})}];
  })).values()];
  const policyIssue=intendedReferences.find(reference=>reference.issue)?.issue;
  const accountIssue=paymentPresentationAccountIssue(state,t);
  // These labels describe the saved presentation. The existing original-check
  // endpoint remains authoritative for a fresh read; no allocation is changed.
  const decision:PaymentDisplayDecision={code:'REVIEW',label:'Behöver granskas',reason:status,next:assessment.invoice?'Granska fakturaoriginalet och kundrelationen före ett separat godkännande.':'Identifiera och granska rätt faktura och dess original.'};
  const block=(reason:string,next:string)=>Object.assign(decision,{code:'BLOCKED',label:'Blockerad',reason,next});
  if(t.ignored)block('Posten är undantagen.','Granska undantaget innan posten används för en betalning.');
  else if(t.duplicateOf)block('Posten kan vara en dubblett.','Kontrollera bankens identitet och original mot den tidigare posten.');
  else if(bankConflict)block('Bankunderlagen är motstridiga.','Jämför de motstridiga originalen innan avstämning.');
  else if(originalIssue||needsBankFileValidation(t))block(originalIssue||'Bankoriginalet behöver verifieras.','Kontrollera det bevarade bankoriginalets integritet.');
  else if(accountIssue)block(accountIssue,'Kontrollera mottagarkontot mot bankens uttryckliga kontouppgifter.');
  else if(detailIssue)block(detailIssue,'Kontrollera de separata detaljuppgifternas bevarade original och AIS-källa.');
  else if(policyIssue)block(policyIssue,'Granska fakturans avsedda referens, företagsregel och bevarade original.');
  else if(assessment.allocationConflict)block(assessment.message,'Granska fakturakopplingen mot den visade bankreferensen.');
  else if(conflict)block('Referensen är ofullständig eller motstridig.','Kontrollera originalreferensen och eventuell OCR-kontroll.');
  else if(requiresSpecification&&!sourceLink)block('Individuella Bankgirodetaljer saknas.','Hämta en individuell betalningsspecifikation med betalare, referens och delbelopp.');
  else if(!fieldSources.payer.value)block('Banken har inte styrkt en individuell betalare eller mottagare.','Kontrollera betalaren i ett individuellt bankoriginal.');
  else if(!selectedReference)block('Bankrapporterad betalningsreferens saknas.','Kontrollera referensen i bankens individuella betalningsunderlag.');
  else if(sourceIssue&&!paymentTypeReview)block(sourceIssue,'Granska det bevarade bankunderlaget mot den registrerade fakturan.');
  else if(assessment.status==='review')decision.reason=assessment.message;
  else if(intendedReferences.some(reference=>reference.conflict)){decision.reason='Fakturans uttryckliga referens avviker från bankrapporterad referens.';decision.next='Jämför den uttryckliga referensen i fakturaoriginalet med bankens original innan betalningskopplingen verifieras.';}
  else if(sourceLink){decision.reason='Underlagsrelationen är manuellt styrkt.';decision.next='Granska den manuella underlagsrelationen, kundrelationen och fakturan separat.';}
  else if(t.specificationStatus==='review'){decision.reason='Rapportobservation, inte en separat ekonomisk betalning.';decision.next='Kontrollera rapportens mottagarkonto och relation till bankens insättning.';}
  else if(allocations.length&&(!invoices.length||invoices.some(invoice=>!invoice.reviewed||!invoice.documentId))){decision.reason='Den registrerade fakturans granskning eller originalunderlag återstår.';decision.next='Öppna och granska fakturans original innan betalningskopplingen visas som verifierad.';}
  else if(verified){decision.code='VERIFIED';decision.label='Verifierad';decision.reason='Fakturakopplingen stöds av sparat bankunderlag.';decision.next='Öppna betalningen för aktuell originalkontroll och betalningshistorik.';}
  // A recorded allocation alone cannot satisfy the current invoice-evidence decision.
  return {...evidenceView,payer:fieldSources.payer.value||(t.amount<0?'Mottagare okänd':'Betalare okänd'),payerKnown:!!fieldSources.payer.value,reference:fieldSources.reference.value,referenceLabel:referenceLabel(fieldSources.reference.value.kind),fieldSources,sourceLink,sources,candidateNote,sourceLabel:sourceLink?'Manuellt verifierad underlagskoppling':t.specificationStatus==='review'?'Granskningsunderlag · räknas inte som pengar':'',invoice:invoiceNumbers.length?invoiceNumbers.join(', '):possible.length?'Möjlig: '+possible.join(', '):'Saknas',invoiceVerified:invoiceNumbers.length>0&&decision.code==='VERIFIED',invoiceNumbers,intendedReferences,possible,status,decision,verified,requiresSpecification};
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
  const rows=bankVisibleTransactions(state),economicIds=new Set(economicTransactions(state).map(t=>t.id));
  const views=rows.filter(t=>economicIds.has(t.id)&&t.amount>0).map(t=>bankPaymentView(state,t));
  return {verified:views.filter(v=>v.decision.code==='VERIFIED').length,specifications:views.filter(v=>v.requiresSpecification).length,review:views.filter(v=>v.decision.code!=='VERIFIED'&&!v.requiresSpecification).length,observations:rows.filter(t=>!t.ignored&&!t.duplicateOf&&!economicIds.has(t.id)).length};
}
