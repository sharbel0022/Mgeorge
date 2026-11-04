'use client';
import {useEffect,useState} from 'react';

type JobStatus='PENDING'|'RETRY'|'IMPORTED'|'REVIEW'|'DUPLICATE'|'BLOCKED';
type ReportStatus={
 enabled:boolean;sourceId:string|null;mode?:string|null;state:string;reason:string|null;
 nextPollAt:string|null;missingReportIds:string[];counts:Record<JobStatus,number>;
 authorization?:{status:string;verifiedAt:string|null;validUntil:string|null}|null;
 lastSuccessAt?:string|null;lastFailureAt?:string|null;lastFailureCode?:string|null;
 jobs:{id:string;reportId:string;status:JobStatus;lastError?:string|null}[];lastError:string|null;
};
const labels:Record<JobStatus,string>={PENDING:'Väntar på inläsning',RETRY:'Väntar på nytt försök',IMPORTED:'Inläst',REVIEW:'Behöver granskning',DUPLICATE:'Redan inläst',BLOCKED:'Spärrad'};
const date=(value?:string|null)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',dateStyle:'short',timeStyle:'short'}).format(new Date(value)):null;
const errors:Record<string,string>={
 AUTHORIZATION_BLOCKED:'Rapportkällans behörighet behöver kontrolleras.',AUTHORIZATION_CHANGED:'Rapportkällans behörighet har ändrats.',
 RATE_LIMITED:'Källan begränsar antalet hämtningar.',TIMEOUT:'Hämtningen tog för lång tid.',SOURCE_UNAVAILABLE:'Rapportkällan kunde inte nås.',
 INVALID_PAGE:'Källans rapportlista kunde inte godkännas.',HASH_MISMATCH:'Rapportens kontrollsumma stämmer inte.',IDENTITY_CONFLICT:'Rapportens identitet eller innehåll har ändrats.',
 INVALID_ORIGINAL:'Rapportoriginalet kunde inte godkännas.',INVALID_SINK_RESULT:'Inläsningen kunde inte bekräftas.',LEASE_LOST:'Körningen avbröts när körlåset ändrades.',
 ACCOUNT_MISMATCH:'Rapportens konto stämmer inte med företagets verifierade bankkonto.',
 BANKGIRO_INFORMATION_UNAVAILABLE:'Individuell betalningsinformation är inte tillgänglig i API-underlaget.',
 BANKGIRO_INFORMATION_PARTIAL:'Individuell betalningsinformation är ofullständig och behöver granskas.',
 BANKGIRO_ENRICHMENT_REVIEW:'Bankgirodetaljerna behöver granskas mot bankoriginalet.',
};
const errorLabel=(code?:string|null)=>code?(Object.hasOwn(errors,code)?errors[code]:'Orsaken kunde inte visas. Kontrollera rapportkällan.'):null;

