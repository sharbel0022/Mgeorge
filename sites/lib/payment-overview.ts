import {classifyDocument,jsonObject} from './document-triage.js';
import {economySummary} from './economy-summary.js';
import {available,balance,credited,invoiceStatus,needsPaymentSpecification,paid,today,type State,type Transaction} from './domain';
import {analyze} from './reconciliation';

type Row=Record<string,any>;
export type ReviewItem={id:string;type:'document'|'payment'|'specification'|'message'|'invoice'|'anomaly';entity_id:string;invoice_id?:string;transaction_id?:string;title:string;reason:string;action:string;amount_cents:number|null;priority:number;date?:string};
/** Presentation only. Never changes bank originals or accepts a proposed match. */
export function paymentGroup(state:State,t:Transaction){
  if(t.ignored)return 'excluded';
  const children=state.transactions.filter(c=>c.parentId===t.id&&!c.ignored&&!c.duplicateOf);
  if(!t.duplicateOf&&available(state,t)===0||children.length>0&&children.every(c=>c.specificationStatus!=='review'&&c.account===t.account&&c.currency===t.currency)&&children.reduce((n,c)=>n+c.amount,0)===t.amount)return 'matched';
  if(needsPaymentSpecification(t))return 'bankgiro';
  if(t.amount<0||/kortköp|card purchase|card refund|återbetalning.*kort|löneutbetalning/iu.test(`${t.description} ${t.payerReference}`))return 'other';
  return 'incoming';
}
export const paymentTitle=(t:Transaction)=>t.bankDetails?.party||t.party.trim()||(needsPaymentSpecification(t)?'Bankgiro – betalningsspecifikation saknas':t.description.trim()||(t.amount<0?'Utbetalning – mottagare saknas':'Inbetalning – betalare saknas'));
// A collection's provider reference is not an individual payer's OCR.
export const paymentPayerReference=(t:Transaction)=>t.bankDetails?.payerReference||(needsPaymentSpecification(t)?'Saknas – individuell specifikation behövs':t.payerReference||'Saknas');
const messageKinds:Record<string,string>={partial:'Delbetalning',possible_vat:'Möjlig momsavvikelse',wrong_reference:'Avvikande OCR eller fakturareferens',missing_reference:'Betalningsreferens saknas',overdue:'Förfallen faktura efter verifierad kontroll',possible_duplicate:'Möjlig dubbelbetalning',overpayment:'Överbetalning att reda ut',confirmation:'Begäran om betalningsbekräftelse'};

