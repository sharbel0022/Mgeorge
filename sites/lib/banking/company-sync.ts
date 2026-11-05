import {db,readWorkspace} from '../server';
import {applyCommand,BankImportEvidenceError,bankImportEvidenceError,prepareBankImportFailure,canonicalBankAccount,emptyState,now,uid} from '../domain';
import {accounts,application,connection,providerConfig,sessionId,withBankLock,type BankConnectionRow,type BankLease} from './store';
import {getSession,getTransactions,ProviderError,providerCooldownDiagnostic,type ProviderPsu} from './enable-banking';
import {guardedBankRead} from './account-read-guard';
import {mergeAccountReadCooldown} from './account-read-cooldown';
import {normalizeTransactions,stableAccountKey} from './transactions';
import {bankSyncRange,fetchBankPeriods,BankPeriodError} from './sync-periods';
import {createHash} from 'node:crypto';
import {createCompanyBankSyncStore,companySyncError,type CompanySyncContext,type CompanySyncGuard,type CompanySyncScope,type CompanyReferencePolicy} from '../company-bank-sync-store.js';
import {createCompanyBankSyncRunner,type CompanySyncSelector,type CompanySyncStage,type CompanySyncResult} from '../company-bank-sync.js';
import {companyBankAccountKey} from '../company-bank-account-key.js';
import {createCompanyReconciler} from '../company-reconciliation';
import {writePaymentState} from '../reconciliation-evidence';

type Context=CompanySyncContext&{scope:CompanySyncScope;referencePolicy:CompanyReferencePolicy|null;reconciliationAccount:string;connectionSnapshot:BankConnectionRow};
/** Agent 1 supplies current membership; the provider/consent adapter supplies
 * current authority and a verified background policy. Nothing here enrolls an
 * arbitrary owner or accepts authority from an HTTP/MCP request. */
export type CompanyBankSyncRuntime={
 jobsForOwner(owner:string):Promise<CompanySyncSelector[]|null>;
 resolveContext(selector:CompanySyncSelector,owner:string):Promise<CompanySyncContext>;
 currentGuard(context:CompanySyncContext):Promise<CompanySyncGuard>|CompanySyncGuard;
 enrich?(stage:CompanySyncStage<Context>):Promise<{state:'verified'|'partial'|'unavailable'}>;
};
let runtime:CompanyBankSyncRuntime|undefined;
export function registerCompanyBankSyncRuntime(value:CompanyBankSyncRuntime){
 if(runtime||!value||typeof value.jobsForOwner!=='function'||typeof value.resolveContext!=='function'||typeof value.currentGuard!=='function')throw new TypeError('Company bank sync requires one trusted server runtime');
 runtime=value;
}
const connectionFields=['id','owner','app_generation','environment','bank_name','country','encrypted_session','encrypted_accounts','selected_accounts','valid_until','date_from','status'] as const;
const sameConnection=(a:BankConnectionRow,b:BankConnectionRow)=>connectionFields.every(key=>a[key]===b[key]);
function fail(code:string):never{throw companySyncError(code);}
const unknownCoverage=()=>({ais:'unknown' as const,bankgiro:'unknown' as const,paymentDataComplete:false as const});
const blocked=(code:string)=>({automatic:true,company:true,status:'blocked',code,imported:0,coverage:unknownCoverage(),results:[]});
const cas=(database:D1Database,owner:string,revision:number)=>database.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND revision=?) THEN 1 ELSE json('WORKSPACE_CHANGED') END").bind(owner,revision);

/** Called by the existing automaticSync entrypoint, not a second scheduler.
 * A durable company binding prevents fallback even after a worker restart
 * where the trusted runtime is unavailable. Unbound legacy owners are unchanged. */
