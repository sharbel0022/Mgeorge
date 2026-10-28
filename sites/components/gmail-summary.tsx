'use client';
import {useEffect,useState} from 'react';
export default function GmailSummary(){
  const [status,setStatus]=useState('Hämtar status…'),[data,setData]=useState<any>(null);
  useEffect(()=>{const controller=new AbortController();fetch('/api/gmail/status?summary=1',{cache:'no-store',signal:controller.signal}).then(r=>r.ok?r.json():null).then((result:any)=>{if(!controller.signal.aborted&&result){setData(result);setStatus(result.connection?.blocked||result.connection?.status==='blocked'?'Automatik stoppad':result.connection?.status==='connected'?'Ansluten':result.connection?'Behöver kontrolleras':'Ej ansluten');}}).catch(()=>{if(!controller.signal.aborted)setStatus('Status kunde inte hämtas');});return()=>controller.abort();},[]);
  return <div><a className="text-button" href="/gmail">Gmail: {status} →</a>{data?.processing&&<small>{data.processing.registered} registrerade · {(data.processing.counts.needs_review||0)+(data.processing.counts.duplicate||0)} att granska · {data.processing.worker_online?'OCR-dator ansluten':'OCR väntar på datorn'} · <a href="/kundmeddelanden">{data.processing.messages_waiting} mejlutkast</a>{data.last_successful_fetch&&<> · Hämtat {new Date(data.last_successful_fetch).toLocaleString('sv-SE')}</>}</small>}</div>;
}
