import * as retainedOriginals from './server';
import {analyze,reconcileState,reconciliationPreview,type ReconciliationOptions} from './reconciliation';
import {normalizeName} from './reconciliation-engine.js';
import {now,uid,bankApiOriginalIssue,canonicalBankAccount,hasBankApiOrigin,paymentLineage,paymentOriginalIssue,invoiceReferenceDecision,readBankgiroSourceEvidence,type State,type Transaction} from './domain';

const MAX_ORIGINALS=32,MAX_BYTES=64_000_000;
const missing='Bankoriginalet saknas eller kan inte verifieras. Nya matchningar väntar på ett tillgängligt, oförändrat original.';
const missingAccount='En aktiv ägarbunden bankanslutning och ett verifierat mottagarkonto krävs före nya betalningskopplingar.';
/** Consent is current access evidence, never an assertion of original integrity. */
function accountReader(owner:string){
 const accounts=new Map<string,Promise<string>>();
 return (account:string,reportedAccount?:string)=>{
  const primary=canonicalBankAccount(account),key=JSON.stringify([primary,reportedAccount??null]);
  if(!accounts.has(key))accounts.set(key,(async()=>{try{const {bankgiroAutomaticAccountIssue}=await import('./bankgiro-service');return await bankgiroAutomaticAccountIssue(owner,primary,reportedAccount);}catch{return missingAccount;}})());
  return accounts.get(key)!;
 };
}
const needsAccount=(t:Transaction)=>hasBankApiOrigin(t)||['bank_file','bankgiro_file'].includes(t.evidence||'');
// Source classification keeps a missing report identifier from bypassing consent.
const reportedAccount=(t:Transaction)=>t.evidence==='bankgiro_file'?(typeof t.recipientAccount==='string'?t.recipientAccount:''):undefined;
function originalReference(state:State,t:Transaction){
 if(!['bank_file','bankgiro_file'].includes(t.evidence||''))return null;
 const record=state.imports.find(record=>record.id===t.importId);
 return {documentId:t.bankFileProof?.documentId||record?.documentId||'',hash:t.bankFileProof?.sha256||record?.hash||''};
}
/** Per-call cache, never an availability assertion reused by another request. */
function originalReader(owner:string){
 const files=new Map<string,Promise<{sha256:string}>>();let bytes=0;
 return async(state:State,t:Transaction)=>{
  const apiIssue=paymentLineage(state,t).issue||bankApiOriginalIssue(t);if(apiIssue)return apiIssue;
  const source=originalReference(state,t);if(!source)return '';
  if(!source.documentId||!/^[a-f0-9]{64}$/.test(source.hash))return missing;
  try{
   if(!files.has(source.documentId)){
    if(files.size>=MAX_ORIGINALS)return 'Bankoriginalen överskrider kontrollens säkerhetsgräns. Granska underlagen i mindre omgångar.';
    files.set(source.documentId,retainedOriginals.readBankOriginalBytes(owner,source.documentId,MAX_BYTES-bytes).then(file=>{bytes+=file.size;return {sha256:file.sha256};}));
   }
   const file=await files.get(source.documentId)!;
   return file.sha256===source.hash?'':'Bankoriginalets kontrollsumma skiljer sig från importen. Nya matchningar kräver granskning.';
  }catch{return missing;}
 };
}
function relatedTransactions(state:State,ids:Iterable<string>){
 const result=new Set<string>();
 for(const id of ids){const t=state.transactions.find(t=>t.id===id);if(t)for(const ancestor of paymentLineage(state,t).ancestors)result.add(ancestor.id);}
 return result;
}
function requiredEvidence(state:State,verifiedInvoiceOriginals:ReadonlySet<string>,sourceReviewIssues:ReadonlyMap<string,string>,options:ReconciliationOptions={}){
 const proposed=reconcileState(state,verifiedInvoiceOriginals,sourceReviewIssues,options),ids=new Set<string>();
 for(const decision of [...analyze(state,verifiedInvoiceOriginals,sourceReviewIssues,options).filter(f=>f.safe),...proposed.decisions]){
  if(decision.transaction_id)ids.add(decision.transaction_id);
  for(const id of decision.child_ids||[])ids.add(id);
  if(!decision.invoice_id)continue;
  const target=state.invoices.find(i=>i.id===decision.invoice_id),payment=state.transactions.find(t=>t.id===decision.transaction_id);
  if(!target||!payment)continue;
  // A prior manual allocation can teach a payer relation only while its own source is available.
  for(const allocation of state.allocations.filter(a=>a.active&&a.effect==='payment')){
   const invoice=state.invoices.find(i=>i.id===allocation.invoiceId),source=state.transactions.find(t=>t.id===allocation.transactionId);
   if(invoice&&source&&source.account===payment.account&&normalizeName(source.party)===normalizeName(payment.party)&&(normalizeName(invoice.party)===normalizeName(target.party)||!!target.organizationNumber&&target.organizationNumber===invoice.organizationNumber))ids.add(source.id);
  }
 }
 return ids;
}
function reportOriginals(state:State,ids?:ReadonlySet<string>){
 const originals=new Map<string,{documentId:string;sha256:string;importId:string}>();
 for(const row of state.transactions.filter(t=>t.specification&&(!ids||ids.has(t.id)))){
  const record=state.imports.find(record=>record.id===row.importId),documentId=row.bankFileProof?.documentId||record?.documentId||'',sha256=row.bankFileProof?.sha256||record?.hash||'';
  if(documentId)originals.set(JSON.stringify([documentId,row.importId]),{documentId,sha256,importId:row.importId});
 }
 return [...originals.values()];
}
async function sourceEvidence(owner:string,state:State,database:ReturnType<typeof retainedOriginals.db>|undefined,ids?:ReadonlySet<string>){
 const originals=reportOriginals(state,ids);
 return originals.length?readBankgiroSourceEvidence(database||retainedOriginals.db(),owner,originals):{complete:true as const,reports:[],snapshot:[]};
}
async function checkedState(owner:string,initial:State,options:ReconciliationOptions={}){
 const source=await sourceEvidence(owner,initial,undefined),sourceReviewIssues=new Map<string,string>();
 for(const report of source.reports.filter(report=>report.issue))for(const row of initial.transactions){
  const record=initial.imports.find(record=>record.id===row.importId);
  if(report.importId&&row.importId===report.importId||report.documentId&&(row.bankFileProof?.documentId===report.documentId||record?.documentId===report.documentId))sourceReviewIssues.set(row.id,'Rapportkällans leveransunderlag kräver granskning: '+report.issue);
 }

 // Positive invoice proof exists only in this request and cannot be supplied by
 // a stored workspace field. Generic reviewed invoices retain their manual semantics.
 const verifiedInvoiceOriginals=new Set<string>(),invoiceFiles=new Map<string,Promise<{size:number}>>();let invoiceBytes=0;
 for(const invoice of initial.invoices.filter(i=>i.reviewed&&!i.voided&&invoiceReferenceDecision(initial,i).applies)){
  if(!invoice.documentId||invoiceFiles.size>=MAX_ORIGINALS&&!invoiceFiles.has(invoice.documentId))continue;
  try{
   if(!invoiceFiles.has(invoice.documentId))invoiceFiles.set(invoice.documentId,retainedOriginals.readInvoiceOriginalBytes(owner,invoice.documentId,MAX_BYTES-invoiceBytes).then(file=>{invoiceBytes+=file.size;return file;}));
   await invoiceFiles.get(invoice.documentId);verifiedInvoiceOriginals.add(invoice.id);
  }catch{/* Missing, foreign, altered and unavailable invoice originals remain review-only. */}
 }

 // Every pending report, including legacy rows, needs current account consent
 // before its stable bank identifiers can promote it into economic child rows.
 const pending=initial.transactions.filter(row=>row.specification&&row.specificationStatus==='review'),accountDecisions:any[]=[],account=accountReader(owner);
 if(pending.length){
  initial=structuredClone(initial);
  for(const row of pending){
   const current=initial.transactions.find(item=>item.id===row.id)!,issue=await account(row.account,reportedAccount(row));
   if((current.bankgiroAccountIssue||'')!==issue)accountDecisions.push({id:uid(),at:now(),kind:issue?'bankgiro_account_held':'bankgiro_account_restored',safe:false,transaction_id:row.id,reason:issue||'Det valda mottagarkontot ingår i ägarens aktiva bankmedgivande.'});
   current.bankgiroAccountIssue=issue;
  }
 }
 // A pure hypothetical pass discovers recovery candidates; none of its allocations escape.
 const probe=structuredClone(initial);for(const t of probe.transactions){delete t.bankOriginalIssue;delete t.bankAccountIssue;}
 const state=structuredClone(initial),read=originalReader(owner),decisions:any[]=[...accountDecisions],checked=new Set<string>();
 for(let pass=0;pass<=state.transactions.length;pass++){
  const ids=requiredEvidence(pass===0?probe:state,verifiedInvoiceOriginals,sourceReviewIssues,options);
  if(pass===0)for(const t of initial.transactions)if(paymentOriginalIssue(initial,t)||t.bankAccountIssue)ids.add(t.id);
  const pending=[...relatedTransactions(state,ids)].filter(id=>!checked.has(id));
  if(!pending.length)return {state,decisions,verifiedInvoiceOriginals,sourceReviewIssues};
  for(const id of pending){
   const t=state.transactions.find(t=>t.id===id)!;const issue=await read(state,t),old=t.bankOriginalIssue||'';checked.add(id);
   if(issue)t.bankOriginalIssue=issue;else delete t.bankOriginalIssue;
   if(issue!==old)decisions.push({id:uid(),at:now(),kind:issue?'bank_original_unavailable':'bank_original_restored',safe:false,transaction_id:t.id,reason:issue||'Det bevarade bankoriginalet är tillgängligt och kontrollsumman stämmer.'});
   const accountIssue=needsAccount(t)?await account(t.account,reportedAccount(t)):'',previousAccountIssue=t.bankAccountIssue||'';
   if(accountIssue)t.bankAccountIssue=accountIssue;else delete t.bankAccountIssue;
   if(accountIssue!==previousAccountIssue)decisions.push({id:uid(),at:now(),kind:accountIssue?'bank_account_held':'bank_account_restored',safe:false,transaction_id:t.id,reason:accountIssue||'Det valda mottagarkontot ingår i ägarens aktiva bankmedgivande.'});
  }
  // Withholding a learned relation can remove an ambiguity and reveal a new candidate.
  // Discover again until every final candidate and source link has been checked.
 }
 throw Error('Bankoriginalkontrollen kunde inte slutföras. Inga nya matchningar har sparats.');
}
/** Production allocation boundary. Missing originals can never use a default trust bypass. */
export async function reconcileWithOriginals(owner:string,initial:State,options:ReconciliationOptions={}){
 const checked=await checkedState(owner,initial,options),result=reconcileState(checked.state,checked.verifiedInvoiceOriginals,checked.sourceReviewIssues,options);
 return {...result,decisions:[...checked.decisions,...result.decisions]};
}
export async function reconciliationPreviewWithOriginals(owner:string,initial:State){
 const checked=await checkedState(owner,initial);return reconciliationPreview(checked.state,checked.verifiedInvoiceOriginals,checked.sourceReviewIssues);
}
/** Original availability only, for read-only explanations independent of consent. */
export async function paymentOriginalAvailabilityIssue(owner:string,initial:State,id:string){
 if(!initial.transactions.some(t=>t.id===id))return missing;
 const read=originalReader(owner);
 for(const relatedId of relatedTransactions(initial,[id])){
  const issue=await read(initial,initial.transactions.find(t=>t.id===relatedId)!);if(issue)return issue;
 }
 return '';
}
export async function assertPaymentOriginal(owner:string,initial:State,id:string){
 const state=structuredClone(initial),read=originalReader(owner),account=accountReader(owner);
 if(!state.transactions.some(t=>t.id===id))throw Error(missing);
 for(const relatedId of relatedTransactions(state,[id])){
  const t=state.transactions.find(t=>t.id===relatedId)!;const issue=await read(state,t);if(issue)throw Error(issue);delete t.bankOriginalIssue;
  if(needsAccount(t)){const issue=await account(t.account,reportedAccount(t));if(issue)throw Error(issue);}
  delete t.bankAccountIssue;
 }
 return state;
}
const consentFields=['id','owner','status','environment','app_generation','valid_until','selected_accounts','encrypted_accounts','encrypted_session','bank_name','country'] as const;
const changedConsent=()=>Object.assign(Error('Bankmedgivandet eller kontovalet ändrades under kontrollen. Inga nya betalningskopplingar sparades. Kör kontrollen igen.'),{code:'BANK_CONSENT_CHANGED',status:409,safe:true});
/** New money and report promotion need a commit-time consent fence. Historical
 * allocations and unrelated metadata remain writable without current consent. */
