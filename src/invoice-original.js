import {digest} from './security.js';

// The active writer and read-only preview use the same retained-original
// predicate. The invoice/document relation and exact bytes are both required.
export function invoiceOriginalIsVerified(invoice,document){
 return !!document&&document.id===invoice.document_id&&document.invoice_id===invoice.id
  &&document.status==='registered'&&document.content instanceof Uint8Array&&document.content.byteLength>0&&/^[a-f0-9]{64}$/.test(document.fingerprint)
  &&digest(document.content)===document.fingerprint;
}
