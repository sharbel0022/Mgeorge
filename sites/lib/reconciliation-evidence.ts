import {readBankOriginalBytes} from './server';
import {analyze,reconcileState,reconciliationPreview} from './reconciliation';
import {normalizeName} from './reconciliation-engine.js';
import {now,uid,bankApiOriginalIssue,paymentLineage,paymentOriginalIssue,type State,type Transaction} from './domain';

const MAX_ORIGINALS=32,MAX_BYTES=64_000_000;
const missing='Bankoriginalet saknas eller kan inte verifieras. Nya matchningar väntar på ett tillgängligt, oförändrat original.';
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
    files.set(source.documentId,readBankOriginalBytes(owner,source.documentId,MAX_BYTES-bytes).then(file=>{bytes+=file.size;return {sha256:file.sha256};}));
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
function requiredEvidence(state:State){
 const proposed=reconcileState(state),ids=new Set<string>();
 for(const decision of [...analyze(state).filter(f=>f.safe),...proposed.decisions]){
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
async function checkedState(owner:string,initial:State){
 // A pure hypothetical pass discovers recovery candidates; none of its allocations escape.
 const probe=structuredClone(initial);for(const t of probe.transactions)delete t.bankOriginalIssue;
 const state=structuredClone(initial),read=originalReader(owner),decisions:any[]=[],checked=new Set<string>();
 for(let pass=0;pass<=state.transactions.length;pass++){
  const ids=requiredEvidence(pass===0?probe:state);
  if(pass===0)for(const t of initial.transactions)if(paymentOriginalIssue(initial,t))ids.add(t.id);
  const pending=[...relatedTransactions(state,ids)].filter(id=>!checked.has(id));
  if(!pending.length)return {state,decisions};
  for(const id of pending){
   const t=state.transactions.find(t=>t.id===id)!;const issue=await read(state,t),old=t.bankOriginalIssue||'';checked.add(id);
   if(issue)t.bankOriginalIssue=issue;else delete t.bankOriginalIssue;
   if(issue!==old)decisions.push({id:uid(),at:now(),kind:issue?'bank_original_unavailable':'bank_original_restored',safe:false,transaction_id:t.id,reason:issue||'Det bevarade bankoriginalet är tillgängligt och kontrollsumman stämmer.'});
  }
  // Withholding a learned relation can remove an ambiguity and reveal a new candidate.
  // Discover again until every final candidate and source link has been checked.
 }
 throw Error('Bankoriginalkontrollen kunde inte slutföras. Inga nya matchningar har sparats.');
}
/** Production allocation boundary. Missing originals can never use a default trust bypass. */
export async function reconcileWithOriginals(owner:string,initial:State){
 const checked=await checkedState(owner,initial),result=reconcileState(checked.state);
 return {...result,decisions:[...checked.decisions,...result.decisions]};
}
export async function reconciliationPreviewWithOriginals(owner:string,initial:State){
 const checked=await checkedState(owner,initial);return reconciliationPreview(checked.state);
}
export async function assertPaymentOriginal(owner:string,initial:State,id:string){
 const state=structuredClone(initial),read=originalReader(owner);
 if(!state.transactions.some(t=>t.id===id))throw Error(missing);
 for(const relatedId of relatedTransactions(state,[id])){
  const t=state.transactions.find(t=>t.id===relatedId)!;const issue=await read(state,t);if(issue)throw Error(issue);delete t.bankOriginalIssue;
 }
 return state;
}