function financialSourceIds(before:State,after:State){
 const allocations=after.allocations.filter(a=>a.active&&!before.allocations.some(old=>old.active&&old.id===a.id&&old.transactionId===a.transactionId&&old.invoiceId===a.invoiceId&&old.amount===a.amount&&old.effect===a.effect));
 const promoted=after.transactions.filter(row=>row.specification&&row.specificationStatus==='linked'&&!before.transactions.some(old=>old.id===row.id&&old.specificationStatus==='linked'&&old.parentId===row.parentId));
 const ids=new Set([...allocations.map(a=>a.transactionId),...promoted.map(row=>row.id)]);
 for(const allocation of allocations){
  const invoice=after.invoices.find(i=>i.id===allocation.invoiceId),payment=after.transactions.find(t=>t.id===allocation.transactionId);if(!invoice||!payment)continue;
  for(const previous of before.allocations.filter(a=>a.active&&a.effect==='payment')){
   const target=after.invoices.find(i=>i.id===previous.invoiceId),source=after.transactions.find(t=>t.id===previous.transactionId);
   if(target&&source&&source.account===payment.account&&normalizeName(source.party)===normalizeName(payment.party)&&(normalizeName(target.party)===normalizeName(invoice.party)||!!invoice.organizationNumber&&invoice.organizationNumber===target.organizationNumber))ids.add(source.id);
  }
 }
 return relatedTransactions(after,ids);
}
const changedSource=()=>Object.assign(Error('Rapportkällans leveransunderlag ändrades under kontrollen. Inga nya betalningskopplingar sparades. Kör kontrollen igen.'),{code:'BANKGIRO_SOURCE_CHANGED',status:409,safe:true});
const sourceFields=['owner','source_id','scope_id','authorization_generation','authorization_status','cursor','missing_report_ids','next_poll_at','attempts','last_error','updated_at'];
const jobFields=['id','owner','source_id','scope_id','report_id','sha256','filename','available_at','authorization_generation','document_id','status','attempts','next_attempt_at','last_error','import_id','payment_count','created_at','updated_at'];
/** Each predicate and its identity census run inside the allocation's D1 batch.
 * The census detects a newly appended conflicting hash as well as row changes. */
