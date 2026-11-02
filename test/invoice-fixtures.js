import {storeDocument} from '../src/db.js';

// Explicit retained invoice evidence for tests about other prerequisites.
export function retainSyntheticInvoiceOriginal(db,invoiceId){
 const invoice=db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
 return storeDocument(db,{invoice_id:invoiceId,name:'synthetic-invoice-'+invoiceId+'.txt',mime_type:'text/plain',bytes:Buffer.from('Synthetic retained invoice '+JSON.stringify(invoice))});
}
