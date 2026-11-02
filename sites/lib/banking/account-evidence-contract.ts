/** Additive v1 projection of the owned, live account-details reader.
 * Account identity does not establish a Bankgiro mapping, the report/deposit
 * relationship, the payer, or permission to reconcile a payment. No account
 * numbers, references, provider UIDs or raw resources belong in this contract.
 */
export type BankAccountEvidenceStatus='verified'|'review'|'blocked';
export type BankAccountEvidenceReasonCode=
 |'ACCOUNT_IDENTITY_VERIFIED'
 |'ACCOUNT_ALIAS_MISSING'
 |'EVIDENCE_STALE'
 |'EVIDENCE_AMBIGUOUS'
 |'EVIDENCE_INCOMPLETE'
 |'PROVIDER_EVIDENCE_UNAVAILABLE'
 |'INVALID_ACCOUNT_EVIDENCE';
export type BankAccountAliasScheme='IBAN'|'BBAN'|'CPAN';
export type BankAccountEvidenceAlias={
 reportRowIndex:number;
 scheme:BankAccountAliasScheme;
 sourcePath:string;
 reportSourcePath:string;
};
export type BankAccountEvidence={
 schemaVersion:'1.0.0';
 scope:'recipient_account_identity';
 status:BankAccountEvidenceStatus;
 checkedAt:string|null;
 transactionId:string|null;
 documentId:string|null;
 workspaceRevision:number|null;
 reasonCode:BankAccountEvidenceReasonCode;
 source:'enable_banking';
 aliases:BankAccountEvidenceAlias[];
 bankgiroMapping:{status:'blocked';reasonCode:'PROVIDER_MAPPING_UNAVAILABLE'};
 paymentReconciliationAllowed:false;
};

const MAX_RESOURCES=5,MAX_ROWS=50;
const identifier=(value:unknown):string|null=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value)?value:null;
const revision=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
function timestamp(value:unknown):string|null{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return null;
 const parsed=Date.parse(value);
 return Number.isFinite(parsed)&&new Date(parsed).toISOString()===value?value:null;
}
/** Snapshot only own data properties. Never call accessors or coerce objects.
 * Proxy descriptor/prototype failures are caught at the exported boundary.
 */
function record(value:unknown):Record<string,unknown>|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const prototype=Object.getPrototypeOf(value);
 if(prototype!==Object.prototype&&prototype!==null)return null;
 const descriptors=Object.getOwnPropertyDescriptors(value),out=Object.create(null) as Record<string,unknown>;
 for(const key of Reflect.ownKeys(descriptors)){
  if(typeof key!=='string')return null;
  const descriptor=descriptors[key];
  if(!('value'in descriptor))return null;
  out[key]=descriptor.value;
 }
 return out;
}
function reportRows(value:unknown):unknown[]|null{
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)return null;
 const descriptors=Object.getOwnPropertyDescriptors(value as object),length:unknown=descriptors.length?.value;
 if(typeof length!=='number'||!Number.isSafeInteger(length)||length<1||length>MAX_ROWS||Reflect.ownKeys(descriptors).length!==length+1)return null;
 const rows:unknown[]=[];
 for(let index=0;index<length;index++){
  const descriptor=descriptors[String(index)];
  if(!descriptor||!('value'in descriptor))return null;
  rows.push(descriptor.value);
 }
 return rows;
}
function blockedReason(status:unknown):BankAccountEvidenceReasonCode{
 switch(status){
  case 'missing':return 'ACCOUNT_ALIAS_MISSING';
  case 'stale':return 'EVIDENCE_STALE';
  case 'ambiguous':return 'EVIDENCE_AMBIGUOUS';
  case 'incomplete':return 'EVIDENCE_INCOMPLETE';
  case 'blocked':case 'error':return 'PROVIDER_EVIDENCE_UNAVAILABLE';
  default:return 'INVALID_ACCOUNT_EVIDENCE';
 }
}
function emptyEvidence():BankAccountEvidence{
 return {
  schemaVersion:'1.0.0',scope:'recipient_account_identity',status:'blocked',
  checkedAt:null,transactionId:null,documentId:null,workspaceRevision:null,
  reasonCode:'INVALID_ACCOUNT_EVIDENCE',source:'enable_banking',aliases:[],
  // Unavailable means this projection has no verified mapping. It does not
  // assert that every provider/bank schema is incapable of representing BGNR.
  bankgiroMapping:{status:'blocked',reasonCode:'PROVIDER_MAPPING_UNAVAILABLE'},
  paymentReconciliationAllowed:false
 };
}
function alias(value:unknown,index:number):BankAccountEvidenceAlias|null{
 const row=record(value);
 if(!row||row.rowIndex!==index||row.status!=='matched'||row.matched!==true||row.ambiguous!==false||row.sourceScope!=='current_owned_ais_consent'||row.reportSourcePath!==`rows[${index}].account`)return null;
 const scheme=row.scheme,sourcePath=row.sourcePath;
 if(scheme!=='IBAN'&&scheme!=='BBAN'&&scheme!=='CPAN'||typeof sourcePath!=='string')return null;
 if(sourcePath==='account_id.iban'){
  if(scheme!=='IBAN')return null;
 }else if(sourcePath!=='account_id.other.identification'&&!/^all_account_ids\[(?:[0-9]|[1-4][0-9])\]\.identification$/.test(sourcePath))return null;
 return {reportRowIndex:index,scheme,sourcePath,reportSourcePath:`rows[${index}].account`};
}

