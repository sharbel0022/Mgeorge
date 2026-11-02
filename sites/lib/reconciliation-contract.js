// Internal, server-adapted evidence only. No I/O or financial mutations.
import {matchingReferenceValues} from './payment-references.js';
import {canonicalInvoiceReference,resolveInvoiceReferenceConfiguration} from './invoice-reference-policy.js';

export const RECONCILIATION_CONTRACT_VERSION='mgeorge-reconciliation-v1';
const rank={VERIFIED:0,REVIEW:1,BLOCKED:2};
const text=value=>typeof value==='string'&&value.length>0;
const money=value=>Number.isSafeInteger(value)&&value>=0;
const positive=value=>money(value)&&value>0;

/** Trusted persisted C1 configuration only; this does not establish bank facts. */
export function invoiceReferencePolicyFromContext(context,companyId){
 const {policy,issue}=resolveInvoiceReferenceConfiguration(context);
 if(issue||!text(companyId)||!policy||policy.direction!=='customer'||policy.referenceSource!=='invoice_number'||policy.matchMode!=='exact')return null;
 return {version:RECONCILIATION_CONTRACT_VERSION,companyId,invoiceNumberIsPaymentReference:true,preserveLeadingZeros:true,comparison:'exact',source:`${policy.version}:${policy.id}`};
}
const name=value=>typeof value==='string'?value.normalize('NFKC').toLocaleLowerCase('sv-SE').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' '):'';
const organization=value=>typeof value==='string'?value.replace(/[- ]/g,''):'';
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const original=proof=>proof?.status==='VERIFIED'&&['bank_api','bank_file','bankgiro_file'].includes(proof.source)&&text(proof.id)&&/^[a-f0-9]{64}$/.test(proof.sha256);
const worse=(a,b)=>rank[b]>rank[a]?b:a;
function hold(decision,status,reason,bank=false){
 decision.status=worse(decision.status,status);
 if(bank)decision.bankEvidenceStatus=worse(decision.bankEvidenceStatus,status);
 if(!decision.reasonCodes.includes(reason))decision.reasonCodes.push(reason);
}
function sum(values){let total=0;for(const value of values){if(!Number.isSafeInteger(value)||!Number.isSafeInteger(total+value))return null;total+=value;}return total;}

