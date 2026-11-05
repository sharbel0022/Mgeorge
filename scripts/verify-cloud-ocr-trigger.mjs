import {readFileSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

/** Validate the immutable trigger envelope first. The separate API preflight
 * below also checks main as observed immediately before credential use. */
export function reviewedCloudOcrTrigger(input={}){
  const {eventName,ref,sha,repository,event}=input;
  const deny=()=>({allowed:false,reason:'UNVERIFIED_OCR_TRIGGER'});
  if(ref!=='refs/heads/main'||typeof sha!=='string'||!/^[0-9a-f]{40}$/.test(sha)||typeof repository!=='string'||!/^[-.\w]+\/[-.\w]+$/.test(repository))return deny();
  if(eventName==='schedule'||eventName==='workflow_dispatch')return {allowed:true,reason:'CONFIGURED_MAIN_TRIGGER'};
  const run=event?.workflow_run;
  if(eventName!=='workflow_run'||event?.action!=='completed'||run?.name!=='Payment control checks'||run?.event!=='push'||run?.conclusion!=='success'||run?.head_branch!=='main'||run?.head_sha!==sha||run?.head_repository?.full_name!==repository)return deny();
  return {allowed:true,reason:'VERIFIED_MAIN_CHECKS'};
}

const MAIN_REF_LIMIT=64*1024;
async function referenceBody(response,signal){
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAIN_REF_LIMIT))throw Error('reference_size');
  if(!response.body)throw Error('reference_missing');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{
    for(;;){
      signal.throwIfAborted();
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>MAIN_REF_LIMIT){await reader.cancel();throw Error('reference_size');}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));
}

/** A contents:read token is sent only to the fixed GitHub API host. No redirect,
 * caller-supplied API origin, cached receipt, or trigger-time SHA can substitute
 * for this fresh reference. This proves main at preflight, not after it moves. */
export async function verifyCurrentCloudOcrTrigger(input,options={}){
  const denied=()=>({allowed:false,reason:'UNVERIFIED_OCR_MAIN_REF'});
  let controller,timer;
  try{
    const trigger=reviewedCloudOcrTrigger(input);if(!trigger.allowed)return trigger;
    const {token,fetchImpl=fetch,timeoutMs=10000}=options,{repository,sha}=input;
    if(typeof token!=='string'||!token||token.length>4096||token.trim()!==token||/[\r\n]/.test(token)||typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)return denied();
    const names=repository.split('/');if(names.some(name=>name==='.'||name==='..'))return denied();
    const base='https://api.github.com/repos/'+names.map(encodeURIComponent).join('/'),url=base+'/git/ref/heads/main';
    controller=new AbortController();timer=setTimeout(()=>controller.abort(),timeoutMs);
    const response=await fetchImpl(url,{method:'GET',redirect:'error',cache:'no-store',signal:controller.signal,
      headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2026-03-10','User-Agent':'Mgeorge-OCR-main-preflight','Cache-Control':'no-cache'}});
    if(response.status!==200||response.redirected||response.url!==url)return denied();
    const reference=await referenceBody(response,controller.signal);
    if(!reference||Array.isArray(reference)||reference.ref!=='refs/heads/main'||reference.url!==base+'/git/refs/heads/main'||reference.object?.type!=='commit'||reference.object.sha!==sha||reference.object.url!==base+'/git/commits/'+sha)return denied();
    return {...trigger,mainSha:sha,mainVerifiedAt:new Date().toISOString()};
  }catch{return denied();}
  finally{clearTimeout(timer);controller?.abort();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const path=process.env.GITHUB_EVENT_PATH;
    if(!path||statSync(path).size>2*1024*1024)throw Error('event_unavailable');
    const event=JSON.parse(readFileSync(path,'utf8'));
    const result=await verifyCurrentCloudOcrTrigger({eventName:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,sha:process.env.GITHUB_SHA,repository:process.env.GITHUB_REPOSITORY,event},{token:process.env.GITHUB_TOKEN});
    console.log(JSON.stringify(result));if(!result.allowed)process.exitCode=1;
  }catch{console.log(JSON.stringify({allowed:false,reason:'UNVERIFIED_OCR_TRIGGER'}));process.exitCode=1;}
}
