/** Our normalized HTTPS-v1 delivery contract, not a bank-specific API.
 * All authority and endpoints originate in trusted server configuration. */
const MAX_ORIGINAL=15000000,MAX_JSON=65536,FRESH_MS=300000,TIMEOUT_MS=10000;
const CAPABILITY='bankgiro_reports:read';
const clean=(value,max=500)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const error=code=>Object.assign(new Error(code),{code});
function freeze(value){if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
function entitlementValid(value,time,fresh=false){
 return value?.synthetic!==true&&value?.mode!=='synthetic'&&value?.status==='VERIFIED'&&value.origin==='provider_authorization'&&clean(value.evidenceId)&&instant(value.checkedAt)&&instant(value.validUntil)&&Date.parse(value.checkedAt)<=time&&Date.parse(value.validUntil)>time&&Date.parse(value.validUntil)>Date.parse(value.checkedAt)&&(!fresh||time-Date.parse(value.checkedAt)<=FRESH_MS)&&Array.isArray(value.capabilities)&&value.capabilities.length<=20&&value.capabilities.every(x=>clean(x,100))&&value.capabilities.includes(CAPABILITY);
}
function endpoint(value){
 if(!clean(value,2000)||value.includes('\\')||/[?#]/.test(value)||/^[a-z]+:\/\/[^/]*@/i.test(value))throw error('AUTHORIZATION_BLOCKED');
 let url;try{url=new URL(value);}catch{throw error('AUTHORIZATION_BLOCKED');}
 const host=url.hostname;
 // Literal IPs, special/local names and ambiguous encoded paths are never allowed.
 // DNS resolution/TLS remain the deployment's trusted network boundary.
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!host.includes('.')||host.endsWith('.')||host.startsWith('[')||/^[\d.]+$/.test(host)||/(?:^|\.)(?:localhost|local|internal|home|lan|onion|invalid)$/.test(host)||! /^[a-z0-9.-]+$/.test(host)||/%|\/\/{2}|(?:^|\/)\.{1,2}(?:\/|$)/.test(url.pathname)||/%|(?:^|\/)\.{1,2}(?:\/|$)/.test(value.slice(value.indexOf('://')+3).replace(/^[^/]+/,'')))throw error('AUTHORIZATION_BLOCKED');
 url.pathname=url.pathname.replace(/\/+$/,'');return url;
}
function validRegistration(registration,time){
 let r;try{r=structuredClone(registration);}catch{throw error('AUTHORIZATION_BLOCKED');}
 if(!r||!['id','owner','companyId','scopeId','generation','profileId','tokenSecret'].every(key=>clean(r[key]))||!/^\d{4,10}$/.test(r.bankgiro)||r.mode!=='production'||r.enabled!==true||r.synthetic===true||r.entitlement?.synthetic===true||r.transport!=='https-v1'||!Number.isSafeInteger(r.intervalMinutes)||r.intervalMinutes<1||r.intervalMinutes>1440||!Array.isArray(r.allowedFormats)||r.allowedFormats.length<1||r.allowedFormats.length>3||!r.allowedFormats.every(format=>['csv','xml','xlsx'].includes(format))||new Set(r.allowedFormats).size!==r.allowedFormats.length||!entitlementValid(r.entitlement,time)||r.configurationRevision!==undefined&&(!Number.isSafeInteger(r.configurationRevision)||r.configurationRevision<1))throw error('AUTHORIZATION_BLOCKED');
 const base=endpoint(r.baseUrl),basePath=base.pathname.replace(/\/+$/,'');
 const registrationView=freeze({...Object.fromEntries(['id','owner','companyId','bankgiro','scopeId','generation','mode','enabled','transport','profileId','allowedFormats','intervalMinutes','configurationRevision'].filter(key=>r[key]!==undefined).map(key=>[key,r[key]])),entitlement:Object.fromEntries(['status','origin','evidenceId','checkedAt','validUntil','capabilities'].map(key=>[key,r.entitlement[key]])),transportBinding:JSON.stringify([base.origin,basePath,r.tokenSecret])});
 return {r,base,basePath,registrationView};
}
function cancel(body){try{Promise.resolve(body?.cancel()).catch(()=>{});}catch{}}
function aborted(signal){if(signal?.aborted)throw error('TIMEOUT');}
function untilAbort(promise,signal){
 aborted(signal);
 return new Promise((resolve,reject)=>{
  const stop=()=>{signal.removeEventListener('abort',stop);reject(error('TIMEOUT'));};
  signal.addEventListener('abort',stop,{once:true});
  Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',stop);resolve(value);},()=>{signal.removeEventListener('abort',stop);reject(signal.aborted?error('TIMEOUT'):error('SOURCE_UNAVAILABLE'));});
 });
}
async function boundedBytes(response,maximum,signal,code){
 const encoding=response.headers.get('content-encoding');
 if(encoding&&encoding.toLowerCase()!=='identity'){cancel(response.body);throw error(code);}
 const raw=response.headers.get('content-length');
 if(raw!==null&&(!/^(0|[1-9]\d*)$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)>maximum)){cancel(response.body);throw error(code);}
 if(!response.body||typeof response.body.getReader!=='function')throw error(code);
 const reader=response.body.getReader(),limit=raw===null?maximum:Number(raw);
 let buffer=new Uint8Array(Math.min(65536,limit)),length=0,finished=false;
 try{
  while(true){
   aborted(signal);const part=await untilAbort(reader.read(),signal);if(part.done){finished=true;break;}
   if(!(part.value instanceof Uint8Array)||part.value.byteLength>limit-length)throw error(code);
   const required=length+part.value.byteLength;
   if(required>buffer.byteLength){const expanded=new Uint8Array(Math.min(limit,Math.max(required,buffer.byteLength*2)));expanded.set(buffer);buffer=expanded;}
   buffer.set(part.value,length);length=required;
  }
  if(raw!==null&&Number(raw)!==length)throw error(code);
  return buffer.byteLength===length?buffer:buffer.slice(0,length);
 }finally{if(!finished)try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}
}
function retryAfter(raw){
 if(typeof raw!=='string')return undefined;
 if(/^\d+(?:\.\d+)?$/.test(raw)){
  const seconds=Number(raw);
  // Explicit overflow remains embargoed to the worker's maximum instant.
  if(!Number.isFinite(seconds)||seconds>=8640000000000)return '8640000000000';
  return raw.length<=100?raw:String(seconds);
 }
 if(raw.length>100)return undefined;
 if(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw)&&Number.isFinite(Date.parse(raw)))return raw;
 // ISO instants are accepted by the existing worker's retry parser too.
 if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw)&&Number.isFinite(Date.parse(raw)))return raw;
 return undefined;
}
function reportDescriptor(value,formats){
 if(!value||!clean(value.reportId)||value.reportId==='.'||value.reportId==='..'||!clean(value.filename,255)||/[\\/]/.test(value.filename)||!formats.includes(value.filename.split('.').pop()?.toLowerCase())||typeof value.sha256!=='string'||! /^[a-f0-9]{64}$/i.test(value.sha256)||value.byteLength!==undefined&&(!Number.isSafeInteger(value.byteLength)||value.byteLength<1||value.byteLength>MAX_ORIGINAL)||value.availableAt!==undefined&&!instant(value.availableAt)||['url','downloadUrl','contentUrl','href'].some(key=>Object.hasOwn(value,key)))throw error('INVALID_PAGE');
 try{encodeURIComponent(value.reportId);}catch{throw error('INVALID_PAGE');}
 return {reportId:value.reportId,filename:value.filename,sha256:value.sha256.toLowerCase(),...(value.byteLength!==undefined?{byteLength:value.byteLength}:{}),...(value.availableAt!==undefined?{availableAt:value.availableAt}:{})};
}
const receiptKey=value=>JSON.stringify(['status','owner','sourceId','companyId','bankgiro','scopeId','generation','profileId','evidenceId','checkedAt','validUntil','origin','capabilities'].map(key=>value?.[key]));

