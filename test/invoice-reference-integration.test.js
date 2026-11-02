import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,listInvoices,listTransactions,storeTransactions,storeDocument,matchingSuggestions,allocate,getSettings,saveSettings} from '../src/db.js';
import {analyzeReconciliation,reconciliationData,runReconciliation} from '../src/reconciliation.js';
import {analyzeDocument,approveDocument} from '../src/invoice-review.js';
import {interpretInvoice} from '../src/invoice-extraction.js';
import {extractPaymentReferences,AIS_NULL_SCHEMA_VERSION} from '../src/payment-references.js';
import {prepareMessages,listMessages,paymentSnapshot,generateMessage,approveAndSend} from '../src/customer-messages.js';
import {approveSyntheticBankAccount,withSyntheticBankOriginal} from './bank-fixtures.js';

const account='SE4280000890119146168423';
function fixture(t,company='M.George Vitvaror AB'){
  const directory=mkdtempSync(join(tmpdir(),'mg-reference-policy-'));
  const db=openDatabase(join(directory,'synthetic.sqlite'));
  saveSettings(db,{...getSettings(db),company_name:company});
  approveSyntheticBankAccount(db,account);
  t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
  return db;
}
function invoice(db,{id='invoice',number='0599',reference='',party='Synthetic customer AB',direction='customer',kind='invoice'}={}){
  db.prepare('INSERT INTO invoices(id,direction,invoice_number,reference,party,total_cents,net_cents,vat_cents,issued_at,due_at,kind) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,direction,number,reference,party,10000,8000,2000,'2026-10-01','2026-11-01',kind);
  return id;
}
function payment(db,{id='SYNTHETIC-PAYMENT',reference='0599',payer='Synthetic customer AB',amount_cents=10000}={}){
  storeTransactions(db,[withSyntheticBankOriginal({account,booked_at:'2026-10-26',amount_cents,currency:'SEK',payer,reference,bank_reference:id})],'enablebanking');
  return listTransactions(db).find(row=>row.bank_reference===id).id;
}
const financialRows=db=>({invoices:db.prepare('SELECT * FROM invoices ORDER BY id').all(),transactions:db.prepare('SELECT * FROM bank_transactions ORDER BY id').all(),allocations:db.prepare('SELECT * FROM allocations ORDER BY id').all()});
function original(db,invoiceId,{number='0599',reference='',issuer='M.George Vitvaror AB',marker='original'}={}){
  const doc=storeDocument(db,{name:marker+'.pdf',mime_type:'application/pdf',bytes:Buffer.from('%PDF-1.4\nSynthetic '+marker),invoice_id:invoiceId});
  const extraction={fields:{invoice_number:{value:number},reference:{value:reference}},details:{supplier:{name:issuer}}};
  db.prepare('UPDATE documents SET extraction=? WHERE id=?').run(JSON.stringify(extraction),doc.id);
  return doc.id;
}

test('invoice reads derive the intended reference without changing stored leading zeros or historical balances',t=>{
  const db=fixture(t);invoice(db,{number:'0001'});
  const transaction=payment(db,{reference:'0001'});
  db.prepare('INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES(?,?,?,?)').run('historical','invoice',transaction,2500);
  const before=financialRows(db),row=listInvoices(db)[0];
  assert.equal(row.reference,'');assert.equal(row.invoice_number,'0001');
  assert.equal(row.intendedPaymentReference,'0001');assert.equal(row.referencePolicy.applies,true);
  assert.equal(row.referencePolicy.status,'REVIEW');
  assert.equal(row.paid_cents,2500);assert.equal(row.remaining_cents,7500);
  reconciliationData(db);matchingSuggestions(db);listInvoices(db);
  assert.deepEqual(financialRows(db),before);
});

for(const number of ['0001','0599'])test('exact company invoice reference '+number+' can use independently verified bank evidence',t=>{
  const db=fixture(t);invoice(db,{number});original(db,'invoice',{number});payment(db,{reference:number});
  assert.equal(listInvoices(db)[0].intendedPaymentReference,number);
  assert.equal(analyzeReconciliation(reconciliationData(db))[0].safe,true);
  const bankBefore=db.prepare('SELECT * FROM bank_transactions').get();
  runReconciliation(db);runReconciliation(db);
  assert.equal(listInvoices(db)[0].paid_cents,10000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,1);
  assert.deepEqual(db.prepare('SELECT * FROM bank_transactions').get(),bankBefore);
  assert.equal(listInvoices(db)[0].referencePolicy.status,'REVIEW');
});

for(const [number,reference] of [['0001','1'],['0001','001'],['0001','00-01'],['0001','0 0 0 1'],['0001','00010'],['0599','599'],['0599','05-99'],['0599','059'],['0599','0600'],['0599','']])test('payer and amount cannot promote nonexact reference '+JSON.stringify(reference)+' for '+number,t=>{
  const db=fixture(t);invoice(db,{number});const transaction=payment(db,{reference}),before=financialRows(db);
  assert.deepEqual(matchingSuggestions(db),[]);
  assert.ok(analyzeReconciliation(reconciliationData(db)).every(row=>!row.safe));
  assert.throws(()=>allocate(db,'invoice',transaction,10000),/referens/i);
  runReconciliation(db);
  assert.deepEqual(financialRows(db),before);
});

test('conflicting historical declared reference blocks new matching without rewriting old money',t=>{
  const db=fixture(t);invoice(db,{number:'0599',reference:'0600'});
  const transaction=payment(db,{reference:'0600'});
  db.prepare('INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES(?,?,?,?)').run('historical','invoice',transaction,2500);
  const before=financialRows(db),row=listInvoices(db)[0];
  assert.equal(row.referencePolicy.status,'BLOCKED');
  assert.equal(row.reference,'0600');assert.equal(row.intendedPaymentReference,'0599');
  assert.equal(row.paid_cents,2500);assert.equal(row.remaining_cents,7500);
  assert.deepEqual(matchingSuggestions(db),[]);
  assert.ok(analyzeReconciliation(reconciliationData(db)).every(row=>!row.safe));
  assert.throws(()=>allocate(db,'invoice',transaction,7500),/referens/i);
  runReconciliation(db);assert.deepEqual(financialRows(db),before);
});

test('a blocked invoice reference withholds current payment proof while preserving historical reconciliation and balances',t=>{
  const db=fixture(t);invoice(db,{number:'0599',reference:'0600'});const transaction=payment(db,{reference:'0600'});
  db.prepare('INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES(?,?,?,?)').run('historical','invoice',transaction,10000);
  db.prepare('UPDATE invoices SET reconciled_at=?,reconciliation_note=? WHERE id=?').run('2026-10-27T10:00:00Z','Synthetic historical reconciliation','invoice');
  const before=financialRows(db),row=listInvoices(db)[0];
  assert.equal(row.referencePolicy.status,'BLOCKED');
  assert.equal(row.reconciliation_state,'unreconciled');assert.equal(row.absence_verified,false);assert.match(row.payment_evidence_issue,/referens/i);
  assert.equal(row.paid_cents,10000);assert.equal(row.remaining_cents,0);assert.equal(row.status,'paid');
  const data=reconciliationData(db);assert.equal(data.transactions[0].verified,true);
  assert.equal(data.invoices[0].reconciliation_state,'unreconciled');
  assert.deepEqual(financialRows(db),before);
});

for(const closed of [false,true])test('same-company duplicate invoice number remains ambiguous across customers, closed='+closed,t=>{
  const db=fixture(t);invoice(db);invoice(db,{id:'duplicate',party:'Another synthetic customer AB'});
  if(closed){const old=payment(db,{id:'OLD-PAYMENT',payer:'Another synthetic customer AB'});db.prepare('INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES(?,?,?,?)').run('historical','duplicate',old,10000);}
  const transaction=payment(db),before=financialRows(db);
  assert.deepEqual(matchingSuggestions(db),[]);
  assert.ok(analyzeReconciliation(reconciliationData(db)).every(row=>!row.safe));
  assert.throws(()=>allocate(db,'invoice',transaction,10000),/referens|flera|dubblett/i);
  runReconciliation(db);assert.deepEqual(financialRows(db),before);
});

test('a blocked invoice keeps its conflicting declared identifier reserved against another invoice',t=>{
  const db=fixture(t);invoice(db,{id:'conflict',number:'0001',reference:'0599',party:'Another synthetic customer AB'});invoice(db);
  const transaction=payment(db);
  assert.deepEqual(matchingSuggestions(db),[]);
  assert.ok(analyzeReconciliation(reconciliationData(db)).every(row=>!row.safe));
  assert.throws(()=>allocate(db,'invoice',transaction,10000),/referens|flera|dubblett/i);
});

test('all linked originals reserve conflicting identifiers even when the latest original agrees',t=>{
  const db=fixture(t);invoice(db,{id:'conflict',number:'0001',reference:'0001',party:'Another synthetic customer AB'});invoice(db);
  original(db,'conflict',{number:'0001',reference:'0599',marker:'conflicting-original'});
  original(db,'conflict',{number:'0001',reference:'0001',marker:'later-agreeing-original'});
  const transaction=payment(db),before=financialRows(db),rows=listInvoices(db);
  assert.equal(rows.find(row=>row.id==='conflict').referencePolicy.status,'BLOCKED');
  assert.deepEqual(matchingSuggestions(db),[]);
  assert.ok(analyzeReconciliation(reconciliationData(db)).every(row=>!row.safe));
  assert.throws(()=>allocate(db,'invoice',transaction,10000),/referens|flera|dubblett/i);
  assert.deepEqual(financialRows(db),before);
});

for(const evidence of [{number:'0600'},{reference:'0600'},{issuer:'Different synthetic issuer AB'}])test('an explicit original contradiction blocks a stored company invoice: '+JSON.stringify(evidence),t=>{
  const db=fixture(t);invoice(db);original(db,'invoice',evidence);const transaction=payment(db);
  assert.equal(listInvoices(db)[0].referencePolicy.status,'BLOCKED');
  assert.deepEqual(matchingSuggestions(db),[]);
  assert.ok(analyzeReconciliation(reconciliationData(db)).every(row=>!row.safe));
  assert.throws(()=>allocate(db,'invoice',transaction,10000),/referens|original|utställare/i);
});

test('other-company and supplier invoices retain their distinct explicit reference semantics',t=>{
  for(const [company,direction,amount] of [['Synthetic Generic AB','customer',10000],['M.George Vitvaror AB','supplier',-10000]]){
    const db=fixture(t,company);invoice(db,{number:'0599',reference:'000018',direction});const transaction=payment(db,{reference:'000018',amount_cents:amount});
    assert.equal(listInvoices(db)[0].referencePolicy.applies,false);
    assert.equal(matchingSuggestions(db).length,1);
    assert.equal(analyzeReconciliation(reconciliationData(db))[0].safe,true);
    allocate(db,'invoice',transaction,10000);assert.equal(listInvoices(db)[0].paid_cents,10000);
  }
});

test('a supplier identifier does not become a duplicate of the issuing company invoice namespace',t=>{
  const db=fixture(t);invoice(db);original(db,'invoice');invoice(db,{id:'supplier',direction:'supplier',party:'Synthetic supplier AB'});payment(db);
  assert.deepEqual(matchingSuggestions(db).map(row=>row.invoice_id),['invoice']);
  assert.equal(analyzeReconciliation(reconciliationData(db)).find(row=>row.invoice_id==='invoice').safe,true);
});

test('explicit context activates policy while context-free analyzer calls retain generic behavior',()=>{
  const data={invoices:[{id:'invoice',invoice_number:'0599',reference:'000018',party:'Synthetic AB',direction:'customer',kind:'invoice',currency:'SEK',issued_at:'2026-10-01',remaining_cents:10000}],transactions:[{id:'transaction',reference:'000018',payer:'Synthetic AB',account,bank_reference:'SYNTHETIC',verified:true,booked_at:'2026-10-26',amount_cents:10000,available_cents:10000,currency:'SEK'}]};
  assert.equal(analyzeReconciliation(data)[0].safe,true);
  assert.equal(analyzeReconciliation({...data,company:{name:'M.George Vitvaror AB'}})[0].safe,false);
});

for(const reference of ['0599','0600'])test('explicit context preserves linked-original conflicts and reserved identifiers for '+reference,t=>{
  const db=fixture(t);invoice(db,{id:'conflict',number:'0599',party:'Original customer AB'});invoice(db,{number:'0600'});
  original(db,'conflict',{number:'0599',reference:'0600'});
  payment(db,{reference,payer:reference==='0599'?'Original customer AB':'Synthetic customer AB'});
  const data=reconciliationData(db),before=structuredClone(data);
  assert.ok(analyzeReconciliation(data).every(row=>!row.safe));
  assert.ok(analyzeReconciliation({...data,company:{name:'M.George Vitvaror AB'}}).every(row=>!row.safe));
  assert.deepEqual(data,before);
});

test('policy configuration rejects invalid input without changing saved settings',t=>{
  const db=fixture(t),before=getSettings(db);
  assert.throws(()=>saveSettings(db,{...before,invoice_reference_policies:[{id:'bad',companyName:'M.George Vitvaror AB',referenceSource:'approximate'}]}),/policy|referens|regel/i);
  assert.deepEqual(getSettings(db),before);
  saveSettings(db,{...before,invoice_reference_policies:[]});invoice(db,{reference:'000018'});
  assert.equal(listInvoices(db)[0].referencePolicy.applies,false);
});

test('document analysis exposes an original reference conflict instead of making it registration-ready',async t=>{
  const db=fixture(t),doc=storeDocument(db,{name:'synthetic-review.pdf',mime_type:'application/pdf',bytes:Buffer.from('%PDF-1.4\nSynthetic review')});
  const text='Faktura\nLeverantör: M.George Vitvaror AB\nKund: Synthetic customer AB\nKundens organisationsnummer: 556016-0680\nFakturanummer: 0599\nFakturadatum: 2026-10-01\nFörfallodatum: 2026-11-01\nNetto: 80,00 SEK\nMoms: 20,00 SEK\nAtt betala: 100,00 SEK\nBetalningsreferens: 0600\nBankgiro: 1234-5678';
  const extraction=await analyzeDocument(db,doc.id,{extract:async()=>interpretInvoice(text,{direction:'customer',direction_confident:true})});
  assert.equal(extraction.fields.invoice_number.value,'0599');assert.equal(extraction.fields.reference.value,'0600');
  assert.equal(extraction.referencePolicy.status,'BLOCKED');assert.equal(extraction.level,'red');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
  assert.throws(()=>approveDocument(db,doc.id,{},true),/granskning|referens/i);
});

test('automatic registration rechecks the company policy instead of trusting an older green extraction',async t=>{
  const db=fixture(t),text=number=>'Faktura\nLeverantör: M.George Vitvaror AB\nKund: Synthetic customer AB\nKundens organisationsnummer: 556016-0680\nFakturanummer: '+number+'\nFakturadatum: 2026-10-01\nFörfallodatum: 2026-11-01\nNetto: 80,00 SEK\nMoms: 20,00 SEK\nAtt betala: 100,00 SEK\nBankgiro: 1234-5678';
  async function document(number,reference){
    const doc=storeDocument(db,{name:'synthetic-'+number+'.pdf',mime_type:'application/pdf',bytes:Buffer.from('%PDF-1.4\nSynthetic '+number)});
    await analyzeDocument(db,doc.id,{extract:async()=>interpretInvoice(text(number)+'\nBetalningsreferens: '+reference,{direction:'customer',direction_confident:true})});
    return doc;
  }
  const trusted=await document('0001','0001');approveDocument(db,trusted.id,{confirm:true});
  const conflicting=await document('0599','0600');
  const stored=JSON.parse(db.prepare('SELECT extraction FROM documents WHERE id=?').get(conflicting.id).extraction);
  stored.level='green';delete stored.referencePolicy;delete stored.intendedPaymentReference;
  db.prepare('UPDATE documents SET extraction=? WHERE id=?').run(JSON.stringify(stored),conflicting.id);
  saveSettings(db,{...getSettings(db),auto_register_known:true});
  assert.throws(()=>approveDocument(db,conflicting.id,{},true),/referens/i);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,1);
});

