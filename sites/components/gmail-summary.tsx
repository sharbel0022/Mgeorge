'use client';
import {useEffect,useState} from 'react';
import {gmailNeedsReconnect,DocumentQueueStatus,GmailAttachmentRejections,GmailFetchStatus,type AttachmentRejections,type Processing,type ScheduleObservation} from './document-ocr-status';
type Summary={connection?:{status?:string;blocked?:boolean};sync_health?:{state?:string;reason?:string};last_successful_fetch?:string;schedule_observation?:ScheduleObservation;attachment_rejections?:AttachmentRejections;processing?:Processing};
const healthLabels:Record<string,string>={blocked:'Automatik stoppad',stale:'Hämtningen behöver kontrolleras',paused:'Dokumentautomatik pausad',waiting:'Väntar på Gmail',pending:'Hämtning behöver följas upp',not_configured:'Automatik inte konfigurerad',not_verified:'Hämtning inte verifierad',recent:'Nyligen hämtat',disconnected:'Behöver anslutas'};
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
  const status=failed?'Status kunde inte hämtas':!data?'Hämtar status…':!data.connection?'Ej ansluten':gmailNeedsReconnect(data.connection.status)?'Behöver anslutas igen':data.connection.status==='blocked'?'Behöver kontrolleras':['connected','retry_wait'].includes(data.connection.status||'')?'Ansluten':'Status okänd';
  const processing=data?.processing,health=data?.connection?.blocked?'Automatik stoppad':healthLabels[data?.sync_health?.state||''];
  const ocr=processing?.cloud_ocr_configured?(processing.cloud_worker_recent?'Moln-OCR har nyligen kontakt':'Moln-OCR väntar på körning'):(processing?.worker_online?'OCR-dator ansluten':'OCR väntar på datorn');
  return <div><a className="text-button" href="/gmail">Gmail: {status} →</a>{data&&<>{health&&<small className="block">{health}{data.sync_health?.reason?' · '+data.sync_health.reason:''}</small>}<GmailFetchStatus compact lastSuccessfulFetch={data.last_successful_fetch} observation={data.schedule_observation}/><DocumentQueueStatus compact processing={processing}/><GmailAttachmentRejections compact rejections={data.attachment_rejections}/>{processing&&<small className="block">{ocr} · <a href="/kundmeddelanden">{Number.isSafeInteger(processing.messages_waiting)?processing.messages_waiting:'Okänt antal'} mejlutkast</a></small>}</>}</div>;
}
