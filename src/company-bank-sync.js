import {readFileSync} from 'node:fs';
import {createCompanyBankSyncStore,companySyncError} from '../sites/lib/company-bank-sync-store.js';
import {createCompanyBankSyncRunner,runCompanyBankSyncBatch} from '../sites/lib/company-bank-sync.js';
import {companyBankAccountKey} from '../sites/lib/company-bank-account-key.js';
import {createCompanySyncDatabase} from './company-sync-database.js';
import {createIntegrationJobs} from './integration-jobs.js';
import {createCompanyReconciler} from './company-reconciliation.js';
import {bankingRequest,fetchBookedTransactions} from './bank.js';
import {planBankSync,completeBankSync} from './bank-sync-state.js';
import {normalizeBankApiTransaction} from './importers.js';
import {storeTransactions,assertNoLegacyBankImports,audit} from './db.js';
import {decryptObject,encryptObject,digest} from './security.js';

const fail=code=>{throw companySyncError(code);};
const text=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=300&&!/[\u0000-\u001f\u007f]/.test(value);
const syncResult=value=>{
 if(value&&typeof value.then==='function'){Promise.resolve(value).catch(()=>{});throw companySyncError('AUTHORIZATION_UNVERIFIED');}
 if(value===false)fail('AUTHORIZATION_CHANGED');
};
const accountIdentity=(account,bank)=>{
 const number=account.account_id?.iban?.replace(/\s/g,'').toUpperCase()||account.account_id?.other?.identification;
 if(number)return number;
 if(account.identification_hash)return `${bank}:SE:hash:${account.identification_hash}`;
 fail('ACCOUNT_MISMATCH');
};
/** Agent 1 may derive selectors only after verifying this persisted account.
 * Session UIDs never identify the quota/receipt namespace. A change of identity
 * representation (for example provider hash to IBAN) needs reviewed migration. */
export function nodeCompanyBankAccountKey({account,bank,provider='enablebanking',country='SE'}={}){
 const iban=account?.account_id?.iban,other=account?.account_id?.other,primaryHash=account?.identification_hash;
 let identity;
 if(typeof iban==='string'&&iban.replace(/\s/g,''))identity='iban:'+iban.replace(/\s/g,'').toUpperCase();
 else if(typeof other?.identification==='string'&&other.identification){
  const scheme=other.scheme_name||'UNSPECIFIED';
  if(typeof scheme!=='string')fail('ACCOUNT_MISMATCH');
  identity='other:'+JSON.stringify([scheme,other.identification]);
 }else if(typeof primaryHash==='string'&&primaryHash)identity='hash:'+primaryHash;
 else fail('ACCOUNT_MISMATCH');
 try{return companyBankAccountKey({provider,bank,country,accountIdentity:identity});}
 catch{fail('ACCOUNT_MISMATCH');}
}
const publicFailure=(request,code,status='blocked',nextAttemptAt=null)=>({companyId:request?.companyId??null,connectionId:request?.connectionId??null,status,code,nextAttemptAt,imported:0,duplicate:0,coverage:{ais:'unknown',bankgiro:'unknown',paymentDataComplete:false}});
const runtimes=new WeakMap(),registered=new Map();
const blockedDiscoveryCodes=new Set(['COMPANY_SCOPE_MISMATCH','ACCOUNT_MISMATCH','AUTHORIZATION_UNVERIFIED','AUTHORIZATION_CHANGED','CONSENT_EXPIRED','BACKGROUND_POLICY_UNVERIFIED','REFERENCE_POLICY_UNVERIFIED','RETRY_AFTER_UNKNOWN']);
let scheduled=false;

/** A durable binding holds legacy writers even after a process restart before
 * its trusted company resolver has been registered again. */
export function isCompanyBankSyncDatabase(db){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='company_bank_sync_scopes'").get())return false;
 return !!db.prepare('SELECT 1 FROM company_bank_sync_scopes LIMIT 1').get();
}

