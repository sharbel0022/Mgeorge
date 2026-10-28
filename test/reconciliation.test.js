import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeTransactions,listInvoices,allocate,deleteAllocation,listTransactions} from '../src/db.js';
import {normalizeName,analyzeReconciliation,reconciliationData,runReconciliation,verifyPayer} from '../src/reconciliation.js';
import {withSyntheticBankOriginal,approveSyntheticBankAccount} from './bank-fixtures.js';
import {parseCAMT,parseCSV} from '../src/importers.js';
import {syntheticCamt,account as syntheticAccount} from '../sites/tests/helpers/camt-integrity.mjs';

function fixture(t){const folder=mkdtempSync(join(tmpdir(),'mg-reconcile-')),db=openDatabase(join(folder,'db.sqlite'));t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});return db;}
function invoice(db,id='i',extra={}){
  const x={id,number:id==='i'?'0597':id,party:'Kund AB',total:312500,...extra};
  db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,vat_cents,net_cents,reference,issued_at) VALUES(?,?,?,?,?,?,?,?,?)').run(x.id,'customer',x.number,x.party,x.total,62500,250000,x.number,'2026-01-01');return x.id;
}
function pay(db,extra={},source='enablebanking'){
  storeTransactions(db,[withSyntheticBankOriginal({account:'MG',booked_at:'2026-10-26',amount_cents:312500,currency:'SEK',payer:'Kund AB',reference:'0597',bank_reference:'B1',...extra})],source);
  return db.prepare('SELECT id FROM bank_transactions WHERE bank_reference=?').get(extra.bank_reference||'B1').id;
}
const analyze=db=>analyzeReconciliation(reconciliationData(db));
test('normalization preserves identity and normalizes punctuation and Unicode',()=>{assert.equal(normalizeName('  KUND, AB!  '),'kund ab');assert.notEqual(normalizeName('Kund AB'),normalizeName('Kund HB'));});
test('correct verified payment auto-allocates once without changing bank originals',t=>{
  const db=fixture(t);invoice(db);pay(db);const before=db.prepare('SELECT * FROM bank_transactions').get();
  assert.equal(analyze(db)[0].safe,true);runReconciliation(db);runReconciliation(db);
  assert.equal(listInvoices(db)[0].status,'paid');assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,1);
  assert.deepEqual(db.prepare('SELECT * FROM bank_transactions').get(),before);
});
test('2500 of 3125 is a partial payment with a 625 balance',t=>{
  const db=fixture(t);invoice(db);pay(db,{amount_cents:250000});runReconciliation(db);
  assert.equal(listInvoices(db)[0].paid_cents,250000);assert.equal(listInvoices(db)[0].remaining_cents,62500);assert.equal(listInvoices(db)[0].status,'partial');
});
test('wrong OCR belonging to another invoice is never silently corrected, even when owner is paid',t=>{
  const db=fixture(t);invoice(db);invoice(db,'other',{number:'0577',party:'Annan AB'});
  const old=pay(db,{reference:'0577',payer:'Annan AB',bank_reference:'OLD'});allocate(db,'other',old,312500);
  pay(db,{reference:'0577',amount_cents:250000});
  const s=analyze(db);assert.equal(s.find(x=>x.invoice_id==='i').kind,'reference_conflict');assert.ok(s.every(x=>!x.safe));runReconciliation(db);assert.equal(listInvoices(db).find(i=>i.id==='i').paid_cents,0);
});
test('wrong and missing references, unknown payer and ambiguous invoices remain manual',t=>{
  for(const [extra,kind] of [[{reference:'0577'},'wrong_reference'],[{reference:''},'missing_reference'],[{payer:'Privatperson'},'different_payer']]){
    const db=fixture(t);invoice(db);pay(db,extra);assert.equal(analyze(db)[0].kind,kind);assert.equal(analyze(db)[0].safe,false);
  }
  const db=fixture(t);invoice(db);pay(db,{reference:'',payer:'Okänd'});assert.equal(analyze(db)[0].safe,false);assert.equal(analyze(db)[0].kind,'unknown_payer');assert.equal(analyze(db)[0].score,10);
});
test('explicitly verified private payer linkage supports future matching',t=>{
  const db=fixture(t);invoice(db);pay(db,{payer:'Anna Andersson'});assert.equal(analyze(db)[0].safe,false);
  verifyPayer(db,{invoice_id:'i',payer:'Anna Andersson',account:'MG',evidence:'Kunden bekräftade betalaren'},'admin');runReconciliation(db);assert.equal(listInvoices(db)[0].status,'paid');
});
test('overpayment leaves traceable excess and two separate payments require duplicate review',t=>{
  const db=fixture(t);invoice(db);pay(db,{amount_cents:350000});runReconciliation(db);assert.equal(listTransactions(db)[0].available_cents,37500);assert.equal(listInvoices(db)[0].paid_cents,312500);
  const other=fixture(t);invoice(other);pay(other);pay(other,{bank_reference:'B2'});assert.ok(analyze(other).every(s=>!s.safe));runReconciliation(other);assert.equal(listInvoices(other)[0].paid_cents,0);
});
test('one transfer referencing multiple invoices proposes an explicit split without consuming money',t=>{
  const db=fixture(t);invoice(db,'i',{total:100000});invoice(db,'0598',{total:212500});pay(db,{reference:'0597 0598'});
  const s=analyze(db);assert.equal(s.length,2);assert.ok(s.every(x=>x.kind==='multiple_invoices'&&!x.safe));assert.equal(s.reduce((a,x)=>a+x.amount_cents,0),312500);
});
test('bank collective deposit and complete Bankgiro specification are counted once',t=>{
  const db=fixture(t);invoice(db);approveSyntheticBankAccount(db,syntheticAccount);pay(db,{account:syntheticAccount,is_aggregate:true,bank_reference:'PARENT',payer:'Bankgiro',reference:''});
  const xml=syntheticCamt.replaceAll('625.00','3125.00').replace('SYNTHETIC-ENTRY','PARENT').replace('SYNTHETIC-CHILD','CHILD').replace('Syntetisk Kund AB','Kund AB').replace('<Ref>000018</Ref>','<Ref>0597</Ref>').replace('<Tp><CdOrPrtry><Prtry>OCR</Prtry></CdOrPrtry></Tp>',''),content=Buffer.from(xml);
  storeTransactions(db,parseCAMT(xml,syntheticAccount),'file:synthetic.xml',{content,mime_type:'application/xml'});runReconciliation(db);
  assert.equal(listInvoices(db)[0].paid_cents,312500);assert.equal(db.prepare("SELECT excluded FROM bank_transactions WHERE bank_reference='PARENT'").get().excluded,1);
});
test('incomplete Bankgiro specification and cross-account copies cannot be consumed',t=>{
  const db=fixture(t);invoice(db);pay(db,{is_aggregate:true,bank_reference:'PARENT',amount_cents:400000});const child=pay(db,{bank_reference:'CHILD',parent_bank_reference:'PARENT'});
  assert.equal(analyze(db).find(x=>x.invoice_id==='i').safe,false);assert.throws(()=>allocate(db,'i',child,312500),/ofullständig/);
  const other=fixture(t);invoice(other);pay(other);pay(other,{account:'OTHER'});runReconciliation(other);assert.equal(listInvoices(other)[0].paid_cents,0);
});
test('manual data without retained original cannot automatically assert a payment',t=>{
  const db=fixture(t);invoice(db);pay(db,{},'manual');runReconciliation(db);assert.equal(listInvoices(db)[0].status,'unreconciled');
});
test('reference for same customer with conflicting amount cannot consume a more plausible invoice',t=>{
  const db=fixture(t);invoice(db);invoice(db,'0577',{total:500000});pay(db,{reference:'0577'});runReconciliation(db);assert.ok(listInvoices(db).every(i=>!i.paid_cents));
});
test('organization number can confirm payer identity and conflicting numbers always stop auto match',t=>{
  for(const [number,safe] of [['5560160680',true],['5560000000',false]]){
    const db=fixture(t);invoice(db);db.prepare("UPDATE invoices SET organization_number='556016-0680'").run();approveSyntheticBankAccount(db,syntheticAccount);
    const csv=`Datum;Belopp;Valuta;Betalare;Referens;Bankreferens;IBAN;Organisationsnummer\n2026-10-26;3125.00;SEK;Kundens restaurang;0597;B1;${syntheticAccount};${number}\n`,content=Buffer.from(csv);
    storeTransactions(db,parseCSV(csv,syntheticAccount),'file:synthetic.csv',{content,mime_type:'text/csv'});assert.equal(analyze(db)[0].safe,safe);
  }
});
test('verified private payer is reusable across invoices and undoing the decision removes learned identity',t=>{
  const db=fixture(t);invoice(db);const tx=pay(db,{payer:'Anna Andersson'});allocate(db,'i',tx,312500);invoice(db,'0598');pay(db,{payer:'Anna Andersson',reference:'0598',bank_reference:'B2'});
  assert.equal(analyze(db).find(s=>s.invoice_id==='0598').safe,true);
  const allocation=db.prepare("SELECT id FROM allocations WHERE invoice_id='i'").get();deleteAllocation(db,allocation.id);
  assert.equal(analyze(db).find(s=>s.invoice_id==='0598').safe,false);
});
test('a new bank import invalidates an earlier absence check',t=>{
  const db=fixture(t);invoice(db);db.prepare("UPDATE invoices SET reconciled_at='2026-10-27',reconciliation_note='Kontrollerat bankutdrag'").run();
  pay(db,{payer:'Okänd betalare',reference:''});assert.equal(listInvoices(db)[0].status,'unreconciled');
});

test('automatic reconciliation reads its evidence only after acquiring the write lock',t=>{
  const db=fixture(t);invoice(db);pay(db);let injected=false;
  const guarded=new Proxy(db,{get(target,key){
    if(key==='exec')return sql=>{if(sql==='BEGIN IMMEDIATE'&&!injected){injected=true;pay(db,{bank_reference:'ARRIVED-BEFORE-LOCK'});}return target.exec(sql);};
    const item=Reflect.get(target,key);return typeof item==='function'?item.bind(target):item;
  }});
  runReconciliation(guarded);
  assert.equal(injected,true);assert.equal(listInvoices(db)[0].paid_cents,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
});

test('automatic payment, findings and both audit events commit or roll back together',t=>{
  const db=fixture(t);invoice(db);pay(db);
  db.exec("CREATE TRIGGER fail_verified_audit BEFORE INSERT ON audit_events WHEN NEW.action='automatic_verified_match' BEGIN SELECT RAISE(ABORT,'audit disk failure'); END;");
  assert.throws(()=>runReconciliation(db),/audit disk failure/);
  assert.equal(listInvoices(db)[0].paid_cents,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='automatic_match'").get().n,0);
});