// A deterministic encoding also distinguishes invalid numeric values. In
// particular NaN and Infinity must not collapse into a valid null snapshot.
function canonical(value,ancestors=new Set()){
 if(value===undefined)return '["undefined"]';
 if(typeof value==='number'&&!Number.isFinite(value))return JSON.stringify(['nonfinite',String(value)]);
 if(typeof value==='bigint')return JSON.stringify(['bigint',String(value)]);
 if(value===null||typeof value!=='object'){
  if(typeof value==='function'||typeof value==='symbol')throw new TypeError('Non-data snapshot');
  return JSON.stringify(value);
 }
 if(ancestors.has(value))throw new TypeError('Cyclic snapshot');
 ancestors.add(value);
 const result=Array.isArray(value)?'['+value.map(item=>canonical(item,ancestors)).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key],ancestors)).join(',')+'}';
 ancestors.delete(value);return result;
}
async function fingerprint(input){
 const {checkedAt,...facts}=input;
 const bytes=new TextEncoder().encode(canonical(facts));
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function duplicateIds(rows){const seen=new Set();for(const row of rows){if(!row||!text(row.id)||seen.has(row.id))return true;seen.add(row.id);}return false;}
function accountValid(evidence,t,input){
 return evidence?.status==='VERIFIED'&&evidence.source==='bank_account_resource'&&text(evidence.proofId)&&
  evidence.ownerId===input.ownerId&&text(t.accountId)&&evidence.accountId===t.accountId&&evidence.currency===t.currency&&
  (!evidence.validUntil||Number.isFinite(Date.parse(evidence.validUntil))&&Date.parse(evidence.validUntil)>Date.parse(input.checkedAt));
}
function bankProblems(t,input){
 const problems=[];
 if(!original(t.original))problems.push('ORIGINAL_MISSING_OR_INVALID');
 if(!accountValid(t.accountEvidence,t,input))problems.push('ACCOUNT_EVIDENCE_REQUIRED');
 if(t.conflict||t.payerEvidence?.conflict)problems.push('BANK_EVIDENCE_CONFLICT');
 if(!text(t.bankId))problems.push('BANK_PAYMENT_ID_REQUIRED');
 if(!date(t.bookedDate))problems.push('INVALID_BANK_DATE');
 if(t.reversal||t.amountMinor<0)problems.push('REVERSAL_OR_OUTGOING_PAYMENT');
 if(!Number.isSafeInteger(t.amountMinor)||t.amountMinor===0)problems.push('INVALID_MONEY');
 if(t.currency!=='SEK')problems.push('UNSUPPORTED_CURRENCY');
 return problems;
}

/** Consume C1's server-derived invoice projection, not its configuration or a
 * browser payload. The legacy absence case keeps the explicit-reference census;
 * incomplete future projections cannot certify uniqueness of other invoices. */
export function adaptInvoiceReferenceEvidence(facts){
 if(!facts||typeof facts!=='object'||Array.isArray(facts))return {referenceClaims:[],issue:'C1_REFERENCE_POLICY_INVALID',complete:false};
 const decision=facts.referencePolicy,rawClaims=facts.referencePolicyIdentifiers;
 const referenceClaims=Array.isArray(rawClaims)?rawClaims.filter(text):[];
 const result=(issue,complete=true)=>({referenceClaims,issue,complete});
 if(decision===undefined&&rawClaims===undefined)return result('');
 const validClaims=Array.isArray(rawClaims)&&Array.from(rawClaims).every(text);
 if(!decision||decision.version!=='invoice-reference-policy-v1'||!['REVIEW','BLOCKED'].includes(decision.status)||typeof decision.applies!=='boolean'||!validClaims||!Array.isArray(decision.issues)||!Array.from(decision.issues).every(v=>typeof v==='string')||typeof decision.reason!=='string')return result('C1_REFERENCE_POLICY_INVALID',false);
 // Reserve C1's bounded, exterior-space-trimmed identity alongside each raw
 // observation, including on held invoices. Financial fields stay unchanged.
 for(const claim of rawClaims){const alias=canonicalInvoiceReference(claim);if(alias&&!referenceClaims.includes(alias))referenceClaims.push(alias);}
 const number=facts.invoice_number??facts.number,declared=facts.reference??facts.ocr??'';
 const decisionReferences=[decision.invoiceNumber,decision.intendedPaymentReference,decision.declaredPaymentReference];
 const knownClaims=[number,declared,...decisionReferences,facts.referenceOriginal?.invoice_number,facts.referenceOriginal?.reference].filter(text);
 // Held/non-applicable invoices still reserve their known original identities.
 // An incomplete census can invalidate uniqueness for a different invoice.
 if(typeof number!=='string'||typeof declared!=='string'||decisionReferences.some(value=>value!==null&&typeof value!=='string')||knownClaims.some(value=>!referenceClaims.includes(value)))return result('C1_REFERENCE_POLICY_INVALID',false);
 if(decision.status==='BLOCKED')return result('C1_REFERENCE_POLICY_BLOCKED');
 if(!decision.applies)return result('C1_REFERENCE_POLICY_NOT_APPLICABLE');
 if(decision.source!=='invoice_number_policy')return result('C1_REFERENCE_POLICY_MODE_UNSUPPORTED');
 if(!text(decision.policyId)||!text(number)||decision.invoiceNumber!==number||decision.intendedPaymentReference!==number||!referenceClaims.includes(number)||typeof declared!=='string'||(decision.declaredPaymentReference??'')!==declared||declared&&!referenceClaims.includes(declared))return result('C1_REFERENCE_POLICY_INVALID',false);
 return result('');
}

/**
 * Build a proposal from a complete, authoritative adapter snapshot. Verification
 * flags are adapter results, never authentication of arbitrary browser JSON.
 */
export async function buildReconciliationPreview(raw){
 const input=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
 const problems=[];
 const collections=['transactions','invoices','allocations','reports','relationships','customerRelationships','importJobs'];
 const rows={};
 for(const key of collections){
  if(!Array.isArray(input[key])){rows[key]=[];problems.push('INCOMPLETE_SNAPSHOT');}
  else rows[key]=input[key];
  if(duplicateIds(rows[key]))problems.push('DUPLICATE_OR_INVALID_RECORD_ID');
 }
 if(input.contractVersion!==RECONCILIATION_CONTRACT_VERSION)problems.push('UNSUPPORTED_CONTRACT_VERSION');
 if(input.complete!==true||rows.importJobs.some(job=>job?.complete!==true||job?.status!=='complete'))problems.push('INCOMPLETE_SNAPSHOT');
 if(!text(input.ownerId)||!text(input.companyId)||!Number.isFinite(Date.parse(input.checkedAt))||!(Number.isSafeInteger(input.revision)&&input.revision>=0||text(input.revision)))problems.push('INVALID_SNAPSHOT_SCOPE');
 const policy=input.referencePolicy;
 if(!policy||policy.version!==RECONCILIATION_CONTRACT_VERSION||policy.companyId!==input.companyId||policy.invoiceNumberIsPaymentReference!==true||policy.preserveLeadingZeros!==true||policy.comparison!=='exact'||!text(policy.source))problems.push('REFERENCE_POLICY_REQUIRED');
 let sha256;
 try{sha256=await fingerprint(input);}catch{problems.push('INVALID_SNAPSHOT_DATA');sha256=await fingerprint({invalidSnapshot:true});}
 const preview={contractVersion:RECONCILIATION_CONTRACT_VERSION,mode:'preview',changed:false,writesAllowed:false,approvalRequired:true,
  ownerId:input.ownerId||'',companyId:input.companyId||'',checkedAt:input.checkedAt||'',status:'VERIFIED',reasonCodes:[],snapshot:{revision:input.revision??'',sha256},decisions:[]};
 const {transactions,invoices,allocations,reports,relationships,customerRelationships}=rows;
 const txById=new Map(transactions.filter(Boolean).map(t=>[t.id,t]));
 const invoiceById=new Map(invoices.filter(Boolean).map(i=>[i.id,i]));
 const reportById=new Map(reports.filter(Boolean).map(r=>[r.id,r]));
 const invoiceBalance=new Map(),usedByTransaction=new Map(),activePairs=new Set();
 const paidByInvoice=new Map();
 for(const a of allocations){
  if(!a||typeof a.active!=='boolean'||!positive(a.amountMinor)||!['payment','refund'].includes(a.effect)){problems.push('INVALID_ALLOCATION');continue;}
  if(!a.active)continue;
  const t=txById.get(a.transactionId),i=invoiceById.get(a.invoiceId);
  if(!t||!i||t.currency!==i.currency||Math.sign(t.amountMinor)!==(i.direction==='receivable'?1:-1)*(a.effect==='refund'?-1:1)){problems.push('ALLOCATION_EVIDENCE_CONFLICT');continue;}
  const pair=JSON.stringify([a.invoiceId,a.transactionId]);
  if(activePairs.has(pair))problems.push('DUPLICATE_ALLOCATION_PAIR');activePairs.add(pair);
  const used=sum([usedByTransaction.get(t.id)||0,a.amountMinor]);
  const paid=sum([paidByInvoice.get(i.id)||0,a.amountMinor*(a.effect==='refund'?-1:1)]);
  if(used===null||paid===null)problems.push('MONEY_OVERFLOW');
  usedByTransaction.set(t.id,used??NaN);paidByInvoice.set(i.id,paid??NaN);
 }
 for(const i of invoices){
  if(i?.referenceClaimsComplete===false)problems.push('INCOMPLETE_REFERENCE_OWNERSHIP');
  if(!i||!text(i.number)||typeof i.explicitReference!=='string'||i.referenceClaims!==undefined&&(!Array.isArray(i.referenceClaims)||!Array.from(i.referenceClaims).every(text))||i.referenceClaimsComplete!==undefined&&typeof i.referenceClaimsComplete!=='boolean'||i.companyId!==input.companyId||!positive(i.totalMinor)||!money(i.creditMinor)||i.creditMinor>i.totalMinor||!['receivable','payable'].includes(i.direction)||typeof i.reviewed!=='boolean'||typeof i.voided!=='boolean'){
   problems.push('INVALID_INVOICE');continue;
  }
  const paid=paidByInvoice.get(i.id)||0,remaining=sum([i.totalMinor,-i.creditMinor,-paid]);
  if(!money(paid)||remaining===null||remaining<0){problems.push('INVALID_INVOICE_BALANCE');continue;}
  invoiceBalance.set(i.id,remaining);
 }
 for(const t of transactions){
  if(!t||!Number.isSafeInteger(t.amountMinor)||t.amountMinor===0||typeof t.economic!=='boolean'||typeof t.ignored!=='boolean'||!['payment','aggregate'].includes(t.kind)||!Array.isArray(t.references))problems.push('INVALID_TRANSACTION');
  if(t&&(!money(usedByTransaction.get(t.id)||0)||(usedByTransaction.get(t.id)||0)>Math.abs(t.amountMinor)))problems.push('INVALID_PAYMENT_BALANCE');
 }

 // A retained, explicitly non-economic duplicate is an observation, not a
 // competing payment. A conflicting copy cannot hide behind duplicateOf.
 const exactDuplicate=t=>{
  const target=t?.duplicateOf&&txById.get(t.duplicateOf);
  return !!target&&target!==t&&t.economic===false&&original(t.original)&&original(target.original)&&
   ['bankId','accountId','amountMinor','currency','bookedDate'].every(key=>t[key]===target[key])&&
   canonical(t.payerEvidence)===canonical(target.payerEvidence)&&canonical(t.references)===canonical(target.references);
 };
 const bankIds=new Map();
 for(const t of transactions)if(t&&text(t.bankId)&&!exactDuplicate(t))bankIds.set(t.bankId,[...(bankIds.get(t.bankId)||[]),t]);
 const sourceProblems=(t,allowOutgoing=false)=>{
  const reasons=bankProblems(t,input).filter(reason=>!(allowOutgoing&&!t.reversal&&reason==='REVERSAL_OR_OUTGOING_PAYMENT'));
  if((bankIds.get(t.bankId)||[]).length>1)reasons.push('DUPLICATE_BANK_PAYMENT_ID');
  return reasons;
 };

 const activeRelations=relationships.filter(r=>r?.active===true),relationsByReport=new Map(),relationsByParent=new Map();
 for(const r of activeRelations){
  if(!reportById.has(r.reportId)||!txById.has(r.transactionId))problems.push('REPORT_DEPOSIT_RELATION_INVALID');
  relationsByReport.set(r.reportId,[...(relationsByReport.get(r.reportId)||[]),r]);
  relationsByParent.set(r.transactionId,[...(relationsByParent.get(r.transactionId)||[]),r]);
 }
 const reportChecks=new Map();
 for(const r of reports){
  if(!r)continue;
  const reasons=[];let status='VERIFIED';
  const fail=code=>{status='BLOCKED';reasons.push(code);};
  if(!original(r.original))fail('REPORT_ORIGINAL_MISSING_OR_INVALID');
  const ids=Array.isArray(r.paymentIds)?r.paymentIds:[],children=ids.map(id=>txById.get(id));
  const total=sum(children.map(child=>child?.amountMinor));
  if(!positive(r.paymentCount)||r.paymentCount!==ids.length||new Set(ids).size!==ids.length||!positive(r.totalMinor)||total!==r.totalMinor||children.some(child=>!child||child.kind!=='payment'||child.reportId!==r.id||child.amountMinor<=0||child.accountId!==r.accountId||child.currency!==r.currency||child.bookedDate!==r.bookedDate))fail('REPORT_INCOMPLETE_OR_CONFLICTING');
  for(const child of children.filter(Boolean)){
   for(const problem of sourceProblems(child))fail(problem);
   if(child.original?.id!==r.original?.id||child.original?.sha256!==r.original?.sha256)fail('REPORT_ORIGINAL_MEMBERSHIP_CONFLICT');
   if(child.ignored||child.duplicateOf||child.holdReason)fail('REPORT_MEMBER_HELD');
  }
  // A hidden extra row invalidates the report even when its declared list sums.
  if(transactions.some(t=>t?.reportId===r.id&&!ids.includes(t.id)))fail('REPORT_INCOMPLETE_OR_CONFLICTING');
  const links=relationsByReport.get(r.id)||[],relation=links[0],parent=relation&&txById.get(relation.transactionId);
  if(links.length!==1||!parent||(relationsByParent.get(parent?.id)||[]).length!==1)fail('REPORT_DEPOSIT_RELATION_REQUIRED');
  if(parent){
   if(parent.kind!=='aggregate'||parent.amountMinor!==r.totalMinor||parent.accountId!==r.accountId||parent.currency!==r.currency)fail('REPORT_DEPOSIT_CONFLICT');
   if((usedByTransaction.get(parent.id)||0)>0)fail('AGGREGATE_ALREADY_ALLOCATED');
   if(parent.economic&&children.some(child=>child?.economic))fail('DOUBLE_COUNTED_DEPOSIT');
   if(children.some(child=>child?.parentId&&child.parentId!==parent.id))fail('REPORT_DEPOSIT_CONFLICT');
   if(transactions.some(t=>t?.parentId===parent.id&&!ids.includes(t.id)))fail('REPORT_INCOMPLETE_OR_CONFLICTING');
   for(const problem of sourceProblems(parent))fail(problem);
  }
  if(relation?.method==='manual_review'&&relation.status==='REVIEW'){
   status=worse(status,'REVIEW');reasons.push('MANUAL_REPORT_RELATION');
  }else if(relation?.method!=='bank_identity'||relation.status!=='VERIFIED'||!text(r.bankDepositId)||r.bankDepositId!==parent?.bankId||r.bookedDate!==parent?.bookedDate||children.some(child=>child?.parentId!==parent?.id)){
   fail('SHARED_BANK_DEPOSIT_ID_REQUIRED');
  }
  if(!parent?.economic&&children.some(child=>!child?.economic))fail('INCOMPLETE_ECONOMIC_REPLACEMENT');
  reportChecks.set(r.id,{status,reasons:[...new Set(reasons)],parentId:parent?.id||'',children:ids});
 }

 // These are the sources whose account validity supports a selected decision:
 // its lineage, every member of a complete report, and any allocated balance
 // sources added below. Unrelated accounts must not impose their deadlines.
 const sourceDependencies=root=>{
  const found=new Set(),pending=[root];
  while(pending.length){
   const current=pending.pop();if(!current||found.has(current))continue;found.add(current);
   if(current.parentId)pending.push(txById.get(current.parentId));
   const links=relationsByParent.get(current.id)||[];
   const checks=[reportChecks.get(current.reportId),...links.map(link=>reportChecks.get(link.reportId))];
   for(const check of checks.filter(Boolean)){
    pending.push(txById.get(check.parentId));
    for(const id of check.children)pending.push(txById.get(id));
   }
  }
  return found;
 };
 const allocatedSourceInvalid=a=>{
  const source=txById.get(a.transactionId);if(!source)return true;
  for(const dependency of sourceDependencies(source)){
   if(sourceProblems(dependency,dependency===source&&a.effect==='refund').length||dependency.holdReason||dependency.ignored||dependency.duplicateOf)return true;
   if(dependency.reportId&&reportChecks.get(dependency.reportId)?.status!=='VERIFIED'||dependency.parentId&&!dependency.reportId)return true;
   const seen=new Set([dependency.id]);let parentId=dependency.parentId;
   while(parentId){
    const parent=txById.get(parentId);if(!parent||seen.has(parentId))return true;
    seen.add(parentId);parentId=parent.parentId;
   }
  }
  return false;
 };
 // Invoice numbers belong to the obligation's cashflow scope. An incoming
 // customer payment cannot acquire ownership from an unrelated supplier bill.
 // Keep every held/closed/original claim inside its own direction's census.
 const referenceKey=(direction,value)=>JSON.stringify([direction,value]);
 const ownersByReference=new Map(),claimOwners=new Map();
 for(const i of invoices)if(i&&text(i.number)){
  const numberKey=referenceKey(i.direction,i.number);
  ownersByReference.set(numberKey,[...(ownersByReference.get(numberKey)||[]),i]);
  for(const value of new Set([i.number,i.explicitReference,...(Array.isArray(i.referenceClaims)?i.referenceClaims:[])].filter(text))){
   const key=referenceKey(i.direction,value),owners=claimOwners.get(key)||new Set();owners.add(i.id);claimOwners.set(key,owners);
  }
 }
 for(const t of transactions){
  if(!t)continue;
  const available=t.economic&&!t.ignored&&!t.duplicateOf&&Number.isSafeInteger(t.amountMinor)?Math.max(0,Math.abs(t.amountMinor)-(usedByTransaction.get(t.id)||0)):0;
  const decision={transactionId:t.id,status:'VERIFIED',bankEvidenceStatus:'VERIFIED',reasonCodes:[],payer:structuredClone(t.payerEvidence??null),references:structuredClone(Array.isArray(t.references)?t.references:[]),candidateInvoiceIds:[],conflictingInvoiceIds:[],allocations:[],availableMinor:Number.isSafeInteger(available)?available:0,unallocatedMinor:Number.isSafeInteger(available)?available:0,reportedAmountMinor:t.amountMinor,economic:t.economic===true};
  preview.decisions.push(decision);
  for(const problem of problems)hold(decision,'BLOCKED',problem);
  for(const problem of sourceProblems(t))hold(decision,'BLOCKED',problem,true);
  if(t.ignored||t.duplicateOf)hold(decision,'BLOCKED','EXCLUDED_OR_DUPLICATE_PAYMENT');
  if(t.holdReason)hold(decision,'BLOCKED','REVOKED_OR_HELD_PAYMENT');
  const visited=new Set([t.id]);let parentId=t.parentId;
  while(parentId){
   if(visited.has(parentId)){hold(decision,'BLOCKED','CYCLIC_PAYMENT_LINEAGE',true);break;}
   visited.add(parentId);const parent=txById.get(parentId);
   if(!parent){hold(decision,'BLOCKED','PAYMENT_PARENT_MISSING',true);break;}
   for(const problem of sourceProblems(parent))hold(decision,'BLOCKED',problem,true);
   if(parent.holdReason||parent.ignored||parent.duplicateOf)hold(decision,'BLOCKED','ANCESTOR_EVIDENCE_HELD',true);
   parentId=parent.parentId;
  }
  if(t.reportId){
   const check=reportChecks.get(t.reportId);
   if(!check)hold(decision,'BLOCKED','REPORT_MISSING',true);
   else for(const reason of check.reasons)hold(decision,check.status,reason,true);
  }else if(t.parentId)hold(decision,'BLOCKED','REPORT_REQUIRED_FOR_CHILD',true);
  if(t.kind==='aggregate'){
   const links=relationsByParent.get(t.id)||[],check=links.length===1?reportChecks.get(links[0].reportId):null;
   if(!check)hold(decision,'BLOCKED','INDIVIDUAL_PAYMENT_REPORT_REQUIRED',true);
   else{
    for(const reason of check.reasons)hold(decision,check.status,reason,true);
    if(check.status==='VERIFIED'&&!t.economic)decision.reasonCodes.push('AGGREGATE_REPRESENTED_BY_CHILDREN');
    else if(check.status==='VERIFIED')hold(decision,'REVIEW','REPORT_REPLACEMENT_REQUIRES_REVIEW');
   }
   continue;
  }
  const references=decision.references;
  if(t.referenceIncomplete||references.some(r=>!r||!text(r.value)||typeof r.rawValue!=='string'||!text(r.source)||!['ocr','structured','invoice','message'].includes(r.kind)||r.validity==='checksum_invalid'))hold(decision,'BLOCKED','INVALID_OR_CONFLICTING_REFERENCE',true);
  const values=matchingReferenceValues({candidates:references.filter(r=>r&&typeof r==='object'&&typeof r.value==='string')},'');
  if(!values.length)hold(decision,'BLOCKED','PAYMENT_REFERENCE_REQUIRED',true);
  const direction=t.amountMinor>0?'receivable':t.amountMinor<0?'payable':null;
  const referenceOwners=value=>ownersByReference.get(referenceKey(direction,value))||[];
  const owners=[...new Set(values.flatMap(referenceOwners))];
  decision.candidateInvoiceIds=owners.map(i=>i.id).sort();
  decision.conflictingInvoiceIds=[...new Set(values.flatMap(value=>{const claimed=claimOwners.get(referenceKey(direction,value));return (claimed?.size||0)>1?[...claimed]:[];}))].sort();
  if(decision.conflictingInvoiceIds.length)hold(decision,'BLOCKED','AMBIGUOUS_INVOICE_REFERENCE');
  if(!owners.length&&values.some(value=>(ownersByReference.get(referenceKey(direction==='receivable'?'payable':'receivable',value))||[]).length))hold(decision,'BLOCKED','INVOICE_REVIEW_OR_DIRECTION_REQUIRED');
  if(!owners.length)hold(decision,'REVIEW','INVOICE_NOT_FOUND');
  if(values.some(value=>!referenceOwners(value).length)&&owners.length)hold(decision,'BLOCKED','CONFLICTING_PAYMENT_REFERENCES',true);
  const payer=t.payerEvidence;
  const payerKnown=payer?.origin==='bank_original'&&payer.scope==='individual'&&!payer.conflict&&text(payer.name?.value)&&typeof payer.name?.rawValue==='string'&&text(payer.name?.source);
  if(!payerKnown)hold(decision,'BLOCKED','INDIVIDUAL_BANK_PAYER_REQUIRED',true);
  let customerEligible=true;
  for(const invoice of owners){
   if(text(invoice.explicitReference)&&invoice.explicitReference!==invoice.number){hold(decision,'REVIEW','INVOICE_REFERENCE_POLICY_CONFLICT');customerEligible=false;}
   if(invoice.direction!=='receivable'||invoice.currency!==t.currency||invoice.voided||!invoice.reviewed||invoice.evidenceIssue||!date(invoice.issuedDate)||invoice.issuedDate>t.bookedDate)hold(decision,'BLOCKED','INVOICE_REVIEW_OR_DIRECTION_REQUIRED');
   // Historical amounts stay booked, but an unavailable old payment source
   // cannot support a new verified balance-based allocation proposal.
   if(allocations.some(a=>a?.active&&a.invoiceId===invoice.id&&allocatedSourceInvalid(a)))hold(decision,'BLOCKED','EXISTING_ALLOCATION_EVIDENCE_INVALID');
   const ownOrg=organization(invoice.customerOrganizationNumber),payerOrg=organization(payer?.organizationNumber);
   const relation=customerRelationships.some(r=>r?.active===true&&r.approved===true&&r.invoiceId===invoice.id&&r.accountId===t.accountId&&text(r.evidence)&&name(r.payerName)===name(payer?.name?.value)&&(!r.payerOrganizationNumber||organization(r.payerOrganizationNumber)===payerOrg));
   if(ownOrg&&payerOrg&&ownOrg!==payerOrg){
    if(relation)hold(decision,'REVIEW','MANUAL_CUSTOMER_RELATION');
    else{hold(decision,'BLOCKED','PAYER_ORGANIZATION_CONFLICT');customerEligible=false;}
   }
   else if(!(payerKnown&&(ownOrg&&payerOrg?ownOrg===payerOrg:name(invoice.customerName)===name(payer.name.value)))){
    hold(decision,'REVIEW',relation?'MANUAL_CUSTOMER_RELATION':'CUSTOMER_RELATION_REQUIRED');
    if(!relation)customerEligible=false;
   }
   if(activePairs.has(JSON.stringify([invoice.id,t.id])))hold(decision,'BLOCKED','ALREADY_ALLOCATED_PAIR');
   if(invoiceBalance.get(invoice.id)===0)hold(decision,'BLOCKED','INVOICE_ALREADY_SETTLED');
  }
  if(!t.economic){hold(decision,decision.bankEvidenceStatus==='REVIEW'?'REVIEW':'BLOCKED','NON_ECONOMIC_REPORT_OBSERVATION');continue;}
  if(available<=0){hold(decision,'BLOCKED','PAYMENT_ALREADY_ALLOCATED');continue;}
  if(decision.status==='BLOCKED'||owners.length===0||!customerEligible)continue;
  const ordered=owners.slice().sort((a,b)=>a.id.localeCompare(b.id));
  if(ordered.length>1){
   const total=sum(ordered.map(i=>invoiceBalance.get(i.id)));
   hold(decision,'REVIEW','MULTIPLE_INVOICES_REQUIRE_REVIEW');
   if(total!==available){hold(decision,'BLOCKED','MULTIPLE_INVOICE_AMOUNT_CONFLICT');continue;}
   if(new Set(ordered.map(i=>organization(i.customerOrganizationNumber)||name(i.customerName))).size>1){hold(decision,'BLOCKED','MULTIPLE_INVOICE_CUSTOMER_CONFLICT');continue;}
  }
  for(const i of ordered){
   const remaining=invoiceBalance.get(i.id),amount=Math.min(available,remaining);
   if(!positive(amount)){hold(decision,'BLOCKED','INVALID_INVOICE_BALANCE');break;}
   const settlement=ordered.length>1?'multiple':available<remaining?'partial':available>remaining?'excess':'full';
   if(settlement==='partial'||settlement==='excess')hold(decision,'REVIEW',settlement==='partial'?'PARTIAL_PAYMENT_REQUIRES_REVIEW':'OVERPAYMENT_REQUIRES_REVIEW');
   decision.allocations.push({invoiceId:i.id,amountMinor:amount,currency:i.currency,invoiceRemainingBeforeMinor:remaining,invoiceRemainingAfterMinor:remaining-amount,settlement});
  }
  const proposed=sum(decision.allocations.map(a=>a.amountMinor));
  if(proposed===null||proposed>available)hold(decision,'BLOCKED','ALLOCATION_EXCEEDS_AVAILABLE');
  decision.unallocatedMinor=available-(proposed??0);
 }
 // Exhausted historical payments and exact non-economic duplicates do not
 // compete for new funds. Unspent held observations still expose ambiguity.
 const competitors=new Map();
 for(const d of preview.decisions)if(d.economic&&d.availableMinor>0)for(const id of d.candidateInvoiceIds)competitors.set(id,new Set([...(competitors.get(id)||[]),d.transactionId]));
 for(const d of preview.decisions){
  const dependencies=sourceDependencies(txById.get(d.transactionId));
  for(const allocation of allocations)if(allocation?.active&&d.candidateInvoiceIds.includes(allocation.invoiceId)){
   for(const source of sourceDependencies(txById.get(allocation.transactionId)))dependencies.add(source);
  }
  const deadlines=[...dependencies].map(source=>Date.parse(source.accountEvidence?.validUntil)).filter(Number.isFinite);
  d.evidenceValidUntil=deadlines.length?new Date(deadlines.reduce((earliest,current)=>Math.min(earliest,current))).toISOString():null;
  if(d.candidateInvoiceIds.some(id=>(competitors.get(id)?.size||0)>1)){
   hold(d,'REVIEW','COMPETING_PAYMENTS_REQUIRE_REVIEW');d.allocations=[];
  }
  if(d.status==='BLOCKED')d.allocations=[];
  d.unallocatedMinor=d.availableMinor-(sum(d.allocations.map(a=>a.amountMinor))??0);
  if(!d.reasonCodes.length)d.reasonCodes.push('EXACT_REFERENCE_AND_BANK_EVIDENCE');
  preview.status=worse(preview.status,d.status);
 }
 preview.reasonCodes=[...new Set(problems)];
 if(problems.length)preview.status='BLOCKED';
 return preview;
}

/** A trusted stored approval can be compared here; this never authorizes I/O. */
export function validateReconciliationApproval(preview,approval,context){
 const reasonCodes=[],deny=code=>{if(!reasonCodes.includes(code))reasonCodes.push(code);};
 if(!preview||preview.contractVersion!==RECONCILIATION_CONTRACT_VERSION||preview.mode!=='preview'||preview.changed!==false||preview.writesAllowed!==false)deny('INVALID_PREVIEW');
 if(!approval||approval.source!=='stored_business_approval'||approval.approved!==true||!text(approval.approvedBy)||!text(approval.requestId)||!Array.isArray(approval.decisions)||!approval.decisions.length)deny('BUSINESS_APPROVAL_REQUIRED');
 if(!context||!text(context.ownerId)||!Number.isFinite(Date.parse(context.now))||context.consumedRequestIds!==undefined&&!Array.isArray(context.consumedRequestIds))deny('INVALID_APPROVAL_CONTEXT');
 if(approval?.contractVersion!==RECONCILIATION_CONTRACT_VERSION||approval?.ownerId!==context?.ownerId||preview?.ownerId!==context?.ownerId)deny('APPROVAL_SCOPE_MISMATCH');
 if(!/^[a-f0-9]{64}$/.test(approval?.snapshotSha256)||approval?.snapshotSha256!==preview?.snapshot?.sha256||approval?.revision!==preview?.snapshot?.revision)deny('STALE_APPROVAL');
 if(!Number.isFinite(Date.parse(approval?.expiresAt))||Date.parse(approval.expiresAt)<=Date.parse(context?.now))deny('APPROVAL_EXPIRED');
 if(!Number.isFinite(Date.parse(preview?.checkedAt))||Date.parse(preview.checkedAt)>Date.parse(context?.now))deny('STALE_APPROVAL');
 if(Array.isArray(context?.consumedRequestIds)&&context.consumedRequestIds.includes(approval?.requestId))deny('APPROVAL_ALREADY_CONSUMED');
 const selected=new Set();
 for(const item of Array.isArray(approval?.decisions)?approval.decisions:[]){
  if(!item||selected.has(item.transactionId)){deny('APPROVAL_PROPOSAL_MISMATCH');continue;}
  selected.add(item.transactionId);
  const candidates=preview?.decisions?.filter(d=>d.transactionId===item.transactionId)||[],decision=candidates[0];
  if(candidates.length!==1||decision?.status!=='VERIFIED'||decision?.bankEvidenceStatus!=='VERIFIED'||!decision.allocations.length){deny('DECISION_NOT_VERIFIED');continue;}
  if(decision.evidenceValidUntil!==null&&(!Number.isFinite(Date.parse(decision.evidenceValidUntil))||Date.parse(decision.evidenceValidUntil)<=Date.parse(context?.now)))deny('STALE_APPROVAL');
  const expected=decision.allocations.map(({invoiceId,amountMinor,currency})=>({invoiceId,amountMinor,currency}));
  try{if(canonical(item.allocations)!==canonical(expected))deny('APPROVAL_PROPOSAL_MISMATCH');}catch{deny('APPROVAL_PROPOSAL_MISMATCH');}
 }
 return {valid:reasonCodes.length===0,reasonCodes,writesAllowed:false};
}
