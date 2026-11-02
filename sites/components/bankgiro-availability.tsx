'use client';
import {useEffect,useState} from 'react';
import type {State} from '@/lib/domain';

type JobStatus='PENDING'|'RETRY'|'IMPORTED'|'REVIEW'|'DUPLICATE'|'BLOCKED';
type SourceState='DISABLED'|'IDLE'|'RUNNING'|'BACKOFF'|'REVIEW'|'BLOCKED';
export type BankgiroAvailability={
 enabled:boolean;sourceId:string|null;mode?:'production'|'synthetic'|null;state:SourceState;reason:string|null;
 nextPollAt:string|null;missingReportIds:string[];counts:Record<JobStatus,number>;lastError:string|null;
 jobs:{id:string;reportId:string;status:JobStatus;attempts?:number;nextAttemptAt?:string|null;updatedAt?:string|null}[];
};
const jobLabels:Record<JobStatus,string>={PENDING:'Väntar på inläsning',RETRY:'Väntar på nytt försök',IMPORTED:'Inläst',REVIEW:'Behöver granskning',DUPLICATE:'Redan inläst',BLOCKED:'Blockerad'};
const sourceLabels:Record<SourceState,string>={DISABLED:'Avstängd',IDLE:'Kön är redo',RUNNING:'Rapporter läses in',BACKOFF:'Väntar på nästa tillåtna försök',REVIEW:'Behöver granskas',BLOCKED:'Blockerad'};
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=500&&!/[\u0000-\u001f]/.test(v);
const instant=(v:unknown)=>v===null||typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const counter=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
/** Accept only the existing C3 public projection, without coercing identifiers. */
export function validBankgiroAvailability(value:unknown):value is BankgiroAvailability{
 if(!object(value)||typeof value.enabled!=='boolean'||!(value.sourceId===null||text(value.sourceId))||!(value.mode===undefined||value.mode===null||value.mode==='production'||value.mode==='synthetic')||typeof value.state!=='string'||!Object.hasOwn(sourceLabels,value.state))return false;
 if(value.enabled&&(!text(value.sourceId)||value.mode!=='production')||!value.enabled&&!['DISABLED','BLOCKED'].includes(value.state))return false;
 if(!(value.reason===null||text(value.reason))||!(value.lastError===null||text(value.lastError))||!instant(value.nextPollAt))return false;
 return Array.isArray(value.missingReportIds)&&value.missingReportIds.length<=1000&&value.missingReportIds.every(text)
  &&object(value.counts)&&Object.keys(jobLabels).every(key=>counter(value.counts[key]))
  &&Array.isArray(value.jobs)&&value.jobs.length<=200&&value.jobs.every(job=>object(job)&&text(job.id)&&text(job.reportId)&&typeof job.status==='string'&&Object.hasOwn(jobLabels,job.status)
   &&(job.attempts===undefined||counter(job.attempts))&&(job.nextAttemptAt===undefined||instant(job.nextAttemptAt))&&(job.updatedAt===undefined||instant(job.updatedAt)));
}

/** This read never runs acquisition, changes a schedule or asks the bank for data. */
export function useBankgiroAvailability(demo=false){
 const [read,setRead]=useState<{status:BankgiroAvailability|null;loading:boolean;error:string}>({status:null,loading:!demo,error:''});
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(demo)return;
  const controller=new AbortController();let active=true;
  const refresh=()=>setAttempt(value=>value+1);
  window.addEventListener('focus',refresh);
  setRead({status:null,loading:true,error:''});
  void(async()=>{
   try{
    const response=await fetch('/api/bankgiro/source/status',{method:'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal});
    if(response.status===404){if(active&&!controller.signal.aborted)setRead({status:null,loading:false,error:'Rapportstatus är inte tillgänglig i denna version.'});return;}
    const value:unknown=await response.json();
    if(!response.ok||!validBankgiroAvailability(value))throw Error('unavailable');
    if(active&&!controller.signal.aborted)setRead({status:value,loading:false,error:''});
   }catch{if(active&&!controller.signal.aborted)setRead({status:null,loading:false,error:'Rapportstatus kunde inte läsas. Försök igen.'});}
  })();
  return()=>{active=false;controller.abort();window.removeEventListener('focus',refresh);};
 },[demo,attempt]);
 return {...read,retry:()=>setAttempt(value=>value+1)};
}
const date=(value:string|null)=>value?new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):null;
type ViewProps={state:State;status:BankgiroAvailability|null;loading?:boolean;error?:string;demo?:boolean;retry?:()=>void};
export function BankgiroAvailabilityView({state,status,loading=false,error='',demo=false,retry}:ViewProps){
 const reports=new Set(state.transactions.filter(t=>t.specification&&!t.ignored&&t.bankFileProof?.documentId).map(t=>t.bankFileProof!.documentId)).size;
 return <section className="bank-report-availability" aria-label="Bankgirodetaljer och rapportåtkomst"><h2>Bankgirodetaljer</h2>
  {demo?<p>Demodata · rapporthämtning och bankbehörigheter kontrolleras inte.</p>:error?<p role="alert">{error} {retry&&<button type="button" className="text-button" onClick={retry}>Läs rapportstatus igen</button>}</p>:loading||!status?<p role="status" aria-busy="true">Läser rapportstatus…</p>:<>
   <dl><div><dt>Automatisk rapporthämtning</dt><dd>{sourceLabels[status.state]}</dd></div><div><dt>Senaste lyckade bankrapporthämtning</dt><dd>Inte bekräftad</dd></div><div><dt>Rapportkälla</dt><dd>{status.sourceId||'Ingen auktoriserad rapportkälla är ansluten.'}</dd></div><div><dt>Rapportbehörighet</dt><dd>{status.state==='BLOCKED'?'Blockerad · källan eller underlaget behöver kontrolleras.':status.enabled?'Konfigurerad källa · aktuell behörighet kontrolleras vid hämtning.':'Inte verifierad · en auktoriserad rapportkälla behöver anslutas och verifieras.'}</dd></div></dl>
   <p>Rapportköns status är inte ett kvitto på lyckad bankrapporthämtning. En ansluten kontohämtning styrker inte rapportbehörighet.</p>
   <dl><div><dt>Inlästa rapporter</dt><dd>{status.counts.IMPORTED+status.counts.REVIEW}</dd></div><div><dt>Behöver granskning</dt><dd>{status.counts.REVIEW+status.counts.BLOCKED}</dd></div><div><dt>Nästa möjliga hämtning</dt><dd>{date(status.nextPollAt)??(status.enabled?'Ingen tid bekräftad':'Efter verifierad anslutning')}</dd></div></dl>
   {status.missingReportIds.length>0&&<p role="status">{status.missingReportIds.length} förväntade rapporter saknas hos källan. Det bevisar inte att en betalning saknas.</p>}
   {status.jobs.length>0&&<details><summary>Senaste rapporterna</summary><ul>{status.jobs.slice(0,10).map(job=><li key={job.id}><span className="mono">{job.reportId}</span> · {jobLabels[job.status]}</li>)}</ul></details>}
  </>}
  {reports>0&&<p>{reports} sparade rapportunderlag finns. Importerade underlag bekräftar inte automatisk hämtning.</p>}
 </section>;
}
export function BankReportAvailability({state,demo=false}:{state:State;demo?:boolean}){
 const read=useBankgiroAvailability(demo);
 return <BankgiroAvailabilityView state={state} demo={demo} {...read}/>;
}