function sourceFences(database:D1Database,owner:string,revision:number,snapshots:unknown[]){
 return snapshots.map(value=>{
  const snapshot=value as {documentId:string;importId:string;jobs:Record<string,any>[];sources:Record<string,any>[]},clauses:string[]=[],values:unknown[]=[];
  const jobScope=['document_id=?','import_id=?'];values.push(owner,snapshot.documentId,snapshot.importId);
  const identities=new Map(snapshot.jobs.map(job=>[JSON.stringify([job.source_id,job.scope_id,job.report_id]),job]));
  for(const job of identities.values()){jobScope.push('(source_id=? AND scope_id=? AND report_id=?)');values.push(job.source_id,job.scope_id,job.report_id);}
  clauses.push(`(SELECT COUNT(*) FROM bankgiro_ingest_jobs WHERE owner=? AND (${jobScope.join(' OR ')}))=?`);values.push(snapshot.jobs.length);
  for(const job of snapshot.jobs){clauses.push(`EXISTS(SELECT 1 FROM bankgiro_ingest_jobs WHERE ${jobFields.map(field=>field+' IS ?').join(' AND ')})`);values.push(...jobFields.map(field=>job[field]??null));}
  for(const source of snapshot.sources){clauses.push(`EXISTS(SELECT 1 FROM bankgiro_ingest_sources WHERE ${sourceFields.map(field=>field+' IS ?').join(' AND ')})`);values.push(...sourceFields.map(field=>source[field]??null));}
  // Keep each bounded fence below D1's parameter limit; a large conflicting
  // identity requires review instead of an incomplete financial check.
  if(values.length+2>100)throw changedSource();
  return database.prepare(`SELECT CASE WHEN ${clauses.join(' AND ')} THEN 1 ELSE json('BANKGIRO_SOURCE_CHANGED') END WHERE EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND revision=?)`).bind(...values,owner,revision);
 });
}
/** Caller supplies its audit and workspace CAS statements. The NOT NULL fence
 * executes under the SAME D1 write transaction, so a concurrent disconnect,
 * deselection, account replacement or expiry cannot leave partial finances. */
