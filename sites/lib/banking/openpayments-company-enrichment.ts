import {db} from '../server';
import {createBankgiroIngest} from '../bankgiro-ingest.js';
import {createBankgiroIngestStore} from '../bankgiro-ingest-store.js';
import {createSitesBankgiroSink} from '../bankgiro-ingest-service';
import {createOpenPaymentsBankgiroCaptureFromProvider,assertOpenPaymentsBankgiroAuthority} from '../bankgiro-openpayments-capture.js';
import type {CompanySyncStage} from '../company-bank-sync.js';
import type {CompanySyncContext} from '../company-bank-sync-store.js';
import type {ProviderBinding} from './bank-data-provider.js';
import type {OpenPaymentsOriginal} from './openpayments-provider.js';

type Input={resolved:{provider:{binding:Readonly<ProviderBinding>};account:{identity:Record<string,string>};verifyConsent():Promise<void>};transactions:{originals:OpenPaymentsOriginal[]};acquisitionId:string;registration:any};
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=300&&!/[\u0000-\u001f\u007f]/.test(value);
const unavailable=()=>({state:'unavailable' as const});

/** Join a server-attested report agreement to the existing durable intake.
 * A successful AIS response cannot create this agreement or account binding.
 * No request fields or captured JSON can register or replace a source. */
export async function enrichOpenPaymentsCompany(stage:CompanySyncStage<CompanySyncContext&{statePayload:string}>,input:Input){
 const r=input.registration,c=stage.context,binding=input.resolved.provider.binding,identity=input.resolved.account.identity;
 if(!r||r.verified!==true||r.enabled!==true||r.origin!=='provider_authorization'||r.companyId!==c.companyId||r.owner!==c.owner||!text(r.id)||!text(r.scopeId)||!text(r.generation)||!text(r.evidenceId)||!text(r.accountId)||!Number.isSafeInteger(r.configurationRevision)||r.configurationRevision<1||r.profileId!=='openpayments-bankgiro-v1'||!Array.isArray(r.capabilities)||!['bankgiro_reports:read','accountinformation','bankgiroinformation','corporate'].every(scope=>r.capabilities.includes(scope))||!/^\d{4,10}$/.test(r.bankgiro)||!text(r.iban)||r.iban!==identity.iban||!Number.isFinite(Date.parse(r.validUntil))||Date.parse(r.validUntil)<=Date.now())return unavailable();
 // The registration, selected provider resource and received raw pages must all
 // identify the same account. A displayed Bankgiro or matching sum is insufficient.
 const captured=createOpenPaymentsBankgiroCaptureFromProvider({context:{owner:c.owner,companyId:c.companyId,sourceId:r.id,scopeId:r.scopeId,accountId:r.accountId,iban:r.iban,bankgiro:r.bankgiro},captureId:input.acquisitionId,originals:input.transactions.originals,binding});
 const database=db();
 const fences=()=>[stage.lease.fence(),database.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM saas_bank_state WHERE owner=? AND revision=? AND payload=?) AND julianday(?)>julianday('now') THEN 1 ELSE json('AUTHORIZATION_CHANGED') END").bind(c.owner,c.revision,c.statePayload,c.validUntil)];
 const assert=async()=>{await stage.assertCurrent();};
 // All intake state, originals and financial writes join the same current
 // consent and job fences, including writes performed by the intake store.
 const originals=new WeakMap<object,D1PreparedStatement>();
 function wrapped(statement:D1PreparedStatement):D1PreparedStatement{
  const proxy={bind(...values:unknown[]){return wrapped(statement.bind(...values));},async first(column?:string){await assert();return column?statement.first(column):statement.first();},async all(){await assert();return statement.all();},async run(){await assert();return(await stage.lease.write([statement]))[0];}} as D1PreparedStatement;
  originals.set(proxy,statement);return proxy;
 }
 const guardedDatabase={prepare:(sql:string)=>wrapped(database.prepare(sql)),async batch(statements:D1PreparedStatement[]){await assert();return stage.lease.write(statements.map(statement=>originals.get(statement)??statement)) as Promise<D1Result[]>;}} as D1Database;
 const validUntil=new Date(Math.min(Date.parse(r.validUntil),Date.parse(c.validUntil))).toISOString();
 const source={id:r.id,mode:'production',configurationValid:true,registration:{...r,allowedFormats:['opbg.json']},intervalMinutes:1,
  async authorize({owner}:{owner:string}){
   if(owner!==c.owner)throw Object.assign(Error('AUTHORIZATION_BLOCKED'),{code:'AUTHORIZATION_BLOCKED'});
   await assert();await input.resolved.verifyConsent();await assert();
   const authorization={status:'VERIFIED',origin:'provider_authorization',owner:c.owner,companyId:c.companyId,sourceId:r.id,scopeId:r.scopeId,generation:r.generation,evidenceId:r.evidenceId,profileId:r.profileId,accountId:r.accountId,iban:r.iban,bankgiro:r.bankgiro,capabilities:[...r.capabilities],checkedAt:new Date().toISOString(),validUntil};
   return assertOpenPaymentsBankgiroAuthority(captured,authorization,{owner:c.owner,companyId:c.companyId,sourceId:r.id,scopeId:r.scopeId});
  },
  async listReports(){await assert();return{reports:[{reportId:captured.reportId,filename:captured.filename,sha256:captured.sha256,availableAt:new Date().toISOString()}],nextCursor:null};},
  async fetchReport(){await assert();return captured.bytes.slice();},
 };
 const retainedSink=createSitesBankgiroSink({companyGuard:{companyId:c.companyId,owner:c.owner,assert,fences}});
 // Intake prepares its lease through the guarded adapter. The financial sink
 // batches directly through the scoped D1 adapter, which must receive the
 // underlying scoped statement while retaining the identical lease predicate.
 function scopedLease<T extends {lease:{fence():D1PreparedStatement}}>(input:T):T{return{...input,lease:{...input.lease,fence(){const statement=input.lease.fence();return originals.get(statement)??statement;}}};}
 const sink={retain:(input:Parameters<typeof retainedSink.retain>[0])=>retainedSink.retain(scopedLease(input)),importReport:(input:Parameters<typeof retainedSink.importReport>[0])=>retainedSink.importReport(scopedLease(input))};
 const result=await createBankgiroIngest({source,store:createBankgiroIngestStore(guardedDatabase),sink}).run(c.owner);
 await assert();
 // Even a complete transport delivery cannot make an unlinked report a payment.
 // Keep the economic engine's review result and the provider coverage separate.
 const accepted=(result.counts?.IMPORTED||0)+(result.counts?.DUPLICATE||0),pending=(result.counts?.PENDING||0)+(result.counts?.RETRY||0)+(result.counts?.BLOCKED||0);
 return {state:captured.normalization.coverage.status==='available'&&accepted>0&&!pending&&!result.counts?.REVIEW?'verified' as const:captured.normalization.coverage.status==='unavailable'?'unavailable' as const:'partial' as const};
}
