import {env} from 'cloudflare:workers';
import {db,identity,currentCompanyContext} from '@/lib/server';
import {seal,unseal,digest,cookieValue} from './security';
import {createSaasBankRuntime} from './saas-bank-runtime.js';
import type {OpenPaymentsOptions} from './openpayments-provider.js';
import {ConsentError} from '../bank-consent-policy.js';
import {configuredOpenPaymentsWorkersTransport} from './openpayments-workers-transport.js';
const settings=()=>env as unknown as Record<string,string>;
const configurationKeys=['SAAS_BANK_ENABLED','SAAS_OPENPAYMENTS_CONFIG','SAAS_OPENPAYMENTS_REGISTRATIONS','SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG','BANK_DATA_ENCRYPTION_KEY'];
function parsed(value:string|undefined){try{return value?JSON.parse(value):null;}catch{throw new ConsentError('SAAS_BANK_CONFIGURATION_INVALID',503);}}
async function runtime(request:Request,companyId:string,providerOptions?:OpenPaymentsOptions){
 const user=await identity(request.method==='GET'?undefined:request),context=currentCompanyContext();
 if(!context||context.companyId!==companyId||context.storageOwner!==user.userId)throw new ConsentError('COMPANY_ACCESS_DENIED',403);
 const config=settings(),owner=context.storageOwner,key=config.BANK_DATA_ENCRYPTION_KEY,providerConfig=parsed(config.SAAS_OPENPAYMENTS_CONFIG);
 const mtls=configuredOpenPaymentsWorkersTransport({configuration:providerConfig,environment:settings});
 const pin=configurationKeys.map(key=>config[key]);
 const guard=async()=>{await identity();if(configurationKeys.some((key,index)=>settings()[key]!==pin[index]))throw new ConsentError('CONSENT_APPLICATION_CHANGED',409);mtls?.assertCurrent();};
 const codec={seal:(o:string,p:string,v:unknown)=>seal(key,o,p,v),unseal:(o:string,p:string,v:string)=>unseal(key,o,p,v)};
 const store={async read(){const row=await db().prepare('SELECT revision,payload FROM saas_bank_state WHERE owner=?').bind(owner).first<{revision:number;payload:string}>();return row?{revision:row.revision,value:await unseal<Record<string,unknown>>(key,owner,'saas-bank-state',row.payload)}:{revision:0,value:null};},async compareAndSet(expected:number,value:unknown){const payload=await seal(key,owner,'saas-bank-state',value);await guard();const result=expected===0?await db().prepare('INSERT OR IGNORE INTO saas_bank_state(owner,revision,payload) VALUES(?,1,?)').bind(owner,payload).run():await db().prepare('UPDATE saas_bank_state SET revision=revision+1,payload=? WHERE owner=? AND revision=?').bind(payload,owner,expected).run();return result.meta.changes===1;}};
 const registration=parsed(config.SAAS_OPENPAYMENTS_REGISTRATIONS)?.find((entry:Record<string,unknown>)=>entry.companyId===companyId&&entry.actorId===context.actorId);
 // Production cannot replace the environment binding with a caller-supplied
 // transport. Preserve the trusted coordinator's per-request quota boundary.
 const options=providerConfig?.environment==='PRODUCTION'?{...providerOptions,transport:mtls?.transport}:providerOptions;
 const bank=createSaasBankRuntime({context,config:providerConfig,registration,enabled:config.SAAS_BANK_ENABLED==='true',requestKey:request.headers.get('idempotency-key'),providerOptions:options,codec,store,assertCurrent:guard,sessionHash:/^[a-f0-9]{64}$/.test(cookieValue(request,'__Host-mg-onboarding'))?await digest(cookieValue(request,'__Host-mg-onboarding')):'',redirectUri:new URL(`/api/companies/${companyId}/bank/callback`,request.url).href});
 if(!mtls)return bank;
 return{...bank,async syncContext(accountId:string){const resolved=await bank.syncContext(accountId);await guard();return{...resolved,context:{...resolved.context,validUntil:new Date(Math.min(Date.parse(resolved.context.validUntil),Date.parse(mtls.certificateValidUntil))).toISOString()}};}};
}
export async function saasBankSnapshot(req:Request,id:string){return (await runtime(req,id)).snapshot();}
export async function saasBankStart(req:Request,id:string,body:Record<string,unknown>){return (await runtime(req,id)).start(body);}
export async function saasBankRenew(req:Request,id:string,body:Record<string,unknown>){return (await runtime(req,id)).renew(body);}
export async function saasBankSelect(req:Request,id:string,body:Record<string,unknown>){return (await runtime(req,id)).select(body);}
export async function saasBankRevoke(req:Request,id:string,body:Record<string,unknown>){return (await runtime(req,id)).revoke(body);}
export async function saasBankDiscovery(req:Request,id:string){return (await runtime(req,id)).discovery();}
export async function saasBankRedirect(req:Request,id:string,authorizationId:string){return new Response(null,{status:303,headers:{Location:await (await runtime(req,id)).redirect(authorizationId),'Cache-Control':'no-store'}});}
export async function saasBankCallback(req:Request,id:string){const params=new URL(req.url).searchParams,body:Record<string,unknown>={};for(const [key,value]of params){if(Object.hasOwn(body,key))throw new ConsentError('INVALID_CALLBACK',403);body[key]=value;}return (await runtime(req,id)).callback(body);}
export async function saasBankSyncContext(req:Request,id:string,accountId:string,providerOptions?:OpenPaymentsOptions){return (await runtime(req,id,providerOptions)).syncContext(accountId);}

