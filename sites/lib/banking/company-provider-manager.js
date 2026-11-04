import {assertCompanyContext,assertCompanyPermission,companyCacheKey} from '../company-contract.js';
import {BankProviderError,scopedResourceCodec,validDate} from './bank-data-provider.js';
import {OPENPAYMENTS_ORIGINS,validateScopes} from './openpayments/config.js';

const PROVIDER='open_payments',MAX_STATE=512_000,MAX_ACCOUNTS=100,FLOW_MS=600_000;
const statuses=new Set(['creating','authorization_required','starting','pending_authorization','accounts_required','connected','review','revocation_pending','revoked','expired']);
const text=(value,max=200)=>typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const clone=value=>structuredClone(value);
const capture=value=>{try{return clone(value);}catch{fail('PROVIDER_INPUT_INVALID');}};
const problem=code=>Object.assign(new Error(code),{code,companyProviderError:true,status:code==='PROVIDER_REVISION_CONFLICT'||code==='PROVIDER_REQUEST_CONFLICT'?409:403});
const fail=code=>{throw problem(code);};
const safeFailure=error=>error?.companyProviderError||error instanceof BankProviderError?error:problem(new Set(['PROVIDER_REVISION_CONFLICT','PROVIDER_REQUEST_CONFLICT','PROVIDER_GRANT_REUSED','COMPANY_CONTEXT_STALE','COMPANY_AUTHORIZATION_CHANGED','COMPANY_FORBIDDEN','BANK_BUSY','BANK_LEASE_LOST']).has(error?.code)?error.code:'PROVIDER_OPERATION_FAILED');
const defaultHash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const bindingFor=row=>({owner:row.owner,companyId:row.company_id,connectionId:row.id,provider:PROVIDER,environment:row.environment,generation:row.app_generation});
const scope=row=>JSON.stringify([row.company_id,row.id,PROVIDER,row.environment,row.app_generation]);
const statePurpose=row=>'provider-manager-state-v1:'+scope(row);
const flowPurpose=flow=>'provider-manager-flow-v1:'+JSON.stringify([flow.companyId,flow.connectionId,flow.id,PROVIDER,flow.environment,flow.appGeneration]);
const endOfDate=date=>date+'T23:59:59.999Z';
// Ordered known fields keep object insertion order out of the authority pin.
const registrationScope=value=>JSON.stringify(['provider-registration-v1',PROVIDER,value.verified,value.owner,value.companyId,value.environment,value.appGeneration,value.evidenceId,value.validUntil,value.corporateId,value.psuId,value.corporateIdType??null,value.affiliatedAspspId??null,value.psu?[value.psu.ipAddress,value.psu.userAgent]:null,value.redirectUri,value.productionTransportVerified===true]);

/** Exact provider callback vocabulary. Routing/provider selection comes from a
 * retained flow, never these untrusted parameters. No generic OAuth aliases. */
export function parseOpenPaymentsCallback(parameters){
 let values;
 try{values=parameters instanceof URLSearchParams?new URLSearchParams(parameters):typeof parameters==='string'?new URLSearchParams(parameters):null;}catch{fail('PROVIDER_CALLBACK_INVALID');}
 if(!values||[...values.keys()].length!==3||['code','scope','state'].some(key=>values.getAll(key).length!==1)||[...values.keys()].some(key=>!['code','scope','state'].includes(key)))fail('PROVIDER_CALLBACK_INVALID');
 const result=Object.fromEntries(values);
 if(!text(result.code,4096)||/[\u0000-\u0020\u007f]/.test(result.code)||!/^[-_A-Za-z0-9]{43}$/.test(result.state)||typeof result.scope!=='string')fail('PROVIDER_CALLBACK_INVALID');
 try{validateScopes(result.scope.split(' '),['accountinformation','corporate']);}catch{fail('PROVIDER_CALLBACK_INVALID');}
 return result;
}

/** Server-only consent/acquisition coordinator. Repository writes MUST join
 * live company authority and the existing bank lease in their own transaction;
 * preflight assertions here never substitute for that persistence fence.
 * This module has no financial importer, allocator, checkpoint or scheduler. */
