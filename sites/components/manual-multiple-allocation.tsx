'use client';
import {useEffect,useRef,useState} from 'react';
import {createManualMultipleClient,parseManualAmount,manualMoney} from '@/lib/manual-multiple-client.js';

type Draft={amounts:Record<string,string>;note:string};
type ViewProps={snapshot:any;draft:Draft;confirmed:boolean;disabled?:boolean;history?:string[];originals?:Record<string,string>;onAction:(action:string,requestId?:string)=>void;onDraft:(field:string,value:string)=>void;onConfirmed:(value:boolean)=>void};
const busyPhases=new Set(['loading','reviewing','submitting','recovering']);
const inputAmount=(value:number)=>(value/100).toFixed(2).replace('.',',');

/** The view never changes the vector after review. Editing consumes the quote. */
export function ManualMultipleView({snapshot,draft,confirmed,disabled=false,history=[],originals={},onAction,onDraft,onConfirmed}:ViewProps){
 const {phase,discovery,quote,receipt,error}=snapshot,busy=disabled||busyPhases.has(phase),review=quote||receipt,rows=review?.allocations||discovery?.invoices||[];
 const historical=phase==='saved',editable=phase==='editing'||phase==='reviewing';
 return <section className="payment-verification manual-multiple-allocation" aria-label="Manuell fördelning på flera fakturor" aria-busy={busy}>
  <h3>{historical?'Manuellt registrerad fördelning':'Fördela på flera fakturor'}</h3>
  <p>{historical?'Historiskt kvitto för ett uttryckligt manuellt godkännande. Aktuella saldon visas i fakturaöversikten.':'Alla fakturor som bankoriginalets referenser anger ska ingå. Granska varje belopp och original innan hela fördelningen godkänns.'}</p>
  {error&&<p role="alert">{error}</p>}
  {phase==='closed'&&<button type="button" className="btn" disabled={busy} onClick={()=>onAction('load')}>Öppna manuell fördelning</button>}
  {busyPhases.has(phase)&&<p role="status">{phase==='submitting'?'Sparar hela fördelningen…':phase==='recovering'?'Hämtar sparat kvitto…':'Kontrollerar hela underlaget…'}</p>}
  {(editable||review)&&<>
   <dl className="details-grid"><div><dt>Betalare enligt granskat bankunderlag</dt><dd>{(review||discovery).payer}</dd></div><div><dt>Bankens betalningsreferenser</dt><dd>{(review||discovery).references.join(', ')}</dd></div><div><dt>{historical?'Tillgängligt vid godkännandet':'Tillgängligt i betalningen'}</dt><dd>{manualMoney(receipt?.availableBeforeMinor??quote?.availableMinor??discovery?.availableMinor)}</dd></div></dl>
   {editable&&discovery.shortfallMinor>0&&<p>Betalningen är {manualMoney(discovery.shortfallMinor)} mindre än fakturornas återstående skuld. Ange hur hela betalningen ska fördelas med ett positivt belopp på varje faktura.</p>}
   {editable&&discovery.excessMinor>0&&<p>När alla fakturor löses återstår {manualMoney(discovery.excessMinor)} i betalningen.</p>}
   <div className="table-scroll"><table><thead><tr><th>Faktura / referens</th><th>Kund</th><th>Fakturarest före</th><th>{editable?'Belopp att fördela':'Fördelat belopp'}</th>{!editable&&<th>Fakturarest efter</th>}</tr></thead><tbody>{rows.map((row:any)=><tr key={row.invoiceId}><td>{row.number}<small>Referens {row.reference}</small>{originals[row.invoiceId]&&<a className="text-button" href={'/api/files?id='+encodeURIComponent(originals[row.invoiceId])} target="_blank" rel="noopener">Visa fakturaoriginal</a>}</td><td>{row.customer}</td><td>{manualMoney(row.invoiceRemainingBeforeMinor)}</td><td>{editable?<label><span className="sr-only">Belopp för faktura {row.number} i kronor</span><input name={'manual-amount-'+row.invoiceId} aria-label={'Belopp för faktura '+row.number+' i kronor'} inputMode="decimal" autoComplete="off" maxLength={24} value={draft.amounts[row.invoiceId]||''} disabled={busy} onChange={event=>onDraft(row.invoiceId,event.target.value)}/></label>:manualMoney(row.amountMinor)}</td>{!editable&&<td>{manualMoney(row.invoiceRemainingAfterMinor)}</td>}</tr>)}</tbody></table></div>
   {editable?<>
    <label className="field"><span>Beskriv granskningen av originalen</span><textarea name="manual-note" maxLength={1500} value={draft.note} disabled={busy} onChange={event=>onDraft('note',event.target.value)}/></label>
    <p>Fördela hela betalningen eller lös alla fakturors återstående skuld. Fördelningen lämnar antingen betalningsrest eller fakturarest.</p>
    <button type="button" className="btn primary" disabled={busy} onClick={()=>onAction('review')}>Granska hela fördelningen</button>
   </>:<>
    <dl className="details-grid"><div><dt>Fördelat totalt</dt><dd>{manualMoney(review.allocatedMinor)}</dd></div><div><dt>{historical?'Betalningsrest vid godkännandet':'Betalningsrest efter'}</dt><dd>{manualMoney(review.paymentRemainingMinor)}</dd></div></dl>
    <p>Granskningsanteckning: {review.note}</p>
    {historical&&<p>Godkänd {new Date(receipt.approvedAt).toLocaleString('sv-SE',{timeZone:'Europe/Stockholm'})}.</p>}
   </>}
  </>}
  {phase==='review'&&<>
   <label className="check-field review-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>onConfirmed(event.target.checked)}/><span>Jag har kontrollerat alla original, fakturor, referenser, belopp och restbelopp och godkänner hela fördelningen manuellt.</span></label>
   <div className="button-row"><button type="button" className="btn" disabled={busy} onClick={()=>onAction('edit')}>Ändra fördelningen</button><button type="button" className="btn primary" disabled={busy||!confirmed} onClick={()=>onAction('confirm')}>Godkänn hela fördelningen</button></div>
  </>}
  {phase==='unknown'&&<><p>Begärans-ID: <code>{snapshot.requestId}</code></p><div className="button-row"><button type="button" className="btn" disabled={busy} onClick={()=>onAction('recover')}>Hämta kvitto</button><button type="button" className="btn" disabled={busy} onClick={()=>onAction('retry')}>Försök samma godkännande igen</button></div></>}
  {!busy&&!['unknown','unreadable','review','editing'].includes(phase)&&history.length>0&&<div><h4>Tidigare manuella fördelningar</h4>{[...new Set(history)].map((id,index)=><button key={id} type="button" className="text-button" onClick={()=>onAction('receipt',id)}>Visa manuellt kvitto {index+1}</button>)}</div>}
 </section>;
}

