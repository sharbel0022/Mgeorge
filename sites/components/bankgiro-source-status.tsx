'use client';
import {useEffect,useState} from 'react';

type JobStatus='PENDING'|'RETRY'|'IMPORTED'|'REVIEW'|'DUPLICATE'|'BLOCKED';
type ReportStatus={
 enabled:boolean;sourceId:string|null;mode?:string|null;state:string;reason:string|null;
 nextPollAt:string|null;missingReportIds:string[];counts:Record<JobStatus,number>;
 jobs:{id:string;reportId:string;status:JobStatus}[];lastError:string|null;
};
const labels:Record<JobStatus,string>={PENDING:'Väntar på inläsning',RETRY:'Väntar på nytt försök',IMPORTED:'Inläst',REVIEW:'Behöver granskning',DUPLICATE:'Redan inläst',BLOCKED:'Spärrad'};
const date=(value:string|null)=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',dateStyle:'short',timeStyle:'short'}).format(new Date(value)):null;

export function BankgiroSourceView({status,loading=false,error=false,demo=false}:{status:ReportStatus|null;loading?:boolean;error?:boolean;demo?:boolean}){
 const heading=<h3>Automatiska Bankgirorapporter</h3>;
 if(demo)return <section className="panel bankgiro-source-panel">{heading}<p>Demoläge – ingen bankhämtning görs.</p></section>;
 if(error)return <section className="panel bankgiro-source-panel">{heading}<p role="status">Rapportstatus kunde inte läsas. Försök igen genom att öppna vyn på nytt.</p></section>;
 if(loading||!status)return <section className="panel bankgiro-source-panel" aria-busy="true">{heading}<p role="status">Läser rapportstatus…</p></section>;
 const next=date(status.nextPollAt);
 return <section className="panel bankgiro-source-panel" aria-label="Status för Bankgirorapporter">
  {heading}
  {!status.enabled?<p>Automatisk hämtning är avstängd. En auktoriserad rapportkälla behöver anslutas och verifieras.</p>:<p role="status">{status.state==='BLOCKED'?'Rapportinläsningen är spärrad. Rapportkälla och underlag behöver kontrolleras.':status.state==='RUNNING'?'Rapporter läses in.':status.state==='BACKOFF'?'Hämtningen väntar till nästa tillåtna försök.':status.state==='REVIEW'?'Rapporter eller leveranser behöver granskas.':'Rapportkön är redo för nästa hämtning.'}</p>}
  <dl className="bank-summary">
   <div><dt>Inlästa rapporter</dt><dd>{status.counts.IMPORTED+status.counts.REVIEW}</dd></div>
   <div><dt>Behöver granskning</dt><dd>{status.counts.REVIEW+status.counts.BLOCKED}</dd></div>
   <div><dt>Nästa möjliga hämtning</dt><dd>{next??(status.enabled?'Ingen tid bekräftad':'Efter verifierad anslutning')}</dd></div>
  </dl>
  {status.missingReportIds.length>0&&<p role="status">{status.missingReportIds.length} förväntade rapporter saknas hos källan. Det bevisar inte att en betalning saknas.</p>}
  {status.jobs.length>0&&<details><summary>Senaste rapporterna</summary><ul>{status.jobs.slice(0,10).map(job=><li key={job.id}><span className="mono">{job.reportId}</span> · {labels[job.status]??'Behöver granskning'}</li>)}</ul></details>}
  <p className="muted">Manuell Excelimport finns kvar som reserv. En inläst rapport innebär att underlaget har sparats; betalningen behöver fortfarande ha tillräckliga bankbevis.</p>
 </section>;
}

function validStatus(value:unknown):value is ReportStatus{
 if(!value||typeof value!=='object')return false;
 const status=value as ReportStatus;
 return typeof status.enabled==='boolean'&&['DISABLED','IDLE','RUNNING','BACKOFF','REVIEW','BLOCKED'].includes(status.state)&&
  (status.nextPollAt===null||typeof status.nextPollAt==='string')&&Array.isArray(status.missingReportIds)&&status.missingReportIds.every(item=>typeof item==='string')&&
  !!status.counts&&Object.keys(labels).every(key=>Number.isSafeInteger(status.counts[key as JobStatus])&&status.counts[key as JobStatus]>=0)&&
  Array.isArray(status.jobs)&&status.jobs.every(job=>!!job&&typeof job.id==='string'&&typeof job.reportId==='string'&&Object.hasOwn(labels,job.status));
}

/** Reading status never triggers a bank request or starts an import. */
export default function BankgiroSourceStatus({demo=false}:{demo?:boolean}){
 const [status,setStatus]=useState<ReportStatus|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(false);
 useEffect(()=>{
  if(demo)return;
  let alive=true,controller:AbortController|null=null;
  const load=async()=>{
   controller?.abort();const current=new AbortController();controller=current;
   try{
    const response=await fetch('/api/bankgiro/source/status',{credentials:'same-origin',cache:'no-store',signal:current.signal});
    const data:unknown=await response.json();if(!response.ok||!validStatus(data))throw Error('status_unavailable');
    if(alive&&!current.signal.aborted){setStatus(data);setError(false);}
   }catch(cause){if(alive&&!current.signal.aborted){setStatus(null);setError(true);}}
   finally{if(alive&&!current.signal.aborted)setLoading(false);}
  };
  setStatus(null);setLoading(true);setError(false);void load();
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void load();},60_000);
  window.addEventListener('focus',load);
  return()=>{alive=false;controller?.abort();clearInterval(timer);window.removeEventListener('focus',load);};
 },[demo]);
 return <BankgiroSourceView status={status} loading={loading} error={error} demo={demo}/>;
}