/** Pure projection; no network, storage or economic side effects.
 *
 * The caller supplies the existing authenticated server reader result. This
 * validates its shape and consistency; it does not authenticate arbitrary client
 * JSON or make a previously stored result current again. Consumers must retain
 * the transaction/document/revision context when using a response.
 *
 * `review` is reserved for a future, explicitly defined manual provenance
 * contract. The current reader has no such contract, so this projection only
 * emits verified/blocked. Missing aliases or an arbitrary manualRelationship
 * input cannot create positive evidence. A blocked result exposes no aliases.
 */
export function projectBankAccountEvidence(result:unknown):BankAccountEvidence{
 const evidence=emptyEvidence();
 try{
  const value=record(result);
  if(!value)return evidence;
  evidence.checkedAt=timestamp(value.checkedAt);
  evidence.transactionId=identifier(value.transactionId);
  evidence.documentId=identifier(value.documentId);
  evidence.workspaceRevision=revision(value.revision);
  evidence.reasonCode=blockedReason(value.status);
  if(value.status!=='matched')return evidence;
  if(evidence.checkedAt===null||evidence.transactionId===null||evidence.documentId===null||evidence.workspaceRevision===null||value.changed!==false||value.providerContacted!==true||value.snapshotCurrent!==true||value.accountMatch!==true||value.complete!==true||value.ambiguous!==false||value.resourcesComplete!==true||value.sourceScope!=='current_owned_ais_consent'||value.sourcePath!=='GET /accounts/{consent-account}/details'||value.originalIntegrity!=='passed'||value.reportSourceScope!=='owned_retained_original'||value.originalAuthenticityProved!==false||value.relationshipProved!==false)return evidence;
  if(value.resourceReadLimit!==MAX_RESOURCES||value.reportRowLimit!==MAX_ROWS||typeof value.resourcesRead!=='number'||!Number.isSafeInteger(value.resourcesRead)||value.resourcesRead<1||value.resourcesRead>MAX_RESOURCES||value.resourcesRead!==value.resourcesTotal||typeof value.reportRowCount!=='number'||!Number.isSafeInteger(value.reportRowCount)||value.reportRowCount<1||value.reportRowCount>MAX_ROWS)return evidence;
  const rows=reportRows(value.rows);
  if(!rows||rows.length!==value.reportRowCount)return evidence;
  const aliases:BankAccountEvidenceAlias[]=[];
  for(let index=0;index<rows.length;index++){
   const match=alias(rows[index],index);
   if(!match)return evidence;
   aliases.push(match);
  }
  evidence.status='verified';
  evidence.reasonCode='ACCOUNT_IDENTITY_VERIFIED';
  evidence.aliases=aliases;
  return evidence;
 }catch{
  // Never copy a thrown message, provider payload, getter value or proxy trap.
  return emptyEvidence();
 }
}
