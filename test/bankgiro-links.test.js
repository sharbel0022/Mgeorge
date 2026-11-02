import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeTransactions,recordImport,listTransactions,allocate,listInvoices} from '../src/db.js';
import {withSyntheticBankOriginal} from './bank-fixtures.js';
import {makeBankgiroXLSX} from '../sites/tests/helpers/bankgiro-xlsx-fixture.mjs';
import {encryptObject,digest} from '../src/security.js';
import {parseBankFile} from '../src/importers.js';

const module=await import('../src/bankgiro-links.js').catch(()=>({}));
const account='SE4280000890119146168423',owner='synthetic-owner';
function fixture(options={}){
 process.env.BANK_DATA_KEY='3'.repeat(64);delete process.env.ENCRYPTION_KEY;
 const directory=mkdtempSync(join(tmpdir(),'mgeorge-links-')),db=openDatabase(join(directory,'test.sqlite'));
 const tx=withSyntheticBankOriginal({account,booked_at:options.bankDate||'2026-10-26',amount_cents:62500,currency:'SEK',payer:'',reference:'',bank_reference:'SYNTHETIC-AIS-625',description:'Insättning',...(options.aggregate?{is_aggregate:true}:{})});
 storeTransactions(db,[tx],'enablebanking');
 db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,status,selected_account_uid) VALUES(?,?,?,?,?,?,?,?,?)').run('connection','enablebanking','Syntetisk Bank',encryptObject({session_id:'synthetic'}),encryptObject([{uid:'account',account_id:{iban:account},currency:'SEK'}]),'2099-01-01',owner,'connected','account');
 const bytes=makeBankgiroXLSX({currency:'SEK',account:options.account??account,date:'2026-10-26',sequence:'83',payments:options.payments||[{party:'Syntetiskt Bistro AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}],...options.report});
 const import_id=recordImport(db,{source:'bank_file',name:'synthetic.xlsx',found:1,review:1,status:'needs_review',content:bytes,mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 const transaction_id=listTransactions(db)[0].id;
 return {db,import_id,transaction_id,bytes,close(){db.close();rmSync(directory,{recursive:true,force:true});}};
}
const input=(f,report)=>({transaction_id:f.transaction_id,import_id:f.import_id,report_key:report.report_key,confirm:true,originals_checked:true,account_checked:true,evidence:'Syntetiska original och mottagarkonto kontrollerade.'});
const counts=db=>({transactions:db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,allocations:db.prepare('SELECT COUNT(*) n FROM allocations').get().n,total:db.prepare('SELECT SUM(amount_cents) n FROM bank_transactions WHERE excluded=0').get().n});

test('XLSX missing currency cannot become explicit Node account evidence or a manual link',()=>{
 const f=fixture({report:{currency:undefined}});try{
  const rows=parseBankFile('synthetic.xlsx',Buffer.from(f.bytes).toString('base64'),account);assert.equal(rows[0].account_evidence.explicit_currency,false);
  const before=counts(f.db),candidate=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0];assert.equal(candidate.can_link,false);assert.match(candidate.reason,/valuta/i);
  assert.throws(()=>module.confirmBankSpecificationLink(f.db,input(f,candidate),owner),/valuta/i);assert.deepEqual(counts(f.db),before);
 }finally{f.close();}
});

for(const format of ['csv','xml'])test(`same report as ${format.toUpperCase()} and XLSX keeps one economic deposit and both originals`,()=>{
 const f=fixture({aggregate:true});try{
  const csv=`Betalningsdatum;Avsändare;Betalningsreferens;Bankgironummer/Avinummer;Belopp;Valuta;Mottagarkonto;Bankreferens\n2026-10-26;Syntetiskt Bistro AB;0599;987-6543;625,00;SEK;${account};SYNTHETIC-AIS-625\n`;
  const xml=`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn><Ntfctn><Acct><Id><IBAN>${account}</IBAN></Id></Acct><Ntry><Amt Ccy="SEK">625.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-26</Dt></BookgDt><ValDt><Dt>2026-10-26</Dt></ValDt><AcctSvcrRef>SYNTHETIC-AIS-625</AcctSvcrRef><NtryDtls><TxDtls><Refs><TxId>SYNTHETIC-CHILD</TxId></Refs><AmtDtls><TxAmt><Amt Ccy="SEK">625.00</Amt></TxAmt></AmtDtls><RltdPties><Dbtr><Nm>Syntetiskt Bistro AB</Nm></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>0599</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;
  const content=Buffer.from(format==='csv'?csv:xml),rows=parseBankFile('synthetic.'+format,content.toString('base64'),account);
  storeTransactions(f.db,rows,'file:synthetic.'+format,{content,mime_type:format==='csv'?'text/csv':'application/xml'});
  const xlsx=parseBankFile('synthetic.xlsx',Buffer.from(f.bytes).toString('base64'),account);assert.throws(()=>storeTransactions(f.db,xlsx,'file:synthetic.xlsx'),/granskning/i);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions WHERE excluded=0').get().n,1);assert.equal(counts(f.db).total,62500);assert.equal(counts(f.db).allocations,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM import_jobs WHERE content IS NOT NULL').get().n,2);assert.equal(f.db.prepare('SELECT content_sha256 FROM import_jobs WHERE id=?').get(f.import_id).content_sha256,digest(f.bytes));
 }finally{f.close();}
});

test('AIS and retained XLSX can be manually associated and revoked without financial writes or changing originals',()=>{
 assert.equal(typeof module.bankSpecificationCandidates,'function','retained XLSX currently has no association API');
 const f=fixture();try{
  const before=counts(f.db),original=f.db.prepare('SELECT * FROM bank_transactions').get();
  const report=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0];
  assert.equal(report.can_link,true);assert.equal(report.rows[0].reference,'0599');
  const link=module.confirmBankSpecificationLink(f.db,input(f,report),owner);
  assert.equal(link.verification,'manual');assert.equal(link.payer,'Syntetiskt Bistro AB');assert.equal(link.reference,'0599');
  assert.deepEqual(link.payments[0].payer_evidence,report.rows[0].payer_evidence);assert.deepEqual(link.payments[0].reference_evidence,report.rows[0].reference_evidence);assert.deepEqual(link.payments[0].account_evidence,report.rows[0].account_evidence);
  assert.equal(link.payments[0].account_evidence.cells.reference.rawValue,'0599');assert.equal(link.payments[0].account_evidence.cells.reference.type,'s');assert.equal(link.payments[0].account_evidence.cells.reference.address,'C19');
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

const reportAlias='8000-0 00123456789';
const aliasResource=(more={})=>({uid:'account',account_id:{iban:account},currency:'SEK',all_account_ids:[{scheme_name:'BBAN',identification:reportAlias}],...more});
const resources=(f,items)=>f.db.prepare('UPDATE bank_connections SET accounts_json=?').run(encryptObject(items));
const financialRows=f=>Object.fromEntries(['bank_transactions','invoices','allocations','payer_links'].map(table=>[table,f.db.prepare(`SELECT * FROM ${table}`).all()]));

for(const [source,alias,resource,expectedField] of [
 ['BBAN all_account_ids',reportAlias,aliasResource(),'all_account_ids[0]'],
 ['CPAN all_account_ids','0012345678901',aliasResource({all_account_ids:[{scheme_name:'CPAN',identification:'0012345678901'}]}),'all_account_ids[0]'],
 ['IBAN all_account_ids','SE4550000000058398257466',aliasResource({all_account_ids:[{scheme_name:'IBAN',identification:'SE4550000000058398257466'}]}),'all_account_ids[0]'],
 ['BBAN account_id.other',reportAlias,aliasResource({account_id:{iban:account,other:{scheme_name:'BBAN',identification:reportAlias}},all_account_ids:[]}),'account_id.other'],
])test(`an exact provider-backed ${source} permits only a manual original relation`,()=>{
 const f=fixture({account:alias});try{
  resources(f,[resource]);const before=financialRows(f),original=Buffer.from(f.db.prepare('SELECT content FROM import_jobs WHERE id=?').get(f.import_id).content);
  const report=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0];
  assert.equal(report.can_link,true);assert.equal(report.rows[0].account_evidence.exact_match,false,'Do not rewrite the parser evidence.');
  assert.equal(report.reported_account,alias);assert.equal(report.account_relation.kind,'provider_alias');assert.equal(report.account_relation.field,expectedField);
  const link=module.confirmBankSpecificationLink(f.db,input(f,report),owner);
  assert.equal(link.verification,'manual');assert.equal(link.reported_account,alias);assert.equal(link.account_relation.kind,'provider_alias');assert.equal(link.account_relation.selected_account,account);
  assert.equal(module.bankSpecificationPresentation(f.db,f.transaction_id,owner).reported_account,alias);
  assert.deepEqual(financialRows(f),before);assert.deepEqual(Buffer.from(f.db.prepare('SELECT content FROM import_jobs WHERE id=?').get(f.import_id).content),original);
  assert.equal(module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0].rows[0].account_evidence.exact_match,false);
 }finally{f.close();}
});

for(const [name,items] of [
 ['missing alias',[aliasResource({all_account_ids:[]})]],
 ['similar digits',[aliasResource({all_account_ids:[{scheme_name:'BBAN',identification:'8000000123456780'}]})]],
 ['unknown scheme',[aliasResource({all_account_ids:[{scheme_name:'OTHER',identification:reportAlias}]})]],
 ['numeric identifier',[aliasResource({all_account_ids:[{scheme_name:'BBAN',identification:800000123456789}]})]],
 ['alias on another resource',[aliasResource(),aliasResource({uid:'another',account_id:{iban:'SE4550000000058398257466'}})]],
 ['duplicate selected UID',[aliasResource(),aliasResource()]],
])test(`a ${name} cannot authorize a provider account alias relation`,()=>{
 const f=fixture({account:reportAlias});try{
  resources(f,items);const before=financialRows(f);
  let report;try{report=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0];}catch(error){assert.match(error.message,/konto|medgivande/i);}
  if(report)assert.equal(report.can_link,false);
  assert.throws(()=>module.confirmBankSpecificationLink(f.db,input(f,report||{report_key:'missing'}),owner));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_specification_links').get().n,0);assert.deepEqual(financialRows(f),before);
 }finally{f.close();}
});

for(const [name,change] of [
 ['removed alias',f=>resources(f,[aliasResource({all_account_ids:[]})])],
 ['foreign owner',f=>f.db.prepare("UPDATE bank_connections SET owner='another-owner'").run()],
 ['deselected account',f=>f.db.prepare("UPDATE bank_connections SET selected_account_uid='another-account'").run()],
 ['expired consent',f=>f.db.prepare("UPDATE bank_connections SET valid_until='2000-01-01'").run()],
 ['ambiguous alias',f=>resources(f,[aliasResource(),aliasResource({uid:'another',account_id:{iban:'SE4550000000058398257466'}})])],
])test(`an existing alias relation becomes stale after ${name} without changing money`,()=>{
 const f=fixture({account:reportAlias});try{
  resources(f,[aliasResource()]);const report=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0];assert.equal(report.can_link,true);
  const link=module.confirmBankSpecificationLink(f.db,input(f,report),owner),before=financialRows(f);change(f);
  assert.equal(module.bankSpecificationPresentation(f.db,f.transaction_id,owner),null);
  const review=module.bankSpecificationCandidates(f.db,f.transaction_id,owner);assert.equal(review.active_links[0].id,link.id);assert.equal(review.active_links[0].stale,true);
  assert.ok(review.items.every(item=>!item.can_link&&item.link===null));
  assert.throws(()=>module.confirmBankSpecificationLink(f.db,input(f,report),owner));assert.deepEqual(financialRows(f),before);
  module.revokeBankSpecificationLink(f.db,link.id,{evidence:'Removed or invalid provider account evidence checked.'},owner);assert.deepEqual(financialRows(f),before);
 }finally{f.close();}
});


const exactAccountCollisions=[
 ['primary IBAN',{account_id:{iban:account}}],
 ['IBAN account_id.other',{account_id:{iban:'SE4550000000058398257466',other:{scheme_name:'IBAN',identification:account}}}],
 ['BBAN account_id.other',{account_id:{iban:'SE4550000000058398257466',other:{scheme_name:'BBAN',identification:account}}}],
 ['IBAN all_account_ids',{account_id:{iban:'SE4550000000058398257466'},all_account_ids:[{scheme_name:'IBAN',identification:account}]}],
 ['BBAN all_account_ids',{account_id:{iban:'SE4550000000058398257466'},all_account_ids:[{scheme_name:'BBAN',identification:account}]}]
];
for(const [name,other] of exactAccountCollisions)for(const currency of ['SEK','EUR'])test('an exact primary IBAN also held by an unselected '+currency+' resource as '+name+' cannot authorize a source relation',()=>{
 const f=fixture();try{
  resources(f,[aliasResource(),{uid:'unselected',currency,...other}]);const before=financialRows(f),original=Buffer.from(f.db.prepare('SELECT content FROM import_jobs WHERE id=?').get(f.import_id).content);
  const report=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0];
  assert.ok(report);assert.equal(report.rows[0].account_evidence.exact_match,true);assert.equal(report.can_link,false);
  assert.equal(report.rows[0].reference,'0599');assert.equal(report.rows[0].payer,'Syntetiskt Bistro AB');
  assert.throws(()=>module.confirmBankSpecificationLink(f.db,input(f,report),owner),/konto|medgivande/i);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_specification_links').get().n,0);assert.deepEqual(financialRows(f),before);
  assert.deepEqual(Buffer.from(f.db.prepare('SELECT content FROM import_jobs WHERE id=?').get(f.import_id).content),original);
 }finally{f.close();}
});
test('a primary-account source relation becomes stale on alias ambiguity and recovers without financial changes',()=>{
 const f=fixture();try{
  resources(f,[aliasResource()]);const report=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0];assert.equal(report.can_link,true);
  const link=module.confirmBankSpecificationLink(f.db,input(f,report),owner),before=financialRows(f),original=Buffer.from(f.db.prepare('SELECT content FROM import_jobs WHERE id=?').get(f.import_id).content);assert.equal(link.account_relation.kind,'exact');
  resources(f,[aliasResource(),{uid:'unselected',currency:'EUR',account_id:{iban:'SE4550000000058398257466'},all_account_ids:[{scheme_name:'IBAN',identification:account}]}]);
  assert.equal(module.bankSpecificationPresentation(f.db,f.transaction_id,owner),null);
  const held=module.bankSpecificationCandidates(f.db,f.transaction_id,owner);assert.equal(held.active_links[0].id,link.id);assert.equal(held.active_links[0].stale,true);assert.ok(held.items.every(item=>!item.can_link&&item.link===null));
  assert.throws(()=>module.confirmBankSpecificationLink(f.db,input(f,report),owner),/konto|medgivande/i);assert.deepEqual(financialRows(f),before);
  resources(f,[aliasResource()]);assert.equal(module.bankSpecificationPresentation(f.db,f.transaction_id,owner).id,link.id);
  assert.equal(module.confirmBankSpecificationLink(f.db,input(f,report),owner).id,link.id);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_specification_links').get().n,1);
  assert.deepEqual(financialRows(f),before);assert.deepEqual(Buffer.from(f.db.prepare('SELECT content FROM import_jobs WHERE id=?').get(f.import_id).content),original);
 }finally{f.close();}
});


for(const [label,patch] of [
 ['zero-padded sequence',{sequence:'00083'}],
 ['changed payer',{payments:[{party:'Different synthetic payer AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}]}],
 ['changed reference',{payments:[{party:'Syntetiskt Bistro AB',reference:'0600',payerBankgiro:'987-6543',amount:62500}]}],
 ['different day within the same year',{date:'2026-10-27'}],
 ['formatted recipient bankgiro',{recipientBankgiro:'12345678'}]
])test('Node reserves one ELIN deposit despite '+label+' across different originals',()=>{
 const f=fixture();try{
  const report=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0],link=module.confirmBankSpecificationLink(f.db,input(f,report),owner);
  storeTransactions(f.db,[withSyntheticBankOriginal({account,booked_at:'2026-10-26',amount_cents:62500,currency:'SEK',payer:'',reference:'',bank_reference:'SYNTHETIC-AIS-ELIN-SECOND',description:'Insättning'})],'enablebanking');
  const second=listTransactions(f.db).find(row=>row.id!==f.transaction_id),bytes=makeBankgiroXLSX({currency:'SEK',account,date:'2026-10-26',sequence:'83',payments:[{party:'Syntetiskt Bistro AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}],...patch}),importId=recordImport(f.db,{source:'bank_file',name:'variant.xlsx',found:1,review:1,status:'needs_review',content:bytes,mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const before=financialRows(f),candidate=module.bankSpecificationCandidates(f.db,second.id,owner).items.find(row=>row.import_id===importId);
  assert.ok(candidate);assert.equal(candidate.can_link,false);assert.match(candidate.reason,/rapport|insättning|koppling/i);
  const command={...input(f,candidate),transaction_id:second.id,import_id:importId,date_difference_note:'Synthetic date review.'};
  assert.throws(()=>module.confirmBankSpecificationLink(f.db,command,owner),/rapport|insättning|koppling/i);assert.deepEqual(financialRows(f),before);
  module.revokeBankSpecificationLink(f.db,link.id,{evidence:'Separate synthetic source correction.'},owner);
  assert.equal(module.confirmBankSpecificationLink(f.db,command,owner).reference,patch.payments?.[0].reference||'0599');assert.deepEqual(financialRows(f),before);
 }finally{f.close();}
});
for(const [label,patch] of [
 ['sequence',{sequence:'84'}],
 ['year',{date:'2027-10-26'}],
 ['recipient bankgiro',{recipientBankgiro:'8765-4321'}]
])test('Node ELIN reservation allows distinct '+label,()=>{
 const f=fixture();try{
  const report=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0];module.confirmBankSpecificationLink(f.db,input(f,report),owner);
  const date=patch.date||'2026-10-26';storeTransactions(f.db,[withSyntheticBankOriginal({account,booked_at:date,amount_cents:62500,currency:'SEK',payer:'',reference:'',bank_reference:'SYNTHETIC-AIS-SCOPED-SECOND',description:'Insättning'})],'enablebanking');
  const second=listTransactions(f.db).find(row=>row.id!==f.transaction_id),bytes=makeBankgiroXLSX({currency:'SEK',account,date,sequence:'83',payments:[{party:'Syntetiskt Bistro AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}],...patch}),importId=recordImport(f.db,{source:'bank_file',name:'distinct.xlsx',found:1,review:1,status:'needs_review',content:bytes,mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const before=financialRows(f),candidate=module.bankSpecificationCandidates(f.db,second.id,owner).items.find(row=>row.import_id===importId);
  assert.ok(candidate);assert.equal(candidate.can_link,true);
  module.confirmBankSpecificationLink(f.db,{...input(f,candidate),transaction_id:second.id,import_id:importId},owner);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM bank_specification_links WHERE revoked_at=''").get().n,2);assert.deepEqual(financialRows(f),before);
 }finally{f.close();}
});


test('an unreadable unrelated active original preserves an existing link but holds a new reservation',()=>{
 const f=fixture();try{
  const first=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items[0];module.confirmBankSpecificationLink(f.db,input(f,first),owner);
  function addDistinct(sequence,bankReference){
   storeTransactions(f.db,[withSyntheticBankOriginal({account,booked_at:'2026-10-26',amount_cents:62500,currency:'SEK',payer:'',reference:'',bank_reference:bankReference,description:'Insättning'})],'enablebanking');
   const transaction=listTransactions(f.db).find(row=>row.bank_reference===bankReference),bytes=makeBankgiroXLSX({currency:'SEK',account,date:'2026-10-26',sequence,payments:[{party:'Syntetiskt Bistro AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}]}),importId=recordImport(f.db,{source:'bank_file',name:'distinct-'+sequence+'.xlsx',found:1,review:1,status:'needs_review',content:bytes,mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
   const report=module.bankSpecificationCandidates(f.db,transaction.id,owner).items.find(item=>item.import_id===importId);assert.ok(report);assert.equal(report.can_link,true);
   return {transaction,importId,command:{...input(f,report),transaction_id:transaction.id,import_id:importId}};
  }
  const b=addDistinct('84','UNRELATED-ORIGINAL-B'),linkB=module.confirmBankSpecificationLink(f.db,b.command,owner),c=addDistinct('85','UNRELATED-ORIGINAL-C'),before=financialRows(f);
  f.db.prepare('UPDATE import_jobs SET content=? WHERE id=?').run(Buffer.from('corrupted synthetic retained source'),f.import_id);
  assert.equal(module.bankSpecificationPresentation(f.db,f.transaction_id,owner),null);
  assert.equal(module.bankSpecificationPresentation(f.db,b.transaction.id,owner)?.id,linkB.id);
  assert.equal(module.confirmBankSpecificationLink(f.db,b.command,owner).id,linkB.id);
  const reviewB=module.bankSpecificationCandidates(f.db,b.transaction.id,owner);assert.equal(reviewB.active_links.find(link=>link.id===linkB.id).stale,false);
  const candidateC=module.bankSpecificationCandidates(f.db,c.transaction.id,owner).items.find(item=>item.import_id===c.importId);assert.ok(candidateC);assert.equal(candidateC.can_link,false);
  assert.throws(()=>module.confirmBankSpecificationLink(f.db,c.command,owner),/aktiv.*rapport|original|koppling/i);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM bank_specification_links WHERE revoked_at=''").get().n,2);assert.deepEqual(financialRows(f),before);
 }finally{f.close();}
});

for(const [firstGiro,secondGiro] of [['123-4566','0123-4566'],['0123-4566','123-4566']])test('Node rejects a stale second reservation when recipient Bankgiro padding changes from '+firstGiro+' to '+secondGiro,()=>{
 const f=fixture({report:{recipientBankgiro:firstGiro}});try{
  storeTransactions(f.db,[withSyntheticBankOriginal({account,booked_at:'2026-10-26',amount_cents:62500,currency:'SEK',payer:'',reference:'',bank_reference:'SYNTHETIC-PADDED-GIRO-SECOND',description:'Insättning'})],'enablebanking');
  const second=listTransactions(f.db).find(row=>row.id!==f.transaction_id),bytes=makeBankgiroXLSX({currency:'SEK',account,date:'2026-10-26',sequence:'83',recipientBankgiro:secondGiro,payments:[{party:'Syntetiskt Bistro AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}]}),importId=recordImport(f.db,{source:'bank_file',name:'padded-giro.xlsx',found:1,review:1,status:'needs_review',content:bytes,mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const first=module.bankSpecificationCandidates(f.db,f.transaction_id,owner).items.find(row=>row.import_id===f.import_id),stale=module.bankSpecificationCandidates(f.db,second.id,owner).items.find(row=>row.import_id===importId);
  assert.equal(first.can_link,true);assert.equal(stale.can_link,true);
  assert.equal(first.recipient_bankgiro,firstGiro);assert.equal(stale.recipient_bankgiro,secondGiro);
  const before=financialRows(f),link=module.confirmBankSpecificationLink(f.db,input(f,first),owner),auditBefore=f.db.prepare('SELECT COUNT(*) n FROM audit_events').get().n;
  assert.equal(link.payments[0].bankgiro,firstGiro);
  const current=module.bankSpecificationCandidates(f.db,second.id,owner).items.find(row=>row.import_id===importId);
  assert.equal(current.can_link,false);assert.match(current.reason,/insättning|rapport|koppling/i);
  assert.throws(()=>module.confirmBankSpecificationLink(f.db,{...input(f,stale),transaction_id:second.id,import_id:importId},owner),/insättning|rapport|koppling/i);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM bank_specification_links WHERE revoked_at=''").get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM audit_events').get().n,auditBefore);assert.deepEqual(financialRows(f),before);assert.equal(counts(f.db).allocations,0);
  assert.deepEqual(Buffer.from(f.db.prepare('SELECT content FROM import_jobs WHERE id=?').get(f.import_id).content),Buffer.from(f.bytes));
  assert.deepEqual(Buffer.from(f.db.prepare('SELECT content FROM import_jobs WHERE id=?').get(importId).content),Buffer.from(bytes));
 }finally{f.close();}
});
