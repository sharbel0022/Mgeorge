import {AsyncLocalStorage} from 'node:async_hooks';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync,existsSync,realpathSync,lstatSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {openDatabase,defaultSettings} from './db.js';
import {decryptObject} from './security.js';
import {assertCompanyContext,hasCompanyPermission,COMPANY_CONTEXT_VERSION} from '../sites/lib/company-contract.js';

// Server adapters may read the already authenticated runtime scope without an
// import of server.js. AsyncLocalStorage keeps concurrent requests/jobs apart.
const currentExecution=new AsyncLocalStorage();
export function currentCompanyContext(){return currentExecution.getStore()?.context??null;}

const fail=(code,status=403)=>Object.assign(new Error(code),{code,status});
const identity=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9:@._-]{0,199}$/.test(value)&&value!=='.'&&value!=='..';
const checkIdentity=value=>{if(!identity(value))throw fail('company_identity_invalid',400);return value;};
const checkName=value=>{if(typeof value!=='string'||!value.trim()||value.length>240)throw fail('company_name_invalid',400);return value.trim();};
const checkVerification=value=>{
 if(value?.status!=='verified'||typeof value.evidenceId!=='string'||!value.evidenceId.trim()||value.evidenceId.length>1000||!identity(value.verifiedBy))throw fail('company_verification_required');
 return {evidenceId:value.evidenceId.trim(),verifiedBy:value.verifiedBy};
};
const boundarySchema=`CREATE TABLE IF NOT EXISTS company_database_boundary (
 id INTEGER PRIMARY KEY CHECK(id=1),company_id TEXT NOT NULL,storage_owner TEXT NOT NULL,
 boundary_version INTEGER NOT NULL CHECK(boundary_version=1),verification_ref TEXT NOT NULL,verified_by TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS company_boundary_no_update BEFORE UPDATE ON company_database_boundary
 BEGIN SELECT RAISE(ABORT,'company_boundary_immutable'); END;
 CREATE TRIGGER IF NOT EXISTS company_boundary_no_delete BEFORE DELETE ON company_database_boundary
 BEGIN SELECT RAISE(ABORT,'company_boundary_immutable'); END;
 CREATE TRIGGER IF NOT EXISTS company_boundary_no_replace BEFORE INSERT ON company_database_boundary
 WHEN EXISTS(SELECT 1 FROM company_database_boundary)
 BEGIN SELECT RAISE(ABORT,'company_boundary_immutable'); END;`;
