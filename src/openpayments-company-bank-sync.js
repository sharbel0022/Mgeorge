import {readFileSync} from 'node:fs';
import {readCompanyDatabaseBoundary} from './company-runtime.js';
import {createNodeBankgiroSink} from './bankgiro-ingest.js';
import {createBankgiroIngest} from '../sites/lib/bankgiro-ingest.js';
import {createBankgiroIngestStore} from '../sites/lib/bankgiro-ingest-store.js';
import {createOpenPaymentsBankgiroCaptureFromProvider,assertOpenPaymentsBankgiroAuthority} from '../sites/lib/bankgiro-openpayments-capture.js';
import {nodeSaasBankRuntime} from './saas-bank-runtime.js';
import {createCompanyBankSyncStore,companySyncError} from '../sites/lib/company-bank-sync-store.js';
import {createCompanyBankSyncRunner,runCompanyBankSyncBatch} from '../sites/lib/company-bank-sync.js';
import {companyBankAccountKey} from '../sites/lib/company-bank-account-key.js';
import {createCompanySyncDatabase} from './company-sync-database.js';
import {normalizeOpenPaymentsBooked,openPaymentsAccountIdentity} from '../sites/lib/banking/openpayments-normalization.js';
import {storeTransactions,recordImport,audit} from './db.js';
import {analyzeReconciliation,reconciliationData} from './reconciliation.js';
import {digest,decryptObject} from './security.js';
import {configuredOpenPaymentsNodeTransport} from './banking/openpayments-runtime-transport.js';
import {createNodeOpenPaymentsTokenCoordinator} from './banking/openpayments-token-coordinator.js';
const fail=code=>{throw companySyncError(code);};
const text=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=300;
const sync=value=>{if(value?.then){Promise.resolve(value).catch(()=>{});fail('AUTHORIZATION_UNVERIFIED');}if(value===false)fail('AUTHORIZATION_CHANGED');};
const configKeys=['SAAS_BANK_ENABLED','SAAS_OPENPAYMENTS_CONFIG','SAAS_OPENPAYMENTS_REGISTRATIONS','SAAS_OPENPAYMENTS_MTLS_CONFIG'];
const failure=(companyId,connectionId,code)=>({companyId,connectionId:connectionId||null,status:'blocked',code,imported:0,duplicate:0,nextAttemptAt:null,coverage:{ais:'unknown',bankgiro:'unknown',paymentDataComplete:false}});

/** Trusted server composition only: db and actor context may never come from
 * HTTP body fields. assertCurrent synchronously re-resolves live membership.
 * This adapter creates no timer and automatic work is disabled by default. */