export function BankgiroSourceView({status,loading=false,error=false,demo=false}:{status:ReportStatus|null;loading?:boolean;error?:boolean;demo?:boolean}){
 const heading=<h3>Automatisk Bankgirohämtning</h3>;
 if(demo)return <section className="panel bankgiro-source-panel">{heading}<p>Demoläge – ingen bankhämtning görs.</p></section>;
 if(error)return <section className="panel bankgiro-source-panel">{heading}<p role="status">Rapportstatus kunde inte läsas. Försök igen genom att öppna vyn på nytt.</p></section>;
 if(loading||!status)return <section className="panel bankgiro-source-panel" aria-busy="true">{heading}<p role="status">Läser rapportstatus…</p></section>;
 const next=date(status.nextPollAt);
 const authorization=status.authorization,now=Date.now();
 const verifiedAt=date(authorization?.verifiedAt),validUntil=date(authorization?.validUntil);
 const registered=status.enabled&&!!status.sourceId&&status.mode==='production';
 const expired=authorization?.status==='EXPIRED'||authorization?.status==='VERIFIED'&&!!validUntil&&Date.parse(authorization.validUntil!)<=now;
 const verified=registered&&authorization?.status==='VERIFIED'&&!!verifiedAt&&!!validUntil&&Date.parse(authorization.verifiedAt!)<=now&&Date.parse(authorization.validUntil!)>now;
 const authLabel=authorization?.status==='BLOCKED'?'Spärrad':expired?'Utgången':verified?'Verifierad':'Inte verifierad';
 const latestError=errorLabel(status.lastFailureCode??status.lastError);
 return <section className="panel bankgiro-source-panel" aria-label="Status för Bankgirorapporter">
  {heading}
  {!status.enabled?<p>Automatisk hämtning är avstängd. En auktoriserad rapportkälla behöver anslutas och verifieras.</p>:<p role="status">{status.state==='BLOCKED'||authLabel==='Spärrad'?'Rapportinläsningen är spärrad. Rapportkälla och underlag behöver kontrolleras.':status.state==='BACKOFF'?'Hämtningen väntar till nästa tillåtna försök.':!verified?'Aktuell behörighet behöver verifieras innan hämtning.':status.state==='RUNNING'?'Rapporter läses in.':status.state==='REVIEW'?'Rapporter eller leveranser behöver granskas.':'Rapportkön väntar på nästa hämtning.'}</p>}
  <dl className="bank-summary">
   <div><dt>Rapportkälla</dt><dd>{registered?'Registrerad':status.mode==='synthetic'?'Testkälla':'Ingen registrerad rapportkälla'}</dd></div>
   <div><dt>Behörighet</dt><dd>{authLabel}</dd></div>
   <div><dt>Nästa möjliga hämtning</dt><dd>{next??(status.enabled?'Ingen tid bekräftad':'Efter verifierad anslutning')}</dd></div>
   <div><dt>Senaste lyckade hämtning</dt><dd>{date(status.lastSuccessAt)??'Ingen bekräftad'}</dd></div>
   <div><dt>Senaste misslyckade hämtning</dt><dd>{date(status.lastFailureAt)??'Ingen bekräftad'}</dd></div>
  </dl>
  <dl className="bank-summary">
   <div><dt>Väntar på inläsning</dt><dd>{status.counts.PENDING}</dd></div>
   <div><dt>Väntar på nytt försök</dt><dd>{status.counts.RETRY}</dd></div>
   <div><dt>Inlästa rapporter</dt><dd>{status.counts.IMPORTED}</dd></div>
   <div><dt>Behöver granskning</dt><dd>{status.counts.REVIEW}</dd></div>
   <div><dt>Spärrade rapporter</dt><dd>{status.counts.BLOCKED}</dd></div>
   <div><dt>Redan inlästa</dt><dd>{status.counts.DUPLICATE}</dd></div>
  </dl>
  {latestError&&<p role="status">Senaste rapporterade fel: {latestError}</p>}
  {status.missingReportIds.length>0&&<p role="status">Källan rapporterar {status.missingReportIds.length} saknade rapporter. Det bevisar inte att en betalning saknas.</p>}
  {(verifiedAt||validUntil)&&<details><summary>Behörighetskvitto</summary><dl className="bank-summary"><div><dt>Verifierad</dt><dd>{verifiedAt??'Ingen tid bekräftad'}</dd></div><div><dt>Giltig till</dt><dd>{validUntil??'Ingen tid bekräftad'}</dd></div></dl></details>}
  {status.jobs.length>0&&<details><summary>Senaste rapporterna</summary><ul>{status.jobs.slice(0,10).map(job=><li key={job.id}><span className="mono">{job.reportId}</span> · {labels[job.status]??'Behöver granskning'}{job.lastError&&<span className="bankgiro-job-error">{errorLabel(job.lastError)}</span>}</li>)}</ul></details>}
  <p className="muted">Om API-underlaget saknar individuella betalningar används företagets CAMT054C/SFTP-källa när ett godkänt avtal finns. Manuell filimport, inklusive Excelimport, finns kvar som sista reserv. En inläst rapport innebär att underlaget har sparats; betalningen behöver fortfarande ha tillräckliga bankbevis.</p>
 </section>;
}

function validStatus(value:unknown):value is ReportStatus{
 if(!value||typeof value!=='object')return false;
 const status=value as ReportStatus;
 const optionalText=(item:unknown)=>item==null||typeof item==='string';
 return typeof status.enabled==='boolean'&&['DISABLED','IDLE','RUNNING','BACKOFF','REVIEW','BLOCKED'].includes(status.state)&&
  [status.lastSuccessAt,status.lastFailureAt,status.lastFailureCode].every(optionalText)&&
  (status.authorization==null||typeof status.authorization==='object'&&typeof status.authorization.status==='string'&&optionalText(status.authorization.verifiedAt)&&optionalText(status.authorization.validUntil))&&
  (status.nextPollAt===null||typeof status.nextPollAt==='string')&&Array.isArray(status.missingReportIds)&&status.missingReportIds.every(item=>typeof item==='string')&&
  !!status.counts&&Object.keys(labels).every(key=>Number.isSafeInteger(status.counts[key as JobStatus])&&status.counts[key as JobStatus]>=0)&&
  Array.isArray(status.jobs)&&status.jobs.every(job=>!!job&&typeof job.id==='string'&&typeof job.reportId==='string'&&Object.hasOwn(labels,job.status)&&optionalText(job.lastError));
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
