'use client';
import {useEffect,useState} from 'react';
import {useCompanyWorkspace} from '@/components/company-workspace';

type AiStatus={status:'disabled'|'blocked'|'configured';code:string|null;model:string|null;policyStatus:string;policyCode:string|null;liveVerified:false};
const labels={disabled:'Avstängt',blocked:'Spärrat',configured:'Konfigurerat'};

/** A read-only diagnostic. Authorization is checked again by the API. */
export default function AdminAiStatus(){
 const workspace=useCompanyWorkspace(),allowed=workspace?.canManageIntegrations===true;
 const [result,setResult]=useState<AiStatus|null>(null),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  setResult(null);setError(false);if(!allowed)return;
  let active=true;const abort=new AbortController();
  void fetch('/api/admin/ai-status',{cache:'no-store',signal:abort.signal}).then(async response=>{
   if(!response.ok)throw Error('AI status unavailable');
   const value:unknown=await response.json();
   if(!value||typeof value!=='object'||!('status'in value)||!Object.hasOwn(labels,String(value.status))||!('liveVerified'in value)||value.liveVerified!==false)throw Error('Invalid AI status');
   if(active)setResult(value as AiStatus);
  }).catch(()=>{if(active)setError(true);});
  return()=>{active=false;abort.abort();};
 },[allowed,workspace?.activeCompanyId,attempt]);
 if(!allowed)return null;
 const enabled=result?.policyStatus==='enabled';
 return <div className="connection-setting"><div><strong>OpenAI</strong><span className="pill" role="status">{result?labels[result.status]:error?'Status kunde inte hämtas':'Hämtar status…'}</span></div>
  {result&&<><p>{enabled?'AI är tillåtet enligt serverns policy. Verklig modellåtkomst och fakturering är inte verifierade av denna status.':result.status==='configured'?'OpenAI är konfigurerat men företagets godkännanden eller villkor spärrar användningen. Befintlig OCR används.':'OpenAI är inte konfigurerat. Befintlig OCR används.'}</p><details><summary>Administrativ diagnostik</summary><p>Modell: {result.model||'Inte angiven'}. Diagnoskod: {result.policyCode||result.code||'Ingen'}.</p><p>Visningen aktiverar ingen integration och skickar inga kundunderlag.</p></details></>}
  <button type="button" className="text-button" disabled={!result&&!error} onClick={()=>setAttempt(value=>value+1)}>Hämta AI-status igen</button>
 </div>;
}
