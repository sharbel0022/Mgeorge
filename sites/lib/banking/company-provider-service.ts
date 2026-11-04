import {env} from 'cloudflare:workers';
import {db,identity,currentCompanyContext,withCompanyOwner,withCompanyRequest,response,failure} from '@/lib/server';
import {assertCompanyContext,assertCompanyPermission,companyCacheKey,type CompanyContext,type CompanyAction} from '../company-contract.js';
import {createCompanyProviderRuntime} from './company-provider-runtime.js';
import {createCompanyProviderRepository} from './company-provider-repository.js';
import {encrypt,decrypt,withBankLock} from './store';
import {cookieValue,digest,randomToken,validFlowToken} from './security';
import type {PublicProviderConnection} from './company-provider-manager.js';

export const COMPANY_BANK_CALLBACK_URI='https://mg-fakturakoll-sharbel.sharbelrasho.chatgpt.site/api/bank/callback';
type Action='providers'|'banks'|'list'|'start'|'renew'|'refresh'|'status'|'method'|'accounts'|'revoke'|'redirect';
type Parameters={companyId:string;id?:string;flowId?:string};
function fail(code:string,status=400):never{throw Object.assign(Error(code),{code,status});}
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[-_A-Za-z0-9:.]{1,200}$/.test(value);
const codec={seal:encrypt,unseal:decrypt};
function publicFailure(error:unknown){
 const code=error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'?error.code:'';
 if(code.startsWith('COMPANY_')||error instanceof Error&&['AUTH_REQUIRED','ORIGIN_DENIED'].includes(error.message))return failure(error);
 const safe=/^(?:PROVIDER_|RESOURCE_SCOPE_|BANK_)[A-Z_]+$/.test(code)?code:'PROVIDER_OPERATION_FAILED';
 const value=error&&typeof error==='object'&&'status'in error?Number(error.status):0;
 return response({error:'Bankåtgärden kunde inte slutföras. Kontrollera anslutningen och försök igen.',code:safe},[400,403,404,409,413,429,503].includes(value)?value:403);
}
async function liveContext():Promise<Readonly<CompanyContext>>{await identity();return assertCompanyContext(currentCompanyContext());}
async function assertCurrent(context:Readonly<CompanyContext>,action:CompanyAction){
 const actual=await liveContext();if(companyCacheKey(actual)!==companyCacheKey(context))fail('COMPANY_CONTEXT_STALE',409);
 assertCompanyPermission(actual.role,action);await withCompanyOwner(context.storageOwner,action,async()=>{});
}
async function runtime(){
 const repository=createCompanyProviderRepository({database:db(),codec,currentContext:liveContext,assertCurrent,flowDialect:'sites'});
 return createCompanyProviderRuntime({settings:()=>env as unknown as Record<string,unknown>,repository,codec,currentContext:liveContext,assertCurrent,withBankLock,callbackUri:COMPANY_BANK_CALLBACK_URI});
}
async function body(request:Request,keys:string[]):Promise<Record<string,any>>{
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))fail('PROVIDER_REQUEST_INVALID');
 const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>8192))fail('PROVIDER_REQUEST_TOO_LARGE',413);
 const reader=request.body?.getReader();if(!reader)fail('PROVIDER_REQUEST_INVALID');let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>8192){await reader.cancel();fail('PROVIDER_REQUEST_TOO_LARGE',413);}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
 let parsed;try{parsed=JSON.parse(text);}catch{fail('PROVIDER_REQUEST_INVALID');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).length!==keys.length||keys.some(key=>!Object.hasOwn(parsed,key)))fail('PROVIDER_REQUEST_INVALID');
 if(keys.includes('revision')&&(!Number.isSafeInteger(parsed.revision)||parsed.revision<1))fail('PROVIDER_REQUEST_INVALID');
 return parsed;
}
const flowCookie=async(companyId:string,flowId:string)=>'__Secure-mg-provider-'+(await hash(JSON.stringify([companyId,flowId]))).slice(0,32);
const cookieHeader=(name:string,value:string,expire=false)=>`${name}=${value}; Path=/api; Secure; HttpOnly; SameSite=Lax; Max-Age=${expire?0:900}`;
async function browser(request:Request,context:Readonly<CompanyContext>,flowId?:string,create=false){
 const name=flowId?await flowCookie(context.companyId,flowId):'',saved=name?cookieValue(request,name):'';
 if(!create&&!validFlowToken(saved)||saved&&!validFlowToken(saved))fail('PROVIDER_BROWSER_BINDING_REQUIRED',403);
 // ChatGPT supplies trusted actor identity, not an independently observable
 // application-session ID. The random per-flow cookie is the browser nonce;
 // this separate identity pin retains every live company generation.
 return {cookie:saved||randomToken(),session:companyCacheKey(context)};
}
async function flowForConnection(context:Readonly<CompanyContext>,connectionId:string){
 const row=await db().prepare("SELECT provider_flow_id FROM bank_auth_flows WHERE owner=? AND company_id=? AND provider_kind='open_payments' AND provider_connection_id=? ORDER BY created_at DESC LIMIT 1").bind(context.storageOwner,context.companyId,connectionId).first<{provider_flow_id:string}>();
 if(!row||!identifier(row.provider_flow_id))fail('PROVIDER_FLOW_INVALID',403);return row.provider_flow_id;
}
function project(context:Readonly<CompanyContext>,value:PublicProviderConnection){
 return {...value,...(value.redirectPath&&value.flowId?{redirectPath:`/api/companies/${encodeURIComponent(context.companyId)}/bank/authorizations/${encodeURIComponent(value.flowId)}/redirect`}:{})};
}
async function dispatch(request:Request,action:Action,params:Parameters){
 await identity(request);const context=await liveContext();
 if(!identifier(params.companyId)||params.companyId!==context.companyId)fail('COMPANY_BOUNDARY_MISMATCH',403);
 const manage=!['providers','list','status'].includes(action);await assertCurrent(context,manage?'manage_integrations':'read');
 const query=new URL(request.url).searchParams;if([...query.keys()].some(key=>!['companyId','companyContextVersion'].includes(key)))fail('PROVIDER_REQUEST_INVALID');
 if(['status','renew','refresh','method','accounts','revoke'].includes(action)&&!identifier(params.id)||action==='redirect'&&!identifier(params.flowId))fail('PROVIDER_REQUEST_INVALID');
 const api=await runtime(),manager=api.manager;
 if(action==='providers')return response({companyId:context.companyId,providers:[await api.configStatus()]});
 if(action==='banks')return response({companyId:context.companyId,...await manager.discoverBanks({countries:['SE']})});
 if(action==='list'){const result=await manager.status() as {connections:PublicProviderConnection[]};return response({companyId:context.companyId,connections:result.connections.map(value=>project(context,value))});}
 if(action==='status')return response({companyId:context.companyId,...project(context,await manager.status({connectionId:params.id,refresh:false}) as PublicProviderConnection)});
 if(action==='redirect')return manager.withRedirect({flowId:params.flowId!,browser:await browser(request,context,params.flowId)},providerUrl=>new Response(null,{status:303,headers:{Location:providerUrl,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}}));
 if(action==='refresh'){await body(request,[]);return response({companyId:context.companyId,...project(context,await manager.status({connectionId:params.id,refresh:true}) as PublicProviderConnection)});}
 if(action==='start'||action==='renew'){
  const input=await body(request,['bankId','validUntil','requestKey',...(action==='renew'?['revision']:[])]);if(typeof input.requestKey!=='string'||!input.requestKey||input.requestKey.length>200)fail('PROVIDER_REQUEST_INVALID');
  const retained=await db().prepare("SELECT provider_flow_id FROM bank_auth_flows WHERE owner=? AND company_id=? AND provider_kind='open_payments' AND provider_request_key_hash=?").bind(context.storageOwner,context.companyId,await hash(input.requestKey)).first<{provider_flow_id:string}>();
  const binding=await browser(request,context,retained?.provider_flow_id,!retained),value=await manager.start({bankId:input.bankId,validUntil:input.validUntil,requestKey:input.requestKey,browser:binding,...(action==='renew'?{renewConnectionId:params.id!,expectedRevision:input.revision}:{})});
  if(!value.flowId||!identifier(value.flowId))fail('PROVIDER_FLOW_INVALID',403);
  const result=response({companyId:context.companyId,...project(context,value)},action==='renew'?200:201);result.headers.set('Set-Cookie',cookieHeader(await flowCookie(context.companyId,value.flowId),binding.cookie));return result;
 }
 if(action==='method'){
  const input=await body(request,['methodId','revision']),flowId=await flowForConnection(context,params.id!);
  return response({companyId:context.companyId,...project(context,await manager.chooseMethod({connectionId:params.id!,revision:input.revision,methodId:input.methodId,browser:await browser(request,context,flowId)}))});
 }
 if(action==='accounts'){const input=await body(request,['accountIds','revision']);return response({companyId:context.companyId,...project(context,await manager.selectAccounts({connectionId:params.id!,revision:input.revision,accountIds:input.accountIds}))});}
 const input=await body(request,['revision']);return response({companyId:context.companyId,...project(context,await manager.revoke({connectionId:params.id!,revision:input.revision}))});
}
export function companyProviderRoute(action:Action){return withCompanyRequest(async(request:Request,route:{params:Promise<Parameters>})=>{try{return await dispatch(request,action,await route.params);}catch(error){return publicFailure(error);}});}

