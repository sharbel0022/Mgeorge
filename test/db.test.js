import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openDatabase,allocate,listInvoices,storeTransactions,listTransactions,matchingSuggestions,deleteAllocation,getSettings,saveSettings,listImports,storeDocument,listDocuments} from '../src/db.js';
import {normalizeBankApiTransaction,parseCAMT} from '../src/importers.js';
process.env.MG_ADMIN_PASSWORD='TEST-DO-NOT-USE-THIS-AS-A-REAL-PASSWORD';
const fixture=()=>{
  const folder=mkdtempSync(join(tmpdir(),'mgeorge-'));let db=openDatabase(join(folder,'db.sqlite'));
  return {db,reopen:()=>{db.close();db=openDatabase(join(folder,'db.sqlite'));return db;},cleanup:()=>{db.close();rmSync(folder,{recursive:true,force:true});}};
};
test('matching respects direction, balances and prevents double-match',()=>{
  const {db,cleanup}=fixture();
  try{
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('i1','customer','0604','Kund AB',187500);
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('i2','supplier','123','Leverantör AB',25000);
    const x={account:'MG',booked_at:'2026-10-26',amount_cents:187500,currency:'SEK',payer:'Kund AB',reference:'0604',bank_reference:'BANK123',payer_bankgiro:'501-8296',description:''};
    assert.equal(storeTransactions(db,[x,x],'test').imported,1);
    assert.equal(db.prepare('SELECT payer_bankgiro FROM bank_transactions').get().payer_bankgiro,'501-8296');
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

test('renewed consent and unstable provider lookup IDs do not duplicate a booked payment',()=>{
  const {db,cleanup}=fixture();try{
    const raw={status:'BOOK',transaction_amount:{amount:'100.00',currency:'SEK'},credit_debit_indicator:'CRDT',booking_date:'2026-10-26',debtor:{name:'Kund AB'},reference_number:'0606',entry_reference:'ARCHIVE-1',transaction_id:'SESSION1-LOOKUP',creditor_account:{other:{scheme_name:'BGNR',identification:'1234-5678'}}};
    const first=normalizeBankApiTransaction(raw,'Swedbank:identification-hash');
    const renewed=normalizeBankApiTransaction({...raw,transaction_id:'SESSION2-LOOKUP'},'Swedbank:identification-hash');
    assert.equal(storeTransactions(db,[first],'enablebanking').imported,1);assert.equal(storeTransactions(db,[renewed],'enablebanking').duplicate,1);
    const [stored]=listTransactions(db);assert.equal(stored.bank_reference,'ARCHIVE-1');assert.equal(stored.reference,'0606');assert.equal(stored.bankgiro,'1234-5678');assert.equal(stored.provider_transaction_id,'SESSION1-LOOKUP');
    assert.equal(storeTransactions(db,[{...renewed,account:'Swedbank:other-account'}],'enablebanking').imported,1);
  }finally{cleanup();}
});
test('upgrading old API identities blocks reimports while retaining original allocations and row IDs',()=>{
  const f=fixture();let db=f.db;try{
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('legacy-invoice','customer','0606','Kund AB',10000);
    const legacy={account:'SE4550000000058398257466',booked_at:'2026-10-26',amount_cents:10000,currency:'SEK',payer:'Kund AB',reference:'0606',bank_reference:'OLD-LOOKUP-ID',description:''};
    storeTransactions(db,[legacy],'enablebanking');const original=listTransactions(db)[0];
    allocate(db,'legacy-invoice',original.id,10000);
    db.exec('ALTER TABLE bank_transactions DROP COLUMN api_identity_version; ALTER TABLE bank_transactions DROP COLUMN provider_transaction_id;');
    db=f.reopen();
    assert.equal(db.prepare('SELECT api_identity_version FROM bank_transactions').get().api_identity_version,0);
    const renewed=normalizeBankApiTransaction({status:'BOOK',entry_reference:'STABLE-ARCHIVE-ID',transaction_id:'NEW-LOOKUP-ID',booking_date:'2026-10-26',credit_debit_indicator:'CRDT',transaction_amount:{amount:'100.00',currency:'SEK'},debtor:{name:'Kund AB'},reference_number:'0606'},'iban:SE4550000000058398257466');
    assert.throws(()=>storeTransactions(db,[{...renewed,bank_reference:'OTHER-PAYMENT'},renewed],'enablebanking'),error=>error.status===409&&error.code==='legacy_bank_identity');
    const rows=listTransactions(db);assert.equal(rows.length,1);assert.equal(rows[0].id,original.id);
    assert.equal(rows[0].allocated_cents,10000);assert.equal(rows[0].available_cents,0);
    assert.equal(listInvoices(db)[0].remaining_cents,0);
  }finally{f.cleanup();}
});

test('current identity versions allow stable-entry deduplication without a provider lookup ID',()=>{
  const {db,cleanup}=fixture();try{
    const payment={account:'iban:SE123',booked_at:'2026-10-26',amount_cents:10000,currency:'SEK',payer:'Kund',reference:'0606',bank_reference:'STABLE-ENTRY'};
    assert.equal(storeTransactions(db,[payment],'enablebanking').imported,1);
    assert.equal(storeTransactions(db,[payment],'enablebanking').duplicate,1);
    assert.equal(db.prepare('SELECT api_identity_version FROM bank_transactions').get().api_identity_version,1);
  }finally{cleanup();}
});

test('an already modern API import stays usable when the identity marker is added',()=>{
  const f=fixture();let db=f.db;try{
    const payment={account:'iban:SE123',booked_at:'2026-10-26',amount_cents:10000,currency:'SEK',payer:'Kund',reference:'0606',bank_reference:'STABLE-ENTRY',provider_transaction_id:'LOOKUP'};
    storeTransactions(db,[payment],'enablebanking');db.exec('ALTER TABLE bank_transactions DROP COLUMN api_identity_version;');db=f.reopen();
    assert.equal(storeTransactions(db,[payment],'enablebanking').duplicate,1);
    assert.equal(listTransactions(db).length,1);
  }finally{f.cleanup();}
});

test('missing stable ID uses content and ignores changing provider detail lookup IDs',()=>{
  const {db,cleanup}=fixture();try{
    const raw={status:'BOOK',transaction_amount:{amount:'100.00',currency:'SEK'},credit_debit_indicator:'CRDT',booking_date:'2026-10-26',debtor:{name:'Kund AB'},reference_number:'0606',transaction_id:'LOOKUP-A'};
    assert.equal(storeTransactions(db,[normalizeBankApiTransaction(raw,'MG')],'enablebanking').imported,1);
    assert.equal(storeTransactions(db,[normalizeBankApiTransaction({...raw,transaction_id:'LOOKUP-B'},'MG')],'enablebanking').duplicate,1);
  }finally{cleanup();}
});
test('successive partial payments reach paid only after explicit reviewed allocations',()=>{
  const {db,cleanup}=fixture();try{
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('i','customer','0606','Kund AB',10000);
    const base={account:'MG',booked_at:'2026-10-26',currency:'SEK',payer:'Kund AB',reference:'0606'};
    storeTransactions(db,[{...base,bank_reference:'PART-1',amount_cents:4000},{...base,bank_reference:'PART-2',amount_cents:6000}],'test');
    assert.equal(listInvoices(db)[0].status,'unreconciled');assert.equal(matchingSuggestions(db).length,2);
    const tx=listTransactions(db);allocate(db,'i',tx.find(t=>t.bank_reference==='PART-1').id,4000);assert.equal(listInvoices(db)[0].status,'partial');
    allocate(db,'i',tx.find(t=>t.bank_reference==='PART-2').id,6000);assert.equal(listInvoices(db)[0].status,'paid');assert.equal(listInvoices(db)[0].remaining_cents,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='manual_match'").get().n,2);
  }finally{cleanup();}
});
test('wrong direction, substring references and payments before invoice date never become suggestions',()=>{
  const {db,cleanup}=fixture();try{
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,issued_at) VALUES(?,?,?,?,?,?)').run('i','customer','0606','Rätt Kund AB',10000,'2026-10-20');
    const base={account:'MG',booked_at:'2026-10-26',amount_cents:10000,currency:'SEK',payer:'Annan Kund',reference:'0606'};
    storeTransactions(db,[{...base,bank_reference:'WRONG-DIRECTION',amount_cents:-10000},{...base,bank_reference:'SUBSTRING',reference:'106066'},{...base,bank_reference:'TOO-EARLY',booked_at:'2026-10-19'}],'test');
    assert.deepEqual(matchingSuggestions(db),[]);assert.equal(listInvoices(db)[0].paid_cents,0);
  }finally{cleanup();}
});
test('a conflicting bank identifier aborts the whole import and retains existing balances',()=>{
  const {db,cleanup}=fixture();try{
    const base={account:'MG',booked_at:'2026-10-26',amount_cents:10000,currency:'SEK',payer:'Kund',reference:'0606',bank_reference:'ARCHIVE-1'};
    storeTransactions(db,[base],'test');
    assert.throws(()=>storeTransactions(db,[{...base,bank_reference:'NEW'},{...base,amount_cents:20000}],'test'),e=>e.code==='conflicting_bank_record');
    assert.equal(listTransactions(db).length,1);assert.equal(listImports(db).length,1);
  }finally{cleanup();}
});

test('a revoked job guard aborts bank import inside the transaction before any writes',()=>{
  const {db,cleanup}=fixture();try{
    let called=false;assert.throws(()=>storeTransactions(db,[{account:'MG',booked_at:'2026-10-26',amount_cents:10000,currency:'SEK',payer:'Kund',reference:'001',bank_reference:'LEASED'}],'enablebanking',null,()=>{called=true;throw new Error('lease revoked');}),/lease revoked/);
    assert.equal(called,true);assert.equal(listTransactions(db).length,0);assert.equal(listImports(db).length,0);
  }finally{cleanup();}
});

const singleSpecification=(extra={})=>{
  const values={amount:'100.00',date:'2026-10-26',reference:'0606',payer:'Kund AB',bankReference:'BG-ARCHIVE-1',...extra};
  const xml=`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"><BkToCstmrDbtCdtNtfctn><Ntfctn><Ntry><Amt Ccy="SEK">${values.amount}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>${values.date}</Dt></BookgDt><AcctSvcrRef>${values.bankReference}</AcctSvcrRef><AddtlNtryInf>Bankgiro inbetalning</AddtlNtryInf><NtryDtls><TxDtls><AmtDtls><TxAmt><Amt Ccy="SEK">${values.amount}</Amt></TxAmt></AmtDtls><RltdPties><Dbtr><Nm>${values.payer}</Nm></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>${values.reference}</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;
  return {items:parseCAMT(xml,'MG'),original:{content:Buffer.from(xml),mime_type:'application/xml'}};
};
const aggregatePayment=()=>({account:'MG',booked_at:'2026-10-26',amount_cents:10000,currency:'SEK',payer:'',reference:'',bank_reference:'BG-ARCHIVE-1',description:'Bankgiro inbetalning',is_aggregate:true,review_reason:'Betalardetaljer saknas – importera betalningsspecifikation.'});
test('one-payment camt.054 completes an API aggregate with the same stable identity exactly once',()=>{
  const {db,cleanup}=fixture();try{
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('i','customer','0606','Kund AB',10000);
    storeTransactions(db,[aggregatePayment()],'enablebanking');const before=listTransactions(db)[0];assert.equal(before.is_aggregate,1);assert.equal(matchingSuggestions(db).length,0);
    const spec=singleSpecification();assert.equal(spec.items[0].bank_reference,before.bank_reference);
    const result=storeTransactions(db,spec.items,'file:betalningsspecifikation.xml',spec.original);
    assert.equal(result.imported,0);assert.equal(result.duplicate,1);assert.equal(result.enriched,1);
    const [completed]=listTransactions(db);assert.equal(listTransactions(db).length,1);assert.equal(completed.id,before.id);assert.equal(completed.is_aggregate,0);assert.equal(completed.payer,'Kund AB');assert.equal(completed.reference,'0606');assert.equal(completed.import_id,result.import_id);assert.equal(completed.source,'enablebanking');assert.equal(completed.allocated_cents,0);
    assert.equal(matchingSuggestions(db)[0].invoice_id,'i');assert.equal(listInvoices(db)[0].paid_cents,0);
    const event=JSON.parse(db.prepare("SELECT details FROM audit_events WHERE action='aggregate_replaced'").get().details);assert.equal(event.before.is_aggregate,1);assert.equal(event.after.is_aggregate,0);assert.equal(event.specification_import_id,result.import_id);assert.equal(event.before.import_id,before.import_id);
    assert.equal(db.prepare('SELECT content FROM import_jobs WHERE id=?').get(result.import_id).content.length,spec.original.content.length);
    assert.equal(storeTransactions(db,spec.items,'file:betalningsspecifikation.xml',spec.original).enriched,0);
    assert.equal(storeTransactions(db,[aggregatePayment()],'enablebanking').duplicate,1);assert.equal(listTransactions(db)[0].is_aggregate,0);
    allocate(db,'i',completed.id,10000);assert.equal(listInvoices(db)[0].status,'paid');assert.equal(listTransactions(db).length,1);
  }finally{cleanup();}
});
test('incomplete and non-XML descriptions never unblock a duplicate aggregate',()=>{
  const {db,cleanup}=fixture();try{
    storeTransactions(db,[aggregatePayment()],'enablebanking');
    for(const extra of [{reference:''},{payer:''},{payer:'Bankgirot AB'}]){const spec=singleSpecification(extra);assert.equal(storeTransactions(db,spec.items,'file:incomplete.xml',spec.original).enriched,0);assert.equal(listTransactions(db)[0].is_aggregate,1);}
    const spec=singleSpecification();assert.equal(storeTransactions(db,spec.items,'file:not-a-specification.csv',{...spec.original,mime_type:'text/csv'}).enriched,0);assert.equal(storeTransactions(db,spec.items,'enablebanking').enriched,0);assert.equal(listTransactions(db)[0].is_aggregate,1);assert.equal(matchingSuggestions(db).length,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='aggregate_replaced'").get().n,0);
  }finally{cleanup();}
});
test('single-payment specification needs matching date, sum, currency and account identity',()=>{
  const {db,cleanup}=fixture();try{
    storeTransactions(db,[aggregatePayment()],'enablebanking');
    for(const extra of [{date:'2026-10-25'},{amount:'99.00'}]){const spec=singleSpecification(extra);assert.throws(()=>storeTransactions(db,spec.items,'file:conflict.xml',spec.original),e=>e.code==='conflicting_bank_record');}
    const spec=singleSpecification();assert.throws(()=>storeTransactions(db,[{...spec.items[0],currency:'EUR'}],'file:conflict.xml',spec.original),e=>e.code==='conflicting_bank_record');
    assert.equal(storeTransactions(db,[{...spec.items[0],account:'OTHER-ACCOUNT'}],'file:other-account.xml',spec.original).enriched,0);assert.equal(listTransactions(db).find(t=>t.account==='MG').is_aggregate,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='aggregate_replaced'").get().n,0);
  }finally{cleanup();}
});
test('single-payment completion preserves exclusions and refuses legacy allocations or existing children',()=>{
  const {db,cleanup}=fixture();try{
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('i','customer','0606','Kund AB',10000);
    storeTransactions(db,[aggregatePayment()],'enablebanking');const parent=listTransactions(db)[0],spec=singleSpecification();
    db.prepare("UPDATE bank_transactions SET excluded=1,exclusion_reason='Manuellt undantag' WHERE id=?").run(parent.id);
    assert.equal(storeTransactions(db,spec.items,'file:spec.xml',spec.original).enriched,0);assert.equal(listTransactions(db)[0].excluded,1);assert.equal(listTransactions(db)[0].is_aggregate,1);
    db.prepare('UPDATE bank_transactions SET excluded=0 WHERE id=?').run(parent.id);
    db.prepare('INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES(?,?,?,?)').run('legacy','i',parent.id,1000);
    assert.throws(()=>storeTransactions(db,spec.items,'file:spec.xml',spec.original),e=>e.code==='allocated_aggregate');assert.equal(listInvoices(db)[0].paid_cents,1000);assert.equal(listTransactions(db)[0].is_aggregate,1);
    db.prepare("DELETE FROM allocations WHERE id='legacy'").run();
    storeTransactions(db,[{...aggregatePayment(),bank_reference:'CHILD',parent_bank_reference:'BG-ARCHIVE-1',is_aggregate:false,amount_cents:1000,payer:'Kund AB',reference:'0606'}],'test');
    assert.throws(()=>storeTransactions(db,spec.items,'file:spec.xml',spec.original),e=>e.code==='conflicting_payment_specification');assert.equal(listTransactions(db).find(t=>t.id===parent.id).is_aggregate,1);
  }finally{cleanup();}
});
