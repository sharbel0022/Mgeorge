// A separate explicit manual policy. This module has no I/O, cannot approve C4,
// and never changes the bank original, a source reference or a financial row.
import {matchingReferenceValues} from './payment-references.js';
import {canonicalInvoiceReference} from './invoice-reference-policy.js';

export const MANUAL_MULTIPLE_VERSION='manual-multiple-allocation-v1';
const MAX_ROWS=20;
const positive=value=>Number.isSafeInteger(value)&&value>0;
const text=value=>typeof value==='string'&&value.length>0;
const fail=(code,message,status=409,reasonCodes=[])=>Object.assign(Error(message),{code,status,reasonCodes});
const evidenceFailure=reasons=>fail('MANUAL_EVIDENCE_REQUIRED','Bank- och fakturaunderlaget är inte entydigt. Kontrollera original, betalare, referenser och aktuellt konto innan fördelningen granskas.',409,reasons);
const allowedDiagnostics=new Set(['MULTIPLE_INVOICES_REQUIRE_REVIEW','MULTIPLE_INVOICE_AMOUNT_CONFLICT','MANUAL_CUSTOMER_RELATION']);
const partyKey=invoice=>(typeof invoice.customerOrganizationNumber==='string'?invoice.customerOrganizationNumber.replace(/[- ]/g,''):'')||(typeof invoice.customerName==='string'?invoice.customerName.normalize('NFKC').toLocaleLowerCase('sv-SE').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' '):'');
function sum(values){let total=0;for(const value of values){if(!Number.isSafeInteger(value)||!Number.isSafeInteger(total+value))throw fail('MANUAL_INVALID_MONEY','Beloppen måste vara hela ören inom tillåten storlek.');total+=value;}return total;}
const compare=(a,b)=>a<b?-1:a>b?1:0;

/** Every value is type-tagged: sentinels cannot collide with user strings or
 * arrays. Only plain data objects are accepted, never Date/Map/class instances. */
export function canonicalManualValue(value,ancestors=new Set()){
 if(value===undefined)return '["undefined"]';
 if(value===null)return '["null"]';
 if(typeof value==='number')return JSON.stringify(['number',Object.is(value,-0)?'-0':Number.isFinite(value)?value:String(value)]);
 if(typeof value==='string'||typeof value==='boolean')return JSON.stringify([typeof value,value]);
 if(typeof value!=='object'||!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw fail('MANUAL_INVALID_DATA','Granskningsunderlaget innehåller ogiltiga uppgifter.');
 if(ancestors.has(value))throw fail('MANUAL_INVALID_DATA','Granskningsunderlaget innehåller ogiltiga uppgifter.');
 if(Object.entries(Object.getOwnPropertyDescriptors(value)).some(([key,property])=>!(Array.isArray(value)&&key==='length')&&(!property.enumerable||!Object.hasOwn(property,'value'))))throw fail('MANUAL_INVALID_DATA','Granskningsunderlaget innehåller ogiltiga uppgifter.');
 if(Object.getOwnPropertySymbols(value).length||Array.isArray(value)&&Object.keys(value).some(key=>!/^\d+$/.test(key)||String(Number(key))!==key||Number(key)>=value.length))throw fail('MANUAL_INVALID_DATA','Granskningsunderlaget innehåller ogiltiga uppgifter.');
 ancestors.add(value);
 const result=Array.isArray(value)?'["array",['+Array.from({length:value.length},(_,index)=>Object.hasOwn(value,index)?canonicalManualValue(value[index],ancestors):'["hole"]').join(',')+']]':'["object",{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalManualValue(value[key],ancestors)).join(',')+'}]';
 ancestors.delete(value);return result;
}

