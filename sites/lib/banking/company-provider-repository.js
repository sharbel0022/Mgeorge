import {assertCompanyContext,assertCompanyPermission,companyCacheKey} from '../company-contract.js';
import {BankProviderError} from './bank-data-provider.js';

const KIND='open_payments';
const COLUMNS=['id','owner','company_id','provider_kind','environment','app_generation','bank_id','bank_name','status','encrypted_state','selected_accounts','valid_until','revision','last_synced_at','last_error','request_key_hash','created_at','updated_at','grant_fingerprint'];
const IMMUTABLE=['id','owner','company_id','provider_kind','environment','app_generation','bank_id','request_key_hash','created_at'];
const FLOW_FIXED=['id','owner','companyId','connectionId','provider','environment','appGeneration','browserHash','requestKeyHash','requestFingerprint','expiresAt'];
const FLOW_STATUSES=['creating','method_required','pending','decoupled','used','review','cancelled'];
const CONNECTION_STATUSES=['creating','authorization_required','starting','pending_authorization','accounts_required','connected','review','revocation_pending','revoked','expired'];
const CODES=new Set(['RESOURCE_SCOPE_MISMATCH','PROVIDER_RESPONSE_INVALID','PROVIDER_REVISION_CONFLICT','PROVIDER_REQUEST_CONFLICT','PROVIDER_GRANT_REUSED','PROVIDER_STORAGE_UNAVAILABLE','PROVIDER_COMMIT_UNCONFIRMED','PROVIDER_FLOW_SESSION_REQUIRED']);
export function providerRepositoryError(code,status=409){
 const error=new BankProviderError(CODES.has(code)?code:'PROVIDER_RESPONSE_INVALID',status);
 // Additional repository codes are a fixed vocabulary, never provider/SQL text.
 error.code=CODES.has(code)?code:'PROVIDER_RESPONSE_INVALID';return error;
}
const fail=(code,status)=>{throw providerRepositoryError(code,status);};
const text=(value,max=200)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const identity=value=>text(value)&&/^[A-Za-z0-9][A-Za-z0-9:@._-]{0,199}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const copy=value=>{try{return structuredClone(value);}catch{fail('PROVIDER_RESPONSE_INVALID');}};
const sameContext=(a,b)=>companyCacheKey(a)===companyCacheKey(b);
const stable=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const normalized=row=>row?Object.fromEntries(COLUMNS.map(key=>[key,(key==='last_synced_at'||key==='last_error')&&row[key]==null?'':row[key]])):null;
const authorityError=error=>/COMPANY_|company_|BANK_(?:LEASE_LOST|BUSY)|integration_(?:lease_lost|busy)/.test(String(error?.code??error?.message));
function safeError(error){
 if(error instanceof BankProviderError&&CODES.has(error.code))return error;
 const detail=String(error?.message??'');
 if(authorityError(error))return providerRepositoryError('RESOURCE_SCOPE_MISMATCH',403);
 if(/(?:bank_provider_grant_claims\.fingerprint|bank_provider_current_grant|bank_provider_connections\.grant_fingerprint|PROVIDER_GRANT_REUSED|BANK_PROVIDER_GRANT)/i.test(detail))return providerRepositoryError('PROVIDER_GRANT_REUSED');
 if(/(?:provider_request_key_hash|bank_provider_request|bank_provider_connections\.owner, bank_provider_connections\.request_key_hash)/i.test(detail))return providerRepositoryError('PROVIDER_REQUEST_CONFLICT');
 if(/(?:NOT NULL constraint failed: bank_provider_connections\.id|BANK_PROVIDER_(?:IDENTITY|REVISION)|UNIQUE constraint failed: bank_provider_connections\.id)/i.test(detail))return providerRepositoryError('PROVIDER_REVISION_CONFLICT');
 return providerRepositoryError('PROVIDER_STORAGE_UNAVAILABLE',503);
}
const envelopePurpose=flow=>'provider-repository-flow-v1:'+JSON.stringify([flow.companyId,flow.connectionId,flow.id,KIND,flow.environment,flow.appGeneration]);
const innerPurpose=flow=>'provider-manager-flow-v1:'+JSON.stringify([flow.companyId,flow.connectionId,flow.id,KIND,flow.environment,flow.appGeneration]);

