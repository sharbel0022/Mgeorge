'use client';
import {useEffect,useMemo,useState} from 'react';
import {FileText,Mail} from 'lucide-react';
import {analyze} from '@/lib/reconciliation';
import {balance,money,paid,hasValidAbsenceCheck,invoicePaymentEvidenceIssue,type Invoice,type State} from '@/lib/domain';

type ReadStatus='ready'|'failed';
type InvoiceMessage={id:string;status:'draft'|'sending'|'unknown';subject:string;body:string;recipient:string};
type MessageRead={key:string;status:ReadStatus;items:InvoiceMessage[];error:string};
type OriginalRead={key:string;status:ReadStatus;url:string;error:string};

function readDrafts(value:unknown,invoiceId:string):InvoiceMessage[]{
 if(!value||typeof value!=='object'||!('items' in value)||!Array.isArray(value.items))throw Error('Mejlutkasten kunde inte hämtas.');
 const items:InvoiceMessage[]=[];
 for(const raw of value.items as unknown[]){
  if(!raw||typeof raw!=='object')throw Error('Mejlutkasten kunde inte hämtas.');
  const message=raw as Record<string,unknown>,sourceInvoice=message.invoice,status=message.status;
  if(!sourceInvoice||typeof sourceInvoice!=='object'||!('id' in sourceInvoice)||typeof sourceInvoice.id!=='string'||typeof status!=='string')throw Error('Mejlutkasten kunde inte hämtas.');
  if(sourceInvoice.id!==invoiceId||status!=='draft'&&status!=='sending'&&status!=='unknown')continue;
  if(typeof message.id!=='string'||typeof message.subject!=='string'||typeof message.body!=='string'||message.recipient!=null&&typeof message.recipient!=='string')throw Error('Mejlutkasten kunde inte hämtas.');
  items.push({id:message.id,status,subject:message.subject,body:message.body,recipient:message.recipient??''});
 }
 return items;
}

