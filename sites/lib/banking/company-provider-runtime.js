import {assertCompanyContext,companyCacheKey} from '../company-contract.js';
import {OpenPaymentsProvider} from './openpayments-provider.js';
import {validateOpenPaymentsConfig} from './openpayments/config.js';
import {createCompanyProviderManager} from './company-provider-manager.js';

const text=(value,max=4096)=>typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
const instant=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===(value.includes('.')?value:value.replace('Z','.000Z'));
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const unavailable=code=>Object.assign(Error(code),{code,status:403,companyProviderError:true});
const keys=new Set(['verified','companyId','owner','evidenceId','environment','appGeneration','validUntil','corporateId','psuId','corporateIdType','affiliatedAspspId','psu','redirectUri','productionTransportVerified']);

/** Trusted runtime construction only. Settings/registrations never originate in
 * request JSON. The returned manager remains usable for stored reads when the
 * provider is unavailable; no configuration or private registration is exposed. */
export async function createCompanyProviderRuntime({settings,repository,codec,currentContext,assertCurrent,withBankLock,transport,transportBinding='',callbackUri,paths,now=Date.now,randomId,hash=digest}={}){
 if(typeof settings!=='function'||typeof currentContext!=='function'||typeof assertCurrent!=='function'||typeof hash!=='function')throw TypeError('Trusted live provider runtime adapters required');
 async function load(){
  let source;try{source=await settings();}catch{source={};}
  const enabled=source?.MG_SAAS_ONBOARDING_ENABLED==='true',raw=source?.MG_OPENPAYMENTS_CONFIG,registrations=source?.MG_COMPANY_BANK_REGISTRATIONS;
  const certificate=source?.MG_OPENPAYMENTS_CLIENT_CERTIFICATE_PEM??'',key=source?.MG_OPENPAYMENTS_CLIENT_PRIVATE_KEY_PEM??'';
  try{
   if(typeof raw!=='string'||raw.length>65536)throw Error();
   const input=JSON.parse(raw),configuration=validateOpenPaymentsConfig(input,now);
   const generation=await hash(JSON.stringify(['company-provider-runtime-v1',configuration.credentialGeneration,configuration.clientId,configuration.clientSecret,configuration.environment,JSON.stringify(configuration),certificate,key,transportBinding]));
   if(!/^[a-f0-9]{64}$/.test(generation))throw Error();
   let transportReady=configuration.environment==='SANDBOX';
   if(configuration.environment==='PRODUCTION'&&transport?.kind==='mtls'&&typeof transport.validateCertificate==='function')try{await transport.validateCertificate();transportReady=true;}catch{}
   return{enabled,input,configuration,generation,registrations,transportReady};
  }catch{return{enabled,configuration:null,generation:null,registrations,transportReady:false};}
 }
 function registered(snapshot,context){
  if(!snapshot.configuration||typeof snapshot.registrations!=='string'||snapshot.registrations.length>262144)return null;
  try{
   const registry=JSON.parse(snapshot.registrations);
   if(registry?.version!==1||Object.keys(registry).some(key=>!['version','bindings'].includes(key))||!Array.isArray(registry.bindings)||registry.bindings.length>100)throw Error();
   const entries=registry.bindings.filter(row=>row?.companyId===context.companyId);
   if(entries.length!==1)throw Error();const row=entries[0];
   if(Object.keys(row).some(key=>!keys.has(key))||row.verified!==true||row.owner!==context.storageOwner||!text(row.evidenceId,300)||row.environment!==snapshot.configuration.environment||row.appGeneration!==snapshot.configuration.credentialGeneration||!instant(row.validUntil)||Date.parse(row.validUntil)<=now()||!text(row.corporateId,300)||!text(row.psuId,300)||!snapshot.configuration.redirectUris.includes(row.redirectUri)||callbackUri!==undefined&&row.redirectUri!==callbackUri)throw Error();
   for(const field of ['corporateIdType','affiliatedAspspId'])if(row[field]!==undefined&&!text(row[field],300))throw Error();
   if(!row.psu||typeof row.psu!=='object'||Array.isArray(row.psu)||Object.keys(row.psu).some(key=>!['ipAddress','userAgent'].includes(key))||!text(row.psu.ipAddress,100)||!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(row.psu.ipAddress)||row.psu.ipAddress.split('.').some(part=>Number(part)>255)||!text(row.psu.userAgent,512))throw Error();
   if(row.environment==='PRODUCTION'&&(row.productionTransportVerified!==true||!snapshot.transportReady))throw Error();
   return{...structuredClone(row),appGeneration:snapshot.generation};
  }catch{return null;}
 }
 const initial=await load();let provider=null;
 if(initial.configuration&&initial.transportReady)try{provider=new OpenPaymentsProvider({...initial.input,credentialGeneration:initial.generation},{...(transport?{transport}:{}),now});}catch{}
 const manager=createCompanyProviderManager({provider,repository,codec,currentContext,withBankLock,now,onboardingEnabled:async()=>{try{return (await settings())?.MG_SAAS_ONBOARDING_ENABLED==='true';}catch{return false;}},...(paths?{paths}:{}),...(randomId?{randomId}:{}),hash,
  async assertCurrent(context,action){
   await assertCurrent(context,action);
   if(action==='manage_integrations'){
    const current=await load();if(!current.configuration||!current.transportReady||!provider)throw unavailable('PROVIDER_UNAVAILABLE');
    if(current.generation!==initial.generation)throw unavailable('PROVIDER_GENERATION_CHANGED');
   }
  },
  async registration(context){const snapshot=await load();return registered(snapshot,assertCompanyContext(context));},
 });
 return Object.freeze({manager,async configStatus(){
  const context=assertCompanyContext(await currentContext());await assertCurrent(context,'read');const snapshot=await load(),registration=registered(snapshot,context);
  const available=!!(snapshot.enabled&&snapshot.configuration&&snapshot.transportReady&&registration&&provider&&snapshot.generation===initial.generation);
  await assertCurrent(context,'read');if(companyCacheKey(assertCompanyContext(await currentContext()))!==companyCacheKey(context))throw unavailable('COMPANY_CONTEXT_STALE');
  return{provider:'open_payments',enabled:snapshot.enabled,configured:!!snapshot.configuration,registered:!!registration,available,environment:snapshot.configuration?.environment??null,reason:!snapshot.enabled?'disabled':!snapshot.configuration?'configuration_required':!snapshot.transportReady?'transport_required':!registration?'company_registration_required':available?'available':'configuration_required',payments:'disabled'};
 }});
}
