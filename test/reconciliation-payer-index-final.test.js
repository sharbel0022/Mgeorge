import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase,storeTransactions,allocate,listInvoices} from '../src/db.js';
import {analyzeReconciliation,reconciliationData,runReconciliation} from '../src/reconciliation.js';
import {withSyntheticBankOriginal,approveSyntheticBankAccount} from './bank-fixtures.js';
import {retainSyntheticInvoiceOriginal} from './invoice-fixtures.js';
import {account} from '../sites/tests/helpers/camt-integrity.mjs';
import {payerIndexContracts} from './helpers/reconciliation-payer-index.mjs';
payerIndexContracts(test,analyzeReconciliation);

test('retained learned identity pays a later invoice once while preserving every bank original',t=>{
 const folder=mkdtempSync(join(tmpdir(),'mg-payer-index-')),db=openDatabase(join(folder,'db.sqlite'));
 t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
 approveSyntheticBankAccount(db,account);
 for(const id of ['SYN-17','SYN-18'])db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,reference,issued_at) VALUES(?,?,?,?,?,?,?)').run(id,'customer',id,'Invoice Owner',10000,id,'2026-01-01');
 for(const id of ['SYN-17','SYN-18'])retainSyntheticInvoiceOriginal(db,id);
 for(const id of ['SYN-17','SYN-18'])storeTransactions(db,[withSyntheticBankOriginal({account,booked_at:'2026-10-26',amount_cents:10000,currency:'SEK',payer:'External Payer',reference:id,bank_reference:id})],'enablebanking');
 const transactions=db.prepare('SELECT * FROM bank_transactions ORDER BY bank_reference').all();
 allocate(db,'SYN-17',transactions[0].id,10000);
 assert.equal(analyzeReconciliation(reconciliationData(db)).find(f=>f.invoice_id==='SYN-18').safe,true);
 runReconciliation(db);runReconciliation(db);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,2);
 assert.ok(listInvoices(db).every(i=>i.remaining_cents===0));
 assert.deepEqual(db.prepare('SELECT * FROM bank_transactions ORDER BY bank_reference').all(),transactions);
});
