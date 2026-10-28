'use client';
import {useEffect,useRef,useState} from 'react';
import {money} from '@/lib/domain';
import type {PaymentHistoryEntry} from '@/lib/payment-history';
export default function PaymentHistory({transactionId,demo=false}:{transactionId:string;demo?:boolean}){
 const [entries,setEntries]=useState<PaymentHistoryEntry[]>([]),[next,setNext]=useState<string|null>(null),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const controller=useRef<AbortController|null>(null),running=useRef(false);
 useEffect(()=>()=>controller.current?.abort(),[]);
 async function load(before?:string){if(running.current||demo)return;running.current=true;setBusy(true);setError('');const abort=new AbortController();controller.current=abort;try{
  const query=new URLSearchParams({transactionId,...(before?{before}:{})}),res=await fetch('/api/bank/history?'+query,{cache:'no-store',signal:abort.signal}),data=await res.json() as {entries:PaymentHistoryEntry[];next:string|null;error?:string};
  if(!res.ok)throw Error(data.error||'Historiken kunde inte hämtas.');if(abort.signal.aborted)return;
  setEntries(old=>before?[...old,...data.entries]:data.entries);setNext(data.next);setLoaded(true);
 }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Historiken kunde inte hämtas.');}finally{if(!abort.signal.aborted){running.current=false;setBusy(false);}}}
 return <details className="original-bank-details" onToggle={e=>{if(e.currentTarget.open&&!loaded&&!error)void load();}}><summary>Verifieringshistorik för betalningen</summary>
  {demo?<p>Demoläget har ingen sparad bankhistorik.</p>:<div aria-busy={busy}>
   {busy&&<p role="status">Hämtar historik…</p>}{error&&<p role="alert">{error} <button type="button" className="text-button" onClick={()=>void load(next||undefined)}>Försök igen</button></p>}
   {loaded&&!entries.length&&<p>Ingen tidigare verifiering finns registrerad för betalningen.</p>}
   <ol className="payment-history">{entries.map(entry=><li key={entry.id}><strong>{entry.label}</strong><small>{entry.actor} · {new Date(entry.at).toLocaleString('sv-SE',{timeZone:'Europe/Stockholm'})}</small>{entry.settlement&&<p>Faktura {entry.settlement.invoice} · {money(entry.settlement.amount)}{entry.settlement.effect==='refund'?' · Återbetalning':''}</p>}{entry.note&&<p>{entry.note}</p>}{entry.payer&&<p>Manuellt verifierad betalare: {entry.payer}</p>}{entry.reference&&<p>Manuellt verifierad referens: <span className="mono">{entry.reference}</span></p>}{entry.decisions.map((d,n)=><p key={n}>{d.reason}{d.rule&&<small>Matchningsregel: {d.rule}</small>}</p>)}</li>)}</ol>
   {next&&<button type="button" className="btn small" disabled={busy} onClick={()=>void load(next)}>Visa äldre händelser</button>}
  </div>}
 </details>;
}