test('a blocked reference policy prepares only a cautious confirmation without directing a reference correction',t=>{
  const db=fixture(t);invoice(db,{number:'0599',reference:'0600'});const transaction=payment(db,{reference:'0600'});
  db.prepare('INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES(?,?,?,?)').run('historical','invoice',transaction,10000);
  const before=financialRows(db);prepareMessages(db);
  const messages=listMessages(db);assert.deepEqual(messages.map(row=>row.kind),['confirmation']);
  const message=messages[0];assert.doesNotMatch(message.body,/Fakturans referens|ange korrekt fakturanummer/i);
  assert.equal(message.status,'draft');assert.deepEqual(financialRows(db),before);
});

test('a blocked reference policy invalidates an older correction draft even when its snapshot is current',async t=>{
  const db=fixture(t);invoice(db,{number:'0599',reference:'0600'});
  db.prepare('INSERT INTO customer_messages(id,invoice_id,kind,recipient,subject,body,snapshot) VALUES(?,?,?,?,?,?,?)').run('older-draft','invoice','wrong_reference','synthetic@example.test','Synthetic correction','Fakturans referens: 0599.',paymentSnapshot(db,'invoice'));
  assert.equal(listMessages(db)[0].status,'stale');
  let prepared=false;
  await assert.rejects(approveAndSend(db,'older-draft',{version:1,review_id:'older-review',approve:true},'synthetic-admin','synthetic-session',{prepare:async()=>{prepared=true;throw new Error('Unexpected provider preparation');},authorize(){}}),/referens|gransk/i);
  assert.equal(prepared,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM message_deliveries').get().n,0);
});

test('direct message generation cannot prescribe an intended reference while its policy is blocked',t=>{
  const db=fixture(t);invoice(db,{number:'0599',reference:'0600'});
  const row={...listInvoices(db)[0],payment_references:['0600']};
  assert.throws(()=>generateMessage(row,'wrong_reference'),/referens|gransk/i);
  assert.doesNotMatch(generateMessage(row,'confirmation').body,/Fakturans referens|ange korrekt fakturanummer/i);
});

for(const retainCandidates of [true,false])test('manual reference correction cannot override preserved bank references, typed candidates='+retainCandidates,t=>{
  const db=fixture(t);invoice(db);const transaction=payment(db,{reference:'0600'});
  db.prepare('UPDATE bank_transactions SET reference=?'+(retainCandidates?'':",reference_evidence='{}'")+' WHERE id=?').run('0599',transaction);
  const data=reconciliationData(db),before=financialRows(db);
  assert.equal(data.transactions[0].original_verified,false);
  // A caller's manual verification marker cannot replace retained source facts.
  data.transactions[0].verified=true;data.transactions[0].verification={reference:'0599',reason:'Synthetic manual correction'};
  const findings=analyzeReconciliation(data);assert.ok(findings.every(row=>!row.safe));
  assert.equal(findings[0].kind,'reference_conflict');
  assert.throws(()=>allocate(db,'invoice',transaction,10000),/referens|original/i);
  assert.deepEqual(financialRows(db),before);
});

for(const [profile,originalReference,safe] of [['ais-null-schema-v1','0599',true],['ais-null-schema-v1','0600',false],['legacy','0599',false]])test('raw bank reference checks preserve the recorded extraction profile '+profile+' / '+originalReference,()=>{
  const raw={reference_number:originalReference,reference_number_schema:null};
  const evidence=extractPaymentReferences(raw,{profile});
  const data={company:{name:'M.George Vitvaror AB'},invoices:[{id:'invoice',invoice_number:'0599',reference:'',party:'Synthetic AB',direction:'customer',kind:'invoice',currency:'SEK',issued_at:'2026-10-01',remaining_cents:10000,invoice_original_verified:true}],transactions:[{id:'transaction',reference:'0599',reference_evidence:evidence,raw_bank_data:raw,payer:'Synthetic AB',account,bank_reference:'SYNTHETIC',verified:true,booked_at:'2026-10-26',amount_cents:10000,available_cents:10000,currency:'SEK'}]};
  const before=structuredClone(data);
  assert.equal(analyzeReconciliation(data)[0].safe,safe);
  assert.deepEqual(data,before);
  if(profile==='ais-null-schema-v1'){assert.equal(evidence.version,AIS_NULL_SCHEMA_VERSION);assert.equal(evidence.selected.kind,'structured');}
});

test('invoice API reads preserve historical rows and allocation API enforces exact company references',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'mg-reference-policy-api-'));
  Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'http://localhost:3000',DB_PATH:join(directory,'synthetic.sqlite'),SESSION_SECRET:'1'.repeat(64),BANK_DATA_KEY:'3'.repeat(64)});
  delete process.env.MG_ADMIN_PASSWORD;delete process.env.ENCRYPTION_KEY;
  const {server,db}=await import('../src/server.js');
  t.after(async()=>{if(server.listening)await new Promise(resolve=>server.close(resolve));db.close();rmSync(directory,{recursive:true,force:true});});
  const base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
  const session=await fetch(base+'/api/me'),cookie=session.headers.get('set-cookie').split(';')[0];
  const configure=async policies=>fetch(base+'/api/settings',{method:'PATCH',headers:{Cookie:cookie,Origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify({invoice_reference_policies:policies})});
  const settingsBefore=getSettings(db),invalid=await configure([{id:'invalid',referenceSource:'approximate'}]);
  assert.equal(invalid.status,400);assert.deepEqual(getSettings(db),settingsBefore);
  const disabled=await configure([]);assert.equal(disabled.status,200);assert.deepEqual((await disabled.json()).invoice_reference_policies,[]);
  const configured=await configure([{version:'invoice-reference-policy-v1',id:'synthetic-mgeorge-rule',companyName:'M.George Vitvaror AB',referenceSource:'invoice_number',direction:'customer',matchMode:'exact'}]);
  assert.equal(configured.status,200);
  approveSyntheticBankAccount(db,account);db.prepare("UPDATE bank_connections SET owner='local-admin'").run();
  invoice(db,{number:'0001'});invoice(db,{id:'historical',number:'0599',reference:'0600'});
  const old=payment(db,{id:'HISTORICAL',reference:'0600'}),inexact=payment(db,{id:'INEXACT',reference:'1'}),exact=payment(db,{id:'EXACT',reference:'0001'});
  db.prepare('INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES(?,?,?,?)').run('prior-allocation','historical',old,2500);
  const before=financialRows(db);
  const response=await fetch(base+'/api/invoices',{headers:{Cookie:cookie}}),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.items.find(row=>row.id==='invoice').intendedPaymentReference,'0001');
  const historical=body.items.find(row=>row.id==='historical');
  assert.equal(historical.reference,'0600');assert.equal(historical.referencePolicy.status,'BLOCKED');assert.equal(historical.paid_cents,2500);assert.equal(historical.remaining_cents,7500);
  const post=async(invoice_id,transaction_id,amount_cents)=>fetch(base+'/api/allocations',{method:'POST',headers:{Cookie:cookie,Origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify({invoice_id,transaction_id,amount_cents,confirm:true})});
  for(const [invoiceId,transactionId,amount] of [['invoice',inexact,10000],['historical',old,7500]]){
    const rejected=await post(invoiceId,transactionId,amount),result=await rejected.json();
    assert.equal(rejected.status,409);assert.equal(result.code,'invoice_reference_policy');
  }
  assert.deepEqual(financialRows(db),before);
  const accepted=await post('invoice',exact,10000);assert.equal(accepted.status,201);
  assert.equal(listInvoices(db).find(row=>row.id==='invoice').paid_cents,10000);
});
