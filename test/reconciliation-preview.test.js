import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {openDatabase,storeTransactions,recordImport,allocate,deleteAllocation} from '../src/db.js';
import {digest,encryptObject} from '../src/security.js';
import {parseCAMT} from '../src/importers.js';
import {withSyntheticBankOriginal,approveSyntheticBankAccount} from './bank-fixtures.js';
import {syntheticCamt,account} from '../sites/tests/helpers/camt-integrity.mjs';
import {makeBankgiroXLSX} from '../sites/tests/helpers/bankgiro-xlsx-fixture.mjs';
import {readReconciliationPreview} from '../src/reconciliation-preview.js';
import {createNodeBankgiroIngest} from '../src/bankgiro-ingest.js';

const owner='synthetic-owner';
const syntheticPolicy=Object.freeze({version:'mgeorge-reconciliation-v1',companyId:'synthetic-company',invoiceNumberIsPaymentReference:true,preserveLeadingZeros:true,comparison:'exact',source:'synthetic-explicit-server-policy'});
function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'mgeorge-reconciliation-preview-')),db=openDatabase(join(directory,'synthetic.sqlite'));
 approveSyntheticBankAccount(db,account);
 t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
 return db;
}
function invoice(db,{id='invoice-0599',number='0599',party='Synthetic Café Payer AB',total=62500,original=true}={}){
 db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,issued_at,reference) VALUES(?,?,?,?,?,?,?)').run(id,'customer',number,party,total,'2026-10-01',number);
 if(original){const content=Buffer.from(`SYNTHETIC INVOICE ${number}; ${party}; ${total} ore; SEK`);db.prepare("INSERT INTO documents(id,invoice_id,name,mime_type,content,fingerprint,status) VALUES(?,?,?,?,?,?,'registered')").run('document-'+id,id,'synthetic.txt','text/plain',content,digest(content));}
 return id;
}
function payment(db,{bankId='SYNTHETIC-DIRECT',reference='0599',payer='Synthetic Café Payer AB',amount=62500,aggregate=false,...extra}={}){
 const imported=storeTransactions(db,[withSyntheticBankOriginal({account,booked_at:'2026-10-26',amount_cents:amount,currency:'SEK',payer,reference,bank_reference:bankId,is_aggregate:aggregate,...extra})],'enablebanking');
 db.prepare('UPDATE import_jobs SET owner=? WHERE id=?').run(owner,imported.import_id);
 return db.prepare('SELECT id FROM bank_transactions WHERE bank_reference=?').get(bankId).id;
}
function snapshot(db){return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);}
const decision=(preview,id)=>preview.decisions.find(row=>row.transactionId===id);
async function readonlyPreview(db,options={}){
 const before=snapshot(db),fetchBefore=globalThis.fetch;
 globalThis.fetch=()=>{throw Error('Provider calls are forbidden in reconciliation preview tests');};
 db.exec('PRAGMA query_only=ON');
 try{const result=await readReconciliationPreview(db,{owner,referencePolicy:syntheticPolicy,...options});assert.deepEqual(snapshot(db),before);return result;}
 finally{db.exec('PRAGMA query_only=OFF');globalThis.fetch=fetchBefore;}
}

test('read-only Node preview verifies exact original string references without changing any database row',async t=>{
 const db=fixture(t);invoice(db);const id=payment(db),preview=await readonlyPreview(db);
 assert.equal(preview.mode,'preview');assert.equal(preview.changed,false);assert.equal(preview.writesAllowed,false);assert.equal(preview.approvalRequired,true);
 const row=decision(preview,id);assert.equal(row.status,'VERIFIED');assert.equal(row.references[0].value,'0599');assert.equal(row.references[0].rawValue,'0599');assert.equal(row.payer.name.rawValue,'Synthetic Café Payer AB');
 assert.equal(row.allocations.length,1);assert.equal(row.allocations[0].invoiceId,'invoice-0599');assert.equal(row.allocations[0].amountMinor,62500);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
});

