import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeTransactions,listInvoices} from '../src/db.js';
import {verifyPayer,runReconciliation} from '../src/reconciliation.js';
import {withSyntheticBankOriginal,approveSyntheticBankAccount} from './bank-fixtures.js';

function fixture(t){
  const folder=mkdtempSync(join(tmpdir(),'mg-payer-atomic-')),db=openDatabase(join(folder,'synthetic.sqlite'));
  // This fixture tests generic, distinct invoice-number/OCR semantics.
  db.prepare("UPDATE app_settings SET data=json_set(data,'$.company_name',?) WHERE id=1").run('Synthetic Generic AB');
  t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
  approveSyntheticBankAccount(db,'SE4280000890119146168423');
  db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,reference,issued_at) VALUES(?,?,?,?,?,?,?)').run('invoice','customer','SYN-1','Synthetic customer AB',10000,'000018','2026-10-01');
  storeTransactions(db,[withSyntheticBankOriginal({account:'SE4280000890119146168423',booked_at:'2026-10-26',amount_cents:10000,currency:'SEK',payer:'Synthetic private payer',reference:'000018',bank_reference:'SYNTHETIC-BANK-1'})],'enablebanking');
  return db;
}
const evidence={invoice_id:'invoice',payer:'Synthetic private payer',account:'SE4280000890119146168423',evidence:'Customer confirmed the synthetic payer relationship'};

for(const existing of [false,true])test(`payer verification audit failure rolls back ${existing?'an existing relationship update':'a new relationship'}`,t=>{
  const db=fixture(t);
  if(existing)verifyPayer(db,{...evidence,evidence:'Previously checked synthetic evidence'},'previous-admin');
  const before=db.prepare('SELECT * FROM payer_links').all(),audits=db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='payer_verified'").get().n;
  db.exec("CREATE TRIGGER reject_payer_audit BEFORE INSERT ON audit_events WHEN NEW.action='payer_verified' BEGIN SELECT RAISE(ABORT,'synthetic payer audit failure'); END;");
  assert.throws(()=>verifyPayer(db,evidence,'admin'),/synthetic payer audit failure/);
  assert.deepEqual(db.prepare('SELECT * FROM payer_links').all(),before);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='payer_verified'").get().n,audits);
  if(!existing){runReconciliation(db);assert.equal(listInvoices(db)[0].paid_cents,0);}
  db.exec('DROP TRIGGER reject_payer_audit');
  verifyPayer(db,evidence,'admin');
  assert.equal(db.prepare('SELECT evidence,verified_by FROM payer_links').get().evidence,evidence.evidence);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='payer_verified'").get().n,audits+1);
  runReconciliation(db);runReconciliation(db);
  assert.equal(listInvoices(db)[0].paid_cents,10000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,1);
});