export function createCompanyProviderManager(options){
 const {provider=null,repository,codec,currentContext,assertCurrent,registration=()=>null,withBankLock,onboardingEnabled=false,
  now=Date.now,randomId=()=>crypto.randomUUID(),hash=defaultHash,paths={redirect:'/api/bank/providers/redirect'}}=options??{};
 if(!repository||!['listConnections','getConnection','findFlowByRequestKey','getFlow','commit','consumeFlow'].every(name=>typeof repository[name]==='function')||!codec||typeof codec.seal!=='function'||typeof codec.unseal!=='function'||typeof currentContext!=='function'||typeof assertCurrent!=='function'||typeof withBankLock!=='function'||typeof registration!=='function'||typeof now!=='function'||typeof randomId!=='function'||typeof hash!=='function'||!/^\/(?!\/)[A-Za-z0-9/_-]+$/.test(paths?.redirect))throw TypeError('Trusted company/provider adapters are required');
 const at=()=>new Date(now()).toISOString();
 const id=()=>{const value=randomId();if(!text(value)||!/^[-_A-Za-z0-9:.]{1,200}$/.test(value))fail('PROVIDER_CONFIGURATION_INVALID');return value;};
 const digest=async value=>{const result=await hash(value);if(!/^[a-f0-9]{64}$/.test(result))fail('PROVIDER_CONFIGURATION_INVALID');return result;};
 const enabled=async()=>{try{return (typeof onboardingEnabled==='function'?await onboardingEnabled():onboardingEnabled)===true;}catch{return false;}};
 async function operation(action,callback,{lock=true,onboarding=false}={}){
  try{
   const context=assertCompanyContext(await currentContext());assertCompanyPermission(context.role,action);
   const key=companyCacheKey(context);
   const guard=async lease=>{
    if(onboarding&&!await enabled())fail('PROVIDER_UNAVAILABLE');
    if(lease)await lease.assert();
    await assertCurrent(context,action);
    if(companyCacheKey(await currentContext())!==key)fail('COMPANY_CONTEXT_STALE');
    if(onboarding){if(!await enabled())fail('PROVIDER_UNAVAILABLE');await assertCurrent(context,action);}
   };
   await guard();
   const run=async lease=>{
    const assert=()=>guard(lease);
    const wait=async work=>{await assert();const result=await work();await assert();return result;};
    const requireOnboarding=async()=>{onboarding=true;await assert();};
    return callback({context,lease,assert,wait,requireOnboarding});
   };
   return lock?await withBankLock(context.storageOwner,run):await run(undefined);
  }catch(error){throw safeFailure(error);}
 }
 const browserHash=async browser=>{
  if(!browser||!text(browser.cookie,4096)||!text(browser.session,4096))fail('PROVIDER_BROWSER_BINDING_REQUIRED');
  return digest(JSON.stringify([browser.cookie,browser.session]));
 };
 function checkedRow(context,row){
  if(!row||row.owner!==context.storageOwner||row.company_id!==context.companyId||row.provider_kind!==PROVIDER||!['SANDBOX','PRODUCTION'].includes(row.environment)||!text(row.id)||!text(row.app_generation)||!statuses.has(row.status)||!Number.isSafeInteger(row.revision)||row.revision<1||!instant(row.valid_until)||typeof row.grant_fingerprint!=='string'||row.grant_fingerprint!==''&&!/^[a-f0-9]{64}$/.test(row.grant_fingerprint))fail('PROVIDER_CONNECTION_UNAVAILABLE');
  return row;
 }
 async function read(op,connectionId){
  if(!text(connectionId))fail('PROVIDER_CONNECTION_UNAVAILABLE');
  return checkedRow(op.context,await op.wait(()=>repository.getConnection(op.context,connectionId)));
 }
 async function state(op,row){
  let result;
  try{result=await op.wait(()=>codec.unseal(row.owner,statePurpose(row),row.encrypted_state));}catch(error){if(error?.companyProviderError)throw error;fail('PROVIDER_STATE_INVALID');}
  if(result?.version!==1||JSON.stringify(result.binding)!==JSON.stringify(bindingFor(row))||!Array.isArray(result.accounts)||result.accounts.length>MAX_ACCOUNTS||!Array.isArray(result.originals))fail('PROVIDER_STATE_INVALID');
  return result;
 }
 async function sealState(op,row,value){
  if(JSON.stringify(value).length>MAX_STATE)fail('PROVIDER_EVIDENCE_CAPACITY');
  return op.wait(()=>codec.seal(row.owner,statePurpose(row),value));
 }
 async function sealFlow(op,flow,value){return op.wait(()=>codec.seal(flow.owner,flowPurpose(flow),value));}
 async function openFlow(op,flow){
  const value=await op.wait(()=>codec.unseal(flow.owner,flowPurpose(flow),flow.encryptedPayload));
  if(value?.version!==1||value.connectionId!==flow.connectionId||value.flowId!==flow.id)fail('PROVIDER_FLOW_INVALID');return value;
 }
 async function reg(op,{required=true}={}){
  const value=await op.wait(()=>registration(op.context));
  const valid=provider?.id===PROVIDER&&value?.verified===true&&value.owner===op.context.storageOwner&&value.companyId===op.context.companyId&&text(value.evidenceId)&&value.environment==='SANDBOX'&&text(value.appGeneration)&&instant(value.validUntil)&&Date.parse(value.validUntil)>now()&&text(value.corporateId)&&text(value.psuId)&&typeof value.redirectUri==='string';
  // Keep production transport/customer attestations distinct from an app token.
  const production=provider?.id===PROVIDER&&value?.verified===true&&value.environment==='PRODUCTION'&&value.productionTransportVerified===true&&value.owner===op.context.storageOwner&&value.companyId===op.context.companyId&&text(value.evidenceId)&&text(value.appGeneration)&&instant(value.validUntil)&&Date.parse(value.validUntil)>now()&&text(value.corporateId)&&text(value.psuId)&&typeof value.redirectUri==='string';
  if(!valid&&!production){if(required)fail('PROVIDER_UNAVAILABLE');return null;}
  try{const uri=new URL(value.redirectUri);if(uri.protocol!=='https:'||uri.username||uri.password||uri.hash||uri.search)throw Error();}catch{if(required)fail('PROVIDER_UNAVAILABLE');return null;}
  return clone(value);
 }
 const registrationFingerprint=(op,value)=>op.wait(()=>digest(registrationScope(value)));
 async function registrationMatches(op,row,value,current){
  return !!current&&/^[a-f0-9]{64}$/.test(value.registrationFingerprint??'')&&row.environment===current.environment&&row.app_generation===current.appGeneration&&value.registrationFingerprint===await registrationFingerprint(op,current);
 }
 async function checkRegistration(op,row,value){
  const current=await reg(op);
  if(!await registrationMatches(op,row,value,current)||Date.parse(current.validUntil)<=now())fail('PROVIDER_GENERATION_CHANGED');
  return current;
 }
 async function save(op,row,value,patch={},flow,expectedFlowStatus){
  const next={...row,...patch,revision:row.revision+1,updated_at:at()};next.encrypted_state=await sealState(op,next,value);
  await op.wait(()=>{
   if(next.status==='connected'&&Date.parse(next.valid_until)<=now())throw new BankProviderError('CONSENT_NOT_VALID',409);
   return repository.commit(op.context,{expectedRevision:row.revision,connection:next,...(flow?{flow,...(expectedFlowStatus?{expectedFlowStatus}:{})}:{})},op.lease);
  });
  return next;
 }
 async function rejectOutcome(op,row,value,error,status='review'){
  try{const current=await read(op,row.id);if(current.revision===row.revision)await save(op,current,value,{status,last_error:error instanceof BankProviderError?error.code:'PROVIDER_OUTCOME_UNKNOWN'});}catch{/* A stale writer cannot overwrite later authority or evidence. */}
 }
 function selected(row){
  let result;try{result=JSON.parse(row.selected_accounts);}catch{fail('PROVIDER_STATE_INVALID');}
  if(!Array.isArray(result)||result.length>MAX_ACCOUNTS||new Set(result).size!==result.length||result.some(value=>!text(value)))fail('PROVIDER_STATE_INVALID');return result;
 }
 async function project(op,row,value){
  const current=await reg(op,{required:false}),changed=!/^[a-f0-9]{64}$/.test(value.registrationFingerprint??'')||!!current&&!await registrationMatches(op,row,value,current);
  const lifecycleAvailable=!!current&&!changed,onboardingAvailable=lifecycleAvailable&&await op.wait(enabled),ids=selected(row);
  const flowExpired=row.status==='pending_authorization'&&instant(value.flowExpiresAt)&&Date.parse(value.flowExpiresAt)<=now();
  const status=changed&&!['revoked','revocation_pending'].includes(row.status)||flowExpired?'review':Date.parse(row.valid_until)<=now()&&!['revoked','revocation_pending','review','creating','starting'].includes(row.status)?'expired':row.status;
  const safeError=row.last_error&&(/^(?:PROVIDER_(?:OUTCOME_UNKNOWN|CALLBACK_PENDING|REVOCATION_PENDING|OPERATION_FAILED|FLOW_EXPIRED|PREVIOUS_GRANTS_PENDING))$/.test(row.last_error)||new BankProviderError(row.last_error).code===row.last_error)?row.last_error:row.last_error?'PROVIDER_OPERATION_FAILED':null;
  const available=lifecycleAvailable&&(!['creating','authorization_required','starting','pending_authorization','accounts_required'].includes(status)||onboardingAvailable);
  const result={id:row.id,provider:PROVIDER,bank:{id:row.bank_id,name:row.bank_name},status,revision:row.revision,validUntil:row.valid_until,available,onboardingAvailable,
   accounts:value.accounts.map((account,index)=>({id:account.id,label:'Konto '+(index+1),currency:account.identity.currency,selected:ids.includes(account.id),companyAccountVerified:false,bankgiroMappingVerified:false})),
   methods:onboardingAvailable&&status==='authorization_required'?(value.methods??[]).map((method,index)=>({id:method.authenticationMethodId,name:'Bankens inloggningssätt '+(index+1),type:/^[A-Z_]{1,40}$/.test(method.authenticationType)?method.authenticationType:'BANK_AUTHORIZATION'})):[],error:changed?'PROVIDER_GENERATION_CHANGED':flowExpired?'PROVIDER_FLOW_EXPIRED':safeError,payments:'disabled',paymentDataComplete:false};
  if(onboardingAvailable&&value.flowId&&['authorization_required','pending_authorization'].includes(status))result.flowId=value.flowId;
  if(result.flowId&&value.redirectReady)result.redirectPath=paths.redirect+'?flowId='+encodeURIComponent(value.flowId);
  await op.assert();return result;
 }
 async function flowFor(op,flowId,browser,{pending=false}={}){
  const flow=await op.wait(()=>repository.getFlow(op.context,flowId));
  if(!flow||flow.owner!==op.context.storageOwner||flow.companyId!==op.context.companyId||flow.provider!==PROVIDER||Date.parse(flow.expiresAt)<=now()||companyCacheKey(flow.initiatingContext)!==companyCacheKey(op.context)||flow.browserHash!==await browserHash(browser)||pending&&flow.status!=='pending')fail('PROVIDER_FLOW_INVALID');
  return flow;
 }
 function assertGrant(row,value){if(!row.grant_fingerprint||value.grantOwned!==true||value.grantFingerprint!==row.grant_fingerprint||!text(value.consentHandle,32768))fail('PROVIDER_GRANT_UNOWNED');}
 async function previousGrantsPending(op,row,value){
  let previous=value.previous,count=0;const seen=new Set([row.grant_fingerprint]);
  while(previous){
   if(++count>10)return true;
   checkedRow(op.context,previous);
   const prior=await state(op,previous);
   if(previous.grant_fingerprint&&!seen.has(previous.grant_fingerprint)&&Date.parse(previous.valid_until)>now()&&previous.status!=='revoked'&&previous.status!=='expired'&&prior.currentGrantRevoked!==true)return true;
   seen.add(previous.grant_fingerprint);previous=prior.previous;
  }
  return false;
 }
 async function confirmedRevocation(op,row,value,terminalStatus=value.currentGrantTerminalStatus??'revoked'){
  value.currentGrantRevoked=true;value.currentGrantTerminalStatus=terminalStatus;
  let pending=true;
  try{pending=await previousGrantsPending(op,row,value);}catch{/* Unknown historical authority cannot become confirmed revocation. */}
  return save(op,row,value,{status:pending?'revocation_pending':terminalStatus,selected_accounts:'[]',last_error:pending?'PROVIDER_PREVIOUS_GRANTS_PENDING':''});
 }
 async function connection(op,row,value,consumeRedirectState=async()=>false,{allowRevocationPending=false,allowUnclaimedGrant=false}={}){
  if(!allowUnclaimedGrant)assertGrant(row,value);
  await checkRegistration(op,row,value);
  return provider.forCompany({...clone(value.providerContext),binding:bindingFor(row)},{codec,assertCurrent:async binding=>{
   if(JSON.stringify(binding)!==JSON.stringify(bindingFor(row)))fail('PROVIDER_CONNECTION_UNAVAILABLE');
   const registration=await checkRegistration(op,row,value);
   const current=await read(op,row.id);if(current.revision!==row.revision||current.grant_fingerprint!==row.grant_fingerprint||current.status!==row.status||current.status==='revoked'||current.status==='expired'||current.status==='revocation_pending'&&!allowRevocationPending)fail('PROVIDER_REVISION_CONFLICT');await op.assert();
   if(Date.parse(registration.validUntil)<=now())fail('PROVIDER_GENERATION_CHANGED');
  },consumeRedirectState});
 }
 async function accounts(op,row,value,client){
  const result=await op.wait(()=>client.listAccounts(value.consentHandle));
  if(!Array.isArray(result.accounts)||result.accounts.length>MAX_ACCOUNTS)fail('PROVIDER_ACCOUNT_LIMIT');
  const resource=scopedResourceCodec(bindingFor(row),codec,now);let until=row.valid_until;
  const previous=value.accounts,oldSelected=selected(row);value.accounts=[];
  for(const account of result.accounts){
   if(!text(account.handle,32768)||!account.identity||!text(account.identity.currency,3))fail('PROVIDER_STATE_INVALID');
   const retained=await op.wait(()=>resource.open('account',account.handle));
   if(validDate(retained.consent?.validUntil)&&endOfDate(retained.consent.validUntil)<until)until=endOfDate(retained.consent.validUntil);
   const same=previous.filter(item=>JSON.stringify(item.identity)===JSON.stringify(account.identity));
   value.accounts.push({id:same.length===1?same[0].id:id(),handle:account.handle,identity:clone(account.identity)});
  }
  const remaining=oldSelected.filter(accountId=>value.accounts.some(account=>account.id===accountId));
  value.originals.push(result.original);return save(op,row,value,{status:remaining.length?'connected':'accounts_required',selected_accounts:JSON.stringify(remaining),valid_until:until,last_error:''});
 }
 return Object.freeze({
  async discoverBanks({countries=['SE']}={}){countries=capture(countries);return operation('manage_integrations',async op=>{
   const initial=await reg(op);if(typeof provider.discoverBanks!=='function')fail('PROVIDER_UNAVAILABLE');
   const check=async()=>{await op.assert();const current=await reg(op);if(JSON.stringify(current)!==JSON.stringify(initial))fail('PROVIDER_GENERATION_CHANGED');};
   const result=await op.wait(()=>provider.discoverBanks(countries,{assertCurrent:check,environment:initial.environment,generation:initial.appGeneration}));
   return {provider:PROVIDER,banks:result.banks.map(bank=>({id:bank.id,name:bank.name})),payments:'disabled'};
   },{onboarding:true});},
  async start(input){input=capture(input);return operation('manage_integrations',async op=>{
   const registration=await reg(op);
   if(!input||!/^[A-Z]{6}[A-Z2-9][A-NP-Z0-9](?:[A-Z0-9]{3})?$/.test(input.bankId)||!validDate(input.validUntil)||Date.parse(endOfDate(input.validUntil))<=now()||!text(input.requestKey,200))fail('PROVIDER_START_INVALID');
   const requestKeyHash=await digest(input.requestKey),fingerprint=await digest(JSON.stringify([input.bankId,input.validUntil,input.renewConnectionId??null,input.expectedRevision??null]));
   const previous=await op.wait(()=>repository.findFlowByRequestKey(op.context,requestKeyHash)),browserPin=await browserHash(input.browser);
   if(previous){
    if(previous.requestFingerprint!==fingerprint||previous.browserHash!==browserPin||companyCacheKey(previous.initiatingContext)!==companyCacheKey(op.context))fail('PROVIDER_REQUEST_CONFLICT');
    const row=await read(op,previous.connectionId);return project(op,row,await state(op,row));
   }
   let old=null,prior=null;
   if(input.renewConnectionId){old=await read(op,input.renewConnectionId);if(old.revision!==input.expectedRevision)fail('PROVIDER_REVISION_CONFLICT');if(old.bank_id!==input.bankId||old.environment!==registration.environment||old.app_generation!==registration.appGeneration)fail('PROVIDER_RENEWAL_IDENTITY_CHANGED');prior=await state(op,old);if((prior.renewals??0)>=10)fail('PROVIDER_EVIDENCE_CAPACITY');}
   else if((await op.wait(()=>repository.listConnections(op.context))).length>=100)fail('PROVIDER_CONNECTION_LIMIT');
   const connectionId=old?.id??id(),flowId=id(),createdAt=at(),validUntil=endOfDate(input.validUntil);
   let row={id:connectionId,owner:op.context.storageOwner,company_id:op.context.companyId,provider_kind:PROVIDER,environment:registration.environment,app_generation:registration.appGeneration,bank_id:input.bankId,bank_name:'',status:'creating',encrypted_state:'',selected_accounts:'[]',valid_until:validUntil,revision:(old?.revision??0)+1,last_synced_at:old?.last_synced_at??'',last_error:'',grant_fingerprint:old?.grant_fingerprint??'',request_key_hash:old?.request_key_hash??requestKeyHash,created_at:old?.created_at??createdAt,updated_at:createdAt};
   const value={version:1,binding:bindingFor(row),initiatingContext:clone(op.context),providerContext:{corporateId:registration.corporateId,psuId:registration.psuId,bicFi:input.bankId,...(registration.corporateIdType?{corporateIdType:registration.corporateIdType}:{}),...(registration.affiliatedAspspId?{affiliatedAspspId:registration.affiliatedAspspId}:{}),...(registration.psu?{psu:registration.psu}:{})},registrationFingerprint:await registrationFingerprint(op,registration),registrationEvidenceId:registration.evidenceId,redirectUri:registration.redirectUri,accounts:[],originals:[],flowId,renewals:(prior?.renewals??0)+(old?1:0),...(old?{previous:clone(old)}:{})};
   const flow={id:flowId,owner:row.owner,companyId:row.company_id,connectionId,provider:PROVIDER,environment:row.environment,appGeneration:row.app_generation,initiatingContext:clone(op.context),browserHash:browserPin,requestKeyHash,requestFingerprint:fingerprint,stateHash:await digest('unissued:'+flowId),encryptedPayload:'',expiresAt:new Date(Math.min(now()+FLOW_MS,Date.parse(validUntil))).toISOString(),status:'creating'};
   value.flowExpiresAt=flow.expiresAt;
   flow.encryptedPayload=await sealFlow(op,flow,{version:1,connectionId,flowId});row.encrypted_state=await sealState(op,row,value);
   await op.wait(()=>repository.commit(op.context,{expectedRevision:old?.revision??null,connection:row,flow},op.lease));
   try{
    const client=await connection(op,row,value,undefined,{allowUnclaimedGrant:true}),capabilities=await op.wait(()=>client.discoverCapabilities());
    if(capabilities.bank.id!==row.bank_id)fail('PROVIDER_BANK_MISMATCH');row.bank_name=capabilities.bank.name;value.originals.push(capabilities.original);
    const consent=await op.wait(()=>client.createConsent({validUntil:input.validUntil,redirectPreferred:true}));value.consentHandle=consent.handle;value.originals.push(consent.original);
    const rawId=consent.original?.bankData?.consentId;
    if(consent.original?.provider!==PROVIDER||JSON.stringify(consent.original.binding)!==JSON.stringify(bindingFor(row))||typeof rawId!=='string'||! /^[A-Za-z0-9_-]{1,200}$/.test(rawId))fail('PROVIDER_GRANT_UNVERIFIED');
    const retainedConsent=await op.wait(()=>scopedResourceCodec(bindingFor(row),codec,now).open('consent',consent.handle));
    if(retainedConsent.id!==rawId)fail('PROVIDER_GRANT_UNVERIFIED');
    value.grantFingerprint=await digest(JSON.stringify(['provider-grant-v1',PROVIDER,row.environment,rawId]));value.grantOwned=true;
    try{row=await save(op,row,value,{grant_fingerprint:value.grantFingerprint});}
    catch(error){
     // A returned receipt is not proof this company owns a globally reused
     // grant. Retain evidence without any usable unowned consent capability.
     value.grantOwned=false;delete value.consentHandle;throw error;
    }
    const claimed=await connection(op,row,value),authorization=await op.wait(()=>claimed.createAuthorisation(consent.handle));value.authorisationHandle=authorization.handle;value.methods=authorization.methods;value.originals.push(authorization.original);
    const ready={...flow,status:'method_required'};
    row=await save(op,row,value,{status:'authorization_required',bank_name:row.bank_name},ready,'creating');return project(op,row,value);
   }catch(error){await rejectOutcome(op,row,value,error);throw error;}
   },{onboarding:true});},
  async chooseMethod(input){input=capture(input);return operation('manage_integrations',async op=>{
   await reg(op);let row=await read(op,input?.connectionId),value=await state(op,row);
   if(row.revision!==input.revision)fail('PROVIDER_REVISION_CONFLICT');
   if(row.status!=='authorization_required'||!value.methods?.some(method=>method.authenticationMethodId===input.methodId))fail('PROVIDER_METHOD_INVALID');
   const flow=await flowFor(op,value.flowId,input.browser);if(flow.status!=='method_required')fail('PROVIDER_FLOW_INVALID');
   row=await save(op,row,value,{status:'starting'});
   try{
    const client=await connection(op,row,value),result=await op.wait(()=>client.startAuthorisation(value.authorisationHandle,{authenticationMethodId:input.methodId,redirectUri:value.redirectUri}));
    const payload={version:1,connectionId:row.id,flowId:flow.id},updated={...flow};
    if(result.approach==='redirect'){
     const privateFlow=await op.wait(()=>scopedResourceCodec(bindingFor(row),codec,now).open('redirect',result.flowHandle));
     payload.providerFlowId=privateFlow.flowId;payload.flowHandle=result.flowHandle;payload.redirectUrl=result.redirectUrl;
     updated.stateHash=await digest(privateFlow.state);updated.status='pending';value.redirectReady=true;
    }else if(result.approach==='decoupled'){updated.status='decoupled';value.redirectReady=false;}
    else fail('PROVIDER_FLOW_INVALID');
    updated.encryptedPayload=await sealFlow(op,updated,payload);
    row=await save(op,row,value,{status:'pending_authorization'},updated,'method_required');return project(op,row,value);
   }catch(error){await rejectOutcome(op,row,value,error);throw error;}
   },{onboarding:true});},
  async withRedirect(input,sendRedirect){input=capture(input);return operation('manage_integrations',async op=>{
   if(typeof sendRedirect!=='function')fail('PROVIDER_REDIRECT_INVALID');await reg(op);
   const flow=await flowFor(op,input.flowId,input.browser,{pending:true}),row=await read(op,flow.connectionId);
   if(row.status!=='pending_authorization'||row.app_generation!==flow.appGeneration||row.environment!==flow.environment)fail('PROVIDER_FLOW_INVALID');
   const payload=await openFlow(op,flow);let url;
   try{url=new URL(payload.redirectUrl);if(url.origin!==OPENPAYMENTS_ORIGINS[row.environment].auth||url.pathname!=='/connect/authorize'||url.username||url.password||url.hash)throw Error();}catch{fail('PROVIDER_REDIRECT_INVALID');}
   return op.wait(()=>Promise.resolve(sendRedirect(url.href)));
   },{lock:false,onboarding:true});},
  async callback(input){const callback=parseOpenPaymentsCallback(input?.parameters);input=capture({flowId:input?.flowId,browser:input?.browser});return operation('manage_integrations',async op=>{
   await reg(op);const flow=await flowFor(op,input.flowId,input.browser,{pending:true});
   if(await digest(callback.state)!==flow.stateHash)fail('PROVIDER_CALLBACK_INVALID');
   let row=await read(op,flow.connectionId),value=await state(op,row);if(row.status!=='pending_authorization'||row.app_generation!==flow.appGeneration||row.environment!==flow.environment)fail('PROVIDER_FLOW_INVALID');
   const payload=await openFlow(op,flow);
   // Persist uncertainty before activation. A crash cannot leave an active-looking
   // connection, and token exchange never precedes durable one-use consumption.
   row=await save(op,row,value,{status:'review',last_error:'PROVIDER_CALLBACK_PENDING'});
   try{
    const client=await connection(op,row,value,async received=>{
     await op.assert();
     if(JSON.stringify(received.binding)!==JSON.stringify(bindingFor(row))||received.flowId!==payload.providerFlowId||await digest(received.state)!==flow.stateHash)fail('PROVIDER_CALLBACK_INVALID');
     return op.wait(()=>repository.consumeFlow(op.context,{id:flow.id,expectedPayload:flow.encryptedPayload,stateHash:flow.stateHash,browserHash:flow.browserHash,providerFlowId:payload.providerFlowId,expectedStatus:'pending'},op.lease));
    });
    const result=await op.wait(()=>client.completeRedirect(payload.flowHandle,callback));value.originals.push(result.original);value.redirectReady=false;
    if(result.status==='valid')row=await accounts(op,row,value,client);
    else row=await save(op,row,value,{status:'pending_authorization',last_error:''});
    return project(op,row,value);
   }catch(error){await rejectOutcome(op,row,value,error);throw error;}
   },{onboarding:true});},
  async status({connectionId,refresh=false}={}){return operation(refresh?'manage_integrations':'read',async op=>{
   if(!connectionId){if(refresh)fail('PROVIDER_CONNECTION_UNAVAILABLE');const rows=await op.wait(()=>repository.listConnections(op.context));if(rows.length>100)fail('PROVIDER_CONNECTION_LIMIT');return {connections:await Promise.all(rows.map(async row=>project(op,checkedRow(op.context,row),await state(op,row))))};}
   let row=await read(op,connectionId),value=await state(op,row);
   if(refresh){
    await reg(op);
    if(row.status==='revocation_pending'&&value.currentGrantRevoked===true){row=await confirmedRevocation(op,row,value);return project(op,row,value);}
    if(['creating','starting','review','revoked','expired'].includes(row.status)||Date.parse(row.valid_until)<=now()||row.status==='pending_authorization'&&Date.parse(value.flowExpiresAt)<=now())return project(op,row,value);
    if(['authorization_required','pending_authorization','accounts_required'].includes(row.status))await op.requireOnboarding();
    if(row.status==='pending_authorization'&&companyCacheKey(value.initiatingContext)!==companyCacheKey(op.context))fail('PROVIDER_FLOW_INVALID');
    const revoking=row.status==='revocation_pending',client=await connection(op,row,value,undefined,{allowRevocationPending:revoking}),result=await op.wait(()=>client.getConsentStatus(value.consentHandle));value.originals.push(result.original);
    if(revoking){
     if(['rejected','revokedByPsu','terminatedByTpp','expired'].includes(result.status))row=await confirmedRevocation(op,row,value,result.status==='expired'?'expired':'revoked');
     else row=await save(op,row,value);
    }else if(result.status==='valid')row=await accounts(op,row,value,client);
    else if(['rejected','revokedByPsu','terminatedByTpp','expired'].includes(result.status))row=await confirmedRevocation(op,row,value,result.status==='expired'?'expired':'revoked');
    else row=await save(op,row,value);
   }
   return project(op,row,value);
  },{lock:refresh});},
  async selectAccounts(input){input=capture(input);return operation('manage_integrations',async op=>{
   await reg(op);let row=await read(op,input?.connectionId),value=await state(op,row);
   if(row.revision!==input.revision)fail('PROVIDER_REVISION_CONFLICT');
   if(!['accounts_required','connected'].includes(row.status)||Date.parse(row.valid_until)<=now()||!Array.isArray(input.accountIds)||!input.accountIds.length||input.accountIds.length>MAX_ACCOUNTS||new Set(input.accountIds).size!==input.accountIds.length||input.accountIds.some(accountId=>!value.accounts.some(account=>account.id===accountId)))fail('PROVIDER_ACCOUNT_INVALID');
   const client=await connection(op,row,value);
    let deadline=Date.parse(row.valid_until);
    for(const accountId of input.accountIds){
     if(now()>=deadline)throw new BankProviderError('CONSENT_NOT_VALID',409);
     const account=value.accounts.find(account=>account.id===accountId),detail=await op.wait(()=>client.getAccount(account.handle));
     if(!instant(detail.effectiveConsentValidUntil))fail('PROVIDER_ACQUISITION_INVALID');
     deadline=Math.min(deadline,Date.parse(detail.effectiveConsentValidUntil));value.originals.push(detail.original);
    }
    row=await save(op,row,value,{status:'connected',valid_until:new Date(deadline).toISOString(),selected_accounts:JSON.stringify(input.accountIds),last_error:''});return project(op,row,value);
   },{onboarding:true});},
  async revoke(input){input=capture(input);return operation('manage_integrations',async op=>{
   await reg(op);let row=await read(op,input?.connectionId),value=await state(op,row);
   if(row.revision!==input.revision)fail('PROVIDER_REVISION_CONFLICT');if(row.status==='revoked')return project(op,row,value);
   assertGrant(row,value);
   row=await save(op,row,value,{status:'revocation_pending',selected_accounts:'[]',last_error:'PROVIDER_REVOCATION_PENDING'});
   try{
    // The restriction is persisted first; only this exact captured operation may
    // invoke DELETE while ordinary reads see revocation_pending and remain held.
    const client=await connection(op,row,value,undefined,{allowRevocationPending:true});
    if(value.currentGrantRevoked!==true)await op.wait(()=>client.revokeConsent(value.consentHandle));
    row=await confirmedRevocation(op,row,value);return project(op,row,value);
   }catch(error){throw error;}
  });},
  async acquireTransactions(input,onAcquired){input=capture(input);return operation('manage_integrations',async op=>{
   await reg(op);const row=await read(op,input?.connectionId),value=await state(op,row);
   if(row.status!=='connected'||Date.parse(row.valid_until)<=now()||!selected(row).includes(input.accountId)||typeof onAcquired!=='function')fail('PROVIDER_ACCOUNT_INVALID');
   const account=value.accounts.find(item=>item.id===input.accountId);if(!account)fail('PROVIDER_ACCOUNT_INVALID');
   const client=await connection(op,row,value),result=await op.wait(()=>client.getTransactions(account.handle,{dateFrom:input.dateFrom,dateTo:input.dateTo,...(input.requireBankgiro!==undefined?{requireBankgiro:input.requireBankgiro}:{})}));
    if(result.paymentReconciliationAllowed!==false||!instant(result.effectiveConsentValidUntil))fail('PROVIDER_ACQUISITION_INVALID');
    // The SDK already narrows this to the retained account and fresh bank
    // consent across every page. Keep the row's earlier deadline as well.
    const deadline=Math.min(Date.parse(row.valid_until),Date.parse(result.effectiveConsentValidUntil));
    const assertDeadline=()=>{if(now()>=deadline)throw new BankProviderError('CONSENT_NOT_VALID',409);};
    const assert=async()=>{
     assertDeadline();const registration=await checkRegistration(op,row,value);assertDeadline();
     const current=await read(op,row.id);assertDeadline();
     if(current.revision!==row.revision||current.grant_fingerprint!==row.grant_fingerprint||current.status!=='connected'||Date.parse(current.valid_until)<=now()||!selected(current).includes(account.id))fail('PROVIDER_REVISION_CONFLICT');
     await op.assert();assertDeadline();if(Date.parse(registration.validUntil)<=now())fail('PROVIDER_GENERATION_CHANGED');
    };
    await assert();const data={...clone(result),effectiveConsentValidUntil:new Date(deadline).toISOString(),connectionId:row.id,accountId:account.id};Object.defineProperty(data,'toJSON',{value(){throw problem('PRIVATE_PROVIDER_DATA');}});
   const receipt=await onAcquired(data,{assertCurrent:assert,lease:op.lease});await assert();
   if(receipt!==undefined&&(!receipt||receipt.version!=='provider-acquisition-receipt-v1'||!text(receipt.id)||receipt.companyId!==op.context.companyId||receipt.connectionId!==row.id||receipt.accountId!==account.id||! /^[a-f0-9]{64}$/.test(receipt.sha256)||!instant(receipt.committedAt)||Date.parse(receipt.committedAt)>now()))fail('PROVIDER_RECEIPT_INVALID');
   return {status:'acquired',bookedCount:result.booked.length,bankgiroCount:result.bankgiro.length,committed:!!receipt,...(receipt?{receiptId:receipt.id}:{}),paymentReconciliationAllowed:false};
  });},
 });
}