test('Node preview never treats 599 as 0599 or substitutes invoice fields for original reference and payer',async t=>{
 const db=fixture(t);invoice(db);const id=payment(db,{reference:'599',payer:''});
 db.prepare("UPDATE bank_transactions SET reference='0599',payer='Synthetic Café Payer AB' WHERE id=?").run(id);
 const row=decision(await readonlyPreview(db),id);assert.equal(row.status,'BLOCKED');assert.equal(row.references[0].value,'599');assert.notEqual(row.payer?.name?.value,'Synthetic Café Payer AB');assert.equal(row.allocations.length,0);
});

test('Node preview includes observations with no invoice candidate and exhausted allocated observations',async t=>{
 const db=fixture(t);const unmatched=payment(db,{reference:'009999',bankId:'SYNTHETIC-UNMATCHED'});let preview=await readonlyPreview(db);
 assert.ok(decision(preview,unmatched));assert.equal(decision(preview,unmatched).allocations.length,0);
 invoice(db);const paid=payment(db,{bankId:'SYNTHETIC-PAID'});allocate(db,'invoice-0599',paid,62500);
 preview=await readonlyPreview(db);assert.ok(decision(preview,paid));assert.equal(decision(preview,paid).availableMinor,0);assert.equal(decision(preview,paid).allocations.length,0);
});

for(const [direction,amount] of [['customer',-10000],['supplier',10000]])test(`settled standalone ${direction} credit history preserves unrelated invoice balance without proposing new credit allocations`,async t=>{
 const db=fixture(t);invoice(db);const ordinary=payment(db);
 const creditId=invoice(db,{id:'synthetic-credit',number:'C0001',total:10000});db.prepare("UPDATE invoices SET kind='credit',direction=? WHERE id=?").run(direction,creditId);
 const creditPayment=payment(db,{bankId:'SYNTHETIC-CREDIT-SETTLEMENT',reference:'C0001',amount});
 const unallocated=await readonlyPreview(db);assert.equal(decision(unallocated,ordinary).status,'VERIFIED');assert.notEqual(decision(unallocated,creditPayment).status,'VERIFIED');assert.equal(decision(unallocated,creditPayment).allocations.length,0);
 allocate(db,creditId,creditPayment,10000);
 const settled=await readonlyPreview(db),ordinaryDecision=decision(settled,ordinary),creditDecision=decision(settled,creditPayment);
 assert.equal(ordinaryDecision.status,'VERIFIED',JSON.stringify(ordinaryDecision.reasonCodes));assert.equal(ordinaryDecision.allocations.length,1);assert.equal(ordinaryDecision.allocations[0].amountMinor,62500);
 assert.equal(creditDecision.availableMinor,0);assert.equal(creditDecision.allocations.length,0);assert.ok(!settled.reasonCodes.includes('INVALID_INVOICE_BALANCE'));
 assert.equal(db.prepare('SELECT amount_cents FROM allocations WHERE invoice_id=?').get(creditId).amount_cents,10000);
});

test('missing invoice original remains review evidence and cannot produce a verified match',async t=>{
 const db=fixture(t);invoice(db,{original:false});const id=payment(db);const row=decision(await readonlyPreview(db),id);assert.notEqual(row.status,'VERIFIED');
});

test('Node preview does not borrow a foreign owner consent or reveal explicitly foreign imports',async t=>{
 const db=fixture(t);invoice(db);const own=payment(db);db.prepare("UPDATE bank_connections SET owner='foreign-owner'").run();
 const row=decision(await readonlyPreview(db),own);assert.equal(row.status,'BLOCKED');assert.equal(row.allocations.length,0);
 db.prepare("UPDATE import_jobs SET owner='foreign-owner'").run();
 const preview=await readonlyPreview(db);assert.equal(preview.decisions.length,0);
 await assert.rejects(readReconciliationPreview(db,{owner,transactionId:own}),error=>error.status===404);
 await assert.rejects(readReconciliationPreview(db,{}),error=>error.status===401);
});