type Props={transactionId:string;revision:number;companyKey:string;demo?:boolean;disabled?:boolean;history?:string[];originals?:Record<string,string>;onCommitted?:()=>void};
export default function ManualMultipleAllocation({transactionId,revision,companyKey,demo=false,disabled=false,history=[],originals={},onCommitted}:Props){
 const controller=useRef<ReturnType<typeof createManualMultipleClient>|null>(null),callback=useRef(onCommitted),previousRevision=useRef(revision);
 const [snapshot,setSnapshot]=useState<any>({phase:'closed',error:''}),[draft,setDraft]=useState<Draft>({amounts:{},note:''}),[confirmed,setConfirmed]=useState(false);
 callback.current=onCommitted;
 useEffect(()=>{
  if(demo)return;let storage:Storage|undefined;try{storage=window.sessionStorage;}catch{/* Confirmation explains unavailable durable browser storage. */}
  let previous='closed';
  const client=createManualMultipleClient({transactionId,companyId:companyKey==='legacy'?null:companyKey,scopeKey:companyKey+':'+transactionId,storage,onChange:value=>{
   if(value.phase==='editing'&&previous==='loading')setDraft({amounts:Object.fromEntries(value.discovery.invoices.map((row:any)=>[row.invoiceId,inputAmount(row.invoiceRemainingBeforeMinor)])),note:''});
   if(value.phase!=='review')setConfirmed(false);previous=value.phase;setSnapshot(value);
  },onCommitted:()=>callback.current?.()});
  controller.current=client;setSnapshot(client.snapshot);setConfirmed(false);previousRevision.current=revision;
  return()=>{client.dispose();if(controller.current===client)controller.current=null;};
  // Revisions invalidate a quote below; they must not discard a pending receipt.
 },[transactionId,companyKey,demo]);
 useEffect(()=>{if(previousRevision.current!==revision){previousRevision.current=revision;controller.current?.invalidate();setConfirmed(false);}},[revision]);
 if(demo)return <section className="payment-verification"><h3>Fördela på flera fakturor</h3><p>Demoläget kan inte godkänna fördelningar mot sparade bank- och fakturaoriginal.</p></section>;
 function action(name:string,id?:string){
  const client=controller.current;if(!client||disabled)return;
  if(name==='review')void client.review({allocations:snapshot.discovery.invoices.map((row:any)=>({invoiceId:row.invoiceId,amountMinor:parseManualAmount(draft.amounts[row.invoiceId]||'')})),note:draft.note});
  else if(name==='confirm')void client.confirm(confirmed);
  else if(name==='receipt')void client.readReceipt(id!);
  else if(name==='edit')client.edit();
  else if(name==='load')void client.load();
  else if(name==='recover')void client.recover();
  else if(name==='retry')void client.retry();
 }
 return <ManualMultipleView snapshot={snapshot} draft={draft} confirmed={confirmed} disabled={disabled} history={history} originals={originals} onAction={action} onConfirmed={setConfirmed} onDraft={(field,value)=>{setConfirmed(false);setDraft(current=>field==='note'?{...current,note:value}:{...current,amounts:{...current.amounts,[field]:value}});}}/>;
}