export function createHttpsBankgiroSource({registration,token,fetchImpl=globalThis.fetch,now=Date.now}){
 const {r,base,basePath,registrationView}=validRegistration(registration,now());
 if(!clean(token,8192)||/\s/.test(token)||typeof fetchImpl!=='function')throw error('AUTHORIZATION_BLOCKED');
 const receipts=new Map(),descriptors=new Map();
 const guard=owner=>{if(owner!==r.owner||!entitlementValid(r.entitlement,now()))throw error('AUTHORIZATION_BLOCKED');};
 const validateRemote=value=>{
  if(!entitlementValid(value,now(),true)||['owner','companyId','bankgiro','scopeId','generation','profileId'].some(key=>value[key]!==r[key])||value.sourceId!==r.id)throw error('AUTHORIZATION_BLOCKED');
  return freeze({...Object.fromEntries(['status','owner','sourceId','companyId','bankgiro','scopeId','generation','profileId','evidenceId','checkedAt','validUntil','origin','capabilities'].map(key=>[key,structuredClone(value[key])])),validUntil:new Date(Math.min(Date.parse(value.validUntil),Date.parse(r.entitlement.validUntil))).toISOString()});
 };
 const authorized=(owner,authorization)=>{guard(owner);validateRemote(authorization);if(!receipts.has(receiptKey(authorization)))throw error('AUTHORIZATION_BLOCKED');};
 async function request(path,params,signal,binary=false){
  const url=new URL(base.href);url.pathname=basePath+path;
  for(const [key,value] of Object.entries(params||{}))url.searchParams.set(key,String(value));
  const controller=new AbortController(),stop=()=>controller.abort();let timer;
  try{
   aborted(signal);signal?.addEventListener('abort',stop,{once:true});timer=setTimeout(stop,TIMEOUT_MS);
   const pending=Promise.resolve().then(()=>fetchImpl(url.href,{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:binary?'application/octet-stream':'application/json','Accept-Encoding':'identity'},redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal}));
   pending.then(response=>{if(controller.signal.aborted)cancel(response?.body);},()=>{});
   const response=await untilAbort(pending,controller.signal);
   if(!response||response.redirected||response.url&&response.url!==url.href){cancel(response?.body);throw error('SOURCE_UNAVAILABLE');}
   if(response.status!==200){
    cancel(response.body);
    if(binary&&response.status===409)throw error('IDENTITY_CONFLICT');
    if(response.status===429){const failure=Object.assign(error('RATE_LIMITED'),{status:429});const wait=retryAfter(response.headers.get('retry-after'));if(wait!==undefined)failure.retryAfter=wait;throw failure;}
    throw error([401,403].includes(response.status)?'AUTHORIZATION_BLOCKED':'SOURCE_UNAVAILABLE');
   }
   if(!binary&&!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){cancel(response.body);throw error('SOURCE_UNAVAILABLE');}
   const bytes=await boundedBytes(response,binary?MAX_ORIGINAL:MAX_JSON,controller.signal,binary?'INVALID_ORIGINAL':'SOURCE_UNAVAILABLE');
   if(binary)return bytes;
   try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw error('SOURCE_UNAVAILABLE');}
  }catch(cause){
   if(controller.signal.aborted||signal?.aborted)throw error('TIMEOUT');
   if(['AUTHORIZATION_BLOCKED','SOURCE_UNAVAILABLE','RATE_LIMITED','INVALID_ORIGINAL','IDENTITY_CONFLICT'].includes(cause?.code))throw cause;
   throw error('SOURCE_UNAVAILABLE');
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);}
 }
 return Object.freeze({id:r.id,mode:'production',configurationValid:true,registration:registrationView,intervalMinutes:r.intervalMinutes,
  async authorize({owner,signal}){
   guard(owner);const auth=validateRemote(await request('/v1/authorization',null,signal));guard(owner);
   receipts.set(receiptKey(auth),true);if(receipts.size>64)receipts.delete(receipts.keys().next().value);return auth;
  },
  async listReports({owner,authorization,cursor=null,limit=50,signal}){
   authorized(owner,authorization);
   if(!Number.isSafeInteger(limit)||limit<1||limit>50||cursor!==null&&!clean(cursor,2000))throw error('INVALID_PAGE');
   const page=await request('/v1/reports',{...(cursor!==null?{cursor}:{}),limit},signal);authorized(owner,authorization);
   if(!page||!Array.isArray(page.reports)||page.reports.length>limit||!(page.nextCursor===null||clean(page.nextCursor,2000))||page.nextPollAt!==undefined&&!instant(page.nextPollAt)||page.missingReportIds!==undefined&&(!Array.isArray(page.missingReportIds)||page.missingReportIds.length>1000||!page.missingReportIds.every(id=>clean(id))))throw error('INVALID_PAGE');
   const reports=page.reports.map(value=>reportDescriptor(value,r.allowedFormats));
   for(const report of reports){descriptors.set(JSON.stringify([report.reportId,report.sha256]),Object.freeze({...report}));if(descriptors.size>1000)descriptors.delete(descriptors.keys().next().value);}
   return {reports,nextCursor:page.nextCursor,...(page.nextPollAt!==undefined?{nextPollAt:page.nextPollAt}:{}),...(page.missingReportIds!==undefined?{missingReportIds:[...page.missingReportIds]}:{})};
  },
  async fetchReport({owner,authorization,report,signal}){
   authorized(owner,authorization);const descriptor=reportDescriptor(report,r.allowedFormats);
   const known=descriptors.get(JSON.stringify([descriptor.reportId,descriptor.sha256]));
   const bytes=await request(`/v1/reports/${encodeURIComponent(descriptor.reportId)}/content`,null,signal,true);authorized(owner,authorization);
   if(!bytes.byteLength||descriptor.byteLength!==undefined&&descriptor.byteLength!==bytes.byteLength||known?.byteLength!==undefined&&known.byteLength!==bytes.byteLength)throw error('INVALID_ORIGINAL');
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
   aborted(signal);authorized(owner,authorization);if(digest!==descriptor.sha256)throw error('HASH_MISMATCH');return bytes;
  }
 });
}