/** Internal trusted composition only. No registration or account identity is
 * returned directly from an HTTP response. This performs stored reads only. */
export async function saasBankSyncConfiguration(request:Request,companyId:string){
 const user=await identity(request.method==='GET'?undefined:request),context=currentCompanyContext();
 if(!context||context.companyId!==companyId||context.storageOwner!==user.userId)throw new ConsentError('COMPANY_ACCESS_DENIED',403);
 const values=settings(),registration=parsed(values.SAAS_OPENPAYMENTS_REGISTRATIONS)?.find((entry:Record<string,unknown>)=>entry.companyId===companyId&&entry.actorId===context.actorId),config=parsed(values.SAAS_OPENPAYMENTS_CONFIG);
 const mtls=configuredOpenPaymentsWorkersTransport({configuration:config,environment:settings}),pin=configurationKeys.map(key=>values[key]);
 const guard=async()=>{await identity();if(configurationKeys.some((key,index)=>settings()[key]!==pin[index]))throw new ConsentError('CONSENT_APPLICATION_CHANGED',409);mtls?.assertCurrent();};
 const serviceEnabled=values.SAAS_BANK_ENABLED==='true'&&(config?.environment==='SANDBOX'||!!mtls);
 const enabled=serviceEnabled&&registration?.verified===true&&registration?.corporateAccessVerified===true&&registration?.redirectVerified===true;
 const row=await db().prepare('SELECT revision,payload FROM saas_bank_state WHERE owner=?').bind(user.userId).first<{revision:number;payload:string}>();
 await guard();
 const stored=row?await unseal<Record<string,any>>(values.BANK_DATA_ENCRYPTION_KEY,user.userId,'saas-bank-state',row.payload):null;
 await guard();
 const configuredDate=registration?.dateFrom,defaultDate=new Date(Date.now()-29*86400000).toISOString().slice(0,10);
 const dateFrom=typeof configuredDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(configuredDate)&&new Date(configuredDate).toISOString().slice(0,10)===configuredDate?configuredDate:defaultDate;
 const rate=registration?.ratePolicy,syncEnabled=enabled&&rate?.verified===true&&typeof rate.evidenceId==='string'&&!!rate.evidenceId&&Number.isSafeInteger(rate.maxRequests)&&rate.maxRequests>0&&Number.isSafeInteger(rate.windowMs)&&rate.windowMs>0;
 const configurationHash=await digest(JSON.stringify(pin));await guard();
 return{enabled,syncEnabled,credentialGeneration:String(config?.credentialGeneration||''),serviceEnabled,companyId,owner:user.userId,bankId:String(registration?.bankId||stored?.bankId||''),evidenceId:String(registration?.syncEvidenceId||registration?.ratePolicy?.evidenceId||''),dateFrom,automaticEnabled:enabled&&registration?.automaticEnabled===true&&registration?.operatorVerified===true&&typeof registration?.operatorEvidenceId==='string'&&!!registration.operatorEvidenceId,configurationHash,assertTransportCurrent:mtls?.assertCurrent,bankgiroRegistration:registration?.bankgiroRegistration??null,stored};
}
