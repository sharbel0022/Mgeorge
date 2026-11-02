import {exactReference} from '../reconciliation-engine.js';
import {available,balance,normalizeOCR,usablePaymentReference,validDate,type State,type Transaction} from '../domain';
import {bankPaymentFieldSources} from '../payment-presentation';
export type BankInvoiceCandidate={documentId:string;invoiceId:string;number:string;party:string;amount:number;issued:string;needsReview:boolean;source:'invoice'|'gmail';reason:string;identifiers?:{field:'number'|'reference'|'ocr';value:string}[];matchedFields?:('number'|'reference'|'ocr')[];extractionSource?:'document_jobs'|'gmail_sources';referenceConflict?:boolean};
export type DocumentInvoiceCandidate=BankInvoiceCandidate&{extractionSource:'document_jobs'|'gmail_sources';referenceFields:{field:'reference'|'ocr';value:string}[];referenceConflict:boolean};
export const fieldValue=(v:any)=>v&&typeof v==='object'&&'value' in v?v.value:v;
export function readInvoiceFields(raw:unknown):Record<string,any>{
 try{const p=typeof raw==='string'?JSON.parse(raw):raw as any,f=p?.fields||p?.values||p||{};return Object.fromEntries(Object.entries(f).map(([k,v])=>[k,fieldValue(v)]));}catch{return {};}
}
export function candidateDocuments(rows:any[]){
 const out:DocumentInvoiceCandidate[]=[],seen=new Set<string>();
 for(const r of rows){if(seen.has(r.document_id)||r.status==='rejected')continue;const job=readInvoiceFields(r.job_extraction),fromJob=Object.keys(job).length>0,f=fromJob?job:readInvoiceFields(r.extraction),number=f.invoice_number||f.number,party=f.party,total=f.total_cents;
  if(f.direction!=='customer'||f.kind&&f.kind!=='invoice'||f.currency!=='SEK'||typeof number!=='string'||!number||number.length>100||typeof party!=='string'||!party||party.length>200||!Number.isSafeInteger(total)||total<=0||!validDate(f.issued_at||''))continue;
  // A current job is the whole extraction source; never fill its missing fields
  // from older Gmail metadata. Current reference and legacy OCR stay separate.
  const referenceFields:DocumentInvoiceCandidate['referenceFields']=(['reference','ocr'] as const).flatMap(field=>typeof f[field]==='string'&&f[field].trim()?[{field,value:f[field]}]:[]);
  const referenceConflict=referenceFields.length>1&&!exactReference(referenceFields[0].value,referenceFields[1].value);
  seen.add(r.document_id);out.push({identifiers:[{field:'number',value:number},...referenceFields],extractionSource:fromJob?'document_jobs':'gmail_sources',referenceFields,referenceConflict,documentId:r.document_id,invoiceId:'',number,party,amount:total,issued:f.issued_at,needsReview:true,source:'gmail',reason:'Belopp och fakturadatum kan passa. Bankens OCR och betalare är inte verifierade mot fakturan.'});
 }return out;
}
/** An exact identifier selects review evidence, never a verified invoice. */
export function matchingDocumentCandidates(rows:any[],reference:string){
 return candidateDocuments(rows).flatMap(candidate=>{
  const matchedFields=[{field:'number',value:candidate.number},...candidate.referenceFields].filter(identifier=>exactReference(reference,identifier.value)).map(identifier=>identifier.field);
  return matchedFields.length?[{...candidate,matchedField:matchedFields[0],matchedFields}]:[];
 });
}
/** Suggestions are deliberately separate from payment evidence and never mutate State. */
export function bankInvoiceCandidates(state:State,t:Transaction,documents:any[]=[]){
 if(t.ignored||t.duplicateOf||t.amount<=0||available(state,t)<=0)return [];
 const reference=bankPaymentFieldSources(state,t).reference.value.value;
 const exact=usablePaymentReference(reference)?normalizeOCR(reference):'';
 const registered=state.invoices.filter(i=>!i.voided&&i.direction==='receivable'&&balance(state,i)>0).map(i=>({documentId:i.documentId,invoiceId:i.id,number:i.number,party:i.party,amount:balance(state,i),issued:i.issued,needsReview:!i.reviewed,source:'invoice' as const,reason:'Belopp och fakturadatum kan passa. Betalningskopplingen är inte verifierad.',ocr:i.ocr}));
 const used=new Set(state.invoices.map(i=>i.documentId).filter(Boolean)),documentCandidates=exact?matchingDocumentCandidates(documents,reference):candidateDocuments(documents),all=[...registered,...documentCandidates.filter(d=>!used.has(d.documentId))];
 return all.filter(i=>i.issued<=t.date&&(exact?i.source==='gmail'||[i.number,'ocr' in i?i.ocr:''].some(n=>typeof n==='string'&&exactReference(reference,n)):i.amount===available(state,t))).sort((a,b)=>b.issued.localeCompare(a.issued)||a.number.localeCompare(b.number)).slice(0,12);
}