test('snapshot binds competing payments, retained original bytes and encrypted consent without returning secrets',async t=>{
 const db=fixture(t);invoice(db);const id=payment(db);const initial=await readonlyPreview(db,{transactionId:id}),repeat=await readonlyPreview(db,{transactionId:id});assert.equal(initial.snapshot.sha256,repeat.snapshot.sha256);
 const secret='SYNTHETIC-PRIVATE-SESSION-VALUE';db.prepare('UPDATE bank_connections SET encrypted_session=?').run(encryptObject({session_id:secret}));
 const changed=await readonlyPreview(db,{transactionId:id});assert.notEqual(initial.snapshot.sha256,changed.snapshot.sha256);assert.ok(!JSON.stringify(changed).includes(secret));assert.ok(!JSON.stringify(changed).includes('encrypted_session'));
 payment(db,{bankId:'SYNTHETIC-COMPETING'});const competing=await readonlyPreview(db,{transactionId:id});assert.notEqual(changed.snapshot.sha256,competing.snapshot.sha256);assert.notEqual(decision(competing,id).status,'VERIFIED');
 db.prepare("UPDATE documents SET content=x'00' WHERE id='document-invoice-0599'").run();const tampered=await readonlyPreview(db,{transactionId:id});assert.notEqual(competing.snapshot.sha256,tampered.snapshot.sha256);assert.notEqual(decision(tampered,id).status,'VERIFIED');
});

test('reversed allocation holds are retained by the new preview and cannot immediately rematch',async t=>{
 const db=fixture(t);invoice(db);const id=payment(db);allocate(db,'invoice-0599',id,62500);const allocation=db.prepare('SELECT id FROM allocations').get();deleteAllocation(db,allocation.id);
 const row=decision(await readonlyPreview(db),id);assert.notEqual(row.status,'VERIFIED');assert.equal(row.allocations.length,0);
});

test('trusted C1 settings activate the company rule while explicit disable and other companies remain blocked',async t=>{
 const db=fixture(t);invoice(db);const id=payment(db);
 for(const company_name of ['M.George Vitvaror AB',' M.George Vitvaror AB ']){
  db.prepare('UPDATE app_settings SET data=? WHERE id=1').run(JSON.stringify({company_name}));
  const preview=await readonlyPreview(db,{referencePolicy:undefined});assert.equal(decision(preview,id).status,'VERIFIED');assert.equal(preview.companyId,'workspace:'+owner);
 }
 for(const settings of [{company_name:'Other Synthetic Company AB'},{company_name:'M.George Vitvaror AB',invoice_reference_policies:[]}]){
  db.prepare('UPDATE app_settings SET data=? WHERE id=1').run(JSON.stringify(settings));
  const blocked=await readonlyPreview(db,{referencePolicy:undefined});assert.equal(decision(blocked,id).status,'BLOCKED');assert.ok(decision(blocked,id).reasonCodes.includes('REFERENCE_POLICY_REQUIRED'));
 }
});

test('C1 conflicting invoice references remain blocked evidence under invoice-number policy',async t=>{
 for(const reference of ['0599','0200']){
  const db=fixture(t);invoice(db);db.prepare("UPDATE invoices SET reference='0200' WHERE id='invoice-0599'").run();const id=payment(db,{reference});
  const row=decision(await readonlyPreview(db),id);assert.equal(row.status,reference==='0599'?'BLOCKED':'REVIEW');assert.equal(row.allocations.length,0);assert.equal(row.references[0].value,reference);
  assert.equal(db.prepare("SELECT reference FROM invoices WHERE id='invoice-0599'").get().reference,'0200');
 }
});

