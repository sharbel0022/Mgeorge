import test from 'node:test';
import {request} from 'node:http';
import assert from 'node:assert/strict';
import {openDatabase,recordImport} from '../src/db.js';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {digest} from '../src/security.js';
import {makeBankgiroXLSX} from '../sites/tests/helpers/bankgiro-xlsx-fixture.mjs';
const adapter=await import('../src/bankgiro-ingest.js').catch(()=>({}));
const owner='local-admin',account='SE4280000890119146168423';
const csv=(withAccount=true)=>Buffer.from(`Datum;Belopp;Betalare;OCR;Valuta;Konto\n2026-10-26;625,00;Synthetic Payer;0599;SEK;${withAccount?account:''}`);
function fixture(){
 const db=openDatabase(join(mkdtempSync(join(tmpdir(),'mg-ingest-')),'db.sqlite'));
 db.exec('CREATE TABLE IF NOT EXISTS bankgiro_ingest_leases(owner TEXT PRIMARY KEY,token TEXT NOT NULL,expires_at INTEGER NOT NULL)');
 db.prepare('INSERT INTO bankgiro_ingest_leases VALUES(?,?,?)').run(owner,'lease',Date.now()+60000);
 const lease={owner,token:'lease',until:Date.now()+60000,async assert(){}};
 assert.equal(typeof adapter.createNodeBankgiroSink,'function','Node original sink is implemented');
 return {db,lease,sink:adapter.createNodeBankgiroSink(db)};
}
async function retained(f,bytes=csv(),filename='synthetic.csv'){
 const sha256=digest(bytes),report={reportId:'delivery-1',filename,sha256};
 const {documentId}=await f.sink.retain({owner,report,bytes,sha256,lease:f.lease});
 f.db.prepare("INSERT INTO bankgiro_ingest_sources(owner,source_id,scope_id,authorization_generation,authorization_status,updated_at) VALUES(?,?,?,?,?,?)").run(owner,'synthetic','contract','1','VERIFIED',Date.now());
 const job={...report,id:'job-1',owner,sha256,documentId,sourceId:'synthetic',scopeId:'contract',authorizationGeneration:'1'};
 f.db.prepare('INSERT INTO bankgiro_ingest_jobs(id,owner,source_id,scope_id,report_id,sha256,filename,authorization_generation,document_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(job.id,owner,job.sourceId,job.scopeId,job.reportId,sha256,filename,'1',documentId,Date.now(),Date.now());
 return {owner,job,documentId,authorization:{status:'VERIFIED',owner,sourceId:'synthetic',scopeId:'contract',generation:'1',evidenceId:'proof',validUntil:'2099-01-01T00:00:00Z'},lease:f.lease};
}
test('Node imports original CSV once, preserves reference/account and survives lost response replay',async()=>{
 const f=fixture();try{
 const input=await retained(f);const first=await f.sink.importReport(input),again=await f.sink.importReport(input);
 assert.equal(first.status,'IMPORTED');assert.equal(again.status,'DUPLICATE');assert.equal(first.importId,again.importId);
 const row=f.db.prepare('SELECT * FROM bank_transactions').get();assert.equal(row.reference,'0599');assert.equal(row.account,account);assert.equal(row.amount_cents,62500);assert.equal(f.db.prepare('SELECT status FROM documents').get().status,'bank_report');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,1);
 assert.equal(f.db.prepare('SELECT owner FROM import_jobs').get().owner,owner);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
 }finally{f.db.close();}
});
test('Node missing account and XLSX remain review-only with exact original',async()=>{
 for(const [bytes,name] of [[csv(false),'missing.csv'],[Buffer.from(csv().toString().replace(';SEK;',';;')),'missing-currency.csv'],[makeBankgiroXLSX({currency:'SEK',account,date:'2026-10-26',sequence:'83',payments:[{party:'Synthetic Payer',reference:'0599',payerBankgiro:'987-6543',amount:62500}]}),'synthetic.xlsx']]){
 const f=fixture();try{const input=await retained(f,bytes,name),result=await f.sink.importReport(input);assert.equal(result.status,'REVIEW');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);assert.equal(digest(f.db.prepare('SELECT content FROM import_jobs').get().content),digest(bytes));}finally{f.db.close();}
 }
});
test('Node replay reuses manual same-SHA import and refuses foreign owned original',async()=>{
 const f=fixture();try{
 const bytes=csv(),id=recordImport(f.db,{source:'bank_file',name:'manual.csv',content:bytes,mime_type:'text/csv',found:1,imported:1});
 const input=await retained(f,bytes);const result=await f.sink.importReport(input);assert.equal(result.status,'DUPLICATE');assert.equal(result.importId,id);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,1);
 await assert.rejects(()=>f.sink.importReport({...input,owner:'other'}));
 }finally{f.db.close();}
});
test('Node rejects changed retained bytes and expired lease before economic writes',async()=>{
 const f=fixture();try{const input=await retained(f);f.db.prepare('UPDATE documents SET content=? WHERE id=?').run(Buffer.from('tampered'),input.documentId);await assert.rejects(()=>f.sink.importReport(input));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);}finally{f.db.close();}
 const f2=fixture();try{const input=await retained(f2);f2.db.prepare('UPDATE bankgiro_ingest_leases SET expires_at=0').run();await assert.rejects(()=>f2.sink.importReport(input));assert.equal(f2.db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,0);}finally{f2.db.close();}
});
test('Node source endpoints require administrator auth, accept no owner, and stay disabled',async()=>{
 Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'https://synthetic.example',DB_PATH:join(mkdtempSync(join(tmpdir(),'mg-ingest-api-')),'db.sqlite'),SESSION_SECRET:'1'.repeat(64),BANK_DATA_KEY:'2'.repeat(64),MG_ADMIN_PASSWORD:'synthetic-test-password-only'});
 const {server,db}=await import('../src/server.js?bankgiro-ingest-test');
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const base=`http://127.0.0.1:${server.address().port}`;
 let cookie='';
 const call=(path,method='GET',body)=>new Promise((resolve,reject)=>{const req=request(base+path,{method,headers:{Host:'synthetic.example',Origin:'https://synthetic.example','Content-Type':'application/json',Cookie:cookie}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:{get:key=>[].concat(res.headers[key]||[])[0]},json:async()=>JSON.parse(text)}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});
 try{
 assert.equal((await call('/api/bankgiro/source/status')).status,401);
 assert.equal((await call('/api/bankgiro/source/run','POST',{})).status,401);
 const login=await call('/api/login','POST',{password:'synthetic-test-password-only'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
 const status=await call('/api/bankgiro/source/status');assert.equal(status.status,200);const publicStatus=await status.json();assert.equal(publicStatus.state,'DISABLED');assert.equal('cursor' in publicStatus,false);
 assert.equal((await call('/api/bankgiro/source/run','POST',{owner:'other'})).status,400);
 const run=await call('/api/bankgiro/source/run','POST',{});assert.equal(run.status,200);assert.equal((await run.json()).state,'DISABLED');
 }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
const camt=(detailCount)=>Buffer.from(`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"><BkToCstmrDbtCdtNtfctn><Ntfctn><Acct><Id><IBAN>${account}</IBAN></Id></Acct><Ntry><Amt Ccy="SEK">300.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-26</Dt></BookgDt><AcctSvcrRef>SYNTHETIC-DEPOSIT</AcctSvcrRef><NtryDtls>${detailCount?Array.from({length:detailCount},(_,i)=>`<TxDtls><Refs><AcctSvcrRef>SYNTHETIC-PAYMENT-${i}</AcctSvcrRef></Refs><AmtDtls><TxAmt><Amt Ccy="SEK">${300/detailCount}.00</Amt></TxAmt></AmtDtls><RltdPties><Dbtr><Nm>Synthetic ${i}</Nm></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>059${i}</Ref></CdtrRefInf></Strd></RmtInf></TxDtls>`).join(''):''}</NtryDtls><AddtlNtryInf>Bankgiro inbetalning</AddtlNtryInf></Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`);
test('Node original CAMT single, multi-payment and aggregate keep original evidence and never allocate',async()=>{
 for(const count of [1,2,0]){const f=fixture();try{
 const input=await retained(f,camt(count),'synthetic.xml');const result=await f.sink.importReport(input);if(!count){assert.equal(result.status,'REVIEW');assert.equal(result.paymentCount,0);}
 const rows=f.db.prepare('SELECT * FROM bank_transactions ORDER BY reference').all();assert.equal(rows.length,count||1);assert.equal(rows.reduce((sum,row)=>sum+row.amount_cents,0),30000);assert.ok(rows.every(row=>row.account===account));
 if(count)assert.equal(rows[0].reference,'0590');else assert.equal(rows[0].is_aggregate,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
 }finally{f.db.close();}}
});
test('Node shared queue uses actual SQLite sink and persists receipt across restart',async()=>{
 const db=openDatabase(join(mkdtempSync(join(tmpdir(),'mg-ingest-queue-')),'db.sqlite'));
 let downloads=0;
 const bytes=csv(),source={id:'synthetic',mode:'synthetic',async authorize({owner}){return {status:'VERIFIED',owner,sourceId:'synthetic',scopeId:'synthetic-contract',generation:'1',validUntil:'2099-01-01T00:00:00Z',evidenceId:'synthetic-proof'};},async listReports(){return {reports:[{reportId:'delivery',filename:'test.csv',sha256:digest(bytes)}],nextCursor:null};},async fetchReport(){downloads++;return bytes;}};
 try{
 const first=await adapter.createNodeBankgiroIngest(db,{source,allowSynthetic:true});const result=await first.run(owner);assert.equal(result.counts.IMPORTED,1,JSON.stringify(result));
 const second=await adapter.createNodeBankgiroIngest(db,{source,allowSynthetic:true});await second.run(owner);
 assert.equal(downloads,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,1);
 db.exec('CREATE TABLE synthetic_rollback(key TEXT,value TEXT)');const d1=adapter.nodeIngestDatabase(db);
 await assert.rejects(()=>d1.batch([d1.prepare("INSERT INTO synthetic_rollback(key,value) VALUES('synthetic-rollback','x')"),d1.prepare("SELECT json('LEASE_LOST')")]));
 assert.equal(db.prepare("SELECT value FROM synthetic_rollback WHERE key='synthetic-rollback'").get(),undefined);
 }finally{db.close();}
});
test('Node lease fencing rolls back original import and payments if lease expires at commit',async()=>{
 const f=fixture();try{
 const input=await retained(f);
 f.db.exec("CREATE TRIGGER synthetic_expire_lease AFTER INSERT ON import_jobs BEGIN UPDATE bankgiro_ingest_leases SET expires_at=0; END");
 await assert.rejects(()=>f.sink.importReport(input));
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM documents').get().n,1);
 }finally{f.db.close();}
});
test('Node queue schema initialization is safe when reopening the same database',()=>{
 const path=join(mkdtempSync(join(tmpdir(),'mg-ingest-reopen-')),'db.sqlite');
 const first=openDatabase(path);first.close();const second=openDatabase(path);second.close();
});

test('Node binds imports to persisted job and current authorization identity',async()=>{
 const f=fixture();try{const input=await retained(f);
 for(const field of ['owner','documentId','sourceId','scopeId','authorizationGeneration','reportId','sha256','filename'])await assert.rejects(()=>f.sink.importReport({...input,job:{...input.job,[field]:'changed'}}),error=>['AUTHORIZATION_CHANGED','IDENTITY_CONFLICT','HASH_MISMATCH'].includes(error.code));
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);
 }finally{f.db.close();}
});
test('Node queue marks malformed retained originals terminal BLOCKED',async()=>{
 const db=openDatabase(join(mkdtempSync(join(tmpdir(),'mg-ingest-invalid-')),'db.sqlite')),bytes=Buffer.from('malformed CSV without bank columns');
 const source={id:'synthetic',mode:'synthetic',async authorize({owner}){return {status:'VERIFIED',owner,sourceId:'synthetic',scopeId:'scope',generation:'1',validUntil:'2099-01-01T00:00:00Z',evidenceId:'proof'};},async listReports(){return {reports:[{reportId:'invalid',filename:'invalid.csv',sha256:digest(bytes)}],nextCursor:null};},async fetchReport(){return bytes;}};
 try{const ingest=await adapter.createNodeBankgiroIngest(db,{source,allowSynthetic:true});const result=await ingest.run(owner);assert.equal(result.counts.BLOCKED,1,JSON.stringify(result));assert.equal(result.counts.RETRY,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM documents').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);}finally{db.close();}
});
test('Node commit guard rejects a changed queued original identity atomically',async()=>{
 const f=fixture();try{const input=await retained(f);f.db.exec("CREATE TRIGGER synthetic_change_job AFTER INSERT ON import_jobs BEGIN UPDATE bankgiro_ingest_jobs SET authorization_generation='changed'; END");await assert.rejects(()=>f.sink.importReport(input),{code:'IDENTITY_CONFLICT'});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,0);}finally{f.db.close();}
});

test('Node commit guard honors local source revocation and generation replacement',async()=>{
 for(const assignment of ["authorization_status='BLOCKED'","authorization_generation='replacement'"]){const f=fixture();try{const input=await retained(f);f.db.exec(`CREATE TRIGGER synthetic_revoke_source AFTER INSERT ON import_jobs BEGIN UPDATE bankgiro_ingest_sources SET ${assignment}; END`);await assert.rejects(()=>f.sink.importReport(input),{code:'AUTHORIZATION_CHANGED'});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,0);}finally{f.db.close();}}
});
test('Node queue replays a renamed same-format original after an ambiguous committed import',async()=>{
 const {createBankgiroIngest}=await import('../sites/lib/bankgiro-ingest.js');
 const {createBankgiroIngestStore}=await import('../sites/lib/bankgiro-ingest-store.js');
 const db=openDatabase(join(mkdtempSync(join(tmpdir(),'mg-ingest-rename-')),'db.sqlite'));
 let clock=Date.now(),lost=false;const now=()=>clock++,bytes=csv();
 const source={id:'synthetic',mode:'synthetic',async authorize({owner}){return {status:'VERIFIED',owner,sourceId:'synthetic',scopeId:'scope',generation:'1',validUntil:'2099-01-01T00:00:00Z',evidenceId:'proof'};},async listReports(){return {reports:[{reportId:'first',filename:'first.csv',sha256:digest(bytes)},{reportId:'renamed',filename:'renamed.csv',sha256:digest(bytes)}],nextCursor:'acknowledged'};},async fetchReport(){return bytes;}};
 const actual=adapter.createNodeBankgiroSink(db,{now}),sink={retain:actual.retain,async importReport(input){const result=await actual.importReport(input);if(!lost){lost=true;throw Error('Synthetic lost response after commit');}return result;}};
 try{
 const ingest=createBankgiroIngest({source,store:createBankgiroIngestStore(adapter.nodeIngestDatabase(db),{now}),sink,now,allowSynthetic:true});
 const first=await ingest.run(owner);assert.equal(first.counts.RETRY,1);assert.equal(first.counts.DUPLICATE,1,JSON.stringify(first));assert.equal(first.counts.BLOCKED,0);
 clock+=120000;const final=await ingest.run(owner);assert.equal(final.counts.DUPLICATE,2);assert.equal(final.counts.BLOCKED,0);assert.equal(final.cursor,'acknowledged');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM documents').get().n,1);assert.equal(db.prepare('SELECT name FROM documents').get().name,'first.csv');assert.deepEqual(db.prepare('SELECT filename FROM bankgiro_ingest_jobs ORDER BY filename').all().map(row=>row.filename),['first.csv','renamed.csv']);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
 }finally{db.close();}
});
test('Node rejects a retained original relabeled as a different file format',async()=>{
 const f=fixture();try{const input=await retained(f);input.job.filename='renamed.xml';f.db.prepare('UPDATE bankgiro_ingest_jobs SET filename=? WHERE id=?').run(input.job.filename,input.job.id);await assert.rejects(()=>f.sink.importReport(input),{code:'IDENTITY_CONFLICT'});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);}finally{f.db.close();}
});
