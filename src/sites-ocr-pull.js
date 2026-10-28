import {createHash} from 'node:crypto';
import {runDocumentProcess} from './invoice-extraction.js';
const MAX_BYTES=15000000;
export async function boundedBody(response,limit){
  if(Number(response.headers.get('content-length'))>limit)throw Error('response_limit');
  const chunks=[];let length=0;
  if(response.body){const reader=response.body.getReader();try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw Error('response_limit');}chunks.push(value);}}finally{reader.releaseLock();}}
  return Buffer.concat(chunks,length);
}
export async function runSitesOcr(config,{fetchImpl=fetch,extract=runDocumentProcess,maxJobs=6}={}){
  const origin=new URL(config.origin);if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||!config.token||!/^[A-Za-z0-9_-]{43}$/.test(config.token)||![undefined,'local','cloud'].includes(config.mode)||!Number.isInteger(maxJobs)||maxJobs<1)throw Error('configuration');
  const cloud=config.mode==='cloud';
  let processed=0,failed=0;
  const request=async(path,body,extra={},timeout=25000)=>{
    const result=await fetchImpl(origin.origin+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+config.token,...(cloud?{'X-MG-OCR-Runner':'cloud'}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(timeout)});
    if(!result.ok)throw Error(result.status===401?'authorization':'site_unavailable');return result;
  };
  const json=async(path,body,limit,timeout)=>{
    const value=JSON.parse((await boundedBody(await request(path,body,{},timeout),limit)).toString());
    if(!value||typeof value!=='object'||Array.isArray(value)||value.error)throw Error('invalid_response');
    return value;
  };
  // The server first tries text PDFs, moving scans into the same durable OCR
  // queue. No browser, Windows task or active Gmail sync is needed to drain it.
  // Two server PDF attempts may each use their 15-second parse budget.
  if(cloud)await json('/api/ocr-worker/process',{},16384,60000);
  for(let n=0;n<Math.min(maxJobs,6);n++){
    const lease=await json('/api/ocr-worker/lease',{},8192);
    if(lease.job===null)break;const job=lease.job;
    if(!job||typeof job!=='object')throw Error('invalid_job');
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(job.id)||!/^[A-Za-z0-9_-]{43}$/.test(job.lease)||!['application/pdf','image/png','image/jpeg','image/webp'].includes(job.mime)||!Number.isInteger(job.size)||job.size>MAX_BYTES||job.size<1||!/^[a-f0-9]{64}$/.test(job.sha256))throw Error('invalid_job');
    let result;
    try{
      const bytes=await boundedBody(await request('/api/ocr-worker/document?id='+encodeURIComponent(job.id),undefined,{'X-MG-OCR-Lease':job.lease}),MAX_BYTES);
      if(bytes.length!==job.size||createHash('sha256').update(bytes).digest('hex')!==job.sha256)throw Error('hash');
      const value=await extract(bytes,job.mime);
      if(!value||value.error||typeof value.text!=='string'||value.text.length>150000||!['pdf','ocr'].includes(value.method)||!Number.isFinite(value.confidence)||value.confidence<0||value.confidence>100)throw Error('ocr');
      // Do not let an extractor overwrite the authenticated lease identifiers.
      result={text:value.text,method:value.method,confidence:value.confidence};
    }catch{result={text:'',method:'ocr',confidence:0,error:true};failed++;}
    const completion=await json('/api/ocr-worker/complete',{id:job.id,lease:job.lease,sha256:job.sha256,...result},16384);
    if(completion.ignored||!(result.error?completion.ok===true:completion.registered===true||['ready','needs_review','duplicate'].includes(completion.state)))throw Error('completion_rejected');
    if(!result.error)processed++;
  }
  return {processed,failed};
}
if(process.argv.includes('--config-stdin')){
  let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>8192)throw Error('configuration');}
  try{console.log(JSON.stringify(await runSitesOcr(JSON.parse(raw))));}catch{console.log(JSON.stringify({status:'retry_later'}));process.exitCode=1;}
}
