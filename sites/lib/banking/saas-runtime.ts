import {env} from 'cloudflare:workers';
import {db,identity,currentCompanyContext} from '@/lib/server';
import {seal,unseal,digest,cookieValue} from './security';
import {createSaasBankRuntime} from './saas-bank-runtime.js';
import {ConsentError} from '../bank-consent-policy.js';
const settings=()=>env as unknown as Record<string,string>;
function parsed(value:string|undefined){try{return value?JSON.parse(value):null;}catch{throw new ConsentError('SAAS_BANK_CONFIGURATION_INVALID',503);}}
async function runtime(request:Request,companyId:string){
 const user=await identity(request.method==='GET'?undefined:request),context=currentCompanyContext();
 if(!context||context.companyId!==companyId||context.storageOwner!==user.userId)throw new ConsentError('COMPANY_ACCESS_DENIED',403);
 const config=settings(),owner=context.storageOwner,key=config.BANK_DATA_ENCRYPTION_KEY;
 const keys=['SAAS_BANK_ENABLED','SAAS_OPENPAYMENTS_CONFIG','SAAS_OPENPAYMENTS_REGISTRATIONS'],pin=keys.map(key=>config[key]);
 const guard=async()=>{await identity();if(keys.some((key,index)=>settings()[key]!==pin[index]))throw new ConsentError('CONSENT_APPLICATION_CHANGED',409);};
 const codec={seal:(o:string,p:string,v:unknown)=>seal(key,o,p,v),unseal:(o:string,p:string,v:string)=>unseal(key,o,p,v)};
 const store={async read(){const row=await db().prepare('SELECT revision,payload FROM saas_bank_state WHERE owner=?').bind(owner).first<{revision:number;payload:string}>();return row?{revision:row.revision,value:await unseal<Record<string,unknown>>(key,owner,'saas-bank-state',row.payload)}:{revision:0,value:null};},async compareAndSet(expected:number,value:unknown){const payload=await seal(key,owner,'saas-bank-state',value);await guard();const result=expected===0?await db().prepare('INSERT OR IGNORE INTO saas_bank_state(owner,revision,payload) VALUES(?,1,?)').bind(owner,payload).run():await db().prepare('UPDATE saas_bank_state SET revision=revision+1,payload=? WHERE owner=? AND revision=?').bind(payload,owner,expected).run();return result.meta.changes===1;}};
 const registration=parsed(config.SAAS_OPENPAYMENTS_REGISTRATIONS)?.find((entry:Record<string,unknown>)=>entry.companyId===companyId&&entry.actorId===context.actorId);
 return createSaasBankRuntime({context,config:parsed(config.SAAS_OPENPAYMENTS_CONFIG),registration,enabled:config.SAAS_BANK_ENABLED==='true',requestKey:request.headers.get('idempotency-key'),codec,store,assertCurrent:guard,sessionHash:/^[a-f0-9]{64}$/.test(cookieValue(request,'__Host-mg-onboarding'))?await digest(cookieValue(request,'__Host-mg-onboarding')):'',redirectUri:new URL(`/api/companies/${companyId}/bank/callback`,request.url).href});
}
export async function saasBankSnapshot(req:Request,id:string){return (await runtime(req,id)).snapshot();}
export async function saasBankStart(req:Request,id:string,body:Record<string,unknown>){return (await runtime(req,id)).start(body);}
export async function saasBankRenew(req:Request,id:string,body:Record<string,unknown>){return (await runtime(req,id)).renew(body);}
export async function saasBankSelect(req:Request,id:string,body:Record<string,unknown>){return (await runtime(req,id)).select(body);}
export async function saasBankRevoke(req:Request,id:string,body:Record<string,unknown>){return (await runtime(req,id)).revoke(body);}
export async function saasBankDiscovery(req:Request,id:string){return (await runtime(req,id)).discovery();}
export async function saasBankRedirect(req:Request,id:string,authorizationId:string){return new Response(null,{status:303,headers:{Location:await (await runtime(req,id)).redirect(authorizationId),'Cache-Control':'no-store'}});}
export async function saasBankCallback(req:Request,id:string){const params=new URL(req.url).searchParams,body:Record<string,unknown>={};for(const [key,value]of params){if(Object.hasOwn(body,key))throw new ConsentError('INVALID_CALLBACK',403);body[key]=value;}return (await runtime(req,id)).callback(body);}
export async function saasBankSyncContext(req:Request,id:string,accountId:string){return (await runtime(req,id)).syncContext(accountId);}
