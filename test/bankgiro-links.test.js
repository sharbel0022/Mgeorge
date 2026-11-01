import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeTransactions,recordImport,listTransactions,allocate,listInvoices} from '../src/db.js';
import {withSyntheticBankOriginal} from './bank-fixtures.js';
import {makeBankgiroXLSX} from '../sites/tests/helpers/bankgiro-xlsx-fixture.mjs';
import {encryptObject,digest} from '../src/security.js';

const module=await import('../src/bankgiro-links.js').catch(()=>({}));
const account='SE4280000890119146168423',owner='synthetic-owner';
function fixture(options={}){
 process.env.BANK_DATA_KEY='3'.repeat(64);delete process.env.ENCRYPTION_KEY;
 const directory=mkdtempSync(join(tmpdir(),'mgeorge-links-')),db=openDatabase(join(directory,'test.sqlite'));
 const tx=withSyntheticBankOriginal({account,booked_at:options.bankDate||'2026-10-26',amount_cents:62500,currency:'SEK',payer:'',reference:'',bank_reference:'SYNTHETIC-AIS-625',description:'Insättning'});
 storeTransactions(db,[tx],'enablebanking');
 db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,status,selected_account_uid) VALUES(?,?,?,?,?,?,?,?,?)').run('connection','enablebanking','Syntetisk Bank',encryptObject({session_id:'synthetic'}),encryptObject([{uid:'account',account_id:{iban:account},currency:'SEK'}]),'2099-01-01',owner,'connected','account');
 const bytes=makeBankgiroXLSX({account:options.account??account,date:'2026-10-26',sequence:'83',payments:options.payments||[{party:'Syntetiskt Bistro AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}],...options.report});
 const import_id=recordImport(db,{source:'bank_file',name:'synthetic.xlsx',found:1,review:1,status:'needs_review',content:bytes,mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 const transaction_id=listTransactions(db)[0].id;
 return {db,import_id,transaction_id,bytes,close(){db.close();rmSync(directory,{recursive:true,force:true});}};
}
const input=(f,report)=>({transaction_id:f.transaction_id,import_id:f.import_id,report_key:report.report_key,confirm:true,originals_checked:true,account_checked:true,evidence:'Syntetiska original och mottagarkonto kontrollerade.'});
const counts=db=>({transactions:db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,allocations:db.prepare('SELECT COUNT(*) n FROM allocations').get().n,total:db.prepare('SELECT SUM(amount_cents) n FROM bank_transactions WHERE excluded=0').get().n});

test('AIS and retained XLSX can be manually associated and revoked without financial writes or changing originals',()=>{
 assert.equal(typeof module.bankSpecificationCandidates,'function','retained XLSX currently has no association API');
 const f=fixture();try{
  const before=counts(f.db),original=f.db.prepare('SELECT * FROM bank_transactions').get();
  const report=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0];
  assert.equal(report.can_link,true);assert.equal(report.rows[0].reference,'0599');
  const link=module.confirmBankSpecificationLink(f.db,input(f,report),owner);
  assert.equal(link.verification,'manual');assert.equal(link.payer,'Syntetiskt Bistro AB');assert.equal(link.reference,'0599');
  assert.deepEqual(counts(f.db),before);assert.deepEqual(f.db.prepare('SELECT * FROM bank_transactions').get(),original);
  assert.equal(module.confirmBankSpecificationLink(f.db,input(f,report),owner).id,link.id);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='bank_specification_linked'").get().n,1);
  assert.deepEqual(Buffer.from(f.db.prepare('SELECT content FROM import_jobs WHERE id=?').get(f.import_id).content),Buffer.from(f.bytes));
  assert.equal(module.bankSpecificationPresentation(f.db,f.transaction_id,owner).reference,'0599');
  module.revokeBankSpecificationLink(f.db,link.id,{evidence:'Syntetisk rättelse efter kontroll.'},owner);
  assert.equal(module.bankSpecificationPresentation(f.db,f.transaction_id,owner),null);assert.deepEqual(counts(f.db),before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_specification_links').get().n,1);
 }finally{f.close();}
});

test('missing or mismatched account, expired consent, contradictory originals and missing checks cannot be linked',()=>{
 assert.equal(typeof module.bankSpecificationCandidates,'function');
 for(const options of [{account:''},{account:'SE4550000000058398257466'},{bankDate:'2026-10-30'},{report:{summaryAmount:62501}}]){
  const f=fixture(options);try{const r=module.bankSpecificationCandidates(f.db,f.transaction_id,owner);assert.equal(r.items.some(x=>x.can_link),false);assert.throws(()=>module.confirmBankSpecificationLink(f.db,{...input(f,r.items[0]||{report_key:'missing'})},owner));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_specification_links').get().n,0);}finally{f.close();}
 }
 const f=fixture();try{const r=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0];for(const patch of [{confirm:false},{originals_checked:false},{account_checked:false},{evidence:''},{report_key:'forged'}])assert.throws(()=>module.confirmBankSpecificationLink(f.db,{...input(f,r),...patch},owner));assert.throws(()=>module.confirmBankSpecificationLink(f.db,input(f,r),'other-owner'));f.db.prepare("UPDATE bank_connections SET valid_until='2000-01-01'").run();assert.throws(()=>module.confirmBankSpecificationLink(f.db,input(f,r),owner));}finally{f.close();}
});

test('same amount distinct AIS remains distinct and report cannot be claimed by another transaction',()=>{
 assert.equal(typeof module.bankSpecificationCandidates,'function');const f=fixture();try{
 const tx=withSyntheticBankOriginal({account,booked_at:'2026-10-26',amount_cents:62500,currency:'SEK',payer:'',reference:'',bank_reference:'SYNTHETIC-AIS-SECOND',description:'Insättning'});storeTransactions(f.db,[tx],'enablebanking');
 const report=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0];assert.equal(report.matching_bank_count,2);
 module.confirmBankSpecificationLink(f.db,input(f,report),owner);const other=listTransactions(f.db).find(x=>x.id!==f.transaction_id);
 assert.throws(()=>module.confirmBankSpecificationLink(f.db,{...input(f,report),transaction_id:other.id},owner));assert.deepEqual(counts(f.db),{transactions:2,allocations:0,total:125000});
 }finally{f.close();}
});

test('complete multi-payer report links only to its total and preserves every individual reference',()=>{
 assert.equal(typeof module.bankSpecificationCandidates,'function');const f=fixture({payments:[{party:'Syntetisk A AB',reference:'0001',payerBankgiro:'987-6543',amount:25000},{party:'Syntetisk B AB',reference:'0002',payerBankgiro:'987-6542',amount:37500}]});try{
 const report=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0],link=module.confirmBankSpecificationLink(f.db,input(f,report),owner);assert.equal(link.payer,'');assert.equal(link.reference,'');assert.deepEqual(link.payments.map(p=>p.reference),['0001','0002']);assert.deepEqual(counts(f.db),{transactions:1,allocations:0,total:62500});
 }finally{f.close();}
});

test('documented bounded date difference remains manual and tampered bytes invalidate presentation',()=>{
 assert.equal(typeof module.bankSpecificationCandidates,'function');const f=fixture({bankDate:'2026-10-27'});try{
 const report=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0];assert.throws(()=>module.confirmBankSpecificationLink(f.db,input(f,report),owner));
 const link=module.confirmBankSpecificationLink(f.db,{...input(f,report),date_difference_note:'Kontrollerad bokföringsdag skiljer sig en dag.'},owner);assert.equal(link.verification,'manual');
 assert.throws(()=>module.revokeBankSpecificationLink(f.db,link.id,{evidence:'Syntetisk rättelse'},'other-owner'));
 f.db.prepare('UPDATE import_jobs SET content=? WHERE id=?').run(Buffer.from('changed'),f.import_id);assert.equal(module.bankSpecificationPresentation(f.db,f.transaction_id,owner),null);assert.throws(()=>module.confirmBankSpecificationLink(f.db,input(f,report),owner));
 assert.equal(f.db.prepare('SELECT content_sha256 FROM import_jobs WHERE id=?').get(f.import_id).content_sha256,digest(f.bytes));
 }finally{f.close();}
});

test('source association preserves existing partial and full allocations and customer identity',()=>{
 assert.equal(typeof module.bankSpecificationCandidates,'function');for(const paid of [25000,62500]){const f=fixture();try{
 f.db.prepare("INSERT INTO invoices(id,direction,invoice_number,party,total_cents,reference) VALUES('invoice','customer','0599','Annan syntetisk kund AB',62500,'0599')").run();
 f.db.prepare("INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES('allocation','invoice',?,?)").run(f.transaction_id,paid);
 const before=listInvoices(f.db),rows=f.db.prepare('SELECT * FROM allocations').all(),report=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0];
 const link=module.confirmBankSpecificationLink(f.db,input(f,report),owner);assert.deepEqual(listInvoices(f.db),before);assert.deepEqual(f.db.prepare('SELECT * FROM allocations').all(),rows);module.revokeBankSpecificationLink(f.db,link.id,{evidence:'Rättelse av underlag'},owner);assert.deepEqual(listInvoices(f.db),before);
 }finally{f.close();}}
});

test('an interrupted atomic link write leaves no relation, owner claim or link audit',()=>{
 const f=fixture();try{const report=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0],before=counts(f.db);
 f.db.exec("CREATE TRIGGER stop_link_audit BEFORE INSERT ON audit_events WHEN NEW.action='bank_specification_linked' BEGIN SELECT RAISE(ABORT,'synthetic interruption'); END;");
 assert.throws(()=>module.confirmBankSpecificationLink(f.db,input(f,report),owner),/synthetic interruption/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_specification_links').get().n,0);assert.equal(f.db.prepare('SELECT owner FROM import_jobs WHERE id=?').get(f.import_id).owner,'');assert.deepEqual(counts(f.db),before);
 f.db.exec('DROP TRIGGER stop_link_audit');assert.equal(module.confirmBankSpecificationLink(f.db,input(f,report),owner).verification,'manual');
 }finally{f.close();}
});

test('a partial report sum is never linked to the full AIS deposit and a lost bank connection blocks new decisions',()=>{
 const f=fixture({payments:[{party:'Syntetiskt Bistro AB',reference:'0599',payerBankgiro:'987-6543',amount:25000}]});try{
 assert.equal(module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items.length,0);assert.throws(()=>module.confirmBankSpecificationLink(f.db,{...input(f,{report_key:'partial'})},owner));assert.deepEqual(counts(f.db),{transactions:1,allocations:0,total:62500});
 }finally{f.close();}
 const connected=fixture();try{const report=module.bankSpecificationCandidates(connected.db,connected.transaction_id,owner).items[0];connected.db.prepare("UPDATE bank_connections SET status='disconnected'").run();assert.throws(()=>module.confirmBankSpecificationLink(connected.db,input(connected,report),owner),/Aktivt ägt/);assert.equal(connected.db.prepare('SELECT COUNT(*) n FROM bank_specification_links').get().n,0);}finally{connected.close();}
});

test('manual source link uses the complete existing AIS evidence and lineage verification boundary',()=>{
 for(const mutation of ["api_identity_version=0","description='Bank reversal'","is_aggregate=1","parent_bank_reference='FORGED'","payer_organization_number='1234567890'","bankgiro='1234-0000'","payer_bankgiro='999-9999'","payer_evidence='{}'","reference_evidence='{}'"]){
 const f=fixture();try{const report=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0];f.db.prepare('UPDATE bank_transactions SET '+mutation+' WHERE id=?').run(f.transaction_id);assert.throws(()=>module.confirmBankSpecificationLink(f.db,input(f,report),owner),undefined,mutation);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_specification_links').get().n,0);}finally{f.close();}
 }
 const f=fixture();try{const report=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0];f.db.prepare("INSERT INTO bank_transactions(id,fingerprint,account,booked_at,amount_cents,payer,reference,bank_reference,parent_bank_reference,source) VALUES('synthetic-child','synthetic-child',?,'2026-10-26',62500,'Syntetisk betalare','0599','SYNTHETIC-CHILD','SYNTHETIC-AIS-625','file:synthetic.csv')").run(account);assert.throws(()=>module.confirmBankSpecificationLink(f.db,input(f,report),owner));}finally{f.close();}
});

test('stale source decisions remain reachable for owner-scoped revocation after original loss or disconnect',()=>{
 for(const mutate of [f=>f.db.prepare('UPDATE import_jobs SET content=NULL WHERE id=?').run(f.import_id),f=>f.db.prepare("UPDATE bank_connections SET status='disconnected'").run()]){
 const f=fixture();try{const report=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0],link=module.confirmBankSpecificationLink(f.db,input(f,report),owner);mutate(f);
 const review=module.bankSpecificationCandidates(f.db,f.transaction_id,owner);assert.equal(review.active_links[0].id,link.id);assert.equal(review.active_links[0].owner,owner);module.revokeBankSpecificationLink(f.db,review.active_links[0].id,{evidence:'Omprövning efter förlorat underlag.'},owner);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM bank_specification_links WHERE revoked_at=''").get().n,0);
 }finally{f.close();}}
});
