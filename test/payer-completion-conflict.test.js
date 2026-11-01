import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeTransactions,listTransactions,listInvoices,allocate} from '../src/db.js';
import {normalizeBankApiTransaction,parseCAMT} from '../src/importers.js';
import {analyzeReconciliation,reconciliationData,runReconciliation} from '../src/reconciliation.js';
import {bankFinancialReview} from '../src/bank-evidence.js';
import {encryptObject} from '../src/security.js';
import {syntheticCamt,account} from '../sites/tests/helpers/camt-integrity.mjs';

// Process-local synthetic key; no server, external bank or production database.
process.env.BANK_DATA_KEY='3'.repeat(64);
delete process.env.ENCRYPTION_KEY;

function fixture(t,description='Batch'){
 const folder=mkdtempSync(join(tmpdir(),'mg-payer-completion-')),db=openDatabase(join(folder,'synthetic.sqlite'));
 t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
 db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,status,selected_account_uid) VALUES(?,?,?,?,?,?,?,?,?)').run('synthetic-bank','enablebanking','Synthetic bank',encryptObject({session_id:'synthetic-session'}),encryptObject([{uid:'synthetic-account',account_id:{iban:account},currency:'SEK'}]),'2099-01-01T00:00:00Z','synthetic-owner','connected','synthetic-account');
 db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,reference,issued_at) VALUES(?,?,?,?,?,?,?)').run('invoice','customer','0594','Syntetisk Kund AB',62500,'000018','2026-10-01');
 const raw={status:'BOOK',transaction_amount:{amount:'625.00',currency:'SEK'},credit_debit_indicator:'CRDT',booking_date:'2026-10-26',entry_reference:'SYNTHETIC-ENTRY',debtor:{name:'',organisation_id:[{identification:'5560000001',scheme_name:'COID',issuer:'SE'},{identification:'5560000002',scheme_name:'COID',issuer:'SE'}]},bank_transaction_code:{description}};
 storeTransactions(db,[normalizeBankApiTransaction(raw,account)],'enablebanking');
 return {db,raw,parent:listTransactions(db)[0]};
}

for(const completion of [true,false])for(const scenario of [
 {name:'without other labels'},
 {name:'with a salary-labelled original',parentDescription:'Batch salary'},
 {name:'with a refund-labelled original',parentDescription:'Batch refund'},
 {name:'with a salary-labelled child',childDescription:'Salary'},
])test(`a conflicting bank payer remains a hard hold after ${completion?'in-place one-payment completion':'replacement by a separate specification child'} ${scenario.name}`,t=>{
 const {db,raw,parent}=fixture(t,scenario.parentDescription);
 assert.equal(parent.payer_evidence.conflict,true);
 let xml=completion?syntheticCamt.replace('SYNTHETIC-CHILD','SYNTHETIC-ENTRY'):syntheticCamt;
 if(scenario.childDescription)xml=xml.replace('</TxDtls>',`<AddtlTxInf>${scenario.childDescription}</AddtlTxInf></TxDtls>`);
 const parsed=parseCAMT(xml,account);
 storeTransactions(db,parsed,'file:synthetic.xml',{mime_type:'application/xml',content:Buffer.from(xml)});
 const rows=listTransactions(db),payment=rows.find(row=>!row.is_aggregate);
 assert.ok(payment);
 assert.equal(rows.length,completion?1:2);
 assert.equal(payment.payer_evidence.conflict,false);
 assert.equal(bankFinancialReview(payment)?.kind,'payer_conflict');
 assert.match(payment.review_reason,/organisationsidentifierare/);
 const retained=db.prepare('SELECT raw_bank_data FROM bank_transactions WHERE id=?').get(parent.id);
 assert.deepEqual(JSON.parse(retained.raw_bank_data),raw);
 if(completion){
  const event=db.prepare("SELECT details FROM audit_events WHERE action='aggregate_replaced' AND json_extract(details,'$.before.is_aggregate')=1").get();
  assert.equal(JSON.parse(JSON.parse(event.details).before.payer_evidence).conflict,true);
 }
 assert.throws(()=>allocate(db,'invoice',payment.id,62500),/organisationsidentifierare/);
 const findings=analyzeReconciliation(reconciliationData(db));
 assert.ok(findings.some(finding=>finding.transaction_id===payment.id));
 assert.ok(findings.every(finding=>!finding.safe));
 runReconciliation(db);
 assert.equal(listInvoices(db)[0].paid_cents,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
 // Historical allocations retain their amount, while their status exposes the hold.
 db.prepare('INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES(?,?,?,?)').run('synthetic-historical-allocation','invoice',payment.id,62500);
 const invoice=listInvoices(db)[0];
 assert.equal(invoice.paid_cents,62500);
 assert.match(invoice.payment_evidence_issue,/organisationsidentifierare/);
});
