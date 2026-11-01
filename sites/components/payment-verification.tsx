'use client';
import {useEffect,useState} from 'react';
import type {PaymentVerification} from '@/lib/payment-verification';

export function PaymentVerificationReport({report}:{report:PaymentVerification}){
 return <><p className="payment-verification-note">Läsande kontroll · inga saldon ändras. Öppna ett steg för källa, regel och nästa åtgärd.</p><ol className="payment-verification-steps">{report.steps.map((step,index)=><li key={step.id}><details><summary><span className="payment-verification-number" aria-hidden="true">{index+1}</span><span>{step.label}</span><strong className={'payment-verification-status is-'+step.status}>{step.statusLabel}</strong></summary><div className="payment-verification-body"><p>{step.reason}</p><dl><div><dt>Källa</dt><dd>{step.source}</dd></div><div><dt>Kontrollerad</dt><dd>{new Date(step.checkedAt).toLocaleString('sv-SE',{timeZone:'Europe/Stockholm'})}</dd></div>{step.facts.map((fact,n)=><div key={n}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}<div><dt>Kontrollregel</dt><dd>{step.rule}</dd></div><div><dt>Nästa steg</dt><dd>{step.next}</dd></div></dl></div></details></li>)}</ol></>;
}

export default function PaymentVerificationPanel({transactionId,revision,demo=false}:{transactionId:string;revision:number;demo?:boolean}){
 const [report,setReport]=useState<PaymentVerification|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(!demo),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(demo)return;const controller=new AbortController();let stopped=false;
  setReport(null);setError('');setLoading(true);
  void (async()=>{try{const response=await fetch('/api/bank/verification?transactionId='+encodeURIComponent(transactionId),{cache:'no-store',signal:controller.signal}),result=await response.json() as PaymentVerification&{error?:string};if(!response.ok)throw Error(result.error||'Betalningskontrollen kunde inte läsas.');if(!stopped)setReport(result);}catch(error){if(!stopped)setError(error instanceof Error?error.message:'Betalningskontrollen kunde inte läsas.');}finally{if(!stopped)setLoading(false);}})();
  return()=>{stopped=true;controller.abort();};
 },[transactionId,revision,demo,attempt]);
 return <section className="payment-verification" aria-labelledby={'verification-heading-'+transactionId}><h3 id={'verification-heading-'+transactionId}>Betalningskontroll</h3>{demo?<p>Demoläget har inga åtkomliga bank- eller fakturaoriginal. Verifieringsstegen visas vid läsning av en sparad betalning.</p>:<div aria-busy={loading}>{loading&&<p role="status">Kontrollerar bevarade underlag…</p>}{error&&<p role="alert">{error} <button type="button" className="text-button" onClick={()=>setAttempt(n=>n+1)}>Försök igen</button></p>}{report&&<PaymentVerificationReport report={report}/>}</div>}</section>;
}