/** Dispatch only from the retained discriminator, before the legacy parser. */
export async function providerCallback(request:Request):Promise<Response|null>{
 const url=new URL(request.url),state=url.searchParams.get('state');if(url.searchParams.getAll('state').length!==1||!validFlowToken(state))return null;
 const user=await identity(),context=currentCompanyContext();
 const rows=await db().prepare('SELECT provider_kind,provider_flow_id,company_id,owner FROM bank_auth_flows WHERE state_hash IN (?,?)').bind(await digest(state),await hash(state)).all<{provider_kind:string;provider_flow_id:string;company_id:string;owner:string}>();
 if(rows.results.length>1)fail('PROVIDER_FLOW_INVALID',403);const flow=rows.results[0];if(!flow)return null;
 if(flow.provider_kind==='enable_banking')return null;if(flow.provider_kind!=='open_payments')fail('PROVIDER_FLOW_INVALID',403);
 if(!context||flow.owner!==user.userId||flow.company_id!==context.companyId||url.origin+url.pathname!==COMPANY_BANK_CALLBACK_URI)fail('PROVIDER_FLOW_INVALID',403);
 const current=assertCompanyContext(context),api=await runtime();await api.manager.callback({flowId:flow.provider_flow_id,parameters:url.searchParams,browser:await browser(request,current,flow.provider_flow_id)});
 return new Response(null,{status:303,headers:{Location:'/bank?result=provider_ready','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','Set-Cookie':cookieHeader(await flowCookie(current.companyId,flow.provider_flow_id),'',true)}});
}
