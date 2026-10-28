import {available,balance,normalizeOCR,usablePaymentReference,validDate,needsPaymentSpecification,type State,type Transaction} from '../domain';
export type BankInvoiceCandidate={documentId:string;invoiceId:string;number:string;party:string;amount:number;issued:string;needsReview:boolean;source:'invoice'|'gmail';reason:string};
export const fieldValue=(v:any)=>v&&typeof v==='object'&&'value' in v?v.value:v;
export function readInvoiceFields(raw:unknown):Record<string,any>{
 try{const p=typeof raw==='string'?JSON.parse(raw):raw as any,f=p?.fields||p?.values||p||{};return Object.fromEntries(Object.entries(f).map(([k,v])=>[k,fieldValue(v)]));}catch{return {};}
}
export function candidateDocuments(rows:any[]){
 const out:BankInvoiceCandidate[]=[],seen=new Set<string>();
 for(const r of rows){if(seen.has(r.document_id)||r.status==='rejected')continue;const job=readInvoiceFields(r.job_extraction),f=Object.keys(job).length?job:readInvoiceFields(r.extraction),number=f.invoice_number||f.number,party=f.party,total=f.total_cents;
  if(f.direction!=='customer'||f.kind&&f.kind!=='invoice'||f.currency!=='SEK'||typeof number!=='string'||!number||number.length>100||typeof party!=='string'||!party||party.length>200||!Number.isSafeInteger(total)||total<=0||!validDate(f.issued_at||''))continue;
  seen.add(r.document_id);out.push({documentId:r.document_id,invoiceId:'',number,party,amount:total,issued:f.issued_at,needsReview:true,source:'gmail',reason:'Belopp och fakturadatum kan passa. Bankens OCR och betalare är inte verifierade mot fakturan.'});
 }return out;
}
/** Suggestions are deliberately separate from payment evidence and never mutate State. */
export function bankInvoiceCandidates(state:State,t:Transaction,documents:any[]=[]){
 if(t.ignored||t.duplicateOf||t.amount<=0||available(state,t)<=0)return [];
 const reference=t.bankDetails?.payerReference||(!needsPaymentSpecification(t)?t.payerReference:'');
 const exact=usablePaymentReference(reference)?normalizeOCR(reference):'';
 const registered=state.invoices.filter(i=>!i.voided&&i.direction==='receivable'&&balance(state,i)>0).map(i=>({documentId:i.documentId,invoiceId:i.id,number:i.number,party:i.party,amount:balance(state,i),issued:i.issued,needsReview:!i.reviewed,source:'invoice' as const,reason:'Belopp och fakturadatum kan passa. Betalningskopplingen är inte verifierad.',ocr:i.ocr}));
 const used=new Set(state.invoices.map(i=>i.documentId).filter(Boolean)),all=[...registered,...candidateDocuments(documents).filter(d=>!used.has(d.documentId))];
 return all.filter(i=>i.issued<=t.date&&(exact?[i.number,'ocr' in i?i.ocr:''].some(n=>typeof n==='string'&&normalizeOCR(n)===exact):i.amount===available(state,t))).sort((a,b)=>b.issued.localeCompare(a.issued)||a.number.localeCompare(b.number)).slice(0,12);
}