/** Explicit trusted registration only. A companyId from an HTTP request cannot
 * choose a database, its owner, or a membership/consent resolver. Existing
 * financial data requires a deliberate existingDataCompanyId attestation. */
export async function createNodeCompanyBankSyncRuntime({db,companyId,owner,evidenceId,existingDataCompanyId,
 resolveContext,assertCurrent,listJobs=async()=>[],providerRequest=bankingRequest,enrich,
 now=Date.now,requestTimeoutMs=18000,maxRunMs=240000,leaseMs=Math.min(300000,maxRunMs)}){
 if(!db||!text(companyId)||!text(owner)||!text(evidenceId)||typeof resolveContext!=='function'||typeof assertCurrent!=='function'||typeof listJobs!=='function'||typeof providerRequest!=='function')throw TypeError('Trusted company database, resolver and current authority guard are required');
 const database=createCompanySyncDatabase(db);
 const migration=readFileSync(new URL('../sites/drizzle/0023_saas_bank_sync.sql',import.meta.url),'utf8').replace(/CREATE TABLE /g,'CREATE TABLE IF NOT EXISTS ').replace(/CREATE (UNIQUE )?INDEX /g,'CREATE $1INDEX IF NOT EXISTS ');
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec(migration);
  const scopes=db.prepare('SELECT * FROM company_bank_sync_scopes').all();
  if(scopes.length>1||scopes.length===1&&(scopes[0].company_id!==companyId||scopes[0].owner!==owner))fail('COMPANY_SCOPE_MISMATCH');
  if(!scopes.length){
   const populated=['invoices','bank_transactions','documents','import_jobs'].some(table=>db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get());
   if(populated&&existingDataCompanyId!==companyId)fail('COMPANY_SCOPE_MISMATCH');
   if(db.prepare('SELECT 1 FROM bank_connections WHERE owner<>? LIMIT 1').get(owner))fail('COMPANY_SCOPE_MISMATCH');
   db.prepare('INSERT INTO company_bank_sync_scopes(company_id,owner,evidence_id,created_at) VALUES(?,?,?,?)').run(companyId,owner,evidenceId,now());
  }
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 const store=createCompanyBankSyncStore(database,{now,leaseMs,maxRunMs});
 const legacyJobs=createIntegrationJobs(db,{now,leaseMs,maxRunMs});

 function localContext(current){
  if(!current||current.companyId!==companyId||current.owner!==owner||current.provider!=='enablebanking')fail('COMPANY_SCOPE_MISMATCH');
  const scopes=db.prepare('SELECT * FROM company_bank_sync_scopes').all(),scope=scopes[0];
  if(scopes.length!==1||scope.company_id!==companyId||scope.owner!==owner)fail('COMPANY_SCOPE_MISMATCH');
  const connection=db.prepare('SELECT * FROM bank_connections WHERE id=? AND owner=?').get(current.connectionId,owner);
  if(!connection||connection.provider!=='enablebanking'||!['connected','error'].includes(connection.status))fail('AUTHORIZATION_CHANGED');
  if(connection.selected_account_uid!==current.accountUid)fail('AUTHORIZATION_CHANGED');
  if(!Number.isFinite(Date.parse(connection.valid_until))||Date.parse(connection.valid_until)<=now())fail('CONSENT_EXPIRED');
  const session=decryptObject(connection.encrypted_session),accounts=decryptObject(connection.accounts_json);
  if(session.session_id!==current.consentId||!Array.isArray(accounts))fail('AUTHORIZATION_CHANGED');
  const selectedAccounts=accounts.filter(account=>account?.uid===current.accountUid);
  if(selectedAccounts.length!==1)fail('ACCOUNT_MISMATCH');
  const selected=selectedAccounts[0];
  if(selected.currency!=='SEK')fail('ACCOUNT_MISMATCH');
  if(current.accountKey!==nodeCompanyBankAccountKey({provider:connection.provider,bank:connection.bank_name,country:'SE',account:selected}))fail('ACCOUNT_MISMATCH');
  return {...current,scope:{companyId,owner,evidenceId:scope.evidence_id,revision:scope.revision},referencePolicy:scope.reference_policy?JSON.parse(scope.reference_policy):null,
   reconciliationAccount:accountIdentity(selected,connection.bank_name),connectionSnapshot:{id:connection.id,owner:connection.owner,provider:connection.provider,bank_name:connection.bank_name,accounts_json:connection.accounts_json,selected_account_uid:connection.selected_account_uid,valid_until:connection.valid_until},session,connectionLastSynced:connection.last_synced};
 }
 const resolve=async request=>{
  if(request?.companyId!==companyId)fail('COMPANY_SCOPE_MISMATCH');
  const current=localContext(await resolveContext({...request}));
  if(current.connectionId!==request.connectionId||current.accountKey!==request.accountKey)fail('ACCOUNT_MISMATCH');
  if(request.expectedGeneration!==undefined&&request.expectedGeneration!==current.generation||request.expectedRevision!==undefined&&request.expectedRevision!==current.revision)fail('AUTHORIZATION_CHANGED');
  syncResult(assertCurrent(current));
  return current;
 };

 async function run(request){
  if(request?.companyId!==companyId||!text(request.connectionId)||!text(request.accountKey))return publicFailure(request,'COMPANY_SCOPE_MISMATCH');
  let legacy;
  try{legacy=legacyJobs.claim('bank:'+request.connectionId,{recordAttempt:false});}
  catch(error){return publicFailure(request,error.code==='integration_busy'?'ACCOUNT_BUSY':'LEASE_LOST','retry',now()+60000);}
  let remoteExpires=Infinity,verifyRemote;
  const assertSnapshot=snapshot=>{
   legacy.assert();syncResult(assertCurrent(snapshot));
   const current=localContext(snapshot);
   if(JSON.stringify(current.connectionSnapshot)!==JSON.stringify(snapshot.connectionSnapshot)||JSON.stringify(current.scope)!==JSON.stringify(snapshot.scope)||JSON.stringify(current.referencePolicy)!==JSON.stringify(snapshot.referencePolicy))fail('AUTHORIZATION_CHANGED');
   if(Math.min(Date.parse(snapshot.validUntil),Date.parse(current.connectionSnapshot.valid_until),remoteExpires)<=now())fail('CONSENT_EXPIRED');
  };
  const runner=createCompanyBankSyncRunner({store,resolveContext:resolve,now,requestTimeoutMs,maxRunMs,
   currentGuard:context=>({assert:()=>assertSnapshot(context),fence:()=>database.guard(()=>assertSnapshot(context))}),
   sync:async({context,lease,request:providerCall,assertCurrent:assertAsync})=>{
    assertSnapshot(context);assertNoLegacyBankImports(db);
    const connection=db.prepare('SELECT * FROM bank_connections WHERE id=? AND owner=?').get(context.connectionId,owner),legacyState=legacyJobs.state('bank:'+context.connectionId);
    if(legacyState?.retry_blocked)throw companySyncError('RETRY_AFTER_UNKNOWN');
    const retryAt=Math.max(connection.retry_after||0,legacyState?.retry_after||0);
    if(retryAt>now())throw companySyncError('PROVIDER_429',{nextAttemptAt:retryAt});
    const send=(path,options={})=>providerCall(({signal,deadline})=>providerRequest(path,{...options,signal,deadline}));
    verifyRemote=async()=>{
     const consent=await send('/sessions/'+encodeURIComponent(context.consentId));
     const expiry=typeof consent.access?.valid_until==='string'?Date.parse(consent.access.valid_until):NaN;
     // Access.transactions is optional in the documented session response.
     // Trusted context already authorizes transaction reads; a present denial
     // or malformed permission must still stop them immediately.
     if(consent.status!=='AUTHORIZED'||!Array.isArray(consent.accounts)||!consent.accounts.includes(context.accountUid)||consent.aspsp?.name!==connection.bank_name||consent.aspsp?.country!=='SE'||consent.psu_type!=='business'||consent.access?.transactions!==undefined&&consent.access.transactions!==true||!Number.isFinite(expiry)||expiry<=now())fail('AUTHORIZATION_CHANGED');
     remoteExpires=Math.min(remoteExpires,expiry);assertSnapshot(context);
    };
    await verifyRemote();
    const plan=planBankSync(context.session,context.reconciliationAccount,context.connectionLastSynced,{},now());
    const raw=await fetchBookedTransactions(context.accountUid,{dateFrom:plan.from,dateTo:plan.to,authorize:()=>assertSnapshot(context),deadline:lease.deadline,request:send});
    await verifyRemote();
    await assertAsync();
    const transactions=raw.map(item=>normalizeBankApiTransaction(item,context.reconciliationAccount));
    if(transactions.some(item=>!item||item.booked_at<plan.from||item.booked_at>plan.to))throw companySyncError('IMPORT_FAILED');
    const completed=completeBankSync(plan,now()),content=JSON.stringify({provider:'enablebanking',date_from:plan.from,date_to:plan.to,transactions:raw}),sha256=digest(content);
    const receiptKey='enablebanking:'+digest(JSON.stringify([context.accountKey,plan.from,plan.to,sha256]));
    let committed;
    try{committed=await lease.commitWork({key:receiptKey,sha256,checkpoint:completed.coverage,work:()=>storeTransactions(db,transactions,'enablebanking',{owner,content:Buffer.from(content),mime_type:'application/json'},()=>assertSnapshot(context),result=>{
     assertSnapshot(context);
     db.prepare("UPDATE bank_connections SET encrypted_session=?,last_synced=?,status='connected',last_error='',retry_after=0 WHERE id=? AND owner=?").run(encryptObject(completed.session),completed.coverage.complete?new Date(now()).toISOString():context.connectionLastSynced,context.connectionId,owner);
     audit(db,'bank_synced',{company_id:companyId,connection_id:context.connectionId,date_from:plan.from,date_to:plan.to,received:raw.length,imported:result.imported,duplicate:result.duplicate});
    },work=>work(),(retainRejected,error)=>{error.retainRejected=retainRejected;})});}
    catch(error){
     if(typeof error.retainRejected==='function'){
      await lease.commitWork({key:'rejected:'+receiptKey,sha256,work:error.retainRejected});
      throw companySyncError('IMPORT_IDENTITY_CONFLICT');
     }
     throw error;
    }
    return {complete:completed.coverage.complete,receiptKey,imported:committed.duplicate?0:committed.result.imported,duplicate:committed.duplicate?raw.length:committed.result.duplicate};
   },enrich,reconcile:async({context,lease,assertCurrent:assertAsync})=>{
    // Enrichment can yield after the AIS receipt commits. Recheck the live
    // remote session with another budgeted request immediately before matching.
    // A complete one-page run therefore uses three session reads and one page.
    if(typeof verifyRemote!=='function')fail('AUTHORIZATION_UNVERIFIED');
    await verifyRemote();await assertAsync();
    // The company lease SQL fence is checked synchronously under the engine's
    // BEGIN IMMEDIATE, along with the old bank lease and current authority.
    const guarded=createCompanyReconciler({db,owner,resolveContext:resolve,now,assertCurrent:snapshot=>{
     assertSnapshot(snapshot);const fence=lease.fence();
     // Execute the same trusted facade statement without opening another txn.
     syncResult(database.assert(fence));
    }});
    return guarded({companyId,connectionId:context.connectionId,accountKey:context.accountKey,expectedGeneration:context.generation,expectedRevision:context.revision});
   },
  });
  try{
   const result=await runner.run(request);
   // Share an observed provider embargo with existing manual/legacy paths.
   if(['PROVIDER_429','PROVIDER_UNAVAILABLE','PROVIDER_TIMEOUT','PROVIDER_BUDGET_EXHAUSTED','RETRY_AFTER_UNKNOWN'].includes(result.code)){
    try{legacy.write(()=>{
     const row=db.prepare('SELECT owner FROM bank_connections WHERE id=?').get(request.connectionId);
     if(row?.owner!==owner)return;
     if(result.nextAttemptAt)db.prepare('UPDATE bank_connections SET retry_after=MAX(retry_after,?) WHERE id=? AND owner=?').run(result.nextAttemptAt,request.connectionId,owner);
     if(result.code==='RETRY_AFTER_UNKNOWN')db.prepare("UPDATE integration_jobs SET retry_blocked=1,job_state='blocked',error_code='retry_after_unknown' WHERE name=?").run('bank:'+request.connectionId);
    });}catch{/* The company store remains authoritative if a legacy lease was replaced. */}
   }
   return result;
  }finally{try{legacy.release();}catch{/* Its finite lease expires without changing committed financial evidence. */}}
 }
 const runtime={companyId,owner,store,run,
  async jobs(){const jobs=await listJobs();if(!Array.isArray(jobs))throw TypeError('Company jobs must be an array');return jobs.filter(job=>job?.companyId===companyId).map(job=>({...job}));},
 };
 runtimes.set(runtime,{async scheduledEligibility(job){
  // Refresh a verified generation before reading its durable readiness. This
  // may clear a repaired configuration block, but never a provider embargo.
  const context=await resolve(job);await store.register(context);
  const status=await store.status(context);
  if(status.status==='blocked'||status.status==='running'||status.nextAttemptAt>now())return null;
  return {lastAttemptAt:status.lastAttemptAt??0};
 }});
 return Object.freeze(runtime);
}

