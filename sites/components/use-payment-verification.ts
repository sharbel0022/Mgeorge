'use client';
import {useEffect,useRef,useState} from 'react';
import type {PaymentVerification} from '@/lib/payment-verification';
import {storedVerification,accountEvidenceDisplay,unknownAccountEvidence,type AccountEvidenceDisplay} from '@/lib/account-evidence-presentation';
type Scope={transactionId:string;revision:number;demo:boolean};
export function usePaymentVerification({transactionId,revision,demo}:Scope){
 const key=JSON.stringify([transactionId,revision,demo]),scope=useRef(key),sequence=useRef(0),accountAbort=useRef<AbortController|null>(null);
 // A changed prop invalidates the visible result before effect cleanup runs.
 scope.current=key;
 const [stored,setStored]=useState<{key:string;report:PaymentVerification}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(!demo),[attempt,setAttempt]=useState(0),[transient,setTransient]=useState<{key:string;value:AccountEvidenceDisplay}|null>(null),[accountLoading,setAccountLoading]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();let stopped=false;sequence.current++;accountAbort.current?.abort();accountAbort.current=null;
  setStored(null);setTransient(null);setAccountLoading(false);setError('');setLoading(!demo);
  if(!demo)void(async()=>{try{const response=await fetch('/api/bank/verification?transactionId='+encodeURIComponent(transactionId),{cache:'no-store',signal:controller.signal}),result:unknown=await response.json();if(!response.ok||!storedVerification(result,transactionId,revision))throw Error('Betalningskontrollen kunde inte läsas för den aktuella bankhändelsen.');if(!stopped&&scope.current===key)setStored({key,report:result});}catch{if(!stopped&&scope.current===key)setError('Betalningskontrollen kunde inte läsas. Läs in den aktuella versionen igen.');}finally{if(!stopped&&scope.current===key)setLoading(false);}})();
  return()=>{stopped=true;controller.abort();sequence.current++;accountAbort.current?.abort();};
 },[transactionId,revision,demo,attempt,key]);
 const report=!demo&&stored?.key===key?stored.report:null,account=!demo&&transient?.key===key?transient.value:null;
 async function checkAccount(){
  const target=report?.accountEvidenceTarget;
  if(demo||!target||scope.current!==key||accountAbort.current)return;
  const controller=new AbortController(),request=++sequence.current;accountAbort.current=controller;setTransient(null);setAccountLoading(true);
  const current=()=>scope.current===key&&sequence.current===request&&!controller.signal.aborted;
  try{const response=await fetch('/api/bank/account-evidence',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',signal:controller.signal,body:JSON.stringify({...target,revision})}),result:unknown=await response.json();if(current())setTransient({key,value:response.ok?accountEvidenceDisplay(result,target,revision):unknownAccountEvidence()});}
  catch{if(current())setTransient({key,value:unknownAccountEvidence()});}
  finally{if(current()){accountAbort.current=null;setAccountLoading(false);}}
 }
 return {report,error:demo?'':error,loading:!demo&&loading,retry:()=>setAttempt(n=>n+1),account,accountLoading:!demo&&accountLoading,checkAccount};
}
