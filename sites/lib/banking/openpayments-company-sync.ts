import {db,identity,currentCompanyContext,withCompanyOwner,readWorkspace} from '../server';
import {applyCommand,bankImportEvidenceError,prepareBankImportFailure,type State} from '../domain';
import {reconciliationPreviewWithOriginals} from '../reconciliation-evidence';
import {createCompanyBankSyncStore,companySyncError,type CompanySyncContext,type CompanyReferencePolicy} from '../company-bank-sync-store.js';
import {createCompanyBankSyncRunner,type CompanySyncStage,type CompanySyncSelector} from '../company-bank-sync.js';
import {companyBankAccountKey} from '../company-bank-account-key.js';
import {companyReferencePolicyFromWorkspace} from '../company-reconciliation-policy.js';
import type {CompanyContext} from '../company-contract.js';
import type {OpenPaymentsOptions} from './openpayments-provider.js';
import {saasBankSnapshot,saasBankSyncContext,saasBankSyncConfiguration} from './saas-runtime';
import {enrichOpenPaymentsCompany} from './openpayments-company-enrichment';
import {normalizeOpenPaymentsWorkspaceRows,openPaymentsAccountIdentity} from './openpayments-normalization.js';
function fail(code:string):never{throw companySyncError(code);}
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
type Configuration={enabled:boolean;credentialGeneration:string;serviceEnabled?:boolean;companyId:string;owner:string;bankId:string;evidenceId:string;dateFrom:string;automaticEnabled:boolean;configurationHash:string;bankgiroRegistration:unknown;stored:Record<string,any>|null};
type ScopedContext=CompanySyncContext&{statePayload:string;configurationHash:string};
type Resolution={context:CompanySyncContext;account:{id?:string;handle:string;identity:Record<string,string>};provider:any;verifyConsent():Promise<void>;assertCurrent():Promise<void>};
export type OpenPaymentsSyncDependencies={database:D1Database;context:Readonly<CompanyContext>;assertCurrent():Promise<void>;configuration():Promise<Configuration>;snapshot():Promise<Record<string,any>>;resolve(accountId:string,options:OpenPaymentsOptions):Promise<Resolution>;readWorkspace(owner:string):Promise<{revision:number;state:State}>;preview(owner:string,state:State):Promise<unknown>;enrich?(stage:CompanySyncStage<ScopedContext>,input:{resolved:Resolution;transactions:any;acquisitionId:string;registration:unknown}):Promise<{state:'verified'|'partial'|'unavailable'}>;now?:()=>number};
/** Concrete shared-runner composition. Reads never register jobs or call banks.
 * Only current membership and retained provider consent can resolve an account. */