export async function dispatchCompanyAutomaticSync(owner:string,options:{psu?:ProviderPsu;nextAutomaticAttempt:(at?:number)=>string}){
 const database=db();
 let bound:{company_id:string}|null;
 try{bound=await database.prepare('SELECT company_id FROM company_bank_sync_scopes WHERE owner=?').bind(owner).first<{company_id:string}>();}
 catch(error){if(error instanceof Error&&/no such table:\s*(?:main\.)?company_bank_sync_scopes\b/i.test(error.message))return runtime?blocked('COMPANY_SCOPE_MISMATCH'):null;throw error;}
 const adapter=runtime;
 if(!adapter)return bound?blocked('AUTHORIZATION_UNVERIFIED'):null;
 let jobs:CompanySyncSelector[]|null;
 try{jobs=await adapter.jobsForOwner(owner);}catch{return blocked('AUTHORIZATION_UNVERIFIED');}
 if(!bound)return jobs===null?null:blocked('COMPANY_SCOPE_MISMATCH');
 if(!Array.isArray(jobs)||!jobs.length)return blocked('AUTHORIZATION_UNVERIFIED');
 if(jobs.some(job=>!job||job.companyId!==bound.company_id)||new Set(jobs.map(job=>job.accountKey)).size!==jobs.length)return blocked('COMPANY_SCOPE_MISMATCH');
 try{return await withBankLock(owner,async ownerLease=>{
  const initial=await connection(owner);
  if(!initial||initial.status!=='connected')return blocked('AUTHORIZATION_UNVERIFIED');
  if(initial.auto_sync_enabled!==1)return {...blocked('JOB_BLOCKED'),due:false,reason:'disabled'};
  if(initial.sync_failures>=3)return {...blocked('JOB_BLOCKED'),due:false,reason:'blocked'};
  const scheduled=initial.auto_next_at&&initial.auto_last_attempt_at?Date.parse(options.nextAutomaticAttempt(Date.parse(initial.auto_last_attempt_at))):0;
  const due=Math.max(scheduled,Date.parse(initial.retry_after||'')||0,initial.last_synced_at?(Date.parse(initial.last_synced_at)||0)+60000:0);
  if(due>Date.now())return {automatic:true,company:true,status:'retry',code:'RETRY_NOT_DUE',due:false,reason:'not_due',nextAttemptAt:new Date(due).toISOString(),imported:0,results:[]};
  const lock=await database.prepare('SELECT token FROM bank_locks WHERE owner=?').bind(owner).first<{token:string}>();
  if(!lock)fail('LEASE_LOST');
  const store=createCompanyBankSyncStore(database);let reserved=false;
  const resolve=async(selector:CompanySyncSelector):Promise<Context>=>{
   const current=await adapter.resolveContext(selector,owner);
   if(current.owner!==owner||current.companyId!==bound.company_id||current.provider!=='enable-banking')fail('COMPANY_SCOPE_MISMATCH');
   const [conn,app,scope,referencePolicy]=await Promise.all([connection(owner),application(owner),store.scope(current),store.referencePolicy(current)]);
   if(!conn||!app||conn.id!==current.connectionId||conn.owner!==owner||app.owner!==owner||conn.app_generation!==app.generation||conn.status!=='connected'||conn.environment!=='PRODUCTION'||Date.parse(conn.valid_until)<=Date.now()||Date.parse(current.validUntil)>Date.parse(conn.valid_until))fail('AUTHORIZATION_UNVERIFIED');
   if(await sessionId(conn)!==current.consentId)fail('AUTHORIZATION_CHANGED');
   const selected:unknown=JSON.parse(conn.selected_accounts);
   if(!Array.isArray(selected)||new Set(selected).size!==selected.length||!selected.includes(current.accountUid))fail('ACCOUNT_MISMATCH');
   const available=await accounts(conn),matches=available.filter(item=>item.uid===current.accountUid);
   if(matches.length!==1)fail('ACCOUNT_MISMATCH');
   const account=matches[0];
   const key=account&&stableAccountKey(account,{name:conn.bank_name,country:conn.country});
   if(!account||account.currency!=='SEK'||!key)fail('ACCOUNT_MISMATCH');
   const reconciliationAccount=canonicalBankAccount(key);
   if(current.accountKey!==companyBankAccountKey({provider:current.provider,bank:conn.bank_name,country:conn.country,accountIdentity:reconciliationAccount}))fail('ACCOUNT_MISMATCH');
   return {...current,scope,referencePolicy,reconciliationAccount,connectionSnapshot:{...conn}};
  };
  const results:CompanySyncResult[]=[];
  for(const selector of jobs.slice(0,100)){
   let checkRemote:(()=>Promise<void>)|undefined;
   const runner=createCompanyBankSyncRunner<Context>({
    store,resolveContext:resolve,currentGuard:context=>adapter.currentGuard(context),
    async sync(stage){
     const {context,lease}=stage,conn=context.connectionSnapshot,scope=context.scope,policy=JSON.stringify(context.referencePolicy),scopeSnapshot=JSON.stringify(scope);
     lease.addGuard({
      async assert(){
       await ownerLease.assert();
       const current=await connection(owner);
       if(!current||!sameConnection(current,conn))fail('AUTHORIZATION_CHANGED');
       if(JSON.stringify(await store.scope(context))!==scopeSnapshot)fail('COMPANY_SCOPE_MISMATCH');
       if(JSON.stringify(await store.referencePolicy(context))!==policy)fail('REFERENCE_POLICY_CHANGED');
      },
      fence(){return database.prepare(`SELECT CASE WHEN
       EXISTS(SELECT 1 FROM bank_locks WHERE owner=? AND token=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       AND EXISTS(SELECT 1 FROM bank_connections WHERE ${connectionFields.map(key=>key+'=?').join(' AND ')} AND julianday(valid_until)>julianday('now'))
       AND EXISTS(SELECT 1 FROM company_bank_sync_scopes WHERE company_id=? AND owner=? AND revision=? AND evidence_id=? AND reference_policy IS ?)
       THEN 1 ELSE json('AUTHORIZATION_CHANGED') END`).bind(owner,lock.token,...connectionFields.map(key=>conn[key]),context.companyId,owner,scope.revision,scope.evidenceId,context.referencePolicy?policy:null);},
     });
     const guardedLease:BankLease={assert:stage.assertCurrent,write:async statements=>await lease.write(statements) as D1Result[],run:async statement=>(await lease.write([statement]))[0] as D1Result};
     const jobId=uid();
     if(!reserved){await lease.write([database.prepare("UPDATE bank_connections SET auto_last_attempt_at=?,auto_next_at=?,sync_failures=sync_failures+1,last_error='Företagets bankhämtning väntar på ett bekräftat resultat.' WHERE owner=? AND id=?").bind(now(),options.nextAutomaticAttempt(),owner,conn.id)]);reserved=true;}
     await lease.write([database.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,COALESCE((SELECT revision FROM workspaces WHERE owner=?),0),?,?,?').bind(uid(),owner,owner,'bank.job.started',JSON.stringify({run_id:jobId,mode:'company',companyId:context.companyId}),now())]);
     const app=await application(owner);if(!app)fail('AUTHORIZATION_UNVERIFIED');
     const config=await providerConfig(app),remoteSession=await sessionId(conn);
     let remoteExpiry=Math.min(Date.parse(context.validUntil),Date.parse(conn.valid_until));
     lease.addGuard({assert(){if(Date.now()>=remoteExpiry)fail('CONSENT_EXPIRED');},fence(){return database.prepare("SELECT CASE WHEN julianday(?)>julianday('now') THEN 1 ELSE json('CONSENT_EXPIRED') END").bind(new Date(remoteExpiry).toISOString());}});
     const read=<T>(operation:()=>Promise<T>)=>stage.request(async({signal})=>guardedBankRead(owner,conn,guardedLease,async()=>{if(signal.aborted)fail('PROVIDER_TIMEOUT');const result=await operation();if(signal.aborted)fail('PROVIDER_TIMEOUT');return result;}));
     checkRemote=async()=>{
      const live=await read(()=>getSession(config,remoteSession)),expiry=Date.parse(live.access.valid_until);
      // The official Access schema permits an omitted transactions flag. The
      // trusted VERIFIED context grants this read; omission is not a new grant.
      if(live.status!=='AUTHORIZED'||!Number.isFinite(expiry)||expiry<=Date.now()||live.aspsp.name!==conn.bank_name||live.aspsp.country!==conn.country||live.psu_type!=='business'||!live.accounts.includes(context.accountUid)||live.access.transactions!==undefined&&live.access.transactions!==true)fail('AUTHORIZATION_CHANGED');
      remoteExpiry=Math.min(remoteExpiry,expiry);await stage.assertCurrent();
     };
     try{
      await checkRemote();
      const previous=await store.status(context),checkpoint=previous?.checkpoint as {lastSyncedAt?:string;configuredDateFrom?:string}|null;
      // Connection.last_synced_at is shared by selected accounts. Only this
      // account's durable successful checkpoint may narrow its import history.
      const range=bankSyncRange(conn.date_from,checkpoint?.configuredDateFrom===conn.date_from?checkpoint.lastSyncedAt??null:null);
      const periods=await fetchBankPeriods({ ...range,budget:{requests:0,rows:0},authorize:stage.assertCurrent,isPeriodError:error=>error instanceof ProviderError&&error.code==='BANK_PERIOD_UNAVAILABLE',fetchPage:input=>read(()=>getTransactions(config,context.accountUid,{...input,psu:options.psu})) });
      const rows:Record<string,unknown>[]=[],warnings=new Set<string>();let skipped=0;
      for(const period of periods){
       const normalized=await normalizeTransactions(period.transactions,{accountKey:context.reconciliationAccount,accountLabel:'Företagets valda konto',bankName:conn.bank_name,dateFrom:period.dateFrom,dateTo:period.dateTo});
       if(normalized.skipped.invalid)throw new BankPeriodError('BANK_INCOMPLETE_RESPONSE','Bankens bokförda uppgifter är ofullständiga. Perioden behöver hämtas igen.');
       rows.push(...normalized.rows);skipped+=normalized.skipped.pending+normalized.skipped.nonSek;normalized.warnings.forEach(warning=>warnings.add(warning));
      }
      // Revocation at the provider during pagination cannot be detected from
      // local state. Validate the remote consent again before accepting data.
      await checkRemote();await stage.assertCurrent();
      const old=await readWorkspace(owner),at=now();
      const candidates=rows.filter(row=>{const existing=old.state.transactions.find(item=>canonicalBankAccount(item.account)===canonicalBankAccount(String(row.account||''))&&item.externalId&&item.externalId===row.externalId);return !(existing?.ignored&&existing.amount===row.amount&&existing.date===row.date&&existing.currency===row.currency);});
      let state=old.state;
      try{
       if(candidates.length)state=applyCommand(old.state,{type:'transactions.import',trustedBankImport:true,rows:candidates,account:'Enable Banking',name:`${conn.bank_name} · bankhämtning ${range.dateFrom}–${range.dateTo}`}).state;
       const conflict=bankImportEvidenceError(old.state,state,'Bankens original innehåller motstridiga uppgifter. Granska underlaget före nästa import.');
       if(conflict)throw conflict;
       if(new TextEncoder().encode(JSON.stringify(state)).length>1800000)throw bankImportEvidenceError(old.state,state,'Registret behöver utökad lagring.')||companySyncError('IMPORT_FAILED');
      }catch(error){
       if(error instanceof BankImportEvidenceError){
        const eventId=uid(),prepared=await prepareBankImportFailure(old.state,error.state,eventId);
        if(!prepared.replayed)await lease.write([cas(database,owner,old.revision),database.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(eventId,owner,old.revision+1,'bank.sync_rejected',JSON.stringify({message:error.message,connectionId:conn.id,retained_conflicts:prepared.conflicts,compact_hold:prepared.compact}),at),database.prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=?').bind(prepared.payload,at,owner,old.revision)]);
        fail('IMPORT_IDENTITY_CONFLICT');
       }
       throw error;
      }
      const imported=state.transactions.length-old.state.transactions.length,duplicate=rows.length-imported;
      const sha256=createHash('sha256').update(JSON.stringify(['company-ais-v1',context.companyId,context.accountKey,range,rows])).digest('hex');
      const receiptKey='ais-v1:'+sha256,auditId=uid();
      const priorReceipt=await store.receipt(context,receiptKey);
      warnings.add('AIS bekräftar inte fullständig Bankgiroinformation eller betalningsreferenser.');
      const successfulConnection=()=>database.prepare("UPDATE bank_connections SET last_synced_at=CASE WHEN json_array_length(selected_accounts)=1 THEN ? ELSE last_synced_at END,last_error=NULL,retry_after='',sync_failures=0,updated_at=? WHERE owner=? AND id=?").bind(at,at,owner,conn.id);
      const statements=[database.prepare('INSERT OR IGNORE INTO workspaces(owner,revision,payload,updated_at) VALUES(?,0,?,?)').bind(owner,JSON.stringify(emptyState()),at),cas(database,owner,old.revision)];
      if(state!==old.state)statements.push(database.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(auditId,owner,old.revision+1,'bank.sync',JSON.stringify({companyId:context.companyId,connectionId:conn.id,from:range.dateFrom,to:range.dateTo,imported,skipped:skipped+duplicate}),at),database.prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=?').bind(JSON.stringify(state),at,owner,old.revision));
      statements.push(database.prepare('INSERT INTO bank_sync_runs(id,owner,connection_id,imported,skipped,warnings,test,created_at) VALUES(?,?,?,?,?,?,0,?)').bind(jobId,owner,conn.id,imported,skipped+duplicate,JSON.stringify([...warnings]),at),successfulConnection(),database.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,revision,?,?,? FROM workspaces WHERE owner=?').bind(uid(),owner,'bank.job.completed',JSON.stringify({run_id:jobId,mode:'company',companyId:context.companyId}),at,owner));
      await stage.assertCurrent();
      const committed=await lease.commit({key:receiptKey,sha256,statements,result:{imported,duplicate},checkpoint:{...range,configuredDateFrom:conn.date_from,lastSyncedAt:at}});
      if(priorReceipt)await lease.write([successfulConnection(),database.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,revision,?,?,? FROM workspaces WHERE owner=?').bind(uid(),owner,'bank.job.completed',JSON.stringify({run_id:jobId,mode:'company',companyId:context.companyId,receipt_key:receiptKey,replayed:true}),at,owner)]);
      return {complete:true,receiptKey,imported:priorReceipt?0:committed.result.imported,duplicate:priorReceipt?rows.length:committed.result.duplicate};
     }catch(error){
      // Preserve supplier backoff in the legacy connection as well. Never clear
      // the independent account-evidence uncertainty marker on an AIS success.
      if(error instanceof ProviderError&&(error.status===429||error.retryAfter!==undefined||error.retryBlocked)){
       const current=await connection(owner),retry=error.retryBlocked?'9999-12-31T23:59:59.999Z':new Date(Date.now()+Math.max(60,error.retryAfter||60)*1000).toISOString();
       if(current)try{await lease.write([database.prepare('UPDATE bank_connections SET retry_after=?,account_evidence_retry=?,last_error=? WHERE owner=? AND id=?').bind(retry,mergeAccountReadCooldown(current.account_evidence_retry,providerCooldownDiagnostic(error)),'Bankens väntetid måste respekteras innan nästa försök.',owner,conn.id)]);}catch{ /* Shared coordinator also persists the embargo; stale authority cannot write. */ }
      }
      throw error;
     }
    },
    enrich:adapter.enrich,
    async reconcile(stage){
     const old=await readWorkspace(owner),reconcile=createCompanyReconciler({owner,resolveContext:()=>resolve(selector),assertCurrent:stage.assertCurrent});
     const result=await reconcile({companyId:stage.context.companyId,connectionId:stage.context.connectionId,expectedGeneration:stage.context.generation,expectedRevision:stage.context.revision},old.state);
     if(result.status!=='completed')return {status:result.status==='stale'?'stale' as const:'held' as const,applied:0,review:result.review};
     if(!result.decisions.length)return {status:'completed' as const,applied:result.applied,review:result.review};
     if(new TextEncoder().encode(JSON.stringify(result.state)).length>1800000)return {status:'held' as const,applied:0,review:result.review};
     if(!checkRemote)fail('AUTHORIZATION_UNVERIFIED');await checkRemote();await stage.assertCurrent();
     // writePaymentState retains its original/source/consent fences. Its batch
     // joins the account lease, owner lock and exact scope/policy SQL guards.
     const fencedDatabase={prepare:database.prepare.bind(database),batch:async(statements:D1PreparedStatement[])=>await stage.lease.write(statements) as D1Result[]} as D1Database;
     await writePaymentState(owner,old.revision,old.state,result.state,fencedDatabase,[cas(database,owner,old.revision),database.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),owner,old.revision+1,'automatic.reconciliation',JSON.stringify({companyId:stage.context.companyId,decisions:result.decisions}),now()),database.prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=?').bind(JSON.stringify(result.state),now(),owner,old.revision)]);
     return {status:'completed' as const,applied:result.applied,review:result.review};
    },
   });
   results.push(await runner.run(selector));
  }
  const status=results.some(row=>row.status==='blocked')?'blocked':results.some(row=>row.status==='retry')?'retry':results.some(row=>row.status==='partial')?'partial':'success';
  return {automatic:true,company:true,status,imported:results.reduce((total,row)=>total+row.imported,0),results,remaining:Math.max(0,jobs.length-results.length)};
 });}catch(error){
  if(error instanceof Error&&['BANK_BUSY','BANK_LEASE_LOST'].includes(error.message))return {automatic:true,company:true,status:'retry',code:'ACCOUNT_BUSY',imported:0,results:[]};
  return blocked('AUTHORIZATION_UNVERIFIED');
 }
}
