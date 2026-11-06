import {digest} from './security.js';
import {createNodeAuditStore} from '../sites/lib/openai-invoices/audit-store.js';
import {enrichInvoiceForReview} from '../sites/lib/openai-invoices/integration.js';
import {extractOpenAiInvoice} from '../sites/lib/openai-invoices/adapter.js';
import {readNodeInvoiceAiRecoveryStatus,invoiceAiRecoveryFallback,INVOICE_AI_RECOVERY_CODES} from '../sites/lib/openai-invoices/recovery.js';

/** Only called by the server; browser input cannot supply policy, owner or key. */
export async function enrichNodeInvoice(db,document,baseline,{authorize=()=>{},environment=process.env,adapter=extractOpenAiInvoice}={}){
  const owner=db.companyContext?.storageOwner||'node:legacy';
  const recoveryStatus=db.invoiceAiRecoveryStatus;
  const recovery=typeof recoveryStatus==='function'?()=>recoveryStatus():()=>readNodeInvoiceAiRecoveryStatus(db);
  const current=async()=>{
    await authorize();
    const recoveryCode=recovery();if(recoveryCode)throw Error(recoveryCode);
    const row=db.prepare('SELECT * FROM documents WHERE id=?').get(document.id);
    if(!row||row.invoice_id||row.status==='dismissed'||row.fingerprint!==document.fingerprint||!row.content||digest(row.content)!==document.fingerprint)throw Error('AI_DOCUMENT_CHANGED');
    return row;
  };
  const store=createNodeAuditStore(db,{owner,authorize:current});
  try{return await enrichInvoiceForReview({
    baseline,owner,documentId:document.id,sha256:document.fingerprint,mime:document.mime_type,environment,store,authorize:current,adapter,
    loadOriginal:async()=>{
      const row=await current(),read=baseline.documentRead;
      // A successful local worker parse establishes actual pages. Failed or
      // client-declared metadata never grants permission to send an original.
      if(read?.validated!==true||read.sha256!==document.fingerprint||read.mime!==document.mime_type)throw Error('AI_PREFLIGHT_REQUIRED');
      return {bytes:new Uint8Array(row.content),pageCount:read.pageCount};
    },
  });}catch(error){
    if(INVOICE_AI_RECOVERY_CODES.includes(error?.message))return invoiceAiRecoveryFallback(baseline,error.message);
    throw error;
  }
}