export function createSitesOpenPaymentsCompanySync(deps:OpenPaymentsSyncDependencies){
 const {database,context}=deps,owner=context.storageOwner,companyId=context.companyId,clock=deps.now??Date.now;
 const store=createCompanyBankSyncStore(database,{now:clock});
 const state=()=>database.prepare('SELECT revision,payload FROM saas_bank_state WHERE owner=?').bind(owner).first<{revision:number;payload:string}>();
 const cas=(revision:number)=>database.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND revision=?) THEN 1 ELSE json('WORKSPACE_CHANGED') END").bind(owner,revision);
 async function configuration(){await deps.assertCurrent();const c=await deps.configuration();if(c.owner!==owner||c.companyId!==companyId)fail('COMPANY_SCOPE_MISMATCH');return c;}
 async function readStatus(accountId:string){
  const c=await configuration(),before=await state(),snapshot=await deps.snapshot(),account=c.stored?.accounts?.find((item:{id:string})=>item.id===accountId);
  if(!before||!account||!c.stored?.selected?.includes(accountId))fail('ACCOUNT_MISMATCH');
  const key=companyBankAccountKey({provider:'open_payments',bank:c.bankId,country:'SE',accountIdentity:openPaymentsAccountIdentity(account.identity)});
  const binding=await database.prepare('SELECT company_id FROM company_bank_sync_scopes WHERE owner=?').bind(owner).first<{company_id:string}>();
  if(binding&&binding.company_id!==companyId)fail('COMPANY_SCOPE_MISMATCH');
  const saved=binding?await store.status({companyId,owner,accountKey:key}):null;
  const authority=binding?await database.prepare('SELECT connection_id,authority_revision FROM company_bank_sync_jobs WHERE company_id=? AND owner=? AND account_key=?').bind(companyId,owner,key).first<{connection_id:string;authority_revision:number}>():null,currentAuthority=!!authority&&authority.connection_id===snapshot.connection?.id&&authority.authority_revision===before.revision;
  const after=await state();await deps.assertCurrent();if(!after||after.revision!==before.revision||after.payload!==before.payload||(await configuration()).configurationHash!==c.configurationHash)fail('AUTHORIZATION_CHANGED');
  const serviceEnabled=c.serviceEnabled??c.enabled,generationCurrent=!!c.credentialGeneration&&c.stored?.generation===c.credentialGeneration,active=serviceEnabled&&generationCurrent&&snapshot.connection?.status==='active'&&Date.parse(snapshot.connection.validUntil)>clock();
  return{companyId,connectionId:snapshot.connection?.id??null,accountId,accountKey:key,state:!active?'blocked':!currentAuthority?'never':saved?.status==='running'?'running':saved?.status==='success'?'succeeded':saved?.status==='blocked'?'blocked':saved?'failed':'never',automaticEnabled:active&&c.automaticEnabled,lastSuccessAt:saved?.lastSuccessAt?new Date(saved.lastSuccessAt).toISOString():null,nextAllowedAt:saved?.nextAttemptAt?new Date(saved.nextAttemptAt).toISOString():null,errorCode:!serviceEnabled?'configuration_required':!generationCurrent?'configuration_changed':!active?'consent_expired':!currentAuthority?null:saved?.code?.toLowerCase()??null,coverage:active&&currentAuthority&&saved?.coverage?saved.coverage:{ais:'unknown',bankgiro:'unknown',paymentDataComplete:false}};
 }
 async function run(accountId:string,expected:{connectionId?:string;expectedRevision?:number}={}){
  if(!['owner','admin'].includes(context.role))fail('AUTHORIZATION_UNVERIFIED');
  const c=await configuration();if(!c.enabled||!c.evidenceId)fail('AUTHORIZATION_UNVERIFIED');
  await store.bindScope({companyId,owner,evidenceId:c.evidenceId});
  const initialWorkspace=await deps.readWorkspace(owner),policy=(companyReferencePolicyFromWorkspace as (context:Readonly<CompanyContext>,state:State,previous:CompanyReferencePolicy|null)=>CompanyReferencePolicy|null)(context,initialWorkspace.state,await store.referencePolicy({companyId,owner}));if(policy)await store.setReferencePolicy(policy);
  let activeStage:CompanySyncStage<ScopedContext>|undefined;
  const providerOptions:OpenPaymentsOptions={requestBoundary:operation=>{if(!activeStage)return Promise.reject(companySyncError('AUTHORIZATION_UNVERIFIED'));return activeStage.request(operation);}};
  const resolve=async():Promise<{resolved:Resolution;context:ScopedContext}>=>{
   const before=await state();if(!before)fail('AUTHORIZATION_UNVERIFIED');const currentConfig=await configuration();if(currentConfig.configurationHash!==c.configurationHash)fail('AUTHORIZATION_CHANGED');
   const resolved=await deps.resolve(accountId,providerOptions),key=companyBankAccountKey({provider:'open_payments',bank:c.bankId,country:'SE',accountIdentity:openPaymentsAccountIdentity(resolved.account.identity)});
   if(resolved.context.companyId!==companyId||resolved.context.owner!==owner||resolved.context.provider!=='open_payments'||resolved.context.revision!==before.revision)fail('COMPANY_SCOPE_MISMATCH');
   const after=await state();if(!after||after.revision!==before.revision||after.payload!==before.payload)fail('AUTHORIZATION_CHANGED');
   return{resolved,context:{...resolved.context,accountKey:key,statePayload:before.payload,configurationHash:c.configurationHash}};
  };
  const first=await resolve();
  if(expected.connectionId!==undefined&&expected.connectionId!==first.context.connectionId)fail('ACCOUNT_MISMATCH');
  const selector:CompanySyncSelector={companyId,connectionId:first.context.connectionId,accountKey:first.context.accountKey,...(expected.expectedRevision===undefined?{}:{expectedRevision:expected.expectedRevision})};
  let fetched:any,resolved:Resolution|undefined,acquisitionId='';
  const runner=createCompanyBankSyncRunner<ScopedContext>({store,now:clock,resolveContext:async()=> (await resolve()).context,currentGuard:current=>({
   async assert(){await deps.assertCurrent();const row=await state();if(!row||row.revision!==current.revision||row.payload!==current.statePayload||(await configuration()).configurationHash!==current.configurationHash||Date.parse(current.validUntil)<=clock())fail('AUTHORIZATION_CHANGED');},
   fence(){return database.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM saas_bank_state WHERE owner=? AND revision=? AND payload=?) AND julianday(?)>julianday('now') THEN 1 ELSE json('AUTHORIZATION_CHANGED') END").bind(owner,current.revision,current.statePayload,current.validUntil);},
  }),async sync(stage){
   activeStage=stage;resolved=(await resolve()).resolved;await resolved.verifyConsent();await stage.assertCurrent();
   const dateTo=new Date(clock()).toISOString().slice(0,10),dateFrom=c.dateFrom;if(dateFrom>dateTo)fail('IMPORT_FAILED');
   fetched=await resolved.provider.getTransactions(resolved.account.handle,{dateFrom,dateTo,requireBankgiro:false});await resolved.verifyConsent();await stage.assertCurrent();
   if(!Array.isArray(fetched.originals)||!fetched.originals.length||fetched.paymentReconciliationAllowed!==false)fail('IMPORT_FAILED');
   for(const original of fetched.originals){if(original.provider!=='open_payments'||original.binding?.companyId!==companyId||original.binding.owner!==owner||original.binding.connectionId!==stage.context.connectionId||original.binding.generation!==stage.context.generation||original.bankDataSha256!==await hash(JSON.stringify(original.bankData))||!original.rawResponse||original.rawResponse.sha256!==await hash(original.rawResponse.body))fail('IMPORT_IDENTITY_CONFLICT');}
   const envelope=JSON.stringify({version:'openpayments-company-original-v1',companyId,accountKey:stage.context.accountKey,dateFrom,dateTo,originals:fetched.originals,bankgiro:fetched.bankgiro,bankgiroEvidence:fetched.bankgiroEvidence});
   if(new TextEncoder().encode(envelope).length>1800000)fail('IMPORT_FAILED');
   const sha256=await hash(envelope);acquisitionId=crypto.randomUUID();const at=new Date(clock()).toISOString(),receiptKey='openpayments:'+sha256;
   const account=openPaymentsAccountIdentity(resolved.account.identity),old=await deps.readWorkspace(owner);
   let rows:ReturnType<typeof normalizeOpenPaymentsWorkspaceRows>;try{rows=normalizeOpenPaymentsWorkspaceRows(fetched.booked,{account,dateFrom,dateTo});}catch(error){
    await stage.lease.write([cas(old.revision),database.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(acquisitionId,owner,old.revision,'openpayments.invalid_original',envelope,at)]);fail('IMPORT_FAILED');
   }
   let next=old.state;for(let n=0;n<rows.length;n+=1000)next=applyCommand(next,{type:'transactions.import',trustedBankImport:true,rows:rows.slice(n,n+1000),name:'Open Payments företagskonto'}).state;
   const conflict=bankImportEvidenceError(old.state,next,'Open Payments-underlaget innehåller motstridiga bankuppgifter.');
   if(new TextEncoder().encode(JSON.stringify(next)).length>1800000)fail('IMPORT_FAILED');
   if(conflict){const held=await prepareBankImportFailure(old.state,conflict.state,acquisitionId);await stage.lease.write([cas(old.revision),database.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(acquisitionId,owner,old.revision+1,'openpayments.sync_rejected',envelope,at),database.prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=?').bind(held.payload,at,owner,old.revision)]);fail('IMPORT_IDENTITY_CONFLICT');}
   const imported=next.transactions.length-old.state.transactions.length,duplicate=rows.length-imported;
   const committed=await stage.lease.commit({key:receiptKey,sha256,checkpoint:{dateFrom,dateTo,complete:true},statements:[cas(old.revision),database.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(acquisitionId,owner,old.revision+1,'openpayments.original',envelope,at),database.prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=?').bind(JSON.stringify(next),at,owner,old.revision)],result:{imported,duplicate}});
   return{complete:true,receiptKey,imported:committed.duplicate?0:committed.result.imported,duplicate:committed.duplicate?rows.length:committed.result.duplicate};
  },async enrich(stage){if(!resolved)fail('AUTHORIZATION_UNVERIFIED');return deps.enrich?deps.enrich(stage,{resolved,transactions:fetched,acquisitionId,registration:c.bankgiroRegistration}):{state:'unavailable'};},async reconcile(stage){await stage.assertCurrent();const current=await deps.readWorkspace(owner);await deps.preview(owner,current.state);await stage.assertCurrent();return{status:'completed',applied:0};}});
  return runner.run(selector);
 }
 return{run,status:readStatus,async selected(){return(await deps.snapshot()).accounts.filter((a:{selected:boolean;importable:boolean})=>a.selected&&a.importable).map((a:{id:string})=>a.id);},async scheduled(){const c=await configuration();if(!c.automaticEnabled)return{disabled:true,results:[]};const results=[];for(const id of await this.selected()){const saved=await readStatus(id);if(saved.state==='running'||saved.state==='blocked'||saved.nextAllowedAt&&Date.parse(saved.nextAllowedAt)>clock())continue;results.push(await run(id));}return{results};}};
}
export async function sitesOpenPaymentsCompanySync(request:Request,companyId:string){
 const user=await identity(request.method==='GET'?undefined:request),context=currentCompanyContext();if(!context||context.companyId!==companyId||context.storageOwner!==user.userId)fail('COMPANY_SCOPE_MISMATCH');
 return createSitesOpenPaymentsCompanySync({database:db(),context,assertCurrent:async()=>{await identity();},configuration:()=>saasBankSyncConfiguration(request,companyId),snapshot:()=>saasBankSnapshot(request,companyId),resolve:(accountId,options)=>withCompanyOwner(user.userId,'manage_integrations',()=>saasBankSyncContext(request,companyId,accountId,options)),readWorkspace,preview:reconciliationPreviewWithOriginals,enrich:enrichOpenPaymentsCompany});
}