export async function createNodeOpenPaymentsCompanySyncRuntime({db,controlDb,context,assertCurrent,evidenceId,existingDataCompanyId,environment=process.env,origin,providerOptions={},now=Date.now,historyDays=30,automatic={},requestTimeoutMs=18000,maxRunMs=240000,leaseMs=Math.min(300000,maxRunMs)}){
 if(!db||!context||!text(context.companyId)||!text(context.storageOwner)||!text(evidenceId)||typeof assertCurrent!=='function'||!Number.isSafeInteger(historyDays)||historyDays<1||historyDays>90)throw TypeError('Trusted company database, membership guard and evidence are required');
 const fixed=Object.freeze({...context}),companyId=fixed.companyId,owner=fixed.storageOwner;
 const guard=()=>{sync(assertCurrent(fixed));if(!['owner','admin'].includes(fixed.role))fail('AUTHORIZATION_UNVERIFIED');};guard();
 let config;try{config=JSON.parse(environment.SAAS_OPENPAYMENTS_CONFIG||'null');}catch{fail('AUTHORIZATION_UNVERIFIED');}
 const transport=config?.environment==='PRODUCTION'?(providerOptions.transport??configuredOpenPaymentsNodeTransport({environment,configuration:config})):null;
 const applicationTokens=environment.SAAS_BANK_ENABLED==='true'&&transport?createNodeOpenPaymentsTokenCoordinator({controlDb,environment,configuration:config,transport}):null;
 const database=createCompanySyncDatabase(db);
 const migration=readFileSync(new URL('../sites/drizzle/0023_saas_bank_sync.sql',import.meta.url),'utf8').replace(/CREATE TABLE /g,'CREATE TABLE IF NOT EXISTS ').replace(/CREATE (UNIQUE )?INDEX /g,'CREATE $1INDEX IF NOT EXISTS ');
 db.exec('BEGIN IMMEDIATE');try{guard();db.exec(migration);const bindings=db.prepare('SELECT * FROM company_bank_sync_scopes').all();
  if(bindings.length>1||bindings.length===1&&(bindings[0].company_id!==companyId||bindings[0].owner!==owner))fail('COMPANY_SCOPE_MISMATCH');
  if(!bindings.length){const populated=['invoices','bank_transactions','documents','import_jobs'].some(table=>db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get());if(populated&&existingDataCompanyId!==companyId)fail('COMPANY_SCOPE_MISMATCH');db.prepare('INSERT INTO company_bank_sync_scopes(company_id,owner,evidence_id,created_at) VALUES(?,?,?,?)').run(companyId,owner,evidenceId,now());}
  guard();db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 const store=createCompanyBankSyncStore(database,{now,leaseMs,maxRunMs});
 const auto=automatic.enabled===true&&automatic.operatorVerified===true&&text(automatic.evidenceId);
 const state=()=>db.prepare('SELECT revision,payload FROM saas_bank_state WHERE owner=?').get(owner);
 function snapshotGuard(snapshot){guard();const current=state(),binding=db.prepare('SELECT company_id,owner FROM company_bank_sync_scopes').all();
  try{snapshot.applicationTokenAssert?.();}catch{fail('AUTHORIZATION_CHANGED');}
  if(binding.length!==1||binding[0].company_id!==companyId||binding[0].owner!==owner)fail('COMPANY_SCOPE_MISMATCH');
  if(!current||current.revision!==snapshot.revision||current.payload!==snapshot.statePayload||configKeys.some(key=>environment[key]!==snapshot.configuration[key]))fail('AUTHORIZATION_CHANGED');
  if(Date.parse(snapshot.validUntil)<=now())fail('CONSENT_EXPIRED');
  if(!providerOptions.transport)configuredOpenPaymentsNodeTransport({environment,configuration:JSON.parse(environment.SAAS_OPENPAYMENTS_CONFIG||'null')})?.validateCertificate();
 }
 function facade(dispatch){
  guard();return nodeSaasBankRuntime({db,controlDb,context:fixed,assertCurrent:guard,sessionHash:'internal-authorized-sync',origin,environment,providerOptions:{...providerOptions,requestBoundary:operation=>{if(typeof dispatch!=='function')fail('AUTHORIZATION_UNVERIFIED');return dispatch(operation);}}});
 }

 async function prepare(accountId,dispatch){guard();const before=state(),configuration=Object.fromEntries(configKeys.map(key=>[key,environment[key]]));if(!before)fail('AUTHORIZATION_UNVERIFIED');
  const runtime=facade(dispatch),resolved=await runtime.syncContext(accountId);guard();
  const bank=(await runtime.snapshot()).connection?.bankId;if(!text(bank))fail('ACCOUNT_MISMATCH');
  const accountIdentity=openPaymentsAccountIdentity(resolved.account.identity),accountKey=companyBankAccountKey({provider:'open_payments',bank,country:'SE',accountIdentity});
  const applicationTokenAssert=applicationTokens?await applicationTokens.captureGuard():null;
  const current={...resolved.context,accountKey,statePayload:before.payload,configuration,applicationTokenAssert};
  if(current.companyId!==companyId||current.owner!==owner||current.provider!=='open_payments'||current.revision!==before.revision)fail('COMPANY_SCOPE_MISMATCH');
  snapshotGuard(current);return{...resolved,context:current,accountIdentity};
 }
 async function selected(){const snapshot=await facade().snapshot();guard();return snapshot.accounts.filter(account=>account.selected&&account.importable).map(account=>account.id);}
 async function execute(accountId,expected={}){
  let stageRequest;const dispatch=operation=>{if(!stageRequest)fail('AUTHORIZATION_UNVERIFIED');return stageRequest(operation);};
  let initial;try{guard();if(applicationTokens)await applicationTokens.coordinator.ensureRegistered();guard();initial=await prepare(accountId,dispatch);}catch(error){return failure(companyId,expected.connectionId,error.code||'AUTHORIZATION_UNVERIFIED');}
  const selector={companyId,connectionId:initial.context.connectionId,accountKey:initial.context.accountKey,...expected};
  const resolve=async request=>{const current=await prepare(accountId,dispatch);if(request.companyId!==companyId||request.connectionId!==current.context.connectionId||request.accountKey!==current.context.accountKey)fail('ACCOUNT_MISMATCH');return current.context;};
  let fetched,resolved,acquisitionId;
  const runner=createCompanyBankSyncRunner({store,now,requestTimeoutMs,maxRunMs,resolveContext:resolve,currentGuard:current=>({assert:()=>snapshotGuard(current),fence:()=>database.guard(()=>snapshotGuard(current))}),
   sync:async stage=>{
    stageRequest=stage.request;const current=await prepare(accountId,dispatch);resolved=current;await current.verifyConsent();await stage.assertCurrent();
    const dateTo=new Date(now()).toISOString().slice(0,10),dateFrom=new Date(now()-(historyDays-1)*86400000).toISOString().slice(0,10);
    fetched=await current.provider.getTransactions(current.account.handle,{dateFrom,dateTo,requireBankgiro:false});await current.verifyConsent();await stage.assertCurrent();
    if(!Array.isArray(fetched.originals)||!fetched.originals.length||fetched.paymentReconciliationAllowed!==false)fail('IMPORT_FAILED');
    for(const original of fetched.originals){if(original.provider!=='open_payments'||original.binding?.companyId!==companyId||original.binding.owner!==owner||original.binding.connectionId!==stage.context.connectionId||original.binding.generation!==stage.context.generation||original.bankDataSha256!==digest(JSON.stringify(original.bankData)))fail('IMPORT_IDENTITY_CONFLICT');}
    const original={version:'openpayments-company-original-v1',provider:'open_payments',companyId,accountKey:stage.context.accountKey,dateFrom,dateTo,originals:fetched.originals,bankgiro:fetched.bankgiro,bankgiroEvidence:fetched.bankgiroEvidence,booked:fetched.booked};
    const bytes=Buffer.from(JSON.stringify(original)),sha256=digest(bytes),receiptKey='openpayments:'+digest(JSON.stringify([stage.context.accountKey,dateFrom,dateTo,sha256]));
    acquisitionId=sha256;
    let rows;try{rows=normalizeOpenPaymentsBooked(fetched.booked,{account:current.accountIdentity.startsWith('iban:')?current.accountIdentity.slice(5):current.accountIdentity,dateFrom,dateTo});}catch(error){
     await stage.lease.commitWork({key:'invalid:'+receiptKey,sha256,work:()=>{snapshotGuard(stage.context);const importId=recordImport(db,{source:'open_payments',status:'blocked',error:'Provider transaction cannot be safely normalized',found:fetched.booked.length,review:fetched.booked.length,content:bytes,mime_type:'application/json'});db.prepare('UPDATE import_jobs SET owner=? WHERE id=?').run(owner,importId);return{imported:0,duplicate:0,import_id:importId};}});fail('IMPORT_FAILED');
    }
    let committed;try{committed=await stage.lease.commitWork({key:receiptKey,sha256,checkpoint:{provider:'open_payments',dateFrom,dateTo,complete:true},work:()=>storeTransactions(db,rows,'open_payments',{owner,content:bytes,mime_type:'application/json'},()=>snapshotGuard(stage.context),result=>{snapshotGuard(stage.context);audit(db,'openpayments_synced',{company_id:companyId,connection_id:stage.context.connectionId,date_from:dateFrom,date_to:dateTo,imported:result.imported,duplicate:result.duplicate,preview_only:true});},work=>work(),(retainRejected,error)=>{error.retainRejected=retainRejected;})});}catch(error){
     if(typeof error.retainRejected==='function')await stage.lease.commitWork({key:'rejected:'+receiptKey,sha256,work:()=>{snapshotGuard(stage.context);const importId=recordImport(db,{source:'open_payments',status:'blocked',error:'Conflicting retained bank identity',found:rows.length,review:rows.length,content:bytes,mime_type:'application/json'});db.prepare('UPDATE import_jobs SET owner=? WHERE id=?').run(owner,importId);error.retainRejected();return{imported:0,duplicate:0,import_id:importId};}});
     if(error.code==='conflicting_bank_record')fail('IMPORT_IDENTITY_CONFLICT');throw error;
    }
    return{complete:true,receiptKey,imported:committed.duplicate?0:committed.result.imported,duplicate:committed.duplicate?rows.length:committed.result.duplicate};
   },
   // Retained Bankgiro observations never establish report entitlement or
   // completeness; enrichment/source verification remains a separate boundary.
   enrich:async stage=>enrichCompanyBankgiro(stage,{resolved,fetched,acquisitionId}),
   reconcile:async stage=>{await stage.assertCurrent();snapshotGuard(stage.context);const review=analyzeReconciliation(reconciliationData(db,{owner}));snapshotGuard(stage.context);return{status:'completed',applied:0,previewOnly:true,review:review.length};},
  });return runner.run(selector);
 }
 async function enrichCompanyBankgiro(stage,{resolved,fetched,acquisitionId}){
  await stage.assertCurrent();snapshotGuard(stage.context);
  const c=stage.context,registration=JSON.parse(environment.SAAS_OPENPAYMENTS_REGISTRATIONS||'[]').find(r=>r.companyId===companyId&&r.actorId===fixed.actorId),r=registration?.bankgiroRegistration;
  if(!c.bankgiroEnabled||!r||r.verified!==true||r.enabled!==true||r.origin!=='provider_authorization'||r.companyId!==companyId||r.owner!==owner||!text(r.id)||!text(r.scopeId)||!text(r.generation)||!text(r.evidenceId)||!text(r.accountId)||!Number.isSafeInteger(r.configurationRevision)||r.configurationRevision<1||r.profileId!=='openpayments-bankgiro-v1'||!Array.isArray(r.capabilities)||!['bankgiro_reports:read','accountinformation','bankgiroinformation','corporate'].every(s=>r.capabilities.includes(s))||!/^\d{4,10}$/.test(r.bankgiro)||r.iban!==resolved.account.identity.iban||!Number.isFinite(Date.parse(r.validUntil))||Date.parse(r.validUntil)<=now())return{state:'unavailable'};
  const boundary=readCompanyDatabaseBoundary(db);if(!boundary||boundary.companyId!==companyId||boundary.storageOwner!==owner)fail('COMPANY_SCOPE_MISMATCH');
  const captured=createOpenPaymentsBankgiroCaptureFromProvider({context:{owner,companyId,sourceId:r.id,scopeId:r.scopeId,accountId:r.accountId,iban:r.iban,bankgiro:r.bankgiro},captureId:acquisitionId,originals:fetched.originals,binding:resolved.provider.binding});
  const assert=()=>{snapshotGuard(c);database.assert(stage.lease.fence());};
  const originals=new WeakMap();
  function wrapped(statement){const proxy={bind(...args){return wrapped(statement.bind(...args));},async first(){assert();const value=await statement.first();assert();return value;},async all(){assert();const value=await statement.all();assert();return value;},async run(){assert();return(await stage.lease.write([statement]))[0];}};originals.set(proxy,statement);return proxy;}
  const guardedDatabase={prepare:query=>wrapped(database.prepare(query)),async batch(statements){assert();return stage.lease.write(statements.map(s=>originals.get(s)||s));}};
  const validUntil=new Date(Math.min(Date.parse(r.validUntil),Date.parse(c.validUntil))).toISOString();
  const source={id:r.id,mode:'production',configurationValid:true,registration:{...r,allowedFormats:['opbg.json']},
   async authorize(input){if(input.owner!==owner)fail('COMPANY_SCOPE_MISMATCH');assert();await resolved.verifyConsent();assert();return assertOpenPaymentsBankgiroAuthority(captured,{status:'VERIFIED',origin:'provider_authorization',owner,companyId,sourceId:r.id,scopeId:r.scopeId,generation:r.generation,evidenceId:r.evidenceId,profileId:r.profileId,accountId:r.accountId,iban:r.iban,bankgiro:r.bankgiro,capabilities:[...r.capabilities],checkedAt:new Date(now()).toISOString(),validUntil},{owner,companyId,sourceId:r.id,scopeId:r.scopeId,now:now()});},
   async listReports(){assert();return{reports:[{reportId:captured.reportId,filename:captured.filename,sha256:captured.sha256,availableAt:new Date(now()).toISOString()}],nextCursor:null};},
   async fetchReport(){assert();return captured.bytes.slice();},
  };
  const sink=createNodeBankgiroSink(db,{now,companyGuard:{companyId,owner,assert}}),worker=createBankgiroIngest({source,store:createBankgiroIngestStore(guardedDatabase,{now}),sink,now});
  await worker.run(owner);assert();
  // Original retention and normalized review are useful evidence, never a new
  // economic payment or an assertion of complete reconciliation coverage.
  return{state:captured.normalization.coverage.status==='unavailable'?'unavailable':'partial'};
 }
 async function status(accountId){return readNodeOpenPaymentsCompanySyncStatus({db,controlDb,context:fixed,assertCurrent:guard,accountId,automaticEnabled:auto,environment,providerOptions,now});}
 return Object.freeze({companyId,owner,store,manual:execute,status,
  async run(request){if(!request||Object.keys(request).some(key=>!['companyId','connectionId','accountKey','expectedGeneration','expectedRevision'].includes(key))||request.companyId!==companyId)return failure(companyId,request?.connectionId,'COMPANY_SCOPE_MISMATCH');guard();if(applicationTokens)await applicationTokens.coordinator.ensureRegistered();for(const id of await selected()){const current=await prepare(id);if(current.context.accountKey===request.accountKey)return execute(id,request);}return failure(companyId,request.connectionId,'ACCOUNT_MISMATCH');},
  async scheduled(){if(!auto)return{results:[],remaining:0,disabled:true};guard();if(applicationTokens)await applicationTokens.coordinator.ensureRegistered();guard();const jobs=[];for(const accountId of await selected()){const current=await prepare(accountId);await store.register(current.context);const saved=await store.status(current.context);if(saved?.status==='blocked'||saved?.status==='running'||saved?.nextAttemptAt>now())continue;jobs.push({accountId,lastAttemptAt:saved?.lastAttemptAt||0});}jobs.sort((a,b)=>a.lastAttemptAt-b.lastAttemptAt);return runCompanyBankSyncBatch({jobs,maxConcurrent:1,maxJobs:100,run:job=>execute(job.accountId)});},
 });
}

/** Read-only projection for current readers (including accountant/viewer).
 * The caller's guard authorizes this actor/company on both sides of the read.
 * No migration, registration, lease or provider operation occurs here. */
export async function readNodeOpenPaymentsCompanySyncStatus({db,controlDb,context,assertCurrent,accountId,automaticEnabled=false,environment=process.env,providerOptions={},now=Date.now}){
 if(!db||!context||typeof assertCurrent!=='function'||!text(accountId))fail('AUTHORIZATION_UNVERIFIED');
 const check=()=>sync(assertCurrent(context));check();
 const configuration=Object.fromEntries(configKeys.map(key=>[key,environment[key]]));let config;try{config=JSON.parse(configuration.SAAS_OPENPAYMENTS_CONFIG);}catch{config=null;}
 const row=db.prepare('SELECT revision,payload FROM saas_bank_state WHERE owner=?').get(context.storageOwner);
 if(!row)fail('AUTHORIZATION_UNVERIFIED');const decoded=decryptObject(row.payload);
 if(decoded.owner!==context.storageOwner||decoded.purpose!=='saas-bank-state')fail('COMPANY_SCOPE_MISMATCH');
 const value=decoded.value,account=value?.accounts?.find(a=>a.id===accountId);
 if(!account||!value.selected?.includes(accountId))fail('ACCOUNT_MISMATCH');
 const accountKey=companyBankAccountKey({provider:'open_payments',bank:value.bankId,country:'SE',accountIdentity:openPaymentsAccountIdentity(account.identity)});
 const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='company_bank_sync_jobs'").get();
 let result=null,authority=null;if(table){authority=db.prepare('SELECT connection_id,authority_revision FROM company_bank_sync_jobs WHERE company_id=? AND owner=? AND account_key=?').get(context.companyId,context.storageOwner,accountKey);const store=createCompanyBankSyncStore(createCompanySyncDatabase(db),{now});result=await store.status({companyId:context.companyId,owner:context.storageOwner,accountKey});}
 check();const latest=db.prepare('SELECT revision,payload FROM saas_bank_state WHERE owner=?').get(context.storageOwner);if(!latest||latest.revision!==row.revision||latest.payload!==row.payload||configKeys.some(key=>environment[key]!==configuration[key]))fail('AUTHORIZATION_CHANGED');
 let transportReady=false;
 if(config?.environment==='PRODUCTION')try{const transport=providerOptions.transport??configuredOpenPaymentsNodeTransport({environment,configuration:config});if(transport?.kind==='mtls'&&typeof transport.validateCertificate==='function'){transport.validateCertificate();const tokenState=createNodeOpenPaymentsTokenCoordinator({controlDb,environment,configuration:config,transport});await tokenState.coordinator.assertCurrent();check();tokenState.assertCurrentSync();transportReady=true;}}catch{/* Stored status never exposes certificate paths or secret material. */}
 // The transport probe includes an asynchronous global DB read. Its safe
 // diagnostic catch must never swallow revoked company authority or return a
 // consent snapshot that changed while that read was pending.
 check();const finalState=db.prepare('SELECT revision,payload FROM saas_bank_state WHERE owner=?').get(context.storageOwner);
 if(!finalState||finalState.revision!==row.revision||finalState.payload!==row.payload||configKeys.some(key=>environment[key]!==configuration[key]))fail('AUTHORIZATION_CHANGED');
 const serviceEnabled=configuration.SAAS_BANK_ENABLED==='true'&&(config?.environment==='SANDBOX'||config?.environment==='PRODUCTION'&&transportReady),generationCurrent=text(config?.credentialGeneration)&&value.generation===config.credentialGeneration;
 const active=serviceEnabled&&generationCurrent&&value.status==='active'&&Date.parse(value.validUntil)>now(),currentAuthority=!!authority&&authority.connection_id===value.id&&authority.authority_revision===row.revision;
 return{companyId:context.companyId,connectionId:value.id,accountId,accountKey,automaticEnabled:active&&automaticEnabled===true,state:!active?'blocked':!currentAuthority?'never':result?.status==='running'?'running':result?.status==='success'?'succeeded':result?.status==='blocked'?'blocked':result?'failed':'never',lastSuccessAt:result?.lastSuccessAt?new Date(result.lastSuccessAt).toISOString():null,nextAllowedAt:result?.nextAttemptAt?new Date(result.nextAttemptAt).toISOString():null,errorCode:!serviceEnabled?'configuration_required':!generationCurrent?'configuration_changed':!active?'consent_expired':!currentAuthority?null:result?.code?.toLowerCase()||null,coverage:active&&currentAuthority&&result?.coverage?result.coverage:{ais:'unknown',bankgiro:'unknown',paymentDataComplete:false}};
}
