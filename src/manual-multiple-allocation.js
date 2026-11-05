import {randomUUID} from 'node:crypto';
import {digest} from './security.js';
import {listInvoices,listTransactions,assertAllocationEconomics} from './db.js';
import {readReconciliationInput} from './reconciliation-preview.js';
import {buildReconciliationPreview} from '../sites/lib/reconciliation-contract.js';
import {MANUAL_MULTIPLE_VERSION,canonicalManualValue,parseManualMultipleRequest,manualMultipleCandidates,manualMultiplePlan,manualMultipleBinding} from '../sites/lib/manual-multiple-allocation.js';

const action='manual_multiple_allocation';
const fail=(code,message,status=409)=>Object.assign(Error(message),{code,status});
const unknown=()=>fail('MANUAL_OUTCOME_UNKNOWN','Utfallet kunde inte läsas säkert. Hämta kvittot med samma begärans-ID innan en ny fördelning görs.',503);
function scope(db,owner){
 if(typeof owner!=='string'||!owner)throw fail('AUTH_REQUIRED','Ägarautentisering krävs.',401);
 const context=db.companyContext;
 return {ownerId:owner,companyId:context?.companyId||'workspace:'+owner,actorId:context?.actorId||owner,...(context?{contextVersion:context.contextVersion,membershipVersion:context.membershipVersion,companyVersion:context.companyVersion}:{} )};
}
function readInput(db,owner,transactionId){
 const input=readReconciliationInput(db,{owner,transactionId}),current=scope(db,owner);
 return {...input,companyId:current.companyId,referencePolicy:input.referencePolicy?{...input.referencePolicy,companyId:current.companyId}:null,invoices:input.invoices.map(invoice=>({...invoice,companyId:current.companyId})),evidenceContext:{...input.evidenceContext,manualCompanyScope:current}};
}
const key=(current,requestId)=>'manual-multiple-'+digest(canonicalManualValue({ownerId:current.ownerId,companyId:current.companyId,requestId}));
const intent=(current,request)=>digest(canonicalManualValue({version:MANUAL_MULTIPLE_VERSION,ownerId:current.ownerId,companyId:current.companyId,actorId:current.actorId,request}));
function storedReceipt(db,current,requestId){
 if(typeof requestId!=='string'||!/^[a-zA-Z0-9-]{10,80}$/.test(requestId))throw fail('MANUAL_INVALID_REQUEST','Ogiltig kvittoidentifierare.',400);
 let record;try{const row=db.prepare('SELECT details FROM audit_events WHERE id=? AND action=?').get(key(current,requestId),action);if(!row)return null;record=JSON.parse(row.details);}catch{throw unknown();}
 if(record?.receipt?.version!==MANUAL_MULTIPLE_VERSION||record.receipt.ownerId!==current.ownerId||record.receipt.companyId!==current.companyId||record.receipt.requestId!==requestId||record.receipt.receiptId!==key(current,requestId)||typeof record.intentHash!=='string')throw unknown();
 return record;
}
function replay(record,intentHash){
 if(record.intentHash!==intentHash)throw fail('MANUAL_REQUEST_REUSED','Samma begärans-ID har redan använts för en annan fördelning.');
 return {receipt:record.receipt,replayed:true,changed:false};
}
export function readManualMultipleReceipt(db,{owner,requestId}){
 const record=storedReceipt(db,scope(db,owner),requestId);
 if(!record)throw fail('MANUAL_RECEIPT_NOT_FOUND','Något sparat kvitto finns inte för denna begäran.',404);
 return {receipt:record.receipt,replayed:true,changed:false};
}
export async function discoverManualMultiple(db,{owner,transactionId}){
 const input=readInput(db,owner,transactionId),preview=await buildReconciliationPreview(input);
 return manualMultipleCandidates(input,preview,transactionId);
}
async function prepare(db,owner,request){
 const input=readInput(db,owner,request.transactionId),preview=await buildReconciliationPreview(input),plan=manualMultiplePlan(input,preview,request);
 return {input,preview,plan,reviewHash:digest(manualMultipleBinding(input,plan))};
}
export async function previewManualMultiple(db,{owner,request}){
 const prepared=await prepare(db,owner,parseManualMultipleRequest(request));
 return {...prepared.plan,reviewHash:prepared.reviewHash};
}
export async function commitManualMultiple(db,{owner,request:raw,assertCurrent=()=>{}}){
 assertCurrent();const request=parseManualMultipleRequest(raw,{commit:true}),current=scope(db,owner),intentHash=intent(current,request);
 const previous=storedReceipt(db,current,request.requestId);if(previous)return replay(previous,intentHash);
 const {reviewHash,requestId,confirm,...selection}=request;
 let prepared;try{prepared=await prepare(db,owner,selection);}catch(error){const raced=storedReceipt(db,current,requestId);if(raced)return replay(raced,intentHash);throw error;}
 if(prepared.reviewHash!==reviewHash)throw fail('MANUAL_STALE_REVIEW','Underlaget eller beloppsfördelningen har ändrats. Granska hela fördelningen igen.');
 let transactionOpen=false;
 try{
  db.exec('BEGIN IMMEDIATE');transactionOpen=true;assertCurrent();
  const previous=storedReceipt(db,current,requestId);
  if(previous){const result=replay(previous,intentHash);db.exec('COMMIT');transactionOpen=false;return result;}
  // All current database originals, ownership claims, balances, source versions
  // and consents are rederived while holding the write lock. No await follows.
  const fresh=readInput(db,owner,selection.transactionId);
  if(digest(manualMultipleBinding(fresh,prepared.plan))!==reviewHash)throw fail('MANUAL_STALE_REVIEW','Bank- eller fakturaunderlaget ändrades före sparandet. Ingen del av fördelningen har sparats.');
  const plan=manualMultiplePlan(fresh,prepared.preview,selection),at=new Date().toISOString(),receiptId=key(current,requestId),allocations=[],invoiceOriginals=[];
  for(const row of plan.allocations){
   const invoice=listInvoices(db).find(invoice=>invoice.id===row.invoiceId),transaction=listTransactions(db).find(transaction=>transaction.id===plan.transactionId);
   assertAllocationEconomics(db,invoice,transaction,row.amountMinor);
   invoiceOriginals.push(db.prepare('SELECT id,invoice_id,fingerprint,name,mime_type FROM documents WHERE id=?').get(invoice.document_id));
   const id=randomUUID();db.prepare('INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES(?,?,?,?)').run(id,row.invoiceId,plan.transactionId,row.amountMinor);
   db.prepare('UPDATE invoices SET reconciled_at=? WHERE id=?').run(at,row.invoiceId);
   allocations.push({...row,id,transactionId:plan.transactionId});
  }
  const source=fresh.transactions.find(row=>row.id===plan.transactionId),evidence={bankOriginal:source.original,accountEvidence:source.accountEvidence,referenceEvidence:source.references,invoiceOriginals,referenceCensusSha256:digest(canonicalManualValue(fresh.invoices))};
  const receipt={version:MANUAL_MULTIPLE_VERSION,receiptId,requestId,ownerId:current.ownerId,companyId:current.companyId,approvedBy:current.actorId,method:'manual_multiple',automatic:false,approvedAt:at,reviewHash,revisionBefore:fresh.revision,transactionId:plan.transactionId,bankId:plan.bankId,accountId:plan.accountId,currency:plan.currency,payer:plan.payer,references:plan.references,availableBeforeMinor:plan.availableMinor,allocatedMinor:plan.allocatedMinor,paymentRemainingMinor:plan.paymentRemainingMinor,allocations,note:plan.note,evidence};
  db.prepare('INSERT INTO audit_events(id,action,details,created_at) VALUES(?,?,?,?)').run(receiptId,action,JSON.stringify({intentHash,receipt}),at);
  assertCurrent();
  if(fresh.transactions.some(row=>row.accountEvidence?.status==='VERIFIED'&&row.accountEvidence.validUntil&&Date.parse(row.accountEvidence.validUntil)<=Date.now()))throw fail('MANUAL_CONSENT_EXPIRED','Bankmedgivandet gick ut före sparandet. Ingen del av fördelningen har sparats.');
  db.exec('COMMIT');transactionOpen=false;
  return {receipt,replayed:false,changed:true};
 }catch(error){
  if(transactionOpen)try{db.exec('ROLLBACK');}catch{/* A lost COMMIT response may already have committed. Read the actual receipt. */}
  const committed=storedReceipt(db,current,requestId);if(committed)return {...replay(committed,intentHash),recovered:true};
  throw error;
 }
}

/** Historical manual provenance is read from the durable receipt, never inferred
 * from a green source decision or promoted into automatic matching evidence. */
export function decorateManualMultipleAllocations(db,allocations){
 const provenance=new Map();
 for(const row of db.prepare('SELECT details FROM audit_events WHERE action=?').all(action)){
  let receipt;try{receipt=JSON.parse(row.details).receipt;}catch{continue;}
  if(receipt?.version!==MANUAL_MULTIPLE_VERSION||receipt.method!=='manual_multiple')continue;
  for(const item of receipt.allocations||[])provenance.set(item.id,{method:'manual_multiple',receiptId:receipt.receiptId,requestId:receipt.requestId,approvedAt:receipt.approvedAt,approvedBy:receipt.approvedBy,reviewHash:receipt.reviewHash});
 }
 return allocations.map(row=>provenance.has(row.id)?{...row,manualReview:provenance.get(row.id)}:row);
}