export function readCompanyDatabaseBoundary(db){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='company_database_boundary'").get())return null;
 const row=db.prepare('SELECT * FROM company_database_boundary WHERE id=1').get();
 if(!row)return null;
 if(!identity(row.company_id)||!identity(row.storage_owner)||row.boundary_version!==1||!row.verification_ref||!row.verified_by)throw fail('company_boundary_invalid');
 return {version:'company-data-boundary-v1',companyId:row.company_id,storageOwner:row.storage_owner,boundaryVersion:1};
}
function stampBoundary(db,{companyId,storageOwner,verification}){
 db.exec(boundarySchema);
 const current=readCompanyDatabaseBoundary(db);
 if(current){if(current.companyId!==companyId||current.storageOwner!==storageOwner)throw fail('company_boundary_conflict');return;}
 db.prepare('INSERT INTO company_database_boundary(id,company_id,storage_owner,boundary_version,verification_ref,verified_by) VALUES(1,?,?,1,?,?)').run(companyId,storageOwner,verification.evidenceId,verification.verifiedBy);
}
const readOnlySql=sql=>/^\s*(?:SELECT\b|EXPLAIN\b|PRAGMA\s+(?:table_info|foreign_key_list|index_list|integrity_check|foreign_key_check)\s*(?:\(|;|$))/i.test(sql);

/** Trusted control plane + physical data partitions. Provisioning has no HTTP route.
 * The existing legacy DB is never copied or assigned by a company-name heuristic.
 */
export function createCompanyRuntime({controlDb,legacyDatabasePath,companyDirectory=join(dirname(resolve(legacyDatabasePath)),'companies'),legacyPrincipal='local-admin'}={}){
 if(!controlDb||!legacyDatabasePath||!identity(legacyPrincipal))throw TypeError('Company runtime configuration required');
 const legacyPath=resolve(legacyDatabasePath),directory=resolve(companyDirectory),storage=new AsyncLocalStorage(),bundles=new Map();
 let initialize=()=>({}),legacyBundle={db:controlDb,path:legacyPath,companyId:null,services:null},closed=false;
 controlDb.exec('BEGIN IMMEDIATE');
 try{
  controlDb.exec(readFileSync(new URL('../migrations/node/0001_company_catalog.sql',import.meta.url),'utf8'));
  const boundary=readCompanyDatabaseBoundary(controlDb);
  if(boundary){
   const binding=controlDb.prepare("SELECT company_id,storage_owner FROM companies WHERE database_key='legacy'").get();
   if(!binding||binding.company_id!==boundary.companyId||binding.storage_owner!==boundary.storageOwner)throw fail('company_boundary_conflict');
  }
  controlDb.exec('COMMIT');
 }catch(error){controlDb.exec('ROLLBACK');throw error;}
 const company=id=>controlDb.prepare('SELECT * FROM companies WHERE company_id=?').get(id);
 const member=(id,actor)=>controlDb.prepare('SELECT * FROM company_memberships WHERE company_id=? AND actor_id=?').get(id,actor);
 const active=actor=>controlDb.prepare('SELECT * FROM company_active_contexts WHERE actor_id=?').get(actor);
 const legacyCompany=()=>controlDb.prepare("SELECT * FROM companies WHERE database_key='legacy'").get();
 function assertLegacyProvisioningAllowed(actorId){
  if(actorId!==legacyPrincipal||legacyCompany())return;
  // A first active company would replace this principal's legacy view. Retain
  // that view until an operator explicitly verifies and binds its existing
  // business records, originals, consent and import history to a company.
  const retainedTables=['invoices','bank_transactions','allocations','documents','document_sources','bank_connections','bank_states','bank_provider_connections','bank_provider_grant_claims','gmail_connections','gmail_states','gmail_rejected_sources','mail_candidates','import_jobs','verified_contacts','payer_links','reconciliation_findings','customer_messages','message_reviews','message_approvals','message_deliveries','bank_specification_links','bankgiro_ingest_sources','bankgiro_ingest_jobs','audit_events'];
  if(retainedTables.some(table=>controlDb.prepare('SELECT 1 FROM '+table+' LIMIT 1').get()))throw fail('company_legacy_binding_required',409);
 }
 function transaction(operation){
  if(storage.getStore())throw fail('company_control_plane_in_data_operation');
  controlDb.exec('BEGIN IMMEDIATE');try{const value=operation();controlDb.exec('COMMIT');return value;}catch(error){controlDb.exec('ROLLBACK');throw error;}
 }
 function addMember(id,actor,role='owner'){
  controlDb.prepare('INSERT INTO company_memberships(company_id,actor_id,role) VALUES(?,?,?)').run(id,actor,role);
  controlDb.prepare('INSERT OR IGNORE INTO company_active_contexts(actor_id,company_id) VALUES(?,?)').run(actor,id);
 }
 function assertMembership(context,{job=false}={}){
  const c=company(context.companyId),m=member(context.companyId,context.actorId);
  if(!c||c.status!=='active'||!m||m.status!=='active')throw fail('company_access_denied');
  if(c.storage_owner!==context.storageOwner||c.company_version!==context.companyVersion||m.membership_version!==context.membershipVersion||m.role!==context.role)throw fail('company_authorization_changed');
  const selected=active(context.actorId);
  if(!job&&(!selected||selected.company_id!==context.companyId||selected.context_version!==context.contextVersion))throw fail('COMPANY_CONTEXT_STALE',409);
  return c;
 }
 function resolveContext({actorId,companyId,contextVersion}={},{job=false}={}){
  checkIdentity(actorId);
  const selected=active(actorId);
  if(companyId!==undefined&&companyId!==null)checkIdentity(companyId);
  if(contextVersion!==undefined&&(!Number.isSafeInteger(contextVersion)||contextVersion<1))throw fail('company_context_invalid',400);
  if(contextVersion!==undefined&&contextVersion!==(selected?.context_version??1))throw fail('COMPANY_CONTEXT_STALE',409);
  const id=companyId||selected?.company_id;
  if(!id){
   if(actorId===legacyPrincipal&&!legacyCompany())return null;
   throw fail('company_access_denied');
  }
  const c=company(id),m=member(id,actorId);
  if(!c||c.status!=='active'||!m||m.status!=='active')throw fail('company_access_denied');
  if(!job&&selected?.company_id!==id)throw fail('COMPANY_CONTEXT_STALE',409);
  return assertCompanyContext({version:COMPANY_CONTEXT_VERSION,companyId:id,storageOwner:c.storage_owner,actorId,
   role:m.role,membershipVersion:m.membership_version,companyVersion:c.company_version,contextVersion:selected?.context_version??1});
 }
 function assertBundleBoundary(bundle,context){
  const boundary=readCompanyDatabaseBoundary(bundle.db);
  if(!boundary||boundary.companyId!==context.companyId||boundary.storageOwner!==context.storageOwner)throw fail('company_boundary_conflict');
 }
 function getBundle(context,{job=storage.getStore()?.job===true}={}){
  if(!context)return legacyBundle;
  const c=assertMembership(context,{job});
  if(c.database_key==='legacy'){
   legacyBundle.companyId=context.companyId;assertBundleBoundary(legacyBundle,context);return legacyBundle;
  }
  let bundle=bundles.get(context.companyId);
  if(!bundle){
   if(!/^[a-f0-9-]{36}$/.test(c.database_key))throw fail('company_boundary_conflict');
   const path=join(directory,c.database_key+'.sqlite');
   // Missing/redirected partitions must never turn into fresh empty companies.
   if(!existsSync(path)||!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()||realpathSync(dirname(path))!==realpathSync(directory))throw fail('company_boundary_conflict');
   const inspection=new DatabaseSync(path,{readOnly:true});
   try{assertBundleBoundary({db:inspection},context);}finally{inspection.close();}
   bundle={db:openDatabase(path),path,companyId:context.companyId,services:null};
   try{assertBundleBoundary(bundle,context);}catch(error){bundle.db.close();throw error;}
   bundles.set(context.companyId,bundle);
  }
  assertBundleBoundary(bundle,context);return bundle;
 }
 function assertScope(scope,action='read'){
  if(closed)throw fail('company_runtime_closed',503);
  if(scope?.initializing)return;
  if(scope?.transactionAborted)throw fail('company_async_transaction_forbidden',409);
  if(scope?.context){
   if(storage.getStore()!==scope)throw fail('company_context_mismatch');
   assertMembership(scope.context,{job:scope.job});assertBundleBoundary(scope.bundle,scope.context);
   if(!hasCompanyPermission(scope.context.role,action))throw fail('company_permission_denied');
   scope.authorize?.();
  }else if(scope){
   if(storage.getStore()!==scope||scope.actorId!==legacyPrincipal||legacyCompany())throw fail('company_access_denied');
   scope.authorize?.();
  }
 }
 function operation(scope,bundle,sql,execute,forceWrite=false){
  const action=!forceWrite&&readOnlySql(sql)?'read':'write';
  if(!scope&&storage.getStore())throw fail('company_context_mismatch');
  if(scope?.initializing||!scope){return execute();}
  if(bundle.transactionScope&&bundle.transactionScope!==scope)throw fail('company_context_mismatch');
  const catalogLock=!!scope.context&&bundle.db!==controlDb&&!bundle.transactionScope;
  if(catalogLock)controlDb.exec('BEGIN IMMEDIATE');
  try{assertScope(scope,action);const result=execute();assertScope(scope,action);if(catalogLock)controlDb.exec('COMMIT');return result;}
  catch(error){if(catalogLock)controlDb.exec('ROLLBACK');throw error;}
 }
 function capture(){const scope=storage.getStore(),bundle=scope?.bundle||legacyBundle;return {scope,bundle};}
 function clearTransaction(bundle){bundle.transactionScope=null;bundle.catalogTransaction=false;bundle.transactionToken=null;bundle.savepoints=[];bundle.transactionMode=null;}
 function abortTransaction(bundle){
  try{bundle.db.exec('ROLLBACK');}catch{}
  if(bundle.catalogTransaction)try{controlDb.exec('ROLLBACK');}catch{}
  clearTransaction(bundle);
 }
 function beginTransaction(scope,bundle,sql,mode,name){
  const separate=!!scope.context&&bundle.db!==controlDb;
  if(separate)controlDb.exec('BEGIN IMMEDIATE');
  try{
   assertScope(scope,mode==='savepoint'?'read':'write');bundle.db.exec(sql);
   bundle.transactionScope=scope;bundle.catalogTransaction=separate;bundle.transactionMode=mode;bundle.savepoints=name?[name]:[];
   const marker={};bundle.transactionToken=marker;
   // SQLite transactions in the existing domain engine are synchronous. Never
   // leave a shared connection transaction open over provider or other awaits.
   queueMicrotask(()=>{if(bundle.transactionToken===marker){scope.transactionAborted=true;abortTransaction(bundle);}});
  }catch(error){if(separate)controlDb.exec('ROLLBACK');throw error;}
 }
 const db=new Proxy({}, {
  get(_target,key){
   if(Object.hasOwn(_target,key))return Reflect.get(_target,key);
   if(key==='companyContext')return storage.getStore()?.context??null;
   if(key==='canWrite')return !storage.getStore()?.context||hasCompanyPermission(storage.getStore().context.role,'write');
   if(key==='releaseIntegrationLease'){
    const {scope,bundle}=capture();assertScope(scope,'write');
    // A revoked operation may release only its exact fenced infrastructure
    // lease. No SQL, tenant selector, business row or successful result can be
    // supplied to this captured capability. It cannot extend or transfer work.
    return (message,name,lease,version)=>{
     if(storage.getStore()!==scope||closed||bundle.transactionScope)throw fail('company_context_mismatch');
     if(scope?.context)assertBundleBoundary(bundle,scope.context);
     if(typeof message!=='string'||typeof name!=='string'||typeof lease!=='string'||!Number.isSafeInteger(version))throw fail('company_lease_invalid');
     return bundle.db.prepare(`UPDATE integration_jobs SET
       job_state=CASE WHEN record_attempt=1 AND job_state='running' THEN CASE WHEN failures>=3 THEN 'blocked' ELSE 'retry_wait' END ELSE job_state END,
       last_error=CASE WHEN record_attempt=1 AND job_state='running' THEN ? ELSE last_error END,
       error_code=CASE WHEN record_attempt=1 AND job_state='running' THEN 'integration_interrupted' ELSE error_code END,
       lease='',lease_until=0,lease_deadline=0 WHERE name=? AND lease=? AND fence_version=?`).run(message,name,lease,version);
    };
   }
   if(key==='prepare')return sql=>{
    const {scope,bundle}=capture();assertScope(scope,readOnlySql(sql)?'read':'write');
    const statement=bundle.db.prepare(sql);
    const effectiveScope=()=>{
     if(!scope?.initializing||storage.getStore()===scope)return scope;
     const current=storage.getStore();if(!current||current.bundle!==bundle)throw fail('company_context_mismatch');return current;
    };
    return new Proxy(statement,{get(target,property){
     const value=Reflect.get(target,property,target);if(typeof value!=='function'){assertScope(effectiveScope());return value;}
     return (...args)=>{
      const executionScope=effectiveScope(),result=operation(executionScope,bundle,sql,()=>value.apply(target,args));
      if(property==='iterate'){
       const iteratorProxy=new Proxy(result,{get(iterator,name){if(name===Symbol.iterator)return ()=>iteratorProxy;const method=Reflect.get(iterator,name,iterator);return typeof method==='function'?(...values)=>operation(executionScope,bundle,sql,()=>method.apply(iterator,values)):method;}});
       return iteratorProxy;
      }
      return result;
     };
    }});
   };
   if(key==='exec')return sql=>{
    const {scope,bundle}=capture();
    if(!scope||scope.initializing)return bundle.db.exec(sql);
    if(/^\s*BEGIN(?:\s+IMMEDIATE|\s+DEFERRED|\s+EXCLUSIVE)?\s*;?\s*$/i.test(sql)){
     if(bundle.transactionScope)throw fail('company_transaction_nested',409);
     return beginTransaction(scope,bundle,sql,'begin');
    }
    if(/^\s*(?:COMMIT|ROLLBACK)\s*;?\s*$/i.test(sql)){
     if(scope.transactionAborted&&!bundle.transactionScope&&/ROLLBACK/i.test(sql))return;
     if(bundle.transactionScope!==scope)throw fail('company_context_mismatch');
     const rollback=/ROLLBACK/i.test(sql),separate=bundle.catalogTransaction;
     try{if(!rollback)assertScope(scope);bundle.db.exec(sql);if(separate)controlDb.exec(sql);clearTransaction(bundle);return;}
     catch(error){abortTransaction(bundle);throw error;}
    }
    const savepoint=/^\s*(SAVEPOINT|RELEASE(?:\s+SAVEPOINT)?|ROLLBACK\s+TO(?:\s+SAVEPOINT)?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*;?\s*$/i.exec(sql);
    if(savepoint){
     const verb=savepoint[1].toUpperCase(),name=savepoint[2];
     if(verb==='SAVEPOINT'&&!bundle.transactionScope)return beginTransaction(scope,bundle,sql,'savepoint',name);
     if(bundle.transactionScope!==scope)throw fail('company_context_mismatch');
     const rollback=verb.startsWith('ROLLBACK');if(!rollback)assertScope(scope);
     bundle.db.exec(sql);
     if(verb==='SAVEPOINT')bundle.savepoints.push(name);
     else{
      const index=bundle.savepoints.lastIndexOf(name);if(index<0)throw fail('company_savepoint_invalid');
      bundle.savepoints.splice(index+(rollback?1:0));
      if(!rollback&&bundle.transactionMode==='savepoint'&&!bundle.savepoints.length){if(bundle.catalogTransaction)controlDb.exec('COMMIT');clearTransaction(bundle);}
     }
     return;
    }
    return operation(scope,bundle,sql,()=>bundle.db.exec(sql),true);
   };
   // The unscoped export remains compatible with legacy maintenance/tests.
   if(storage.getStore())throw fail('company_database_operation_denied');
   const value=Reflect.get(controlDb,key,controlDb);return typeof value==='function'?value.bind(controlDb):value;
  }
 });
 // Keep the guarded public operations as real properties. Runtime inspection
 // and fault instrumentation must see the same methods ordinary callers use;
 // both wrappers still capture and validate the current company on every call.
 for(const name of ['prepare','exec'])Object.defineProperty(db,name,{value:db[name],writable:true,enumerable:true,configurable:true});
 function services(){
  const {bundle,scope}=capture();
  if(bundle.services===null)bundle.services=storage.run({initializing:true,bundle,context:scope?.context},()=>initialize());
  return bundle.services;
 }
 function run(context,callback,{authorize,job=false,actorId=legacyPrincipal}={}){
  const old=storage.getStore();
  if(old&&!old.initializing){
   if(!context||!old.context||context.companyId!==old.context.companyId||context.actorId!==old.context.actorId||context.contextVersion!==old.context.contextVersion)throw fail('company_context_mismatch');
   assertScope(old);return callback();
  }
  if(context){context=assertCompanyContext(context);assertMembership(context,{job});}
  else if(actorId!==legacyPrincipal||legacyCompany())throw fail('company_access_denied');
  const scope={context,bundle:getBundle(context,{job}),authorize,job,actorId};
  return storage.run(scope,()=>currentExecution.run(scope,()=>{assertScope(scope);services();return callback();}));
 }
 /** Trusted collision probes share path/boundary validation, including retained
  * suspended companies. Only a boolean escapes; foreign business data does not. */
 function retainedStorageContains(matches){
  try{
   const legacy=legacyCompany(),legacyContext=legacy?{companyId:legacy.company_id,storageOwner:legacy.storage_owner}:null;
   if(legacyContext)assertBundleBoundary(legacyBundle,legacyContext);
   if(matches(controlDb,legacyContext))return true;
   for(const c of controlDb.prepare("SELECT company_id,storage_owner,database_key FROM companies WHERE database_key<>'legacy'").all()){
    const context={companyId:c.company_id,storageOwner:c.storage_owner};
    if(!/^[a-f0-9-]{36}$/.test(c.database_key))return true;
    const path=join(directory,c.database_key+'.sqlite');
    if(!existsSync(path)||!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()||realpathSync(dirname(path))!==realpathSync(directory))return true;
    const inspection=new DatabaseSync(path,{readOnly:true});
    try{assertBundleBoundary({db:inspection},context);if(matches(inspection,context))return true;}finally{inspection.close();}
   }
   return false;
  }catch{return true;} // Missing/corrupt retained evidence cannot authorize reuse.
 }
 return {
  db,controlDb,
  current:()=>storage.getStore()?.context??null,
  legacyBound:()=>!!legacyCompany(),
  isJob:()=>storage.getStore()?.job===true,
  services,
  configureServices(factory){initialize=factory;},
  service(name){return new Proxy({}, {
   get(_target,key){const item=services()[name];const value=Reflect.get(item,key,item);return typeof value==='function'?value.bind(item):value;},
   set(_target,key,value){services()[name][key]=value;return true;},
   ownKeys(){return Reflect.ownKeys(services()[name]);},
   has(_target,key){return key in services()[name];},
   getOwnPropertyDescriptor(_target,key){const descriptor=Reflect.getOwnPropertyDescriptor(services()[name],key);return descriptor?{...descriptor,configurable:true}:undefined;}
  });},
  resolve:resolveContext,run,
  runJob(context,callback,options={}){return run(context,callback,{...options,job:true});},
  assert(action='read'){assertScope(storage.getStore(),action);},
  /** Exact provider-session collision check for trusted consent code. It exposes
   * only a boolean, never another company's bank payload or credentials. The
   * callback repeats this while holding the existing catalogue commit lock. */
  retainedBankSessionInUse(sessionId,exceptConnectionId){
   const scope=storage.getStore();if(!scope||scope.initializing)throw fail('company_access_denied');
   assertScope(scope,'manage_integrations');
   if(typeof sessionId!=='string'||!sessionId||sessionId.length>256||/[\s\u0000-\u001f\u007f]/.test(sessionId))return true;
   const owner=scope.context?.storageOwner??scope.actorId;let exception=null,seen=false;
   if(exceptConnectionId!==undefined){
    if(!identity(exceptConnectionId))return true;
    // A caller can exclude only a known row in its current live namespace,
    // never a supplied owner/company tuple or an unrelated remote handle.
    try{
     const row=scope.bundle.db.prepare('SELECT id,owner,encrypted_session FROM bank_connections WHERE id=? AND owner=?').get(exceptConnectionId,owner);
     if(!row||decryptObject(row.encrypted_session).session_id!==sessionId)return true;
     exception=row;
    }catch{return true;}
   }
   const contains=(database,boundary)=>{
    for(const row of database.prepare('SELECT id,owner,encrypted_session FROM bank_connections').all()){
     if(row.owner!==(boundary?.storageOwner??legacyPrincipal))return true;
     const ownBoundary=scope.context?boundary?.companyId===scope.context.companyId&&boundary.storageOwner===owner:!boundary&&database===scope.bundle.db;
     if(exception&&ownBoundary&&row.id===exception.id&&row.owner===owner&&row.encrypted_session===exception.encrypted_session){seen=true;continue;}
     if(decryptObject(row.encrypted_session).session_id===sessionId)return true;
    }
    return false;
   };
   const retained=retainedStorageContains(contains);assertScope(scope,'manage_integrations');
   return retained||!!exception&&!seen;
  },
  /** Call within the existing catalogue+tenant write transaction before claim
   * insertion/CAS. A preflight alone is not a grant reservation. */
  retainedProviderGrantInUse(fingerprint,connectionId){
   const scope=storage.getStore();if(!scope?.context)throw fail('company_access_denied');
   assertScope(scope,'manage_integrations');
   const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
   if(!hash(fingerprint)||!identity(connectionId))return true;
   const current=scope.context,result=retainedStorageContains((database,boundary)=>{
    const tables=new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('bank_provider_connections','bank_provider_grant_claims')").all().map(row=>row.name));
    if(!tables.size)return false;
    if(tables.size!==2){const table=tables.has('bank_provider_connections')?'bank_provider_connections':'bank_provider_grant_claims';return !!database.prepare('SELECT 1 FROM '+table+' LIMIT 1').get();}
    // Inspect only namespace/claim metadata, never encrypted state or accounts.
    const rows=database.prepare('SELECT id,owner,company_id,provider_kind,environment,grant_fingerprint FROM bank_provider_connections').all();
    const claims=database.prepare('SELECT fingerprint,owner,company_id,connection_id,provider_kind,environment FROM bank_provider_grant_claims').all();
    if(!rows.length&&!claims.length)return false;
    if(!boundary)return true;
    const valid=row=>row.owner===boundary.storageOwner&&row.company_id===boundary.companyId&&row.provider_kind==='open_payments'&&['SANDBOX','PRODUCTION'].includes(row.environment);
    const connections=new Map(rows.map(row=>[row.id,row])),history=new Map(claims.map(row=>[row.fingerprint,row]));
    for(const row of rows){
     if(!valid(row)||!identity(row.id)||typeof row.grant_fingerprint!=='string'||row.grant_fingerprint!==''&&!hash(row.grant_fingerprint))return true;
     if(row.grant_fingerprint){const claim=history.get(row.grant_fingerprint);if(!claim||claim.connection_id!==row.id||claim.owner!==row.owner||claim.company_id!==row.company_id||claim.provider_kind!==row.provider_kind||claim.environment!==row.environment)return true;}
    }
    for(const claim of claims){
     const row=connections.get(claim.connection_id);
     if(!valid(claim)||!hash(claim.fingerprint)||!row||row.owner!==claim.owner||row.company_id!==claim.company_id||row.provider_kind!==claim.provider_kind||row.environment!==claim.environment)return true;
     if(claim.fingerprint===fingerprint&&(claim.owner!==current.storageOwner||claim.company_id!==current.companyId||claim.connection_id!==connectionId))return true;
    }
    return false;
   });
   assertScope(scope,'manage_integrations');return result;
  },
  databasePath(context){return getBundle(context).path;},
  listCompanies(actorId){
   checkIdentity(actorId);
   const companies=controlDb.prepare("SELECT c.company_id id,c.name,m.role,m.membership_version membershipVersion FROM company_memberships m JOIN companies c USING(company_id) WHERE m.actor_id=? AND m.status='active' AND c.status='active' ORDER BY c.name,c.company_id").all(actorId).map(row=>({...row}));
   const current=active(actorId),activeCompanyId=companies.some(c=>c.id===current?.company_id)?current.company_id:null;
   if(!companies.length){
    if(actorId===legacyPrincipal&&!legacyCompany()&&!current)return {version:COMPANY_CONTEXT_VERSION,companies:[],activeCompanyId:null,contextVersion:1,legacy:true};
    throw fail('company_access_denied');
   }
   return {version:COMPANY_CONTEXT_VERSION,companies,activeCompanyId,contextVersion:current?.context_version??1,
    ...(activeCompanyId?{context:resolveContext({actorId,companyId:activeCompanyId})}:{actorId,selectionRequired:true})};
  },
  selectActiveCompany({actorId,companyId,contextVersion}={}){
   checkIdentity(actorId);checkIdentity(companyId);
   return transaction(()=>{
    const c=company(companyId),m=member(companyId,actorId),current=active(actorId);
    if(!c||c.status!=='active'||!m||m.status!=='active')throw fail('company_access_denied');
    if(contextVersion!==undefined&&contextVersion!==(current?.context_version??1))throw fail('COMPANY_CONTEXT_STALE',409);
    controlDb.prepare('INSERT INTO company_active_contexts(actor_id,company_id,context_version) VALUES(?,?,2) ON CONFLICT(actor_id) DO UPDATE SET company_id=excluded.company_id,context_version=company_active_contexts.context_version+1').run(actorId,companyId);
    return resolveContext({actorId,companyId});
   });
  },
  /** Operator-only API. Existing authenticated legacy principal must own the binding. */
  bindLegacyCompany({companyId,name,storageOwner,actorId,verification}={}){
   checkIdentity(companyId);name=checkName(name);verification=checkVerification(verification);
   if(storageOwner!==legacyPrincipal||actorId!==legacyPrincipal)throw fail('company_legacy_owner_mismatch');
   return transaction(()=>{
    const existing=legacyCompany();
    if(existing||company(companyId))throw fail('company_boundary_conflict');
    for(const table of ['bank_connections','import_jobs','bank_specification_links','bankgiro_ingest_sources']){
     if(controlDb.prepare(`SELECT 1 FROM ${table} WHERE owner<>'' AND owner<>? LIMIT 1`).get(storageOwner))throw fail('company_legacy_owner_conflict');
    }
    stampBoundary(controlDb,{companyId,storageOwner,verification});
    controlDb.prepare("INSERT INTO companies(company_id,name,storage_owner,database_key,verification_ref,verified_by) VALUES(?,?,?,'legacy',?,?)").run(companyId,name,storageOwner,verification.evidenceId,verification.verifiedBy);
    addMember(companyId,actorId);return resolveContext({actorId,companyId},{job:true});
   });
  },
  /** Operator-only API. Creates an empty partition; accepts no old DB path. */
  provisionCompany({companyId,name,actorId,verification}={}){
   checkIdentity(companyId);checkIdentity(actorId);name=checkName(name);verification=checkVerification(verification);
   if(company(companyId))throw fail('company_boundary_conflict');
   assertLegacyProvisioningAllowed(actorId);
   mkdirSync(directory,{recursive:true,mode:0o700});
   if(lstatSync(directory).isSymbolicLink())throw fail('company_boundary_conflict');
   const databaseKey=randomUUID(),path=join(directory,databaseKey+'.sqlite'),storageOwner='company:'+randomUUID();
   const tenant=openDatabase(path);
   try{
    tenant.exec('BEGIN IMMEDIATE');
    try{stampBoundary(tenant,{companyId,storageOwner,verification});
     tenant.prepare('UPDATE app_settings SET data=? WHERE id=1').run(JSON.stringify({...defaultSettings,company_name:name,email:'',gmail_sync_interval_minutes:0,invoice_reference_policies:[]}));tenant.exec('COMMIT');
    }catch(error){tenant.exec('ROLLBACK');throw error;}
    transaction(()=>{assertLegacyProvisioningAllowed(actorId);controlDb.prepare('INSERT INTO companies(company_id,name,storage_owner,database_key,verification_ref,verified_by) VALUES(?,?,?,?,?,?)').run(companyId,name,storageOwner,databaseKey,verification.evidenceId,verification.verifiedBy);addMember(companyId,actorId);});
    bundles.set(companyId,{db:tenant,path,companyId,services:null});return resolveContext({actorId,companyId},{job:true});
   }catch(error){tenant.close();throw error;}
  },
  /** Trusted provisioning/revocation; never accepts an unauthenticated HTTP principal. */
  setMembership({companyId,actorId,role,status='active'}={}){
   checkIdentity(companyId);checkIdentity(actorId);
   if(!hasCompanyPermission(role,'read')||!['active','revoked'].includes(status))throw fail('company_membership_invalid',400);
   return transaction(()=>{
    if(!company(companyId))throw fail('company_access_denied');
    const previous=member(companyId,actorId);
    if(previous?.role==='owner'&&previous.status==='active'&&(status!=='active'||role!=='owner')&&!controlDb.prepare("SELECT 1 FROM company_memberships WHERE company_id=? AND actor_id<>? AND role='owner' AND status='active'").get(companyId,actorId))throw fail('company_last_owner');
    controlDb.prepare("INSERT INTO company_memberships(company_id,actor_id,role,status) VALUES(?,?,?,?) ON CONFLICT(company_id,actor_id) DO UPDATE SET role=excluded.role,status=excluded.status,membership_version=company_memberships.membership_version+1,updated_at=CURRENT_TIMESTAMP").run(companyId,actorId,role,status);
    if(status==='active')controlDb.prepare('INSERT OR IGNORE INTO company_active_contexts(actor_id,company_id) VALUES(?,?)').run(actorId,companyId);
   });
  },
  scheduledContexts(){
   return controlDb.prepare("SELECT c.company_id,COALESCE(MIN(CASE WHEN m.role='owner' THEN m.actor_id END),MIN(m.actor_id)) actor_id FROM companies c JOIN company_memberships m USING(company_id) WHERE c.status='active' AND m.status='active' AND m.role IN ('owner','admin') GROUP BY c.company_id").all().map(row=>resolveContext({actorId:row.actor_id,companyId:row.company_id},{job:true}));
  },
  close(){if(closed)return;closed=true;for(const bundle of bundles.values()){bundle.services?.paymentControl?.stop();bundle.db.close();}legacyBundle.services?.paymentControl?.stop();}
 };
}