/** Strict transport shape: the browser supplies intent, never evidence or scope. */
export function parseManualMultipleRequest(value,{commit=false}={}){
 const allowed=new Set(['transactionId','allocations','note',...(commit?['reviewHash','requestId','confirm']:[])]);
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.has(key))||typeof value.transactionId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value.transactionId))throw fail('MANUAL_INVALID_REQUEST','Välj en giltig bankhändelse.',400);
 if(!Array.isArray(value.allocations)||value.allocations.length<2||value.allocations.length>MAX_ROWS)throw fail('MANUAL_INVALID_VECTOR','Fördelningen måste omfatta 2–20 fakturor.',400);
 const ids=new Set();
 const allocations=value.allocations.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>!['invoiceId','amountMinor'].includes(key))||typeof row.invoiceId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(row.invoiceId)||ids.has(row.invoiceId)||!positive(row.amountMinor))throw fail('MANUAL_INVALID_VECTOR','Varje faktura ska förekomma en gång med ett positivt belopp i hela ören.',400);
  ids.add(row.invoiceId);return {invoiceId:row.invoiceId,amountMinor:row.amountMinor};
 }).sort((a,b)=>compare(a.invoiceId,b.invoiceId));
 if(typeof value.note!=='string'||!value.note.trim()||value.note.length>1500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value.note))throw fail('MANUAL_REVIEW_NOTE_REQUIRED','Beskriv vilket originalunderlag som bekräftar hela fördelningen.',400);
 const request={transactionId:value.transactionId,allocations,note:value.note.trim()};
 if(commit){
  if(value.confirm!==true||typeof value.reviewHash!=='string'||!/^[a-f0-9]{64}$/.test(value.reviewHash)||typeof value.requestId!=='string'||!/^[a-zA-Z0-9-]{10,80}$/.test(value.requestId))throw fail('MANUAL_CONFIRMATION_REQUIRED','Granska hela fördelningen och bekräfta den uttryckligen innan den sparas.',400);
  Object.assign(request,{reviewHash:value.reviewHash,requestId:value.requestId,confirm:true});
 }
 return request;
}

/** C4's unchanged assessment is evidence input, never an execution approval.
 * Only the explicitly enumerated multi-invoice diagnostics are considered here;
 * all other source, ownership, payer, balance and competition holds stay closed.
 */
export function manualMultipleCandidates(input,preview,transactionId){
 const decisions=preview?.decisions?.filter(row=>row.transactionId===transactionId)||[],decision=decisions[0];
 if(decisions.length!==1||preview?.ownerId!==input?.ownerId||preview?.companyId!==input?.companyId||preview?.snapshot?.revision!==input?.revision||preview?.reasonCodes?.length||decision?.bankEvidenceStatus!=='VERIFIED'||!Array.isArray(decision?.reasonCodes)||!decision.reasonCodes.includes('MULTIPLE_INVOICES_REQUIRE_REVIEW')||decision.reasonCodes.some(code=>!allowedDiagnostics.has(code)))throw evidenceFailure([...(preview?.reasonCodes||[]),...(decision?.reasonCodes||[])]);
 const transaction=input.transactions.find(row=>row.id===transactionId);
 if(!transaction||!transaction.economic||transaction.kind!=='payment'||!positive(transaction.amountMinor)||transaction.ignored||transaction.duplicateOf||transaction.reversal||transaction.holdReason||transaction.conflict||transaction.original?.status!=='VERIFIED'||transaction.accountEvidence?.status!=='VERIFIED'||transaction.accountEvidence.ownerId!==input.ownerId||transaction.accountEvidence.accountId!==transaction.accountId||transaction.payerEvidence?.origin!=='bank_original'||transaction.payerEvidence.scope!=='individual'||transaction.payerEvidence.conflict||!text(transaction.payerEvidence.name?.value)||transaction.referenceIncomplete)throw evidenceFailure([]);
 const references=matchingReferenceValues({candidates:transaction.references},'');
 if(references.length<2||references.length>MAX_ROWS)throw evidenceFailure(['MANUAL_REFERENCE_COUNT']);
 const invoices=[];
 for(const reference of references){
  // Closed and held originals still reserve their identifiers. Do not select a
  // convenient subset of owners or discard an unknown source reference.
  const owners=input.invoices.filter(invoice=>invoice.direction==='receivable'&&[invoice.number,invoice.explicitReference,...(invoice.referenceClaims||[])].some(claim=>canonicalInvoiceReference(claim)===reference));
  if(owners.length!==1||owners[0].number!==reference)throw evidenceFailure(['MANUAL_REFERENCE_OWNERSHIP']);
  const invoice=owners[0];
  if(invoice.companyId!==input.companyId||invoice.direction!=='receivable'||invoice.currency!==transaction.currency||!invoice.reviewed||invoice.voided||invoice.evidenceIssue||invoice.referenceClaimsComplete===false||invoice.explicitReference&&invoice.explicitReference!==invoice.number)throw evidenceFailure(['MANUAL_INVOICE_EVIDENCE']);
  if(!invoices.some(row=>row.id===invoice.id))invoices.push(invoice);
 }
 if(invoices.length<2||new Set(invoices.map(partyKey)).size!==1||!partyKey(invoices[0]))throw evidenceFailure(['MULTIPLE_INVOICE_CUSTOMER_CONFLICT']);
 if(canonicalManualValue(invoices.map(row=>row.id).sort(compare))!==canonicalManualValue([...decision.candidateInvoiceIds].sort(compare)))throw evidenceFailure(['MANUAL_REFERENCE_OWNERSHIP']);
 if(input.allocations.some(row=>row.active&&row.transactionId===transactionId&&invoices.some(invoice=>invoice.id===row.invoiceId)))throw evidenceFailure(['ALREADY_ALLOCATED_PAIR']);
 const used=sum(input.allocations.filter(row=>row.active&&row.transactionId===transactionId).map(row=>row.amountMinor));
 const availableMinor=transaction.amountMinor-used;
 if(!positive(availableMinor)||availableMinor!==decision.availableMinor)throw evidenceFailure(['INVALID_PAYMENT_BALANCE']);
 const rows=invoices.sort((a,b)=>compare(a.id,b.id)).map(invoice=>{
  const paid=sum(input.allocations.filter(row=>row.active&&row.invoiceId===invoice.id).map(row=>row.amountMinor*(row.effect==='refund'?-1:1)));
  const remaining=sum([invoice.totalMinor,-invoice.creditMinor,-paid]);
  if(!positive(remaining))throw evidenceFailure(['INVALID_INVOICE_BALANCE']);
  return {invoiceId:invoice.id,number:invoice.number,reference:invoice.number,customer:invoice.customerName,currency:invoice.currency,invoiceTotalMinor:invoice.totalMinor,invoiceRemainingBeforeMinor:remaining};
 });
 const requiredMinor=sum(rows.map(row=>row.invoiceRemainingBeforeMinor));
 return {version:MANUAL_MULTIPLE_VERSION,mode:'manual_review',method:'manual_multiple',ownerId:input.ownerId,companyId:input.companyId,revision:input.revision,transactionId,bankId:transaction.bankId,accountId:transaction.accountId,currency:transaction.currency,payer:transaction.payerEvidence.name.value,references:[...references].sort(compare),availableMinor,requiredMinor,shortfallMinor:Math.max(0,requiredMinor-availableMinor),excessMinor:Math.max(0,availableMinor-requiredMinor),invoices:rows};
}

