import {X509Certificate} from 'node:crypto';
import {BankProviderError,assertServerRuntime,isRecord} from './bank-data-provider.js';
import {createOpenPaymentsTokenCacheIdentity,invalidateOpenPaymentsTokenCacheIdentity} from './openpayments/token-cache.js';

const CONFIG_KEY='SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG';
// App-token values live in the bounded shared cache. These weak maps retain
// only the opaque capability for one verified binding/configuration identity.
const identities=new WeakMap(),environments=new WeakMap();
function retire(identity){
 if(!identity)return;
 identity.retired=true;invalidateOpenPaymentsTokenCacheIdentity(identity.cacheIdentity);
 if(identities.get(identity.binding)===identity)identities.delete(identity.binding);
}
function forget(environment){const identity=environments.get(environment);retire(identity);environments.delete(environment);}
const INVALID=()=>new BankProviderError('INVALID_CLIENT_CERTIFICATE',409);
const denied=()=>new BankProviderError('FEATURE_NOT_ALLOWED',403);
const aborted=()=>new BankProviderError('PROVIDER_ABORTED',499);
const ID='[A-Za-z0-9_-]{1,200}';
const CONSENT=new RegExp('^/psd2/consent/v1/consents(?:/'+ID+'(?:/status|/authorisations(?:/'+ID+')?)?)?$');
const ACCOUNT=new RegExp('^/psd2/accountinformation/v1/accounts(?:/'+ID+'(?:/transactions)?)?$');
const ASPSP=/^\/psd2\/aspspinformation\/v1\/aspsps(?:\/[A-Z]{6}[A-Z2-9][A-NP-Z0-9](?:[A-Z0-9]{3})?)?$/;
const HEADERS=new Set(['accept','authorization','content-type','x-request-id','x-bicfi','psu-id','psu-corporate-id','psu-corporate-id-type','psu-ip-address','psu-user-agent','tpp-redirect-preferred','tpp-redirect-uri','consent-id','x-affiliatedaspsp-id','x-consentid','x-consentauthorisationid']);
const cancel=response=>{try{void response?.body?.cancel().catch(()=>{});}catch{}};

