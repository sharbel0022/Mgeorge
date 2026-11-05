import {ConsentError} from '../bank-consent-policy.js';
import {validateReadScopes} from '../bank-consent-policy.js';
const fail=(code,status=409)=>{throw new ConsentError(code,status);};
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
/** Durable application lifecycle. Store CAS must be atomic and guarded by live
 * membership. All provider handles remain in the encrypted server payload. */
export function createOpenPaymentsLifecycle(options){
 const {provider,context,codec,store,assertCurrent,enabled=false,redirectUri,actorPin,sessionHash,now=Date.now}=options;
 let fenceRevision;
 const guard=async()=>{if(!enabled)fail('SAAS_BANK_DISABLED');await assertCurrent(context.binding);if(fenceRevision!==undefined&&(await store.read()).revision!==fenceRevision)fail('BANK_STATE_CHANGED');};
 const read=async()=>{await guard();const row=await store.read();if(fenceRevision===undefined)fenceRevision=row.revision;await guard();return row;};
 const write=async(row,value)=>{await guard();if(!await store.compareAndSet(row.revision,value))fail('BANK_STATE_CHANGED');fenceRevision=row.revision+1;await guard();return {revision:fenceRevision,value};};
 const expected=(row,input)=>{if(!Number.isSafeInteger(input.expectedRevision)||row.revision!==input.expectedRevision)fail('BANK_STATE_CHANGED');if(input.connectionId!==undefined&&input.connectionId!==row.value?.id)fail('RESOURCE_SCOPE_MISMATCH',403);};
 const live=value=>{if(!value||!['active','pending_account'].includes(value.status)||Date.parse(value.validUntil)<=now())fail('BANK_CONSENT_EXPIRED');};
 const client=(consumeRedirectState=async()=>false)=>provider.forCompany(context,{codec,assertCurrent:guard,consumeRedirectState});
 const flowCheck=value=>{if(!value||value.actorPin!==actorPin||value.sessionHash!==sessionHash||Date.parse(value.expiresAt)<=now())fail('INVALID_CALLBACK',403);};
 return {
  async start(input){
   let row=await read();expected(row,input);const permissions=validateReadScopes(input.permissions);
   if(permissions.includes('bankgiro:read')&&!options.bankgiroAllowed)fail('BANKGIRO_SCOPE_UNAVAILABLE');
   if(row.value&&!['revoked','failed','cancelled'].includes(row.value.status))fail('BANK_BUSY');
   const value={id:context.binding.connectionId,bankId:input.bankId,bankName:options.bankName||input.bankId,status:'starting',actorPin,sessionHash,permissions,accounts:[],selected:[],authorizationId:crypto.randomUUID(),expiresAt:new Date(now()+10*60000).toISOString(),validUntil:new Date(now()+90*86400000).toISOString().slice(0,10)+'T23:59:59.999Z',generation:context.binding.generation};
   row=await write(row,value);const c=client();
   try{
    const caps=await c.discoverCapabilities();await guard();if(!caps.authorizationMethods.includes('redirect'))fail('BUSINESS_BANK_UNAVAILABLE');
    const consent=await c.createConsent({validUntil:value.validUntil.slice(0,10),redirectPreferred:true});await guard();
    row=await write(row,{...row.value,consentHandle:consent.handle});
    const authorization=await c.createAuthorisation(consent.handle);await guard();
    const method=authorization.methods.find(m=>m.authenticationMethodId===options.authenticationMethodId)||authorization.methods.length===1&&authorization.methods[0];
    if(!method)fail('BANK_AUTHENTICATION_METHOD_REQUIRED');
    const redirect=await c.startAuthorisation(authorization.handle,{authenticationMethodId:method.authenticationMethodId,redirectUri});await guard();
    if(redirect.approach!=='redirect')fail('BUSINESS_BANK_UNAVAILABLE');
    const state=new URL(redirect.redirectUrl).searchParams.get('state');if(!state||!/^[-_A-Za-z0-9]{43}$/.test(state))fail('INVALID_CALLBACK');
    row=await write(row,{...row.value,status:'pending',stateHash:await hash(state),flowHandle:redirect.flowHandle,redirectUrl:redirect.redirectUrl});return row;
   }catch(error){try{await write(row,{...row.value,status:'failed'});}catch{}throw error;}
  },
  async redirect(authorizationId){const row=await read();flowCheck(row.value);if(row.value.authorizationId!==authorizationId||row.value.status!=='pending')fail('INVALID_CALLBACK',403);return row.value.redirectUrl;},
  async complete(callback){
   let row=await read();flowCheck(row.value);
   if(!callback||Object.keys(callback).some(k=>!['code','scope','state','error'].includes(k))||typeof callback.state!=='string'||await hash(callback.state)!==row.value.stateHash)fail('INVALID_CALLBACK',403);
   if(callback.error!==undefined){if(callback.code!==undefined||callback.scope!==undefined||callback.error!=='access_denied'||row.value.status!=='pending')fail('INVALID_CALLBACK',403);return write(row,{...row.value,status:'cancelled',redirectUrl:''});}
   if(typeof callback.code!=='string'||!callback.code||callback.code.length>4096||typeof callback.scope!=='string')fail('INVALID_CALLBACK',403);
   const callbackHash=await hash(JSON.stringify(callback));
   if(['pending_account','active'].includes(row.value.status)&&row.value.callbackHash===callbackHash)return row;
   if(row.value.status!=='pending')fail('INVALID_CALLBACK',403);
   const c=client(async input=>{if(input.state!==callback.state||input.binding.companyId!==context.binding.companyId)return false;row=await write(row,{...row.value,status:'consuming',callbackHash,redirectUrl:''});return true;});
   const result=await c.completeRedirect(row.value.flowHandle,callback);await guard();if(result.status!=='valid')fail('BANK_CONSENT_INVALID');
   const list=await c.listAccounts(row.value.consentHandle);await guard();
   if(!list.accounts.length)fail('BANK_ACCOUNT_SCOPE_INVALID');
   const expires=Date.parse(list.validUntil);if(!Number.isFinite(expires)||expires<=now())fail('BANK_CONSENT_EXPIRED');
   const validUntil=new Date(Math.min(Date.parse(row.value.validUntil),expires)).toISOString();
   const accounts=list.accounts.map(account=>({...account,id:crypto.randomUUID()}));
   return write(row,{...row.value,status:'pending_account',validUntil,accounts,flowHandle:'',redirectUrl:'',completedAt:new Date(now()).toISOString()});
  },
  async select(input){let row=await read();expected(row,input);live(row.value);const ids=input.accountIds;if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>!row.value.accounts.some(a=>a.id===id&&a.identity.currency==='SEK')))fail('BANK_ACCOUNT_SCOPE_INVALID');const c=client();if((await c.getConsentStatus(row.value.consentHandle)).status!=='valid')fail('BANK_CONSENT_INVALID');await guard();for(const id of ids){await c.getAccount(row.value.accounts.find(a=>a.id===id).handle);await guard();}return write(row,{...row.value,selected:ids,status:'active'});},
  async revoke(input){let row=await read();expected(row,input);if(!row.value)fail('RESOURCE_SCOPE_MISMATCH',403);if(row.value.status==='revoked')return row;row=await write(row,{...row.value,status:'revocation_pending',selected:[]});await client().revokeConsent(row.value.consentHandle);await guard();return write(row,{...row.value,status:'revoked',accounts:[],selected:[],flowHandle:'',redirectUrl:''});},
  async transactions(accountId,input){const row=await read();live(row.value);if(row.value.status!=='active'||!row.value.selected.includes(accountId))fail('BANK_ACCOUNT_SCOPE_INVALID');const account=row.value.accounts.find(a=>a.id===accountId),c=client();if((await c.getConsentStatus(row.value.consentHandle)).status!=='valid')fail('BANK_CONSENT_INVALID');await guard();const result=await c.getTransactions(account.handle,input);await guard();const current=await read();if(current.revision!==row.revision)fail('BANK_STATE_CHANGED');return result;},
  async renew(input){const row=await this.revoke(input);return this.start({bankId:row.value.bankId,permissions:row.value.permissions,expectedRevision:row.revision});},
 };
}
