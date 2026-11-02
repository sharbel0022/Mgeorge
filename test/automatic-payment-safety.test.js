import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,getSettings,saveSettings,storeDocument,storeTransactions,listInvoices,listTransactions,allocate} from '../src/db.js';
import {reconciliationData,analyzeReconciliation,runReconciliation} from '../src/reconciliation.js';
import {readReconciliationPreview} from '../src/reconciliation-preview.js';
import {approveSyntheticBankAccount,withSyntheticBankOriginal} from './bank-fixtures.js';
import {digest} from '../src/security.js';
import {createNodeBankgiroIngest} from '../src/bankgiro-ingest.js';

const account='SE4280000890119146168423',owner='synthetic-owner';
function fixture(t,{amount=62500,original=true,company='M.George Vitvaror AB'}={}){
 const folder=mkdtempSync(join(tmpdir(),'mg-automatic-safety-')),db=openDatabase(join(folder,'synthetic.sqlite'));
 t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
 saveSettings(db,{...getSettings(db),company_name:company});approveSyntheticBankAccount(db,account);
 db.prepare('INSERT INTO invoices(id,direction,invoice_number,reference,party,total_cents,issued_at) VALUES(?,?,?,?,?,?,?)').run('invoice','customer','0599','0599','Synthetic customer AB',62500,'2026-10-01');
 const document=original?storeDocument(db,{invoice_id:'invoice',name:'synthetic.txt',mime_type:'text/plain',bytes:Buffer.from('Synthetic original invoice 0599: 625.00 SEK')}):null;
 const receipt=storeTransactions(db,[withSyntheticBankOriginal({account,booked_at:'2026-10-26',amount_cents:amount,currency:'SEK',payer:'Synthetic customer AB',reference:'0599',bank_reference:'SYNTHETIC-PAYMENT'})],'enablebanking');
 db.prepare('UPDATE import_jobs SET owner=? WHERE id=?').run(owner,receipt.import_id);
 return {db,document,transaction:listTransactions(db)[0]};
}
const previewDecision=async db=>(await readReconciliationPreview(db,{owner})).decisions[0];
const assertUnallocated=db=>{assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);assert.equal(listInvoices(db)[0].paid_cents,0);};

for(const amount of [25000,70000])test(`active reconciliation preserves ${amount<62500?'partial':'excess'} payment for review just like the preview`,async t=>{
 const {db}=fixture(t,{amount});
 assert.equal((await previewDecision(db)).status,'REVIEW');
 const finding=analyzeReconciliation(reconciliationData(db))[0];assert.equal(finding.safe,false);assert.match(finding.reason,/delbetalning|överbetalning/i);
 runReconciliation(db);runReconciliation(db);assertUnallocated(db);assert.equal(listTransactions(db)[0].available_cents,amount);
});

for(const invalid of ['missing','tampered','unregistered','wrong-binding','missing-hash','empty-valid-hash'])test(`active M.George automatic reconciliation requires the retained invoice original: ${invalid}`,async t=>{
 const {db,document}=fixture(t,{original:invalid!=='missing'});
 if(invalid==='tampered')db.prepare('UPDATE documents SET content=? WHERE id=?').run(Buffer.from('changed'),document.id);
 if(invalid==='unregistered')db.prepare("UPDATE documents SET status='needs_review' WHERE id=?").run(document.id);
 if(invalid==='wrong-binding')db.prepare('UPDATE documents SET invoice_id=NULL WHERE id=?').run(document.id);
 if(invalid==='missing-hash')db.prepare("UPDATE documents SET fingerprint='' WHERE id=?").run(document.id);
 if(invalid==='empty-valid-hash')db.prepare('UPDATE documents SET content=?,fingerprint=? WHERE id=?').run(Buffer.alloc(0),digest(Buffer.alloc(0)),document.id);
 assert.notEqual((await previewDecision(db)).status,'VERIFIED');
 runReconciliation(db);runReconciliation(db);assertUnallocated(db);
 assert.ok(analyzeReconciliation(reconciliationData(db)).every(f=>!f.safe));
});

test('exact full payment with intact invoice and bank originals allocates once',async t=>{
 const {db}=fixture(t);assert.equal((await previewDecision(db)).status,'VERIFIED');
 runReconciliation(db);runReconciliation(db);assert.equal(listInvoices(db)[0].paid_cents,62500);assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,1);
});