export function createCompanyProviderRepository({database,codec,currentContext,assertCurrent,flowDialect='sites',write,sessionHash,now=Date.now,randomId=()=>crypto.randomUUID()}={}){
 if(!database||typeof database.prepare!=='function'||!codec||typeof codec.seal!=='function'||typeof codec.unseal!=='function'||typeof currentContext!=='function'||typeof assertCurrent!=='function'||!['sites','node'].includes(flowDialect)||write!==undefined&&typeof write!=='function')throw TypeError('Trusted scoped provider repository adapters required');
 const node=flowDialect==='node',table=node?'bank_states':'bank_auth_flows';
 const statement=(sql,...args)=>database.prepare(sql).bind(...args);
 async function guard(context,action){
  let actual;try{actual=assertCompanyContext(await currentContext());assertCompanyPermission(actual.role,action);if(!sameContext(context,actual))throw Error();await assertCurrent(context,action);}catch{fail('RESOURCE_SCOPE_MISMATCH',403);}
 }
 async function run(input,action,work){
  try{const context=assertCompanyContext(input);await guard(context,action);const result=await work(context);await guard(context,action);return result;}catch(error){throw safeError(error);}
 }
 async function wait(context,action,work){await guard(context,action);const result=await work();await guard(context,action);return result;}
 function rowValid(context,row){
  if(!row||row.owner!==context.storageOwner||row.company_id!==context.companyId||row.provider_kind!==KIND||!identity(row.id)||!['SANDBOX','PRODUCTION'].includes(row.environment)||!text(row.app_generation)||!text(row.bank_id)||typeof row.bank_name!=='string'||!CONNECTION_STATUSES.includes(row.status)||!text(row.encrypted_state,1_000_000)||!Number.isSafeInteger(row.revision)||row.revision<1||!hash(row.request_key_hash)||!instant(row.valid_until)||!instant(row.created_at)||!instant(row.updated_at)||typeof row.selected_accounts!=='string'||!['last_synced_at','last_error'].every(key=>typeof row[key]==='string')||row.grant_fingerprint!==''&&!hash(row.grant_fingerprint))fail('PROVIDER_RESPONSE_INVALID');
  let selected;try{selected=JSON.parse(row.selected_accounts);}catch{fail('PROVIDER_RESPONSE_INVALID');}if(!Array.isArray(selected)||selected.length>100||selected.some(value=>!identity(value))||new Set(selected).size!==selected.length)fail('PROVIDER_RESPONSE_INVALID');return row;
 }
 function flowValid(context,flow){
  if(!flow||flow.owner!==context.storageOwner||flow.companyId!==context.companyId||flow.provider!==KIND||!identity(flow.id)||!identity(flow.connectionId)||!['SANDBOX','PRODUCTION'].includes(flow.environment)||!text(flow.appGeneration)||!FLOW_STATUSES.includes(flow.status)||!hash(flow.browserHash)||!hash(flow.requestKeyHash)||!hash(flow.requestFingerprint)||!hash(flow.stateHash)||!text(flow.encryptedPayload,1_000_000)||!instant(flow.expiresAt)||flow.initiatingContext?.companyId!==context.companyId||flow.initiatingContext?.storageOwner!==context.storageOwner)fail('PROVIDER_RESPONSE_INVALID');
  assertCompanyContext(flow.initiatingContext);return flow;
 }
 const connectionRead=(context,id)=>statement('SELECT * FROM bank_provider_connections WHERE owner=? AND company_id=? AND provider_kind=? AND id=?',context.storageOwner,context.companyId,KIND,id).first();
 const flowSelect=node?`SELECT s.*,p.company_id AS provider_company_id,p.environment AS provider_environment,p.app_generation AS provider_app_generation FROM ${table} s JOIN bank_provider_connections p ON p.id=s.provider_connection_id AND p.owner=s.owner AND p.provider_kind=s.provider_kind`:`SELECT * FROM ${table}`;
 const flowRead=(context,selector,value)=>statement(flowSelect+` WHERE ${node?'s.':''}owner=? AND ${node?'s.':''}provider_kind=? AND ${node?'p.company_id':'company_id'}=? AND ${node?'s.':''}${selector}=?`,context.storageOwner,KIND,context.companyId,value).first();
 async function decodeFlow(context,raw){
  if(!raw)return null;
  const pins={companyId:node?raw.provider_company_id:raw.company_id,connectionId:raw.provider_connection_id,id:raw.provider_flow_id,environment:node?raw.provider_environment:raw.environment,appGeneration:node?raw.provider_app_generation:raw.app_generation};
  let envelope;try{envelope=await codec.unseal(raw.owner,envelopePurpose(pins),raw.provider_payload);}catch{fail('PROVIDER_RESPONSE_INVALID');}
  const flow=flowValid(context,envelope?.flow);
  if(envelope.version!==1||FLOW_FIXED.filter(key=>Object.hasOwn(pins,key)).some(key=>flow[key]!==pins[key])||raw.owner!==flow.owner||raw.status!==flow.status||raw.state_hash!==flow.stateHash||raw.provider_request_key_hash!==flow.requestKeyHash||Date.parse(flow.expiresAt)!==(node?raw.expires_at:Date.parse(raw.expires_at)))fail('PROVIDER_RESPONSE_INVALID');
  if(node){
   let pinned;try{pinned=JSON.parse(raw.company_context_json);}catch{fail('PROVIDER_RESPONSE_INVALID');}
   if(!hash(raw.session_hash)||raw.consumed!==(flow.status==='used'?1:0)||pinned?.version!=='company-oauth-context-v1'||pinned.actorId!==flow.initiatingContext.actorId||pinned.storageOwner!==flow.owner||!sameContext(pinned.context,flow.initiatingContext))fail('PROVIDER_RESPONSE_INVALID');
  }else if(raw.cookie_hash!==flow.browserHash||raw.company_actor_id!==flow.initiatingContext.actorId||raw.company_context_version!==flow.initiatingContext.contextVersion||raw.company_membership_version!==flow.initiatingContext.membershipVersion||raw.company_version!==flow.initiatingContext.companyVersion)fail('PROVIDER_RESPONSE_INVALID');
  return {flow,envelope,raw};
 }
 async function getFlow(context,selector,value){return decodeFlow(context,await wait(context,'read',()=>flowRead(context,selector,value)));}
 async function sealEnvelope(context,flow,consumptionId){return wait(context,'manage_integrations',()=>codec.seal(flow.owner,envelopePurpose(flow),{version:1,flow,...(consumptionId?{consumptionId}:{})}));}
 const rowValues=row=>COLUMNS.map(key=>row[key]);
 // A failed precondition must abort the entire batch, including earlier claims.
 // Explicit NOT NULL id is stable across both real SQLite/D1 schemas.
 function fence(row,predicate,args){const sentinel={...row,id:null,grant_fingerprint:'',request_key_hash:'',revision:1};return statement(`INSERT INTO bank_provider_connections(${COLUMNS.join(',')}) SELECT ${COLUMNS.map(()=>'?').join(',')} WHERE NOT (${predicate})`,...rowValues(sentinel),...args);}
 async function actualSession(){if(!node)return undefined;let value;try{value=await sessionHash?.();}catch{}if(!hash(value))fail('PROVIDER_FLOW_SESSION_REQUIRED',403);return value;}
 async function writer(context,lease,statements,{grantFingerprint='',connectionId='',actualSessionHash}={}){
  if(typeof lease?.assert!=='function'||typeof lease?.write!=='function')fail('RESOURCE_SCOPE_MISMATCH',403);await lease.assert();await guard(context,'manage_integrations');
  return write?write({context,lease,statements,grantFingerprint,connectionId,...(actualSessionHash?{sessionHash:actualSessionHash}:{})}):lease.write(statements);
 }
 const expiryPredicate=node?"expires_at>max(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))":"julianday(expires_at)>max(julianday(?),julianday('now'))";
 function flowWhere(context,raw){
  const sql=`owner=? AND provider_kind=? AND provider_connection_id=? AND provider_flow_id=? AND provider_request_key_hash=? AND state_hash=? AND provider_payload=? AND status=?`;
  const args=[context.storageOwner,KIND,raw.provider_connection_id,raw.provider_flow_id,raw.provider_request_key_hash,raw.state_hash,raw.provider_payload,raw.status];
  if(node)return {sql:sql+' AND session_hash=? AND company_context_json=? AND consumed=?',args:[...args,raw.session_hash,raw.company_context_json,raw.consumed]};
  return {sql:sql+' AND cookie_hash=? AND company_id=? AND company_actor_id=? AND company_context_version=? AND company_membership_version=? AND company_version=? AND environment=? AND app_generation=?',args:[...args,raw.cookie_hash,raw.company_id,raw.company_actor_id,raw.company_context_version,raw.company_membership_version,raw.company_version,raw.environment,raw.app_generation]};
 }
 async function flowFields(context,flow,payload,session){
  const c=flow.initiatingContext;
  const common={state_hash:flow.stateHash,owner:flow.owner,expires_at:node?Date.parse(flow.expiresAt):flow.expiresAt,status:flow.status,provider_kind:KIND,provider_payload:payload,provider_connection_id:flow.connectionId,provider_flow_id:flow.id,provider_request_key_hash:flow.requestKeyHash};
  if(node)return {...common,session_hash:session,company_context_json:JSON.stringify({version:'company-oauth-context-v1',actorId:c.actorId,storageOwner:c.storageOwner,context:c}),consumed:flow.status==='used'?1:0};
  return {...common,cookie_hash:flow.browserHash,app_generation:flow.appGeneration,bank_name:'',country:'',environment:flow.environment,redirect_uri:'',date_from:'',created_at:new Date(now()).toISOString(),company_id:flow.companyId,company_actor_id:c.actorId,company_context_version:c.contextVersion,company_membership_version:c.membershipVersion,company_version:c.companyVersion};
 }
 async function accepted(context,row,flow){
  const retained=normalized(await wait(context,'manage_integrations',()=>connectionRead(context,row.id)));if(!retained||stable(retained)!==stable(row))return false;
  if(row.grant_fingerprint){const claim=await wait(context,'manage_integrations',()=>statement('SELECT * FROM bank_provider_grant_claims WHERE fingerprint=? AND owner=? AND company_id=? AND connection_id=? AND provider_kind=? AND environment=?',row.grant_fingerprint,row.owner,row.company_id,row.id,KIND,row.environment).first());if(!claim)return false;}
  if(flow){const actual=await getFlow(context,'provider_flow_id',flow.id);if(!actual||stable(actual.flow)!==stable(flow))return false;}return true;
 }
 return Object.freeze({
  listConnections:input=>run(input,'read',async context=>{const result=await wait(context,'read',()=>statement('SELECT * FROM bank_provider_connections WHERE owner=? AND company_id=? AND provider_kind=? ORDER BY created_at,id LIMIT 101',context.storageOwner,context.companyId,KIND).all());if(!Array.isArray(result.results))fail('PROVIDER_RESPONSE_INVALID');return result.results.map(row=>rowValid(context,normalized(row)));}),
  getConnection:(input,id)=>run(input,'read',async context=>{if(!identity(id))fail('PROVIDER_RESPONSE_INVALID');const row=normalized(await wait(context,'read',()=>connectionRead(context,id)));return row?rowValid(context,row):null;}),
  getFlow:(input,id)=>run(input,'read',async context=>{if(!identity(id))fail('PROVIDER_RESPONSE_INVALID');return (await getFlow(context,'provider_flow_id',id))?.flow??null;}),
  findFlowByRequestKey:(input,key)=>run(input,'read',async context=>{if(!hash(key))fail('PROVIDER_RESPONSE_INVALID');return (await getFlow(context,'provider_request_key_hash',key))?.flow??null;}),
  async commit(input,change,lease){change=copy(change);return run(input,'manage_integrations',async context=>{
   const row=rowValid(context,normalized(change?.connection)),expected=change.expectedRevision;
   if(expected!==null&&(!Number.isSafeInteger(expected)||expected<1)||row.revision!==(expected??0)+1)fail('PROVIDER_REVISION_CONFLICT');
   const old=normalized(await wait(context,'manage_integrations',()=>connectionRead(context,row.id)));
   if(old&&IMMUTABLE.some(key=>old[key]!==row[key]))fail('PROVIDER_REVISION_CONFLICT');
   const flow=change.flow?flowValid(context,change.flow):undefined;let oldFlow,session;
   if(flow){
    if(flow.status==='used')fail('PROVIDER_REVISION_CONFLICT');
    if(flow.connectionId!==row.id||flow.environment!==row.environment||flow.appGeneration!==row.app_generation||!sameContext(flow.initiatingContext,context))fail('RESOURCE_SCOPE_MISMATCH',403);
    oldFlow=await getFlow(context,'provider_flow_id',flow.id);session=await actualSession();
    if(change.expectedFlowStatus===undefined?oldFlow!==null:!oldFlow||oldFlow.flow.status!==change.expectedFlowStatus)fail('PROVIDER_REVISION_CONFLICT');
    if(oldFlow&&(FLOW_FIXED.some(key=>oldFlow.flow[key]!==flow[key])||!sameContext(oldFlow.flow.initiatingContext,flow.initiatingContext)||node&&oldFlow.raw.session_hash!==session||oldFlow.flow.status==='used'||flow.status==='used'))fail('PROVIDER_REVISION_CONFLICT');
   }
   const statements=[];
   const claim=row.grant_fingerprint?statement('INSERT INTO bank_provider_grant_claims(fingerprint,owner,company_id,connection_id,provider_kind,environment,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM bank_provider_grant_claims WHERE fingerprint=? AND owner=? AND company_id=? AND connection_id=? AND provider_kind=? AND environment=?)',row.grant_fingerprint,row.owner,row.company_id,row.id,KIND,row.environment,row.updated_at,row.grant_fingerprint,row.owner,row.company_id,row.id,KIND,row.environment):null;
   // An initial connection must exist for the claim's protected relational
   // trigger. Neither is externally visible until the same batch commits.
   if(claim&&expected!==null)statements.push(claim);
   const rowPredicate=expected===null?'NOT EXISTS(SELECT 1 FROM bank_provider_connections WHERE owner=? AND company_id=? AND id=?)':'EXISTS(SELECT 1 FROM bank_provider_connections WHERE owner=? AND company_id=? AND id=? AND revision=?)';
   statements.push(fence(row,rowPredicate,[row.owner,row.company_id,row.id,...(expected===null?[]:[expected])]));
    // The actual writer may queue after the manager's last clock check. A
    // connected row must still be authorized at SQL execution, atomically with
    // its claim, flow, selection and CAS. NULL date calculations fail closed.
    if(row.status==='connected')statements.push(fence(row,"COALESCE(julianday(?)>max(julianday(?),julianday('now')),0)=1",[row.valid_until,new Date(now()).toISOString()]));
   if(flow&&oldFlow){const where=flowWhere(context,oldFlow.raw);statements.push(fence(row,`EXISTS(SELECT 1 FROM ${table} WHERE ${where.sql})`,where.args));}
   if(expected===null)statements.push(statement(`INSERT INTO bank_provider_connections(${COLUMNS.join(',')}) VALUES(${COLUMNS.map(()=>'?').join(',')})`,...rowValues(row)));
   else statements.push(statement(`UPDATE bank_provider_connections SET ${COLUMNS.filter(key=>!IMMUTABLE.includes(key)).map(key=>key+'=?').join(',')} WHERE owner=? AND company_id=? AND id=? AND revision=?`,...COLUMNS.filter(key=>!IMMUTABLE.includes(key)).map(key=>row[key]),row.owner,row.company_id,row.id,expected));
   if(claim&&expected===null)statements.push(claim);
   if(flow){
    const payload=await sealEnvelope(context,flow),fields=await flowFields(context,flow,payload,session);if(oldFlow&&!node)fields.created_at=oldFlow.raw.created_at;const names=Object.keys(fields);
    if(!oldFlow)statements.push(statement(`INSERT INTO ${table}(${names.join(',')}) VALUES(${names.map(()=>'?').join(',')})`,...names.map(name=>fields[name])));
    else{const where=flowWhere(context,oldFlow.raw);statements.push(statement(`UPDATE ${table} SET ${names.map(name=>name+'=?').join(',')} WHERE ${where.sql}`,...names.map(name=>fields[name]),...where.args));}
   }
   try{await writer(context,lease,statements,{grantFingerprint:row.grant_fingerprint,connectionId:row.id,actualSessionHash:session});}
   catch(error){try{if(await accepted(context,row,flow))return;}catch(readError){if(authorityError(readError)||readError.code==='RESOURCE_SCOPE_MISMATCH')throw readError;fail('PROVIDER_COMMIT_UNCONFIRMED',503);}throw error;}
  });},
  async consumeFlow(input,expected,lease){expected=copy(expected);return run(input,'manage_integrations',async context=>{
   if(!expected||!identity(expected.id)||!text(expected.expectedPayload,1_000_000)||!hash(expected.stateHash)||!hash(expected.browserHash)||!text(expected.providerFlowId)||expected.expectedStatus!=='pending')return false;
   const found=await getFlow(context,'provider_flow_id',expected.id);if(!found)return false;const {flow,raw}=found;
   if(flow.status!=='pending'||!sameContext(flow.initiatingContext,context)||flow.encryptedPayload!==expected.expectedPayload||flow.stateHash!==expected.stateHash||flow.browserHash!==expected.browserHash||Date.parse(flow.expiresAt)<=now())return false;
   const session=await actualSession();if(node&&raw.session_hash!==session)return false;
   let inner;try{inner=await wait(context,'manage_integrations',()=>codec.unseal(flow.owner,innerPurpose(flow),flow.encryptedPayload));}catch{return false;}
   if(inner?.version!==1||inner.connectionId!==flow.connectionId||inner.flowId!==flow.id||inner.providerFlowId!==expected.providerFlowId)return false;
   const receipt=randomId();if(!identity(receipt))fail('PROVIDER_RESPONSE_INVALID');const used={...flow,status:'used'},payload=await sealEnvelope(context,used,receipt),where=flowWhere(context,raw);
   const stmt=statement(`UPDATE ${table} SET status='used',provider_payload=?${node?',consumed=1':''} WHERE ${where.sql} AND ${expiryPredicate}`,payload,...where.args,node?now():new Date(now()).toISOString());
   try{const result=await writer(context,lease,[stmt],{connectionId:flow.connectionId,actualSessionHash:session});return Number(result?.[0]?.meta?.changes)===1;}
   catch(error){
    try{const after=await getFlow(context,'provider_flow_id',flow.id);if(after?.raw.provider_payload===payload&&after.envelope.consumptionId===receipt&&after.flow.status==='used')return true;return false;}
    catch(readError){if(readError.code==='RESOURCE_SCOPE_MISMATCH')throw readError;fail('PROVIDER_COMMIT_UNCONFIRMED',503);}
   }
  });},
 });
}