export function buildPaymentOverview(state:State,documents:Row[]=[],messages:Row[]=[]){
  const customers=state.invoices.filter(i=>i.direction==='receivable'&&!i.voided),reviewed=customers.filter(i=>i.reviewed),findings=analyze(state);
  const groups:Record<string,Transaction[]>={incoming:[],bankgiro:[],other:[],matched:[],excluded:[]};
  for(const t of state.transactions)groups[paymentGroup(state,t)].push(t);
  const queue:ReviewItem[]=[],pending=[...new Map(documents.filter(d=>!d.invoice_id&&d.status==='needs_review'&&!['queued','waiting_ocr','processing'].includes(d.state||d.processing_state)&&!classifyDocument(d).exclude_from_invoice_queue).map(d=>[d.document_id,d])).values()],currentMessages=messages.filter(m=>['draft','sending','unknown'].includes(m.status));
  for(const m of currentMessages){const invoice=state.invoices.find(i=>i.id===m.invoice_id),uncertain=m.status!=='draft',kind=messageKinds[m.kind]||'Kundmeddelande';queue.push({id:'message:'+m.id,type:'message',entity_id:m.id,invoice_id:m.invoice_id,title:`${invoice?.party||'Kund'} · ${invoice?.number||'Faktura'}`,reason:uncertain?'Utskickets status är oklar. Kontrollera Skickat i Gmail. Skicka inte igen.':`${kind}. ${m.recipient?'Läs och godkänn den aktuella mejlversionen.':'Verifiera kundadressen och läs utkastet före godkännande.'}`,action:uncertain?'Kontrollera utskick':'Läs mejlutkast',amount_cents:invoice?Math.max(0,balance(state,invoice)):null,priority:uncertain?0:40,date:invoice?.due||m.created_at});}
  for(const d of pending)queue.push({id:'document:'+d.document_id,type:'document',entity_id:d.document_id,title:d.filename||'Fakturaunderlag',reason:d.state==='failed'?'Dokumenttolkningen misslyckades. Originalet finns kvar.':d.state==='waiting_ocr'?'Dokumentet väntar säkert på den lokala OCR-datorn.':d.state==='duplicate'?'Möjlig dubblett behöver kontrolleras.':(jsonObject(d.processing_extraction||d.extraction).issues||[]).slice(0,2).join(' ')||'Kontrollera tolkade fält, moms och kunduppgifter mot originalet.',action:'Granska faktura',amount_cents:null,priority:10,date:d.created_at});
  const paymentReview=[...groups.incoming,...groups.other.filter(t=>!!t.duplicateOf||findings.some(f=>f.transaction_id===t.id&&!!f.invoice_id))];
  for(const t of paymentReview){const related=findings.filter(f=>f.transaction_id===t.id),ids=[...new Set(related.map(f=>f.invoice_id).filter(Boolean))];queue.push({id:'payment:'+t.id,type:'payment',entity_id:t.id,transaction_id:t.id,invoice_id:ids.length===1?ids[0]:undefined,title:paymentTitle(t),reason:t.duplicateOf?'Möjlig dubblett av ett annat bankunderlag. Posten hålls för kontroll och kan inte matchas som en ny betalning.':ids.length>1?`${ids.length} fakturor kan passa. Kontrollera underlaget innan du väljer.`:related[0]?.reason||'Ingen säker fakturakoppling. Beloppet ensamt är inget betalningsbevis.',action:'Granska betalning',amount_cents:available(state,t),priority:t.duplicateOf?15:20,date:t.date});}
  for(const t of groups.bankgiro)queue.push({id:'specification:'+t.id,type:'specification',entity_id:t.id,transaction_id:t.id,title:'Samlingsbetalning',reason:'Individuella betalningsuppgifter saknas eller är ofullständiga. Samlingsbeloppet får inte räknas en gång till.',action:'Lägg till underlag',amount_cents:available(state,t),priority:15,date:t.date});
  const messaged=new Set(currentMessages.map(m=>m.invoice_id)),suggested=new Set(findings.map(f=>f.invoice_id));
  for(const i of customers){
    const p=paid(state,i.id),left=balance(state,i),overdue=left>0&&!!i.due&&i.due<today();
    const related=findings.filter(f=>f.invoice_id===i.id),economic=related.find(f=>['overpayment','possible_duplicate'].includes(f.kind));
    let type:ReviewItem['type']='invoice',reason='Betalning är inte bekräftad. Det är inte samma sak som att fakturan är obetald.',priority=35;
    if(!i.reviewed){reason='Fakturauppgifterna måste granskas mot originalet.';priority=10;}
    else if(p>0&&left>0){type='anomaly';reason=`En verifierad delbetalning finns. ${i.vat!=null&&i.net!=null&&i.net+i.vat===i.total&&i.net===p&&left===i.vat?'Skillnaden motsvarar angiven moms. Orsaken behöver bekräftas.':'Kontrollera återstående belopp.'}`;priority=25;}
    else if(left<0||economic){if(economic&&paymentReview.some(t=>t.id===economic.transaction_id))continue;type='anomaly';reason=economic?.reason||'Verifierade betalningar överstiger fakturans saldo. Granska eventuell överbetalning.';priority=15;}
    else if(overdue){type='anomaly';reason=i.reconciledAt?'Fakturan är förfallen med kvarvarande saldo efter verifierad kontroll.':'Förfallodatumet har passerat. Betalning är ännu inte bekräftad; kontrollera bankunderlaget.';priority=30;}
    else if(left<=0||suggested.has(i.id)||messaged.has(i.id)||i.reviewed&&!!i.due&&i.due>=today())continue;
    queue.push({id:type+':'+i.id,type,entity_id:i.id,invoice_id:i.id,title:i.party+' · '+i.number,reason,action:'Visa faktura och underlag',amount_cents:Math.max(0,left),priority,date:i.due||i.issued});
  }
  queue.sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
  const sum=(items:typeof customers,value:(i:typeof customers[number])=>number)=>items.reduce((n,i)=>n+value(i),0),open=reviewed.filter(i=>balance(state,i)>0),partial=open.filter(i=>paid(state,i.id)>0),overdue=open.filter(i=>i.due&&i.due<today());
  const checked=(i:typeof customers[number])=>!!i.reconciledAt&&!!i.reconciliationNote?.trim();
  const economy=economySummary(state);
  const processing=documents.filter(d=>!d.invoice_id&&d.status==='needs_review'&&['queued','waiting_ocr','processing'].includes(d.state||d.processing_state));
  return {economy,totals:{invoiced_cents:sum(reviewed,i=>i.total-credited(state,i.id)),paid_cents:sum(reviewed,i=>paid(state,i.id)),remaining_cents:sum(open,i=>balance(state,i)),unreconciled_cents:sum(open.filter(i=>!checked(i)),i=>balance(state,i)),verified_outstanding_cents:sum(open.filter(checked),i=>balance(state,i)),overdue_cents:sum(overdue,i=>balance(state,i)),partial_count:partial.length,partial_remaining_cents:sum(partial,i=>balance(state,i)),paid_count:reviewed.filter(i=>invoiceStatus(state,i).key==='paid').length,open_count:open.length,overdue_count:overdue.length},counts:{review:queue.length,documents:pending.length,processing:new Set(processing.map(d=>d.document_id)).size,other_documents:new Set(documents.filter(d=>classifyDocument(d).exclude_from_invoice_queue).map(d=>d.document_id)).size,payments:paymentReview.length,specifications:groups.bankgiro.length,messages:currentMessages.length,anomalies:queue.filter(q=>q.type==='anomaly').length,other:groups.other.length},queue};
}