export async function writePaymentState(owner:string,revision:number,before:State,after:State,database:D1Database,statements:D1PreparedStatement[],options:{manualAllocationIds?:ReadonlySet<string>}={}){
 const financialIds=financialSourceIds(before,after),newAllocationIds=new Set(after.allocations.filter(a=>a.active&&!before.allocations.some(old=>old.active&&old.id===a.id)).map(a=>a.transactionId));
 // Newly imported report rows are fenced by their intake lease and original
 // receipt. Later allocation and promotion must bind the completed C3 receipt.
 const reportIds=new Set([...financialIds].filter(id=>newAllocationIds.has(id)||before.transactions.some(row=>row.id===id))),source=await sourceEvidence(owner,after,database,reportIds);
 for(const report of source.reports.filter(report=>report.issue)){
  const matches=(row:Transaction)=>row.importId===report.importId||!!report.documentId&&(row.bankFileProof?.documentId===report.documentId||after.imports.find(record=>record.id===row.importId)?.documentId===report.documentId);
  const affected=after.allocations.filter(a=>a.active&&!before.allocations.some(old=>old.active&&old.id===a.id)).filter(a=>{const row=after.transactions.find(t=>t.id===a.transactionId);return !!row&&matches(row);});
  const promoted=after.transactions.some(row=>row.specification&&row.specificationStatus==='linked'&&matches(row)&&!before.transactions.some(old=>old.id===row.id&&old.specificationStatus==='linked'&&old.parentId===row.parentId));
  if(promoted||!affected.length||affected.some(a=>!options.manualAllocationIds?.has(a.id)))throw changedSource();
 }
 const reportFences=sourceFences(database,owner,revision,source.snapshot);
 const accounts=new Map<string,{primary:string;reported:string|undefined}>();
 for(const id of financialIds){
  const source=after.transactions.find(t=>t.id===id)!;if(!needsAccount(source))continue;
  const primary=canonicalBankAccount(source.account),reported=reportedAccount(source);
  accounts.set(JSON.stringify([primary,reported??null]),{primary,reported});
 }
 if(!accounts.size){try{return (await database.batch([...reportFences,...statements])).slice(reportFences.length);}catch(error){if(reportFences.length&&/malformed JSON/i.test(String(error)))throw changedSource();throw error;}}
 const snapshots=new Map<string,unknown[]>();
 try{
  const {bankAccountConsentSnapshot}=await import('./bankgiro-service');
  // Validate every retained recipient alias before deduplicating equal consent snapshots.
  for(const {primary,reported} of accounts.values()){const current=await bankAccountConsentSnapshot(owner,primary,reported),values=consentFields.map(field=>current[field]);if(values.some(value=>typeof value!=='string'||!value))throw changedConsent();snapshots.set(JSON.stringify(values),values);}
 }catch{throw changedConsent();}
 const match=[...snapshots].map(()=>`EXISTS(SELECT 1 FROM bank_connections WHERE ${consentFields.map(field=>field+'=?').join(' AND ')} AND julianday(valid_until)>julianday('now'))`).join(' AND ');
 const fence=database.prepare(`UPDATE workspaces SET payload=NULL WHERE owner=? AND revision=? AND NOT (${match})`).bind(owner,revision,...[...snapshots.values()].flat());
 try{return (await database.batch([...reportFences,fence,...statements])).slice(reportFences.length+1);}
 catch(error){if(reportFences.length&&/malformed JSON/i.test(String(error)))throw changedSource();if(/NOT NULL constraint failed:\s*workspaces\.payload/i.test(String(error)))throw changedConsent();throw error;}
}