function checkedRequest(raw,init){
 if(typeof raw!=='string'||raw.length>10000||/[\s\\#\u0000-\u001f\u007f]/u.test(raw))throw denied();
 let url;try{url=new URL(raw);}catch{throw denied();}
 const rawPath=/^https:\/\/[^/?#]+([^?#]*)/u.exec(raw)?.[1]||'/',method=init?.method;
 if(url.protocol!=='https:'||url.username||url.password||url.port||rawPath!==url.pathname||url.pathname.includes('%')||
  !['GET','POST','PUT','DELETE'].includes(method)||!(init.headers instanceof Headers)||
  init.body!==undefined&&typeof init.body!=='string'||method==='GET'&&init.body!==undefined||
  init.signal!==undefined&&!(init.signal instanceof AbortSignal)||[...init.headers.keys()].some(key=>!HEADERS.has(key)))throw denied();
 if(url.origin==='https://auth.openbankingplatform.com'){
  if(url.pathname!=='/connect/token'||url.search||method!=='POST')throw denied();
 }else if(url.origin==='https://api.openbankingplatform.com'){
  const path=url.pathname,consent=CONSENT.test(path),root='/psd2/consent/v1/consents';
  const allowed=method==='GET'&&(ASPSP.test(path)||ACCOUNT.test(path)||consent&&path!==root)||
   consent&&method==='POST'&&(path===root||path.endsWith('/authorisations'))||
   consent&&method==='PUT'&&new RegExp('/authorisations/'+ID+'$').test(path)||
   consent&&method==='DELETE'&&new RegExp('^'+root+'/'+ID+'$').test(path);
  if(!allowed||url.search&&(method!=='GET'||consent))throw denied();
 }else throw denied();
 const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length)throw denied();
 return url.href;
}

/** Only the trusted Worker environment selects the certificate binding. The
 * public leaf certificate is a deployment receipt; Workers does not expose the
 * binding's certificate ID. Operators must verify that receipt against the
 * uploaded binding. This code never imports a private key or uses global fetch.
 * The shared HTTP client supplies the request deadline and bounded JSON limit. */
export function configuredOpenPaymentsWorkersTransport({configuration,environment,now=Date.now}={}){
 assertServerRuntime();
 if(typeof environment!=='function'||typeof now!=='function')throw INVALID();
 const initial=environment();
 if(initial.SAAS_BANK_ENABLED!=='true'||configuration?.environment!=='PRODUCTION'){forget(initial);return null;}
 const raw=initial[CONFIG_KEY];if(raw===undefined||raw===''){forget(initial);return null;}
 const providerRaw=initial.SAAS_OPENPAYMENTS_CONFIG;
 let metadata,certificate,validFrom,validTo;
 try{
  if(typeof raw!=='string'||raw.length>65536)throw INVALID();
  metadata=JSON.parse(raw);
  const keys=['version','credentialGeneration','binding','certificateId','certificatePem','certificateSha256'];
  if(!isRecord(metadata)||Object.keys(metadata).some(key=>!keys.includes(key))||metadata.version!==1||
   typeof metadata.credentialGeneration!=='string'||!metadata.credentialGeneration||metadata.credentialGeneration!==configuration.credentialGeneration||
   typeof metadata.binding!=='string'||!/^[_A-Z][_A-Z0-9]{0,63}$/.test(metadata.binding)||
   typeof metadata.certificateId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(metadata.certificateId)||
   typeof metadata.certificateSha256!=='string'||!/^[a-f0-9]{64}$/.test(metadata.certificateSha256)||
   typeof metadata.certificatePem!=='string'||metadata.certificatePem.length>32768||
   !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\r?\n?$/.test(metadata.certificatePem))throw INVALID();
  certificate=new X509Certificate(metadata.certificatePem);
  validFrom=Date.parse(certificate.validFrom);validTo=Date.parse(certificate.validTo);
  if(certificate.fingerprint256.replaceAll(':','').toLowerCase()!==metadata.certificateSha256||
   !Number.isFinite(validFrom)||!Number.isFinite(validTo)||validFrom>=validTo)throw INVALID();
 }catch{forget(initial);throw INVALID();}
 const binding=initial[metadata.binding],fetch=binding?.fetch;
 if(!isRecord(binding)||typeof fetch!=='function'||fetch===globalThis.fetch){forget(initial);throw INVALID();}
 let identity=identities.get(binding);
 if(identity&&(identity.raw!==raw||identity.providerRaw!==providerRaw||identity.fetch!==fetch)){retire(identity);identity=undefined;}
 if(!identity){identity={binding,raw,providerRaw,fetch,cacheIdentity:createOpenPaymentsTokenCacheIdentity(),retired:false};identities.set(binding,identity);}
 const previous=environments.get(initial);if(previous&&previous!==identity)retire(previous);environments.set(initial,identity);
 const capturedIdentity=identity;
 function assertCurrent(){
  try{
   const current=environment(),timestamp=now();
   if(current.SAAS_BANK_ENABLED!=='true'||current[CONFIG_KEY]!==raw||current.SAAS_OPENPAYMENTS_CONFIG!==providerRaw||
    current[metadata.binding]!==binding||binding.fetch!==fetch||!Number.isFinite(timestamp)||timestamp<validFrom)throw INVALID();
   if(timestamp>=validTo)throw new BankProviderError('CLIENT_CERTIFICATE_EXPIRED',409);
   if(capturedIdentity.retired||identities.get(binding)!==capturedIdentity||environments.get(initial)!==capturedIdentity)throw INVALID();
  }catch(error){retire(capturedIdentity);if(environments.get(initial)===capturedIdentity)environments.delete(initial);throw error;}
 }
 assertCurrent();
 async function request(input,init){
  assertCurrent();const url=checkedRequest(input,init),signal=init.signal;
  if(signal?.aborted)throw aborted();
  // A binding should honor AbortSignal. Settle independently as well, so an
  // aborted request cannot retain a late response or hold the caller open.
  const response=await new Promise((resolve,reject)=>{
   let settled=false;
   const cleanup=()=>signal?.removeEventListener('abort',onAbort);
   const onAbort=()=>{if(settled)return;settled=true;cleanup();reject(aborted());};
   signal?.addEventListener('abort',onAbort,{once:true});
   if(signal?.aborted){onAbort();return;}
   let pending;
   try{pending=fetch.call(binding,url,{method:init.method,headers:init.headers,body:init.body,signal,redirect:'manual',cache:'no-store'});}
   catch{settled=true;cleanup();reject(new BankProviderError('PROVIDER_UNAVAILABLE_NETWORK'));return;}
   Promise.resolve(pending).then(value=>{
    if(settled){cancel(value);return;}settled=true;cleanup();resolve(value);
   },()=>{if(settled)return;settled=true;cleanup();reject(signal?.aborted?aborted():new BankProviderError('PROVIDER_UNAVAILABLE_NETWORK'));});
  });
  try{
   assertCurrent();if(signal?.aborted)throw aborted();
   if(!(response instanceof Response)||response.status>=300&&response.status<400)throw new BankProviderError('PROVIDER_RESPONSE_INVALID');
  }catch(error){cancel(response);throw error;}
  if(!response.body)return response;
  const reader=response.body.getReader();
  let terminal=false,controller;
  const cleanup=()=>signal?.removeEventListener('abort',onAbort);
  const stop=error=>{
   if(terminal)return;terminal=true;cleanup();try{void reader.cancel().catch(()=>{});}catch{}
   try{controller.error(error);}catch{}
  };
  const onAbort=()=>stop(aborted());
  const body=new ReadableStream({
   start(value){controller=value;signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();},
   async pull(value){
    if(terminal)return;
    try{
     assertCurrent();if(signal?.aborted)throw aborted();
     const chunk=await reader.read();if(terminal)return;
     assertCurrent();if(signal?.aborted)throw aborted();
     if(chunk.done){terminal=true;cleanup();reader.releaseLock();value.close();}
     else value.enqueue(chunk.value);
    }catch(error){stop(error instanceof BankProviderError?error:new BankProviderError('PROVIDER_UNAVAILABLE_NETWORK'));}
   },
   cancel(){if(terminal)return;terminal=true;cleanup();try{void reader.cancel().catch(()=>{});}catch{}},
  });
  return new Response(body,{status:response.status,headers:response.headers});
 }
 const transport=Object.freeze({kind:'mtls',validateCertificate:assertCurrent,request});
 return Object.freeze({transport,assertCurrent,cacheIdentity:capturedIdentity.cacheIdentity,certificateValidUntil:new Date(validTo).toISOString()});
}
