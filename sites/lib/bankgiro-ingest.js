import {ingestError,validateAuthorization,validateReportPage,sanitizedIngestCode,retryAt} from './bankgiro-source.js';
import {registrationBinding,bankgiroRegistrationPlan} from './bankgiro-ingest-store.js';
const statuses=['PENDING','RETRY','IMPORTED','REVIEW','DUPLICATE','BLOCKED'];
const blocked=code=>['AUTHORIZATION_BLOCKED','AUTHORIZATION_CHANGED','ACCOUNT_MISMATCH','INVALID_PAGE','HASH_MISMATCH','IDENTITY_CONFLICT','INVALID_ORIGINAL','INVALID_SINK_RESULT'].includes(code);
const reviewReasons=['BANKGIRO_INFORMATION_UNAVAILABLE','BANKGIRO_INFORMATION_PARTIAL','BANKGIRO_ENRICHMENT_REVIEW'];
const iso=value=>value==null?null:new Date(value).toISOString();
const emptyCounts=()=>Object.fromEntries(statuses.map(s=>[s,0]));
/** Bounded transport worker. Financial interpretation belongs exclusively to the sink. */
export function createBankgiroIngest({source,store,sink,now=Date.now,allowSynthetic=false}){
 const production=source?.mode==='production'&&source?.configurationValid===true;
 const disabled=!source||source.mode==='synthetic'&&!allowSynthetic;
 const invalid=source&&(source.configurationValid===false||source.mode==='production'&&source.configurationValid!==true||!['production','synthetic'].includes(source.mode)||typeof source.id!=='string'||!source.id||source.id.length>500||!['authorize','listReports','fetchReport'].every(key=>typeof source[key]==='function'));
 const invalidStatus=()=>({...disabledStatus(),state:'BLOCKED',reason:'AUTHORIZATION_BLOCKED',lastError:'AUTHORIZATION_BLOCKED',authorization:{status:'BLOCKED',verifiedAt:null,validUntil:null}});
 const disabledStatus=()=>({enabled:false,sourceId:source?.id??null,mode:source?.mode??null,state:'DISABLED',reason:source?'SYNTHETIC_DISABLED':'SOURCE_NOT_CONFIGURED',cursor:null,nextPollAt:null,missingReportIds:[],counts:emptyCounts(),jobs:[],lastError:null,authorization:{status:'UNKNOWN',verifiedAt:null,validUntil:null},lastSuccessAt:null,lastFailureAt:null,lastFailureCode:null});
 const checkOwner=owner=>{if(typeof owner!=='string'||!owner||owner.length>500)throw ingestError('AUTHORIZATION_BLOCKED');};
 async function status(owner){
  if(disabled)return disabledStatus();if(invalid)return invalidStatus();checkOwner(owner);
  const snapshot=await store.snapshot(owner,source.id,production?registrationBinding(source.registration):undefined),s=snapshot.source,counts=emptyCounts();for(const row of snapshot.counts)counts[row.status]=row.count;
  const times=[s?.nextPollAt,snapshot.nextAttemptAt===0?now():snapshot.nextAttemptAt].filter(x=>x!=null);const nextPollAt=s?.lastError&&s.nextPollAt>now()?s.nextPollAt:times.length?Math.min(...times):null;
  let admissionBlocked=false;if(production)try{bankgiroRegistrationPlan(owner,source,snapshot.authorities);}catch{admissionBlocked=true;}
  const currentCounts=production?Object.fromEntries((snapshot.currentCounts||[]).map(row=>[row.status,row.count])):counts;
  const authorityChanged=admissionBlocked||production&&s&&(s.registrationRevision!==source.registration.configurationRevision||s.registrationBinding!==registrationBinding(source.registration));
  const expired=!!s?.authorizationValidUntil&&s.authorizationValidUntil<=now();
  const authStatus=authorityChanged||s?.authorizationStatus==='BLOCKED'?'BLOCKED':expired?'EXPIRED':s?.authorizationStatus==='VERIFIED'&&(!production||s.authorizationValidUntil>now()&&s.authorizationVerifiedAt>0&&s.authorizationVerifiedAt<=now())?'VERIFIED':'UNKNOWN';
  const state=admissionBlocked?'BLOCKED':snapshot.lease?'RUNNING':['BLOCKED','EXPIRED'].includes(authStatus)||currentCounts.BLOCKED?'BLOCKED':nextPollAt>now()?'BACKOFF':currentCounts.REVIEW||JSON.parse(s?.missingReportIds||'[]').length?'REVIEW':'IDLE';
  return {enabled:true,sourceId:source.id,mode:source.mode,state,reason:admissionBlocked?'AUTHORIZATION_CHANGED':s?.lastError??null,cursor:s?.cursor??null,nextPollAt:iso(nextPollAt),missingReportIds:JSON.parse(s?.missingReportIds||'[]'),counts,jobs:snapshot.jobs,leaseExpiresAt:iso(snapshot.lease?.expiresAt),lastError:s?.lastError??null,authorization:{status:authStatus,verifiedAt:iso(s?.authorizationVerifiedAt),validUntil:iso(s?.authorizationValidUntil)},lastSuccessAt:iso(s?.lastSuccessAt),lastFailureAt:iso(s?.lastFailureAt),lastFailureCode:s?.lastFailureCode??null};
 }
 async function run(owner){
  if(source?.revocation){checkOwner(owner);if(source.revocation.owner!==owner)return invalidStatus();try{await store.revokeOwner(owner,source.revocation.configurationRevision);}catch{}return invalidStatus();}
  if(disabled)return disabledStatus();if(invalid)return invalidStatus();checkOwner(owner);
  const lease=await store.acquire(owner);if(!lease)return status(owner);
  const started=now();let authorization,prior,page,registered=false;
  async function call(fn){
   await lease.assert();const remaining=45000-(now()-started);if(remaining<=0)throw ingestError('TIMEOUT');
   const controller=new AbortController();let timer;
   try{return await Promise.race([Promise.resolve().then(()=>fn(controller.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(ingestError('TIMEOUT'));},Math.min(10000,remaining));})]);}finally{clearTimeout(timer);}
  }
  async function authorize(expected){
   const auth=await call(signal=>source.authorize({owner,signal}));await lease.assert();const receipt=validateAuthorization(auth,owner,source.id,now(),expected);
   if(production){const r=source.registration;if(receipt.companyId!==r.companyId||receipt.bankgiro!==r.bankgiro||receipt.profileId!==r.profileId||receipt.scopeId!==r.scopeId||receipt.generation!==r.generation||receipt.origin!=='provider_authorization'||!receipt.capabilities?.includes('bankgiro_reports:read'))throw ingestError('AUTHORIZATION_BLOCKED');await store.bindAuthorization(lease,source,receipt);}
   return receipt;
  }
  try{
   // A contender must see the cursor and embargo committed by the previous lease holder.
   if(production){await store.register(owner,source,lease);registered=true;}
   prior=await store.source(owner,source.id);
   if(prior?.lastError&&prior.nextPollAt>now()){await store.release(lease);return status(owner);}
   if(!['production','synthetic'].includes(source.mode))throw ingestError('AUTHORIZATION_BLOCKED');
   if(production&&prior?.authorizationStatus==='VERIFIED'&&prior?.nextPollAt>now()&&!(await store.due(owner,source.id,1)).length)return status(owner);
   authorization=await authorize();
   const cursor=prior?.scopeId&&prior.scopeId!==authorization.scopeId?null:prior?.cursor??null;
   if(!prior?.nextPollAt||prior.nextPollAt<=now()||prior.scopeId!==authorization.scopeId){
    page=validateReportPage(await call(signal=>source.listReports({owner,authorization,cursor,limit:50,signal})),50);
    authorization=await authorize(authorization);
    if(production&&source.intervalMinutes)page={...page,discoveryNextPollAt:Math.max(page.nextPollAt?Date.parse(page.nextPollAt):0,now()+source.intervalMinutes*60000)};
    await store.discover(owner,source.id,authorization,page,lease);
   }
   const jobs=await store.due(owner,source.id,10);
   for(const job of jobs){
    if(now()-started>=45000)break;
    try{
     authorization=await authorize(authorization);
     if(production&&job.registrationBinding!==authorization.registrationBinding)throw ingestError('AUTHORIZATION_CHANGED');
     if(job.scopeId!==authorization.scopeId||job.authorizationGeneration!==authorization.generation)throw ingestError('AUTHORIZATION_CHANGED');
     await store.update(job,{attempts:job.attempts+1,lastError:null},lease);
     const report={reportId:job.reportId,filename:job.filename,sha256:job.sha256,...(job.availableAt?{availableAt:job.availableAt}:{})};
     if(!job.documentId){
      const bytes=await call(signal=>source.fetchReport({owner,authorization,report,signal}));
      authorization=await authorize(authorization);
      if(!(bytes instanceof Uint8Array)||bytes.byteLength===0||bytes.byteLength>15000000)throw ingestError('INVALID_ORIGINAL');
      const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
      if(sha256!==job.sha256)throw ingestError('HASH_MISMATCH');
      await lease.assert();const retained=await call(()=>sink.retain({owner,report,bytes,sha256,lease,authorization}));
      if(typeof retained?.documentId!=='string'||!retained.documentId)throw ingestError('INVALID_SINK_RESULT');
      await store.update(job,{documentId:retained.documentId},lease);
     }
     authorization=await authorize(authorization);
     if(await store.conflict(job))throw ingestError('IDENTITY_CONFLICT');
     const duplicate=await store.duplicate(job);
     if(duplicate){await store.update(job,{status:'DUPLICATE',importId:duplicate.importId,paymentCount:duplicate.paymentCount,nextAttemptAt:null,lastError:null},lease);continue;}
     await lease.assert();const result=await call(()=>sink.importReport({owner,job:{...job},documentId:job.documentId,authorization,lease}));
     if(!['IMPORTED','REVIEW','DUPLICATE'].includes(result?.status)||!Number.isSafeInteger(result.paymentCount)||result.paymentCount<0)throw ingestError('INVALID_SINK_RESULT');
     if(result.reasonCode!==undefined&&(result.status!=='REVIEW'||!reviewReasons.includes(result.reasonCode)))throw ingestError('INVALID_SINK_RESULT');
     await store.update(job,{status:result.status,importId:result.importId??null,paymentCount:result.paymentCount,nextAttemptAt:null,lastError:result.reasonCode??null},lease);
    }catch(error){
     const code=sanitizedIngestCode(error);if(code==='LEASE_LOST')throw error;
     await store.update(job,{status:blocked(code)?'BLOCKED':'RETRY',lastError:code,nextAttemptAt:blocked(code)?null:retryAt(error,job.attempts,now())},lease);
     await store.recordSource(owner,source.id,{lastFailureAt:now(),lastFailureCode:code},lease);
     if(code==='TIMEOUT'){await store.release(lease);throw error;}
     if(code.startsWith('AUTHORIZATION_'))throw error;
     if(code==='RATE_LIMITED'){await store.recordSource(owner,source.id,{nextPollAt:retryAt(error,job.attempts,now()),lastError:code},lease);break;}
    }
   }
   if(page){if(production&&source.intervalMinutes){const hint=page.nextPollAt?Date.parse(page.nextPollAt):0;page={...page,nextPollAt:new Date(Math.max(hint,now()+source.intervalMinutes*60000)).toISOString()};}await store.acknowledge(owner,source.id,authorization,page,lease);}
  }catch(error){
   const code=sanitizedIngestCode(error);
   try{if(production&&!registered)throw ingestError('AUTHORIZATION_CHANGED');await lease.assert();await store.recordSource(owner,source.id,{...(blocked(code)?{authorizationStatus:'BLOCKED'}:{}),lastError:code,lastFailureAt:now(),lastFailureCode:code,attempts:(prior?.attempts||0)+1,nextPollAt:blocked(code)?null:retryAt(error,prior?.attempts||0,now())},lease);}catch{/* Lost lease: the new owner alone may write. */}
  }finally{await store.release(lease);}
  return status(owner);
 }
 return {run,status};
}
