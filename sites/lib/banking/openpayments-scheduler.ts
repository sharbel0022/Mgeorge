import {env} from 'cloudflare:workers';
import {db,currentCompanyContext,withCompanyOwner} from '../server';

/** Adapter for the existing authenticated scheduler. No timer, caller-supplied
 * company identity, or implicit automatic enrollment is created here. */
export async function dispatchOpenPaymentsSchedule(owner:string,request?:Request,statusOnly=false){
 const context=currentCompanyContext();if(!context)return null;
 if(context.storageOwner!==owner)throw Object.assign(Error('COMPANY_SCOPE_MISMATCH'),{status:403});
 let row:unknown;
 try{row=await db().prepare('SELECT revision FROM saas_bank_state WHERE owner=?').bind(owner).first();}
 catch(error){if(error instanceof Error&&/no such table:\s*(?:main\.)?saas_bank_state\b/i.test(error.message))return null;throw error;}
 if(!row)return null;
 const disabled={automatic:true,company:true,provider:'open_payments',enabled:false,connected:false,disabled:true,status:'blocked',code:'CONFIGURATION_REQUIRED',imported:0,lastSyncedAt:null,lastAttemptAt:null,nextAttemptAt:null,failures:0,blocked:true,results:[]};
 const values=env as unknown as Record<string,string>;
 if(values.SAAS_BANK_ENABLED!=='true')return disabled;
 let config:Record<string,any>;try{config=JSON.parse(values.SAAS_OPENPAYMENTS_CONFIG);}catch{return disabled;}
 // Internal MCP continuations have no browser Request. Use an operator-owned
 // registered callback origin solely to compose the read adapter; no redirect
 // is started and no browser session is manufactured.
 const callbackPath=`/api/companies/${context.companyId}/bank/callback`;
 const registered=Array.isArray(config.redirectUris)?config.redirectUris.find((value:unknown)=>{try{return typeof value==='string'&&new URL(value).protocol==='https:'&&new URL(value).pathname===callbackPath;}catch{return false;}}):null;
 if(!request&&!registered)return disabled;
 const readRequest=new Request(request?.url??registered,{method:'GET'});
 const {saasBankSnapshot,saasBankSyncConfiguration}=await import('./saas-runtime');
 const {sitesOpenPaymentsCompanySync}=await import('./openpayments-company-sync');
 const configuration=await saasBankSyncConfiguration(readRequest,context.companyId),snapshot=await saasBankSnapshot(readRequest,context.companyId);
 const connected=configuration.serviceEnabled&&snapshot.connection?.status==='active'&&Date.parse(snapshot.connection.validUntil)>Date.now();
 const adapter=await sitesOpenPaymentsCompanySync(readRequest,context.companyId);
 if(statusOnly){
  const statuses=[];for(const account of snapshot.accounts.filter((item:{selected:boolean})=>item.selected))statuses.push(await adapter.status(account.id));
  const successes=statuses.map(value=>value.lastSuccessAt),next=statuses.map(value=>value.nextAllowedAt).filter((value):value is string=>!!value);
  return{automatic:true,company:true,provider:'open_payments',enabled:configuration.automaticEnabled,connected,disabled:!configuration.automaticEnabled,lastSyncedAt:successes.length&&successes.every(Boolean)?successes.sort()[0]:null,lastAttemptAt:null,nextAttemptAt:next.length?next.sort().at(-1):null,blocked:!connected||statuses.some(value=>value.state==='blocked'),failures:statuses.filter(value=>value.state==='failed').length,imported:0};
 }
 if(!configuration.automaticEnabled||!connected)return{...disabled,connected,code:!connected?'CONSENT_INVALID':'AUTOMATIC_SYNC_DISABLED'};
 return withCompanyOwner(owner,'manage_integrations',async()=>({automatic:true,company:true,provider:'open_payments',...await adapter.scheduled()}));
}
