import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openDatabase,allocate,listInvoices,storeTransactions,listTransactions,matchingSuggestions,deleteAllocation,getSettings,saveSettings,listImports,storeDocument,listDocuments} from '../src/db.js';
process.env.MG_ADMIN_PASSWORD='TEST-DO-NOT-USE-THIS-AS-A-REAL-PASSWORD';
const fixture=()=>{
  const folder=mkdtempSync(join(tmpdir(),'mgeorge-'));const db=openDatabase(join(folder,'db.sqlite'));
  return {db,cleanup:()=>{db.close();rmSync(folder,{recursive:true,force:true});}};
};
test('matching respects direction, balances and prevents double-match',()=>{
  const {db,cleanup}=fixture();
  try{
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('i1','customer','0604','Kund AB',187500);
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('i2','supplier','123','Leverantör AB',25000);
    const x={account:'MG',booked_at:'2026-10-26',amount_cents:187500,currency:'SEK',payer:'Kund AB',reference:'0604',bank_reference:'BANK123',description:''};
    assert.equal(storeTransactions(db,[x,x],'test').imported,1);
    const t=db.prepare('SELECT id FROM bank_transactions').get().id;
    assert.throws(()=>allocate(db,'i2',t,25000),/riktning/);
    allocate(db,'i1',t,125000);assert.equal(listInvoices(db)[0].paid_cents,125000);
    assert.throws(()=>allocate(db,'i1',t,70000),/saldo|UNIQUE/);
    assert.equal(listInvoices(db)[0].status,'partial');
  }finally{cleanup();}
});
test('matching refuses transactions missing payer and reference',()=>{
  const {db,cleanup}=fixture();
  try{
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('i1','customer','0604','Kund AB',10000);
    storeTransactions(db,[{account:'MG',booked_at:'2026-10-26',amount_cents:10000,currency:'SEK',payer:'',reference:'',bank_reference:'SWED123',description:''}],'test');
    const t=db.prepare('SELECT id FROM bank_transactions').get().id;
    assert.throws(()=>allocate(db,'i1',t,10000),/Komplettera/);
  }finally{cleanup();}
});
test('unverified absence of payment never becomes confirmed unpaid, including past due dates',()=>{
  const {db,cleanup}=fixture();try{
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,due_at) VALUES(?,?,?,?,?,?)').run('i','customer','1','Kund',10000,'2000-01-01');
    let invoice=listInvoices(db)[0];assert.equal(invoice.status,'unreconciled');assert.equal(invoice.is_overdue,true);assert.equal(invoice.reconciliation_state,'unreconciled');
    db.prepare("UPDATE invoices SET reconciled_at=CURRENT_TIMESTAMP,reconciliation_note='Bankunderlag kontrollerat' WHERE id='i'").run();
    invoice=listInvoices(db)[0];assert.equal(invoice.status,'overdue');assert.equal(invoice.reconciliation_state,'verified');
    db.prepare("UPDATE invoices SET due_at='2099-01-01' WHERE id='i'").run();assert.equal(listInvoices(db)[0].status,'unpaid');
  }finally{cleanup();}
});
test('suggestions need reference or matching payer and amount and respect credit direction',()=>{
  const {db,cleanup}=fixture();try{
    const insert=db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,kind) VALUES(?,?,?,?,?,?)');
    insert.run('customer','customer','0606','Rätt Kund AB',10000,'invoice');insert.run('supplier','supplier','0606','Rätt Kund AB',10000,'invoice');insert.run('credit','customer','K0606','Rätt Kund AB',10000,'credit');
    const base={account:'MG',booked_at:'2026-10-26',amount_cents:10000,currency:'SEK',payer:'Annan Kund',reference:'',description:''};
    storeTransactions(db,[{...base,bank_reference:'no-evidence'}],'test');assert.equal(matchingSuggestions(db).length,0);
    storeTransactions(db,[{...base,bank_reference:'exact',reference:'0606'}],'test');assert.deepEqual(matchingSuggestions(db).map(x=>x.invoice_id),['customer']);
    storeTransactions(db,[{...base,bank_reference:'credit',amount_cents:-10000,reference:'K0606'}],'test');assert.ok(matchingSuggestions(db).some(x=>x.invoice_id==='credit'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM allocations').get().n,0);
  }finally{cleanup();}
});
test('same stable bank ID remains a duplicate when descriptions and payer are enriched',()=>{
  const {db,cleanup}=fixture();try{
    const base={account:'MG',booked_at:'2026-10-26',amount_cents:10000,currency:'SEK',payer:'',reference:'',bank_reference:'BANK-ID',description:'Betalning'};
    assert.equal(storeTransactions(db,[base],'test').imported,1);
    assert.equal(storeTransactions(db,[{...base,payer:'Kund AB',description:'Mer information',reference:'0606'}],'test').duplicate,1);
    assert.equal(listTransactions(db).length,1);assert.equal(listImports(db).length,2);
  }finally{cleanup();}
});
test('collective Bankgiro totals are blocked and replaced only by a complete specification',()=>{
  const {db,cleanup}=fixture();try{
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('i','customer','0606','Kund',10000);
    const base={account:'MG',booked_at:'2026-10-26',currency:'SEK',payer:'Kund',reference:'0606',description:''};
    storeTransactions(db,[{...base,bank_reference:'PARENT',amount_cents:20000,is_aggregate:true}],'test');const parent=listTransactions(db)[0];
    assert.equal(matchingSuggestions(db).length,0);assert.throws(()=>allocate(db,'i',parent.id,10000),/betalningsspecifikation/);
    storeTransactions(db,[{...base,bank_reference:'CHILD1',parent_bank_reference:'PARENT',amount_cents:10000}],'test');assert.equal(listTransactions(db).find(t=>t.id===parent.id).excluded,0);
    storeTransactions(db,[{...base,bank_reference:'CHILD2',parent_bank_reference:'PARENT',amount_cents:10000}],'test');assert.equal(listTransactions(db).find(t=>t.id===parent.id).excluded,1);
  }finally{cleanup();}
});
test('reversing a verified payment restores uncertainty and preserves the full allocation in audit',()=>{
  const {db,cleanup}=fixture();try{
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('i','customer','1','Kund',10000);
    storeTransactions(db,[{account:'MG',booked_at:'2026-10-26',amount_cents:10000,currency:'SEK',payer:'Kund',reference:'1'}],'test');const t=listTransactions(db)[0];
    allocate(db,'i',t.id,10000);assert.equal(listInvoices(db)[0].status,'paid');
    const allocation=db.prepare('SELECT id FROM allocations').get();assert.equal(deleteAllocation(db,allocation.id),true);
    assert.equal(listInvoices(db)[0].status,'unreconciled');assert.equal(listTransactions(db)[0].available_cents,10000);
    const event=db.prepare("SELECT details FROM audit_events WHERE action='undo_match'").get();assert.equal(JSON.parse(event.details).transaction_id,t.id);
  }finally{cleanup();}
});
test('settings and private original metadata persist without seeding business data',()=>{
  const {db,cleanup}=fixture();try{
    assert.equal(listInvoices(db).length,0);assert.equal(listTransactions(db).length,0);
    const settings={...getSettings(db),company_name:'Mitt företag',sync_interval_minutes:30};saveSettings(db,settings);assert.equal(getSettings(db).company_name,'Mitt företag');
    const payload={name:'faktura.pdf',mime_type:'application/pdf',bytes:Buffer.from('%PDF-1.4\noriginal')};
    const first=storeDocument(db,payload),second=storeDocument(db,payload);assert.equal(second.duplicate,true);assert.equal(first.id,second.id);
    const listed=listDocuments(db)[0];assert.equal(listed.content,undefined);assert.equal(listed.fingerprint,undefined);assert.equal(listed.size_bytes,payload.bytes.length);
  }finally{cleanup();}
});
test('attaching an existing pending original links it once and refuses another invoice',()=>{
  const {db,cleanup}=fixture();try{
    const insert=db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)');insert.run('i1','customer','1','Kund',10000);insert.run('i2','customer','2','Kund',10000);
    const payload={name:'original.pdf',mime_type:'application/pdf',bytes:Buffer.from('%PDF-1.4\nrepeat')};
    const pending=storeDocument(db,payload);assert.equal(pending.invoice_id,null);
    const attached=storeDocument(db,{...payload,invoice_id:'i1'});assert.equal(attached.duplicate,true);assert.equal(attached.invoice_id,'i1');assert.equal(attached.status,'registered');
    assert.equal(storeDocument(db,{...payload,invoice_id:'i1'}).invoice_id,'i1');
    assert.throws(()=>storeDocument(db,{...payload,invoice_id:'i2'}),e=>e.status===409);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='document_attached'").get().n,1);
  }finally{cleanup();}
});