test('a C1 held original with exterior spaces reserves its exact canonical reference',async t=>{
 const db=fixture(t);invoice(db);const other=invoice(db,{id:'held-original-owner',number:'0600'}),id=payment(db);
 db.prepare('UPDATE documents SET extraction=? WHERE invoice_id=?').run(JSON.stringify({fields:{invoice_number:{value:' 0599 '},reference:{value:''}}}),other);
 const preview=await readonlyPreview(db,{referencePolicy:undefined}),item=decision(preview,id);
 assert.equal(item.status,'BLOCKED');assert.deepEqual(item.conflictingInvoiceIds,['held-original-owner','invoice-0599']);assert.equal(item.allocations.length,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
});

test('incoming C1 preview separates an unrelated supplier number from its own customer reference',async t=>{
 const db=fixture(t);invoice(db);const supplier=invoice(db,{id:'supplier-same-number',number:'0599',party:'Synthetic supplier AB'}),id=payment(db);
 db.prepare("UPDATE invoices SET direction='supplier',reference='000018' WHERE id=?").run(supplier);
 const item=decision(await readonlyPreview(db,{referencePolicy:undefined}),id);
 assert.equal(item.status,'VERIFIED');assert.deepEqual(item.candidateInvoiceIds,['invoice-0599']);assert.deepEqual(item.conflictingInvoiceIds,[]);assert.equal(item.allocations.length,1);assert.equal(item.allocations[0].invoiceId,'invoice-0599');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
});

for(const state of ['open','held','closed'])test(`a conflicting declaration on ${state==='open'?'an':'a'} ${state} invoice reserves ownership against another exact-number candidate`,async t=>{
 const db=fixture(t);invoice(db,{id:'synthetic-exact-owner',number:'0001'});
 const competing=invoice(db,{id:'synthetic-declared-owner',number:'0002',original:state!=='held'});
 if(state==='closed'){
  const settled=payment(db,{bankId:'SYNTHETIC-CLOSED-OWNER',reference:'0002'});
  allocate(db,competing,settled,62500);
 }
 db.prepare('UPDATE invoices SET reference=? WHERE id=?').run('0001',competing);
 const id=payment(db,{reference:'0001'}),row=decision(await readonlyPreview(db),id);
 assert.equal(row.status,'BLOCKED',JSON.stringify(row.reasonCodes));assert.ok(row.reasonCodes.includes('AMBIGUOUS_INVOICE_REFERENCE'));assert.equal(row.allocations.length,0);
 assert.deepEqual(row.candidateInvoiceIds,['synthetic-exact-owner']);
 assert.deepEqual([...row.conflictingInvoiceIds].sort(),['synthetic-declared-owner','synthetic-exact-owner']);
 assert.equal(db.prepare('SELECT reference FROM invoices WHERE id=?').get(competing).reference,'0001');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,state==='closed'?1:0);
});

test('explicit server policy can derive invoice number only when no contradictory reference is stored',async t=>{
 const db=fixture(t);invoice(db);db.prepare("UPDATE invoices SET reference='' WHERE id='invoice-0599'").run();const id=payment(db);
 const row=decision(await readonlyPreview(db),id);assert.equal(row.status,'VERIFIED');assert.equal(row.allocations[0].amountMinor,62500);assert.equal(row.references[0].value,'0599');
});

