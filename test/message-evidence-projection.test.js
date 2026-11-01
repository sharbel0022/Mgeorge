import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeTransactions,allocate} from '../src/db.js';
import {prepareMessages,listMessages} from '../src/customer-messages.js';
import {withSyntheticBankOriginal} from './bank-fixtures.js';

test('message payment evidence exposes parsed provenance without changing bank or allocation records',t=>{
 const folder=mkdtempSync(join(tmpdir(),'mg-message-evidence-')),db=openDatabase(join(folder,'db.sqlite'));t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
 db.prepare("INSERT INTO invoices(id,direction,invoice_number,party,total_cents,reference) VALUES('i','customer','0599','Synthetic payer',62500,'0599')").run();
 storeTransactions(db,[withSyntheticBankOriginal({account:'SYNTHETIC',booked_at:'2026-10-26',amount_cents:50000,currency:'SEK',payer:'Synthetic payer',reference:'0599',bank_reference:'SYNTHETIC-ID'})],'enablebanking');
 const transaction=db.prepare('SELECT * FROM bank_transactions').get();allocate(db,'i',transaction.id,50000);prepareMessages(db);
 const before={bank:db.prepare('SELECT * FROM bank_transactions').all(),allocations:db.prepare('SELECT * FROM allocations').all()},payment=listMessages(db).find(m=>m.payments.length)?.payments[0];
 assert.ok(payment);assert.equal(typeof payment.reference_evidence,'object');assert.ok(Array.isArray(payment.reference_evidence.candidates));assert.equal(typeof payment.raw_bank_data,'object');assert.equal(payment.raw_bank_data.status,'BOOK');assert.equal(payment.verified_cents,50000);
 assert.deepEqual({bank:db.prepare('SELECT * FROM bank_transactions').all(),allocations:db.prepare('SELECT * FROM allocations').all()},before);
});