/** Called by trusted company setup (Agent 1); never enrolled from user input. */
export function registerCompanyBankSyncRuntime(runtime){
 if(!runtimes.has(runtime)||registered.has(runtime.companyId))throw TypeError('Company runtime must be explicitly created and registered once');
 registered.set(runtime.companyId,runtime);
 return ()=>{if(registered.get(runtime.companyId)===runtime)registered.delete(runtime.companyId);};
}

/** Invoked by the existing Node timer. Durable account claims handle other processes. */
export async function runScheduledCompanyBankSync(){
 if(scheduled)return {results:[],remaining:0};
 scheduled=true;
 try{
  const jobs=[],discovery=[];
  const failed=(runtime,job,error)=>{
   const blocked=blockedDiscoveryCodes.has(error?.code);
   discovery.push({...publicFailure({companyId:runtime.companyId,connectionId:job?.connectionId},blocked?error.code:'COMPANY_DISCOVERY_UNAVAILABLE',blocked?'blocked':'retry',blocked?null:Date.now()+60000),stage:'discovery'});
  };
  for(const runtime of registered.values()){
   let listed;
   try{listed=await runtime.jobs();}catch(error){failed(runtime,null,error);continue;}
   for(const job of listed)try{
    const eligible=await runtimes.get(runtime).scheduledEligibility(job);
    if(eligible)jobs.push({runtime,job,lastAttemptAt:eligible.lastAttemptAt,order:JSON.stringify([runtime.companyId,job.accountKey,job.connectionId])});
   }catch(error){failed(runtime,job,error);}
  }
  // A fixed prefix starves later companies on every tick. Persisted attempts
  // make new/unattempted accounts first and rotate older jobs across restarts.
  jobs.sort((left,right)=>left.lastAttemptAt-right.lastAttemptAt||(left.order<right.order?-1:left.order>right.order?1:0));
  const batch=await runCompanyBankSyncBatch({jobs,maxConcurrent:4,maxJobs:100,run:({runtime,job})=>runtime.run(job)});
  return {...batch,results:[...discovery,...batch.results]};
 }finally{scheduled=false;}
}