function reviewReport(db,{currency='SEK',foreign=false}={}){
 const bytes=Buffer.from(makeBankgiroXLSX({currency,account,date:'2026-10-26',payments:[{party:'Synthetic Café Payer AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}]}));
 const id=recordImport(db,{source:'bank_file',name:'synthetic-report.xlsx',status:'needs_review',found:1,review:1,content:bytes,mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 db.prepare('UPDATE import_jobs SET owner=? WHERE id=?').run(foreign?'foreign-owner':owner,id);return id;
}

test('retained unlinked XLSX observations remain explicit and cannot manufacture a stable deposit relation',async t=>{
 const db=fixture(t);invoice(db);const ais=payment(db,{aggregate:true,reference:'',payer:''});reviewReport(db);
 const preview=await readonlyPreview(db);assert.ok(preview.decisions.length>=2);assert.equal(decision(preview,ais).status,'BLOCKED');
 const report=preview.decisions.find(row=>row.transactionId!==ais);assert.equal(report.references[0].value,'0599');assert.equal(report.payer.name.rawValue,'Synthetic Café Payer AB');assert.equal(report.status,'BLOCKED');assert.equal(report.allocations.length,0);
});

test('missing retained report and a missing declared report count fail closed without hiding bank children',async t=>{
 const db=fixture(t);invoice(db,{number:'000018',party:'Syntetisk Kund AB'});
 const parent=payment(db,{bankId:'SYNTHETIC-ENTRY',aggregate:true,payer:'Bankgiro',reference:''});
 const result=storeTransactions(db,parseCAMT(syntheticCamt,account),'file:synthetic.xml',{content:Buffer.from(syntheticCamt),mime_type:'application/xml'});db.prepare('UPDATE import_jobs SET owner=? WHERE id=?').run(owner,result.import_id);
 const child=db.prepare("SELECT id FROM bank_transactions WHERE bank_reference='SYNTHETIC-CHILD'").get().id;
 const missingCount=await readonlyPreview(db);assert.ok(decision(missingCount,parent));assert.equal(decision(missingCount,child).status,'BLOCKED');assert.equal(decision(missingCount,child).allocations.length,0);
 db.prepare('UPDATE import_jobs SET content=NULL WHERE id=?').run(result.import_id);const missingOriginal=await readonlyPreview(db);assert.equal(decision(missingOriginal,child).status,'BLOCKED');
});

test('a missing bank parent is not invented from the child reference or matching amounts',async t=>{
 const db=fixture(t);invoice(db);const id=payment(db);db.prepare("UPDATE bank_transactions SET parent_bank_reference='MISSING-SYNTHETIC-PARENT' WHERE id=?").run(id);
 const row=decision(await readonlyPreview(db),id);assert.equal(row.status,'BLOCKED');assert.equal(row.allocations.length,0);
});

test('a complete original CAMT group represents its retained aggregate exactly once',async t=>{
 const db=fixture(t);invoice(db,{number:'000018',party:'Syntetisk Kund AB'});
 const parent=payment(db,{bankId:'SYNTHETIC-ENTRY',aggregate:true,payer:'Bankgiro',reference:''});
 const xml=syntheticCamt.replace('<NtryDtls>','<NtryDtls><Btch><NbOfTxs>1</NbOfTxs><TtlAmt Ccy="SEK">625.00</TtlAmt></Btch>');
 const saved=storeTransactions(db,parseCAMT(xml,account),'file:synthetic-complete.xml',{content:Buffer.from(xml),mime_type:'application/xml'});db.prepare('UPDATE import_jobs SET owner=? WHERE id=?').run(owner,saved.import_id);
 const child=db.prepare("SELECT id FROM bank_transactions WHERE bank_reference='SYNTHETIC-CHILD'").get().id;
 const preview=await readonlyPreview(db);assert.equal(decision(preview,child).status,'VERIFIED');assert.equal(decision(preview,child).allocations[0].amountMinor,62500);assert.equal(decision(preview,parent).economic,false);assert.equal(decision(preview,parent).allocations.length,0);
 db.prepare('UPDATE bank_transactions SET excluded=0 WHERE id=?').run(parent);
 const duplicated=await readonlyPreview(db);assert.equal(decision(duplicated,child).status,'BLOCKED');assert.equal(decision(duplicated,child).allocations.length,0);
});

test('a standalone individual CAMT entry remains a direct payment without an invented report-deposit relationship',async t=>{
 const db=fixture(t);invoice(db,{number:'000018',party:'Syntetisk Kund AB'});
 const xml=syntheticCamt.replace('<TxId>SYNTHETIC-CHILD</TxId>','<TxId>SYNTHETIC-ENTRY</TxId>').replace('<NtryDtls>','<NtryDtls><Btch><NbOfTxs>1</NbOfTxs><TtlAmt Ccy="SEK">625.00</TtlAmt></Btch>');
 const parsed=parseCAMT(xml,account);assert.equal(parsed.length,1);assert.equal(parsed[0].parent_bank_reference,undefined);assert.equal(parsed[0].is_aggregate,undefined);
 const saved=storeTransactions(db,parsed,'file:synthetic-standalone.xml',{content:Buffer.from(xml),mime_type:'application/xml'});db.prepare('UPDATE import_jobs SET owner=? WHERE id=?').run(owner,saved.import_id);
 const id=db.prepare("SELECT id FROM bank_transactions WHERE bank_reference='SYNTHETIC-ENTRY'").get().id,item=decision(await readonlyPreview(db),id);
 assert.equal(item.status,'VERIFIED');assert.deepEqual(item.reasonCodes,['EXACT_REFERENCE_AND_BANK_EVIDENCE']);assert.equal(item.allocations.length,1);assert.equal(item.allocations[0].amountMinor,62500);assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
});

test('Node source worker identity conflicts hold the retained preview and invalidate its snapshot',async t=>{
 const db=fixture(t);invoice(db,{number:'000018',party:'Syntetisk Kund AB'});payment(db,{bankId:'SYNTHETIC-ENTRY',aggregate:true,payer:'Bankgiro',reference:''});
 const xml=syntheticCamt.replace('<NtryDtls>','<NtryDtls><Btch><NbOfTxs>1</NbOfTxs><TtlAmt Ccy="SEK">625.00</TtlAmt></Btch>');
 const reports=[{reportId:'synthetic-source-report',filename:'synthetic-source.xml',bytes:Buffer.from(xml)}];reports[0].sha256=digest(reports[0].bytes);
 const source={id:'synthetic-source',mode:'synthetic',async authorize(){return {status:'VERIFIED',owner,sourceId:this.id,scopeId:'synthetic-scope',generation:'g1',evidenceId:'synthetic-proof',validUntil:'2099-01-01T00:00:00Z'};},async listReports(){return {reports,nextCursor:null};},async fetchReport({report}){return reports.find(row=>row.sha256===report.sha256).bytes;}};
 const worker=await createNodeBankgiroIngest(db,{source,allowSynthetic:true});const first=await worker.run(owner);assert.equal(first.counts.IMPORTED,1);
 const child=db.prepare("SELECT id FROM bank_transactions WHERE bank_reference='SYNTHETIC-CHILD'").get().id,before=await readonlyPreview(db);assert.equal(decision(before,child).status,'VERIFIED');
 const bytes=Buffer.from(xml.replace('<Ref>000018</Ref>','<Ref>599</Ref>'));reports.push({...reports[0],bytes,sha256:digest(bytes)});const conflict=await worker.run(owner);assert.equal(conflict.counts.BLOCKED,1);
 const after=await readonlyPreview(db);assert.equal(decision(after,child).status,'BLOCKED');assert.equal(decision(after,child).allocations.length,0);assert.notEqual(after.snapshot.sha256,before.snapshot.sha256);assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
});

test('a second valid consent cannot hide an ambiguous identifier in another active owner resource',async t=>{
 const db=fixture(t);invoice(db);const id=payment(db);
 db.prepare('UPDATE bank_connections SET accounts_json=?').run(encryptObject([{uid:'synthetic-account',account_id:{iban:account},currency:'SEK'},{uid:'unselected-foreign-currency',account_id:{other:{scheme_name:'BBAN',identification:account}},currency:'EUR'}]));
 approveSyntheticBankAccount(db,account,{id:'second-synthetic-consent'});
 const row=decision(await readonlyPreview(db),id);assert.equal(row.status,'BLOCKED');assert.equal(row.allocations.length,0);
});

test('existing allocations outside the bank owner scope cannot be dropped to manufacture invoice balance',async t=>{
 const db=fixture(t);invoice(db);const own=payment(db);
 const foreign=payment(db,{bankId:'SYNTHETIC-FOREIGN-ALLOCATED',amount:31250,account:'SE3580000000000000000001'});
 db.prepare("UPDATE import_jobs SET owner='foreign-owner' WHERE id=(SELECT import_id FROM bank_transactions WHERE id=?)").run(foreign);
 db.prepare('INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES(?,?,?,?)').run('synthetic-foreign-allocation','invoice-0599',foreign,31250);
 const row=decision(await readonlyPreview(db),own);assert.equal(row.status,'BLOCKED');assert.equal(row.allocations.length,0);assert.ok(row.reasonCodes.includes('ALLOCATION_EVIDENCE_CONFLICT'));
});

test('an unreadable active owner account resource cannot be ignored beside a valid consent',async t=>{
 const db=fixture(t);invoice(db);const id=payment(db);
 db.prepare("UPDATE bank_connections SET accounts_json='unreadable-synthetic-resource'").run();approveSyntheticBankAccount(db,account,{id:'second-readable-consent'});
 const row=decision(await readonlyPreview(db),id);assert.equal(row.status,'BLOCKED');assert.equal(row.allocations.length,0);
});

test('authenticated GET preview remains read-only and rejects mutation or client policy payloads',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'mgeorge-reconciliation-preview-api-'));
 for(const key of Object.keys(process.env))if(/^(GOOGLE_|ENABLE_BANKING_|ENABLEBANKING_|MG_ADMIN_PASSWORD|ENCRYPTION_KEY)/.test(key))delete process.env[key];
 Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'https://mg.example.test',DB_PATH:join(directory,'synthetic.sqlite'),SESSION_SECRET:'1'.repeat(64),BANK_DATA_KEY:'3'.repeat(64),MG_ADMIN_PASSWORD:'Synthetic test password 123!'});
 const {server,db}=await import('../src/server.js');
 const base=await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`));});
 t.after(()=>new Promise(resolve=>server.close(()=>{db.close();rmSync(directory,{recursive:true,force:true});resolve();})));
 async function call(path,method='GET',body,cookie=''){return new Promise((resolve,reject)=>{const payload=body===undefined?undefined:JSON.stringify(body);const req=request(base+path,{method,headers:{Host:'mg.example.test',...(cookie?{Cookie:cookie}:{}),...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),Origin:process.env.APP_ORIGIN}:{})}},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,json:JSON.parse(Buffer.concat(chunks).toString())}));});req.on('error',reject);req.end(payload);});}
 assert.equal((await call('/api/reconciliation/preview')).status,401);
 const login=await call('/api/login','POST',{password:process.env.MG_ADMIN_PASSWORD});const cookie=login.headers['set-cookie'][0].split(';')[0];
 approveSyntheticBankAccount(db,account);db.prepare("UPDATE bank_connections SET owner='administrator'").run();invoice(db);const id=payment(db);db.prepare("UPDATE import_jobs SET owner='administrator'").run();
 const before=snapshot(db);db.exec('PRAGMA query_only=ON');
 try{
  const result=await call('/api/reconciliation/preview?transactionId='+encodeURIComponent(id),'GET',undefined,cookie);assert.equal(result.status,200,JSON.stringify(result.json));assert.equal(result.json.changed,false);assert.equal(result.json.writesAllowed,false);assert.equal(decision(result.json,id).status,'VERIFIED');assert.equal(result.json.companyId,'workspace:administrator');
  assert.equal((await call('/api/reconciliation/preview','POST',{confirm:true},cookie)).status,404);
  assert.equal((await call('/api/reconciliation/preview?owner=foreign-owner','GET',undefined,cookie)).status,400);
  assert.equal((await call('/api/reconciliation/preview?referencePolicy=trust-browser','GET',undefined,cookie)).status,400);
  assert.deepEqual(snapshot(db),before);
 }finally{db.exec('PRAGMA query_only=OFF');}
 await t.test('a session revoked during snapshot hashing cannot receive the private preview',async()=>{
  const original=crypto.subtle.digest.bind(crypto.subtle);let release,reached;const wait=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{reached=resolve;});
  crypto.subtle.digest=async(...args)=>{reached();await wait;return original(...args);};
  try{
   const pending=call('/api/reconciliation/preview','GET',undefined,cookie);await started;
   assert.equal((await call('/api/logout','POST',{},cookie)).status,200);release();
   assert.equal((await pending).status,401);
  }finally{release();crypto.subtle.digest=original;}
 });
});
