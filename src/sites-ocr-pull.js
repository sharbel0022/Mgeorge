import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {runDocumentProcess} from './invoice-extraction.js';
import {checkedOcrBankgiroEvidence} from '../sites/lib/ocr-bankgiro-evidence.js';
const MAX_BYTES=15000000;
// Only errors created here receive public diagnostics. Unknown thrown values
// are never inspected: provider/body text, getters and token values stay private.
const httpFailures=new WeakMap();
const bodyLimitFailures=new WeakSet();
const retryDeferredFailures=new WeakSet();
function bodyLimitFailure(){
  const error=Error('response_limit');bodyLimitFailures.add(error);return error;
}
export function sitesOcrFailure(error){
  return httpFailures.get(error)??{failure_code:'UNCLASSIFIED_FAILURE'};
}
function rejectHttp(status,deferRetry=false){
  const failure_code=status===404?'SITE_NOT_FOUND':status===401?'WORKER_UNAUTHORIZED':status===403?'WORKER_FORBIDDEN':status===429?'SITE_RATE_LIMITED':status>=300&&status<400?'SITE_REDIRECT_BLOCKED':status>=500?'SITE_UNAVAILABLE':'SITE_RESPONSE_REJECTED';
  const error=Error(status===401?'authorization':'site_unavailable');
  httpFailures.set(error,Object.freeze({failure_code,http_status:status}));
  if(deferRetry)retryDeferredFailures.add(error);
  throw error;
}
function cancelBody(body){
  // Cleanup cannot delay or replace an already established size rejection.
  try{void Promise.resolve(body?.cancel()).catch(()=>{});}catch{}
}
export async function boundedBody(response,limit){
  if(Number(response.headers.get('content-length'))>limit){
    const error=bodyLimitFailure();
    cancelBody(response.body);
    throw error;
  }
  const chunks=[];let length=0;
  if(response.body){const reader=response.body.getReader();try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){const error=bodyLimitFailure();cancelBody(reader);throw error;}chunks.push(value);}}finally{reader.releaseLock();}}
  return Buffer.concat(chunks,length);
}
export async function runSitesOcr(config,{fetchImpl=fetch,extract=runDocumentProcess,maxJobs=6}={}){
  const origin=new URL(config.origin);if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||!config.token||!/^[A-Za-z0-9_-]{43}$/.test(config.token)||![undefined,'local','cloud'].includes(config.mode)||!Number.isInteger(maxJobs)||maxJobs<1)throw Error('configuration');
  const cloud=config.mode==='cloud';
  let processed=0,failed=0,settled=0;
  const request=async(path,body,extra={},timeout=25000)=>{
    const result=await fetchImpl(origin.origin+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+config.token,...(cloud?{'X-MG-OCR-Runner':'cloud'}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(timeout)});
    if(!result.ok){cancelBody(result.body);rejectHttp(result.status,result.headers.get('retry-after')!==null);}return result;
  };
  // A document GET is read-only. Restart an interrupted transfer once from
  // byte zero; never retry leases or completion POSTs with uncertain outcomes.
  const download=async(job)=>{
    for(let attempt=0;attempt<2;attempt++){
      try{
        return await boundedBody(await request('/api/ocr-worker/document?id='+encodeURIComponent(job.id),undefined,{'X-MG-OCR-Lease':job.lease}),MAX_BYTES);
      }catch(error){
        const http=httpFailures.get(error);
        // A server-requested delay belongs to the next durable queue recovery,
        // not an immediate retry or an unbounded wait in this worker.
        if(attempt===1||bodyLimitFailures.has(error)||retryDeferredFailures.has(error)||(http&&http.http_status<500))throw error;
        await delay(250);
      }
    }
  };
  const json=async(path,body,limit,timeout)=>{
    const value=JSON.parse((await boundedBody(await request(path,body,{},timeout),limit)).toString());
    if(!value||typeof value!=='object'||Array.isArray(value)||value.error)throw Error('invalid_response');
    return value;
  };
  const jobIdentity=job=>({id:job.id,lease:job.lease,sha256:job.sha256});
  const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
  const terminal=state=>['ready','needs_review','duplicate','registered'].includes(state);
  const protocolFailure=code=>{
    const error=Error(code.toLowerCase());
    httpFailures.set(error,Object.freeze({failure_code:code}));
    return error;
  };
  const completionAccepted=(result,value)=>!value.ignored&&(result.error?value.ok===true:value.registered===true||['ready','needs_review','duplicate'].includes(value.state));

  // Capability negotiation keeps old Sites and local workers compatible. One
  // timer and one in-flight heartbeat bound each job; the server enforces the
  // absolute lease horizon. A failed heartbeat is transport/ownership loss,
  // never an OCR failure acknowledgement.
  const startHeartbeat=async job=>{
    let timer,pending=Promise.resolve(),stopped=false,failure,rejectLost;
    const lost=new Promise((_,reject)=>{rejectLost=reject;});
    void lost.catch(()=>{});
    const beat=async()=>{
      for(let attempt=0;attempt<2;attempt++){
        try{
          const value=await json('/api/ocr-worker/heartbeat',jobIdentity(job),8192);
          if(value.ok!==true||value.run_id!==job.run_id||!timestamp(value.lease_until))throw protocolFailure('LEASE_HEARTBEAT_REJECTED');
          return;
        }catch(error){
          const http=httpFailures.get(error);
          if(attempt===1||bodyLimitFailures.has(error)||retryDeferredFailures.has(error)||(http&&!(http.http_status>=500)))throw error;
          await delay(250);
        }
      }
    };
    await beat();
    const schedule=()=>{
      timer=setTimeout(()=>{
        pending=beat().catch(error=>{failure=error;rejectLost(error);}).then(()=>{
          if(!stopped&&!failure)schedule();
        });
      },30000);
      timer.unref?.();
    };
    schedule();
    return {
      protect:operation=>Promise.race([operation,lost]),
      async stop(){
        stopped=true;clearTimeout(timer);await pending;
        if(failure)throw failure;
      },
    };
  };
  const acceptedReceipts=new WeakSet(),pendingReceipts=new WeakSet();
  const complete=async(job,result)=>{
    const body={...jobIdentity(job),...result};
    if(job.protocol!==2)return json('/api/ocr-worker/complete',body,16384);
    for(let attempt=0;attempt<3;attempt++){
      let failure;
      try{
        const value=await json('/api/ocr-worker/complete',body,16384);
        if(completionAccepted(result,value))return value;
        failure=protocolFailure('RESULT_ACKNOWLEDGEMENT_INVALID');
      }catch(error){failure=error;}
      const http=httpFailures.get(failure);
      // A provider-requested wait, authorization failure or redirect is a stop,
      // not an invitation to poll another endpoint with the same credential.
      if(retryDeferredFailures.has(failure)||(http?.http_status&&http.http_status<500&&http.http_status!==409))throw failure;
      const receipt=await json('/api/ocr-worker/receipt',jobIdentity(job),16384);
      if(receipt.id!==job.id||receipt.sha256!==job.sha256||receipt.run_id!==job.run_id||typeof receipt.accepted!=='boolean')throw protocolFailure('RESULT_RECEIPT_INVALID');
      if(receipt.accepted){
        if(typeof receipt.settled!=='boolean'||!timestamp(receipt.accepted_at))throw protocolFailure('RESULT_RECEIPT_INVALID');
        if(!receipt.settled){const pending={};pendingReceipts.add(pending);return pending;}
        if(!terminal(receipt.state))throw protocolFailure('RESULT_RECEIPT_INVALID');
        const accepted={state:receipt.state,registered:receipt.state==='registered'};
        acceptedReceipts.add(accepted);return accepted;
      }
      if(receipt.retryable!==true||attempt===2)throw failure;
      // Only the same immutable result is resent, after a fresh absence/lease
      // check. SQL receipt fences still arbitrate a delayed original request.
      await delay(250*2**attempt+Math.floor(Math.random()*250));
    }
  };
  // The server first tries text PDFs, moving scans into the same durable OCR
  // queue. No browser, Windows task or active Gmail sync is needed to drain it.
  // Two server PDF attempts may each use their 15-second parse budget.
  if(cloud){
    const server=await json('/api/ocr-worker/process',{},16384,60000);
    // Older Sites responses may omit this field. Only the current server's
    // bounded, accepted text-PDF count can contribute to completed work.
    if(Object.hasOwn(server,'processed')){
      if(!Number.isSafeInteger(server.processed)||server.processed<0||server.processed>2)throw Error('invalid_response');
      processed=server.processed;
    }
    if(server.status_unknown===true){
      if(processed===0)throw Error('invalid_response');
      return {processed,failed,status_unknown:true};
    }
  }
  try{
    for(let n=0;n<Math.min(maxJobs,6);n++){
      const lease=await json('/api/ocr-worker/lease',{},8192);
      if(lease.job===null)break;const job=lease.job;
      if(!job||typeof job!=='object')throw Error('invalid_job');
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(job.id)||!/^[A-Za-z0-9_-]{43}$/.test(job.lease)||!['application/pdf','image/png','image/jpeg','image/webp'].includes(job.mime)||!Number.isInteger(job.size)||job.size>MAX_BYTES||job.size<1||!/^[a-f0-9]{64}$/.test(job.sha256))throw Error('invalid_job');
      if(job.protocol!==undefined&&(job.protocol!==2||!/^[A-Za-z0-9_-]{43}$/.test(job.run_id)||!timestamp(job.lease_until)))throw Error('invalid_job');
      let heartbeat;
      try{
        if(job.protocol===2)heartbeat=await startHeartbeat(job);
        // Restart only the bounded original GET. Ownership loss stays separate
        // from an extractor failure, even when it arrives during extraction.
        const bytes=await (heartbeat?heartbeat.protect(download(job)):download(job));
        const interpret=async()=>{
          try{
            if(bytes.length!==job.size||createHash('sha256').update(bytes).digest('hex')!==job.sha256)throw Error('hash');
            const value=await extract(bytes,job.mime);
            if(!value||value.error||typeof value.text!=='string'||value.text.length>150000||!['pdf','ocr'].includes(value.method)||!Number.isFinite(value.confidence)||value.confidence<0||value.confidence>100)throw Error('ocr');
            const ocrEvidence=checkedOcrBankgiroEvidence(value.text,job.sha256,value.ocrEvidence);
            return {text:value.text,method:value.method,confidence:value.confidence,...(ocrEvidence?{ocrEvidence}:{})};
          }catch{return {text:'',method:'ocr',confidence:0,error:true};}
        };
        const result=await (heartbeat?heartbeat.protect(interpret()):interpret());
        // Finish the last heartbeat before committing; a heartbeat must never
        // race a successful terminal transition and erase its acknowledgement.
        await heartbeat?.stop();
        const completion=await complete(job,result);
        if(pendingReceipts.has(completion))return {processed,failed,accepted_pending:1,status_unknown:true};
        if(!acceptedReceipts.has(completion)&&!completionAccepted(result,completion))throw Error('completion_rejected');
        settled++;
        if(result.error&&!acceptedReceipts.has(completion))failed++;else processed++;
      }finally{
        // Cleanup cannot replace an accepted result or a more specific failure.
        if(heartbeat)await heartbeat.stop().catch(()=>{});
      }
    }
  }catch(error){
    // Preserve accepted successes and acknowledged OCR failures when a later
    // transport or queue operation stops the run. Only negotiated receipt-aware
    // completion retries are allowed; legacy POSTs are never replayed.
    if(processed===0&&settled===0)throw error;
    return {processed,failed,status_unknown:true};
  }
  return {processed,failed};
}
if(process.argv.includes('--config-stdin')){
  let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>8192)throw Error('configuration');}
  try{const result=await runSitesOcr(JSON.parse(raw));console.log(JSON.stringify(result));if(result.status_unknown)process.exitCode=1;}catch{console.log(JSON.stringify({status:'retry_later'}));process.exitCode=1;}
}
