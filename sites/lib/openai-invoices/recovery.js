// A fixed, read-only recovery view. Never return control rows, token state,
// markers or evidence to a document caller, and never clear a recovery gate.
const CONTROL='company_application_token_control';
const STATE='company_application_tokens';
const QUERY='SELECT id,revision,recovery_required,restore_marker,recovery_evidence FROM '+CONTROL;
export const INVOICE_AI_RECOVERY_CODES=Object.freeze(['AI_RECOVERY_REQUIRED','AI_RECOVERY_UNAVAILABLE']);
function status(rows){
  const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
  if(!row||row.id!==1||!Number.isSafeInteger(row.revision)||row.revision<1||
    ![0,1].includes(row.recovery_required)||typeof row.restore_marker!=='string'||row.restore_marker.length>100||
    typeof row.recovery_evidence!=='string'||row.recovery_evidence.length>200)return 'AI_RECOVERY_UNAVAILABLE';
  // A bank-token recovery release is not reconciliation of an AI spending
  // ledger rolled back with the snapshot. A retained restore marker keeps AI
  // blocked; this module deliberately provides no recovery-release operation.
  return row.recovery_required===1||row.restore_marker!==''?'AI_RECOVERY_REQUIRED':null;
}
export function readNodeInvoiceAiRecoveryStatus(database){
  try{
    const tables=database.prepare("SELECT name,type FROM sqlite_master WHERE name COLLATE NOCASE IN ('company_application_token_control','company_application_tokens')").all();
    const control=tables.find(row=>row.name.toLowerCase()===CONTROL),tokens=tables.find(row=>row.name.toLowerCase()===STATE);
    // Fresh standalone/company data databases predate the optional control
    // plane. A partial or malformed control plane is never treated as fresh.
    if(!control&&!tokens)return null;
    if(control?.type!=='table'||tokens&&tokens.type!=='table')return 'AI_RECOVERY_UNAVAILABLE';
    return status(database.prepare(QUERY).all());
  }catch{return 'AI_RECOVERY_UNAVAILABLE';}
}
export async function readD1InvoiceAiRecoveryStatus(database){
  try{return status((await database.prepare(QUERY).all()).results);}
  catch{return 'AI_RECOVERY_UNAVAILABLE';}
}
export function invoiceAiRecoveryFallback(baseline,code){
  return {...baseline,ai:{version:'invoice-ai-integration-2026-11-06.v1',status:'blocked',code,
    requiresHumanReview:true,bankEvidence:false,costMicroUsd:null}};
}
