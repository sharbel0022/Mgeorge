'use client';
import {useEffect,useState} from 'react';
type Summary={connection?:{status?:string;blocked?:boolean};sync_health?:{state?:string;reason?:string};last_successful_fetch?:string;processing?:{registered?:number;counts?:Record<string,number>;worker_online?:boolean;cloud_ocr_configured?:boolean;cloud_worker_recent?:boolean;messages_waiting?:number}};
const healthLabels:Record<string,string>={blocked:'Automatik stoppad',stale:'Hämtningen behöver kontrolleras',paused:'Dokumentautomatik pausad',waiting:'Väntar på Gmail',pending:'Hämtning behöver följas upp',not_configured:'Schema saknas',not_verified:'Hämtning inte verifierad',recent:'Nyligen hämtat',disconnected:'Behöver anslutas'};
const date=(value?:string)=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Stockholm'}).format(new Date(value)):'';
export default function GmailSummary(){
  const [data,setData]=useState<Summary|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/gmail/status?summary=1',{cache:'no-store',signal:controller.signal})
      .then(r=>{if(!r.ok)throw Error('status_unavailable');return r.json();})
      .then(result=>{if(!result||typeof result!=='object')throw Error('invalid_status');if(!controller.signal.aborted)setData(result as Summary);})
      .catch(()=>{if(!controller.signal.aborted)setFailed(true);});
    return()=>controller.abort();
  },[]);
  const status=failed?'Status kunde inte hämtas':!data?'Hämtar status…':healthLabels[data.sync_health?.state||'']||(data.connection?.blocked?'Automatik stoppad':data.connection?.status==='connected'?'Ansluten':'Ej ansluten');
  const processing=data?.processing,at=date(data?.last_successful_fetch);
  const ocr=processing?.cloud_ocr_configured?(processing.cloud_worker_recent?'Moln-OCR har nyligen kontakt':'Moln-OCR väntar på körning'):(processing?.worker_online?'OCR-dator ansluten':'OCR väntar på datorn');
  return <div><a className="text-button" href="/gmail">Gmail: {status} →</a>{data?.sync_health?.reason&&<small>{data.sync_health.reason}</small>}{processing&&<small>{processing.registered??0} registrerade · {(processing.counts?.needs_review||0)+(processing.counts?.duplicate||0)} att granska · {ocr} · <a href="/kundmeddelanden">{processing.messages_waiting??0} mejlutkast</a>{at&&<> · Hämtat {at}</>}</small>}</div>;
}