export default function InvoiceEvidence({invoice,state,demo,onMessage,openTransaction,originalOnly=false}:{originalOnly?:boolean;invoice:Invoice;state:State;demo:boolean;onMessage:(id:string)=>void;openTransaction:(id:string)=>void}){
 const [messageRead,setMessageRead]=useState<MessageRead|null>(null),[originalRead,setOriginalRead]=useState<OriginalRead|null>(null),[attempt,setAttempt]=useState(0);
 const identity=JSON.stringify([invoice.id,invoice.documentId,demo,originalOnly,attempt]);
 const [visit,setVisit]=useState({identity,epoch:0});
 let epoch=visit.epoch;
 if(visit.identity!==identity){epoch++;setVisit({identity,epoch});}
 const key=JSON.stringify([identity,epoch]);
 // Returning to an earlier identity is a new visit, including before effect cleanup.
 const messages=messageRead?.key===key?messageRead:null,original=originalRead?.key===key?originalRead:null;
 const retry=()=>setAttempt(n=>n+1);
 useEffect(()=>{
  if(demo)return;
  const controller=new AbortController();let url='';
  const current=()=>!controller.signal.aborted;
  if(!originalOnly){
   void(async()=>{
    try{
     const response=await fetch('/api/customer-messages/list',{cache:'no-store',signal:controller.signal});
     if(!current())return;
     if(!response.ok)throw Error('Mejlutkasten kunde inte hämtas.');
     const value:unknown=await response.json(),items=readDrafts(value,invoice.id);
     if(current())setMessageRead({key,status:'ready',items,error:''});
    }catch(error){if(current())setMessageRead({key,status:'failed',items:[],error:error instanceof Error?error.message:'Mejlutkasten kunde inte hämtas.'});}
   })();
  }
  if(invoice.documentId){
   void(async()=>{
    try{
     const response=await fetch('/api/files?id='+encodeURIComponent(invoice.documentId),{signal:controller.signal});
     if(!current())return;
     if(!response.ok)throw Error('Originalförhandsvisningen kunde inte hämtas.');
     const blob=await response.blob();
     if(!current())return;
     if(blob.size>15_000_000)throw Error('Öppna hela originalet för att se detta dokument.');
     const image=blob.type==='application/pdf'?await (await import('@/lib/local-ocr')).pdfPreview(new File([blob],'original.pdf',{type:blob.type})):blob;
     if(!current())return;
     if(image.type.startsWith('image/'))url=URL.createObjectURL(image);
     setOriginalRead({key,status:'ready',url,error:''});
    }catch(error){if(current())setOriginalRead({key,status:'failed',url:'',error:error instanceof Error?error.message:'Originalförhandsvisningen kunde inte hämtas.'});}
   })();
  }
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 },[invoice.id,invoice.documentId,demo,originalOnly,attempt,key]);
 const analysis=useMemo(()=>originalOnly?[]:analyze(state),[state,originalOnly]);
 const findings=analysis.filter(finding=>finding.invoice_id===invoice.id),remaining=balance(state,invoice),paymentIssue=invoicePaymentEvidenceIssue(state,invoice.id),netDifference=!paymentIssue&&invoice.vat!=null&&invoice.net!=null&&remaining>0&&invoice.net+invoice.vat===invoice.total&&remaining===invoice.vat&&paid(state,invoice.id)===invoice.net;
 return <div className={'invoice-evidence-grid '+(originalOnly?'original-only':'')}>
  <section><h3 className="section-title">1. Originalfaktura och uppgifter</h3>
   {invoice.documentId?<><a className="text-button" href={'/api/files?id='+encodeURIComponent(invoice.documentId)} target="_blank" rel="noopener"><FileText size={15}/> Öppna hela originalet</a>
    {!demo&&!original&&<p role="status">Hämtar originalförhandsvisningen…</p>}
    {original?.url&&<img className="invoice-original-preview" src={original.url} alt="Originalfaktura, första sidan"/>}
    {original?.status==='ready'&&!original.url&&<p className="detail-empty">Förhandsvisning saknas för det här filformatet. Öppna hela originalet.</p>}
    {original?.status==='failed'&&<p role="alert" className="form-error">{original.error} <button type="button" className="text-button" onClick={retry}>Hämta underlag igen</button></p>}
   </>:<p className="detail-empty">Inget original bifogat.</p>}
   <dl className="details-grid"><div><dt>Exklusive moms</dt><dd>{invoice.net==null?'Saknas i underlaget':money(invoice.net)}</dd></div><div><dt>Moms</dt><dd>{invoice.vat==null?'Saknas i underlaget':money(invoice.vat)}</dd></div><div><dt>Organisationsnummer</dt><dd>{invoice.organizationNumber||'Saknas i underlaget'}</dd></div></dl>
  </section>
  {!originalOnly&&<section><h3 className="section-title">2. Avvikelseanalys och förslag</h3>
   {!hasValidAbsenceCheck(state,invoice)&&paid(state,invoice.id)===0&&<p className="control-hint">Ingen säker betalning är kopplad. Detta bevisar inte att fakturan är obetald.</p>}
   {paymentIssue&&<p className="control-hint">{paymentIssue}</p>}
   {netDifference&&<p className="invoice-difference">Verifierat betalt är {money(paid(state,invoice.id))} av {money(invoice.total)}. Differensen {money(remaining)} motsvarar fakturans angivna moms. Det är en möjlig förklaring som behöver kontrolleras mot betalningsunderlaget.</p>}
   {findings.length?findings.map((finding,n)=><article className="invoice-finding" key={finding.transaction_id+'-'+n}><strong>Förslag att granska</strong><p>{finding.reason}</p>{finding.transaction_id&&<button className="btn small" onClick={()=>openTransaction(finding.transaction_id)}>Granska betalningsunderlaget</button>}</article>):<p className="detail-empty">Inga nya säkra förslag i det hämtade underlaget.</p>}
   <h3 className="section-title">3. Kundmeddelande</h3>
   {demo?<p className="detail-empty">Demoläget har inga sparade mejlutkast.</p>:!messages?<p role="status">Hämtar aktuella mejlutkast…</p>:messages.status==='failed'?<p role="alert" className="form-error">{messages.error} <button type="button" className="text-button" onClick={retry}>Hämta underlag igen</button></p>:messages.items.length?messages.items.map(message=><article className="invoice-mail" key={message.id}><strong>{message.subject}</strong><p>Till: {message.recipient||'Kundadressen behöver verifieras'}</p><pre>{message.body}</pre><button className="btn primary" onClick={()=>onMessage(message.id)}><Mail size={16}/>{message.status==='draft'?'Läs och granska mejlet':'Kontrollera oklar leverans'}</button><small>Varje utskick kräver att du granskar och uttryckligen godkänner den aktuella versionen.</small></article>):<p className="detail-empty">Inget aktuellt mejlutkast. Betalningskontrollen förbereder utkast när underlaget visar ett uppföljningsbehov.</p>}
  </section>}
 </div>;
}
