import {db,readWorkspace,currentCompanyContext,response,failure} from './server';
import {uid,type State} from './domain';
import {readReconciliationInput} from './reconciliation-preview';
import {buildReconciliationPreview} from './reconciliation-contract.js';
import {writePaymentState,paymentSourceSnapshotFences} from './reconciliation-evidence';
import {MANUAL_MULTIPLE_VERSION,canonicalManualValue,parseManualMultipleRequest,manualMultipleCandidates,manualMultiplePlan,manualMultipleBinding} from './manual-multiple-allocation.js';

const action='manual_multiple_allocation';
const fail=(code:string,message:string,status=409)=>Object.assign(Error(message),{code,status});
const unknown=()=>fail('MANUAL_OUTCOME_UNKNOWN','Utfallet kunde inte läsas säkert. Hämta kvittot med samma begärans-ID innan en ny fördelning görs.',503);
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
function scope(owner:string){
 if(!owner)throw Error('AUTH_REQUIRED');const context=currentCompanyContext();
 return {ownerId:owner,companyId:context?.companyId||'workspace:'+owner,actorId:context?.actorId||owner,...(context?{contextVersion:context.contextVersion,membershipVersion:context.membershipVersion,companyVersion:context.companyVersion}:{} )};
}
const key=(current:ReturnType<typeof scope>,requestId:string)=>hash(canonicalManualValue({ownerId:current.ownerId,companyId:current.companyId,requestId})).then(value=>'manual-multiple-'+value);
const intent=(current:ReturnType<typeof scope>,request:unknown)=>hash(canonicalManualValue({version:MANUAL_MULTIPLE_VERSION,ownerId:current.ownerId,companyId:current.companyId,actorId:current.actorId,request}));
async function storedReceipt(current:ReturnType<typeof scope>,requestId:string){
 if(typeof requestId!=='string'||!/^[a-zA-Z0-9-]{10,80}$/.test(requestId))throw fail('MANUAL_INVALID_REQUEST','Ogiltig kvittoidentifierare.',400);
 const receiptId=await key(current,requestId);let record:any;
 try{const row=await db().prepare('SELECT detail FROM audit_events WHERE id=? AND owner=? AND action=?').bind(receiptId,current.ownerId,action).first<{detail:string}>();if(!row)return null;record=JSON.parse(row.detail);}catch(error){if(error instanceof Error&&/^(AUTH_REQUIRED|COMPANY_)/.test(error.message))throw error;throw unknown();}
 if(record?.receipt?.version!==MANUAL_MULTIPLE_VERSION||record.receipt.ownerId!==current.ownerId||record.receipt.companyId!==current.companyId||record.receipt.requestId!==requestId||record.receipt.receiptId!==receiptId||typeof record.intentHash!=='string')throw unknown();
 return record;
}
function replay(record:any,intentHash:string){
 if(record.intentHash!==intentHash)throw fail('MANUAL_REQUEST_REUSED','Samma begärans-ID har redan använts för en annan fördelning.');
 return {receipt:record.receipt,replayed:true,changed:false};
}
export async function readManualMultipleReceipt(owner:string,requestId:string){
 const record=await storedReceipt(scope(owner),requestId);if(!record)throw fail('MANUAL_RECEIPT_NOT_FOUND','Något sparat kvitto finns inte för denna begäran.',404);
 return {receipt:record.receipt,replayed:true,changed:false};
}
async function readInput(owner:string,transactionId:string){
 const current=scope(owner),old=await readWorkspace(owner);
 const raw=await db().prepare('SELECT revision,payload FROM workspaces WHERE owner=?').bind(owner).first<{revision:number;payload:string}>();
 if(!raw||raw.revision!==old.revision)throw fail('MANUAL_STALE_REVIEW','Uppgifterna ändrades under kontrollen. Läs fördelningen igen.');
 const source=JSON.parse(raw.payload) as State;delete source.company.id;if(old.state.company.id)source.company.id=old.state.company.id;
 if(canonicalManualValue(source)!==canonicalManualValue(old.state))throw fail('MANUAL_STALE_REVIEW','Uppgifterna ändrades under kontrollen. Läs fördelningen igen.');
 const adapted:any=await readReconciliationInput(owner,old.state,old.revision,transactionId,{manualReview:true});
 const input={...adapted,companyId:current.companyId,referencePolicy:adapted.referencePolicy?{...adapted.referencePolicy,companyId:current.companyId}:null,invoices:adapted.invoices.map((invoice:any)=>({...invoice,companyId:current.companyId})),evidenceContext:{...adapted.evidenceContext,manualCompanyScope:current,manualWorkspacePayloadSha256:await hash(raw.payload)}};
 return {old,rawPayload:raw.payload,input,current};
}
export async function discoverManualMultiple(owner:string,transactionId:string){
 const prepared=await readInput(owner,transactionId),preview=await buildReconciliationPreview(prepared.input);
 return manualMultipleCandidates(prepared.input,preview,transactionId);
}
async function prepare(owner:string,request:any){
 const prepared=await readInput(owner,request.transactionId),preview=await buildReconciliationPreview(prepared.input),plan=manualMultiplePlan(prepared.input,preview,request);
 return {...prepared,plan,reviewHash:await hash(manualMultipleBinding(prepared.input,plan))};
}
export async function previewManualMultiple(owner:string,request:unknown){
 const prepared=await prepare(owner,parseManualMultipleRequest(request));return {...prepared.plan,reviewHash:prepared.reviewHash};
}
const consentFields=['id','owner','status','environment','app_generation','valid_until','selected_accounts','encrypted_accounts','encrypted_session','bank_name','country'];
const documentFields=['id','owner','filename','mime','size','sha256','created_at'];
function commitFences(database:D1Database,owner:string,revision:number,input:any,rawPayload:string){
 const unchanged=" THEN 1 ELSE json('MANUAL_EVIDENCE_CHANGED') END WHERE EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND revision=?)";
 const statements=[database.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND revision=? AND payload=?)"+unchanged).bind(owner,revision,rawPayload,owner,revision)];
 const evidence=input.evidenceContext.manualCommitEvidence;
 for(const original of evidence.originals){
  if(original.row.owner!==owner)throw fail('MANUAL_EVIDENCE_CHANGED','Originalet tillhör inte det aktuella företaget.');
  statements.push(database.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM documents WHERE ${documentFields.map(field=>field+' IS ?').join(' AND ')})`+unchanged).bind(...documentFields.map(field=>original.row[field]??null),owner,revision));
 }
 for(const consent of evidence.consents){
  if(consent.owner!==owner)throw fail('MANUAL_EVIDENCE_CHANGED','Bankmedgivandet tillhör inte det aktuella företaget.');
  if(consent.provider==='open_payments')statements.push(database.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM saas_bank_state WHERE owner=? AND revision=? AND payload=?) AND julianday(?)>julianday('now')"+unchanged).bind(owner,consent.revision,consent.payload,consent.validUntil,owner,revision));
  else statements.push(database.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM bank_connections WHERE ${consentFields.map(field=>field+' IS ?').join(' AND ')} AND julianday(valid_until)>julianday('now'))`+unchanged).bind(...consentFields.map(field=>consent[field]??null),owner,revision));
 }
 statements.push(...paymentSourceSnapshotFences(database,owner,revision,input.evidenceContext.bankgiroSource));
 return statements;
}
export async function commitManualMultiple(owner:string,rawRequest:unknown){
 const request:any=parseManualMultipleRequest(rawRequest,{commit:true}),current=scope(owner),intentHash=await intent(current,request);
 const previous=await storedReceipt(current,request.requestId);if(previous)return replay(previous,intentHash);
 const {reviewHash,requestId,confirm,...selection}=request;
 // Reread every original byte/hash/version and all source facts. The quote is
 // intent binding, never permission to trust a browser-supplied bank assertion.
 let prepared;try{prepared=await prepare(owner,selection);}catch(error){const raced=await storedReceipt(current,requestId);if(raced)return replay(raced,intentHash);throw error;}
 if(prepared.reviewHash!==reviewHash)throw fail('MANUAL_STALE_REVIEW','Underlaget eller beloppsfördelningen har ändrats. Granska hela fördelningen igen.');
 const {plan,old,input,rawPayload}=prepared,at=new Date().toISOString(),receiptId=await key(current,requestId),next=structuredClone(old.state),manualAllocationIds=new Set<string>();
 const allocations=plan.allocations.map((row:any)=>{
  const id=uid();manualAllocationIds.add(id);
  next.allocations.push({id,invoiceId:row.invoiceId,transactionId:plan.transactionId,amount:row.amountMinor,effect:'payment',active:true,note:plan.note,createdAt:at,manualReview:{method:'manual_multiple',receiptId,requestId,approvedAt:at,approvedBy:current.actorId,reviewHash}});
  next.invoices.find(invoice=>invoice.id===row.invoiceId)!.reconciledAt=at;
  return {...row,id,transactionId:plan.transactionId};
 });
 const source=input.transactions.find((row:any)=>row.id===plan.transactionId),evidence={bankOriginal:source.original,accountEvidence:source.accountEvidence,referenceEvidence:source.references,originals:input.evidenceContext.manualCommitEvidence.originals,referenceCensusSha256:await hash(canonicalManualValue(input.invoices))};
 const receipt={version:MANUAL_MULTIPLE_VERSION,receiptId,requestId,ownerId:owner,companyId:current.companyId,approvedBy:current.actorId,method:'manual_multiple',automatic:false,approvedAt:at,reviewHash,revisionBefore:old.revision,revisionAfter:old.revision+1,transactionId:plan.transactionId,bankId:plan.bankId,accountId:plan.accountId,currency:plan.currency,payer:plan.payer,references:plan.references,availableBeforeMinor:plan.availableMinor,allocatedMinor:plan.allocatedMinor,paymentRemainingMinor:plan.paymentRemainingMinor,allocations,note:plan.note,evidence};
 const payload=JSON.stringify(next);if(new TextEncoder().encode(payload).length>1_800_000)throw fail('MANUAL_WORKSPACE_TOO_LARGE','Registret är för stort för att spara fördelningen i denna version.');
 const database=db(),fences=commitFences(database,owner,old.revision,input,rawPayload);
 try{
  const saved=await writePaymentState(owner,old.revision,old.state,next,database,[...fences,
   database.prepare('INSERT INTO audit_events (id,owner,revision,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND revision=?)').bind(receiptId,owner,old.revision+1,action,JSON.stringify({intentHash,receipt}),at,owner,old.revision),
   database.prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=?').bind(payload,at,owner,old.revision)
  ],{manualAllocationIds});
  if(saved.at(-1)?.meta.changes!==1){const raced=await storedReceipt(current,requestId);if(raced)return replay(raced,intentHash);throw fail('MANUAL_STALE_REVIEW','En annan ändring sparades samtidigt. Ingen del av denna fördelning har sparats.');}
  return {receipt,replayed:false,changed:true};
 }catch(error){
  const committed=await storedReceipt(current,requestId);if(committed)return {...replay(committed,intentHash),recovered:true};
  if(error instanceof Error&&/malformed JSON|BANK_CONSENT_CHANGED|BANKGIRO_SOURCE_CHANGED|NOT NULL constraint failed:\s*workspaces\.payload/i.test(error.message)||error&&typeof error==='object'&&'code'in error&&['BANK_CONSENT_CHANGED','BANKGIRO_SOURCE_CHANGED'].includes(String(error.code)))throw fail('MANUAL_EVIDENCE_CHANGED','Bankmedgivandet, originalet eller referensunderlaget ändrades före sparandet. Ingen del av fördelningen har sparats.');
  if(error instanceof Error&&/^(AUTH_REQUIRED|COMPANY_)/.test(error.message)||error&&typeof error==='object'&&'code'in error&&String(error.code).startsWith('MANUAL_'))throw error;
  // A missing receipt immediately after an unclassified batch failure is not
  // proof of rollback: the batch may have committed before its reply was lost.
  // Preserve the intent/request ID and ask the client to recover this outcome.
  throw unknown();
 }
}
export function manualMultipleFailure(error:unknown){
 if(error&&typeof error==='object'&&'code'in error&&String(error.code).startsWith('MANUAL_')&&'status'in error)return response({error:error instanceof Error?error.message:'Fördelningen kunde inte behandlas.',code:error.code},Number(error.status));
 return failure(error);
}