test('invoice original integrity is checked after acquiring the active writer lock',t=>{
 const {db,document}=fixture(t);let injected=false;
 const guarded=new Proxy(db,{get(target,key){if(key==='exec')return sql=>{if(sql==='BEGIN IMMEDIATE'&&!injected){injected=true;db.prepare('UPDATE documents SET content=? WHERE id=?').run(Buffer.from('changed before lock'),document.id);}return target.exec(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 runReconciliation(guarded);assert.equal(injected,true);assertUnallocated(db);
});

test('manual partial allocation and its historical balance survive automatic review',t=>{
 const {db,transaction}=fixture(t,{amount:25000});allocate(db,'invoice',transaction.id,25000);
 const before=db.prepare('SELECT * FROM allocations').all();runReconciliation(db);assert.deepEqual(db.prepare('SELECT * FROM allocations').all(),before);assert.equal(listInvoices(db)[0].paid_cents,25000);
});

test('a later payment exactly covering the reviewed remaining balance can allocate once',t=>{
 const {db,transaction}=fixture(t,{amount:25000});allocate(db,'invoice',transaction.id,25000);
 storeTransactions(db,[withSyntheticBankOriginal({account,booked_at:'2026-10-27',amount_cents:37500,currency:'SEK',payer:'Synthetic customer AB',reference:'0599',bank_reference:'SYNTHETIC-REMAINING'})],'enablebanking');
 runReconciliation(db);runReconciliation(db);assert.equal(listInvoices(db)[0].paid_cents,62500);assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,2);
});

test('a generic reviewed manual invoice retains automatic exact-payment semantics without a document',t=>{
 const {db}=fixture(t,{company:'Synthetic Generic AB',original:false});runReconciliation(db);assert.equal(listInvoices(db)[0].paid_cents,62500);
});

async function sourcedFixture(t){
 const {db}=fixture(t);db.prepare('DELETE FROM bank_transactions').run();db.prepare('DELETE FROM import_jobs').run();
 const reportBytes=reference=>Buffer.from(`Datum;Belopp;Betalare;Referens;Valuta;IBAN;Bankreferens\n2026-10-26;625.00;Synthetic customer AB;${reference};SEK;${account};SYNTHETIC-SOURCED-PAYMENT\n`),initial=reportBytes('0599');
 const reports=[{reportId:'synthetic-delivery',filename:'synthetic.csv',sha256:digest(initial)}],bytes=new Map([[digest(initial),initial]]);
 const source={id:'synthetic-source',mode:'synthetic',async authorize({owner}){return {status:'VERIFIED',owner,sourceId:'synthetic-source',scopeId:'synthetic-contract',generation:'1',evidenceId:'synthetic-proof',validUntil:'2099-01-01T00:00:00Z'};},async listReports(){return {reports:[...reports],nextCursor:null};},async fetchReport({report}){return bytes.get(report.sha256);}};
 const worker=await createNodeBankgiroIngest(db,{source,allowSynthetic:true});assert.equal((await worker.run(owner)).counts.IMPORTED,1);
 assert.equal(analyzeReconciliation(reconciliationData(db))[0].safe,true,'An intact currently authorized source can authorize the exact payment.');
 return {db,worker,appendVariant(){const changed=reportBytes('599'),hash=digest(changed);bytes.set(hash,changed);reports.push({reportId:'synthetic-delivery',filename:'changed.csv',sha256:hash});}};
}

test('a contradictory retained C3 delivery blocks active reconciliation before the changed report reaches the sink',async t=>{
 const {db,worker,appendVariant}=await sourcedFixture(t);const original=db.prepare('SELECT * FROM bank_transactions').get();appendVariant();
 const outcome=await worker.run(owner);assert.equal(outcome.counts.BLOCKED,1);assert.equal(db.prepare("SELECT last_error FROM bankgiro_ingest_jobs WHERE status='BLOCKED'").get().last_error,'IDENTITY_CONFLICT');
 runReconciliation(db);assertUnallocated(db);assert.deepEqual(db.prepare('SELECT * FROM bank_transactions').get(),original);
});

for(const assignment of ["authorization_status='BLOCKED'","authorization_generation='2'","missing_report_ids='[\"missing-delivery\"]'"])test('active reconciliation holds sourced payments when current C3 source changes: '+assignment,async t=>{
 const {db}=await sourcedFixture(t);db.exec('UPDATE bankgiro_ingest_sources SET '+assignment);runReconciliation(db);assertUnallocated(db);
});

test('active source review remains owner isolated and keeps unlinked legacy payments usable',async t=>{
 const {db}=await sourcedFixture(t);
 const original=db.prepare('SELECT document_id,import_id FROM bankgiro_ingest_jobs WHERE owner=?').get(owner);
 db.prepare('INSERT INTO bankgiro_ingest_jobs(id,owner,source_id,scope_id,report_id,sha256,filename,authorization_generation,status,document_id,import_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('foreign-conflict','foreign-owner','synthetic-source','synthetic-contract','synthetic-delivery','a'.repeat(64),'foreign.csv','1','BLOCKED',original.document_id,original.import_id,Date.now(),Date.now());
 runReconciliation(db);assert.equal(listInvoices(db)[0].paid_cents,62500);
});