export function manualMultiplePlan(input,preview,rawRequest){
 const base=manualMultipleCandidates(input,preview,rawRequest?.transactionId),request=parseManualMultipleRequest(rawRequest);
 if(request.allocations.length!==base.invoices.length||request.allocations.some(row=>!base.invoices.some(invoice=>invoice.invoiceId===row.invoiceId)))throw fail('MANUAL_INCOMPLETE_COVERAGE','Alla fakturor som bankoriginalets referenser anger måste ingå exakt en gång.');
 const allocations=request.allocations.map(row=>{
  const invoice=base.invoices.find(invoice=>invoice.invoiceId===row.invoiceId);
  if(row.amountMinor>invoice.invoiceRemainingBeforeMinor)throw fail('MANUAL_AMOUNT_EXCEEDS_DEBT','Ett delbelopp överstiger fakturans återstående skuld.');
  return {...invoice,amountMinor:row.amountMinor,invoiceRemainingAfterMinor:invoice.invoiceRemainingBeforeMinor-row.amountMinor};
 });
 const allocatedMinor=sum(allocations.map(row=>row.amountMinor));
 if(allocatedMinor>base.availableMinor)throw fail('MANUAL_AMOUNT_EXCEEDS_PAYMENT','Summan överstiger betalningens tillgängliga belopp.');
 const paymentRemainingMinor=base.availableMinor-allocatedMinor;
 if(paymentRemainingMinor>0&&allocations.some(row=>row.invoiceRemainingAfterMinor>0))throw fail('MANUAL_BOTH_REMAINDERS','Fördela hela betalningen eller lös samtliga fakturors återstående skuld. Både betalningsrest och fakturarest kan inte lämnas i samma fördelning.');
 const {invoices,...summary}=base;
 return {...summary,allocations,allocatedMinor,paymentRemainingMinor,note:request.note};
}

/** The hash of this value binds evidence and intent; it is not bank evidence. */
export function manualMultipleBinding(input,plan){
 const {checkedAt,...facts}=input;
 return canonicalManualValue({version:MANUAL_MULTIPLE_VERSION,input:facts,plan});
}
