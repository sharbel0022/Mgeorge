import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase,saveSettings,getSettings,recordImport} from '../src/db.js';
import {createNodeBankgiroIngest} from '../src/bankgiro-ingest.js';
const captureApi=await import('../sites/lib/bankgiro-openpayments-capture.js').catch(()=>({}));
const owner='synthetic-company-workspace',companyId='synthetic-company-a',iban='SE4280000890119146168423';
const testNow=Date.parse('2026-11-04T18:01:00Z');
function report({reference='0599',company=companyId,information=true,enriched=true,captureId='capture-1'}={}){
 assert.equal(typeof captureApi.createOpenPaymentsBankgiroCapture,'function');
 const page={account:{iban},transactions:{booked:[{transactionId:'PARENT',entryReference:'DEPOSIT',bookingDate:'2026-10-26',transactionAmount:{amount:'625.00',currency:'SEK'}}],_links:{}}};
 if(information)page.transactions.bankgiro=[{transactionId:'CHILD',entryReference:'CHILD-REFERENCE',aggregateTransactionId:'PARENT',aggregateAmount:'625.00',aggregateId:12,isAliasPayin:true,isEnriched:enriched,transactionAmount:{amount:'625.00',currency:'SEK'},bookingDate:'2026-10-26',debtorName:'Synthetic customer AB',remittanceInformationStructured:reference}];
 return captureApi.createOpenPaymentsBankgiroCapture({context:{owner,companyId:company,sourceId:'synthetic-source',scopeId:'synthetic-scope',accountId:'account-a',iban,bankgiro:'1234567'},captureId,pages:[{body:JSON.stringify(page,null,2),requestPath:'/psd2/accountinformation/v1/accounts/account-a/transactions?bookingStatus=booked',requestId:'synthetic-request',receivedAt:'2026-11-04T18:00:00Z'}]});
}
async function fixture(t,options={}){
 const dir=mkdtempSync(join(tmpdir(),'mg-opbg-')),db=openDatabase(join(dir,'db.sqlite'));t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 if(options.bind!==false)saveSettings(db,{...getSettings(db),company_id:companyId});
 const captures=options.reports||[report()],source={id:'synthetic-source',mode:'synthetic',async authorize(){return {status:'VERIFIED',origin:'provider_authorization',owner,companyId,sourceId:this.id,scopeId:'synthetic-scope',generation:'generation-1',profileId:'openpayments-bankgiro-v1',bankgiro:'1234567',accountId:'account-a',iban,evidenceId:'synthetic-proof',checkedAt:new Date(testNow).toISOString(),validUntil:'2099-01-01T00:00:00Z',capabilities:options.capabilities||['bankgiro_reports:read','accountinformation','bankgiroinformation','corporate'],...options.authorization};},async listReports(){return {reports:captures.map(({reportId,filename,sha256})=>({reportId,filename,sha256})),nextCursor:null};},async fetchReport({report:r}){return captures.find(c=>c.reportId===r.reportId&&c.sha256===r.sha256).bytes;}};
 const worker=await createNodeBankgiroIngest(db,{source,allowSynthetic:true,now:()=>testNow});return {db,source,worker,captures};
}
test('Node intake retains native JSON and exposes normalized review observations without financial rows',async t=>{
 const f=await fixture(t),status=await f.worker.run(owner);
 assert.equal(status.counts.REVIEW,1,JSON.stringify(status));
 assert.equal(status.jobs[0].paymentCount,1);assert.equal(status.jobs[0].lastError,'BANKGIRO_ENRICHMENT_REVIEW');
 const original=f.db.prepare('SELECT * FROM import_jobs').get();assert.equal(original.mime_type,'application/vnd.mgeorge.openpayments-bankgiro+json');
 assert.deepEqual(Buffer.from(original.content),Buffer.from(f.captures[0].bytes));assert.equal(original.owner,owner);
 const detail=captureApi.readOpenPaymentsBankgiroCapture(original.content);assert.equal(detail.normalization.rows[0].payerReference,'0599');assert.equal(detail.normalization.rows[0].amount,62500);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
 await f.worker.run(owner);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,1);
});
for(const [label,options] of [['another company',{foreign:true}],['a workspace without a company binding',{bind:false}],['AIS without Bankgiro scope',{capabilities:['bankgiro_reports:read','accountinformation','corporate']}]])test('Node rejects '+label,async t=>{
 const f=await fixture(t,{...options,...(options.foreign?{reports:[report({company:'foreign-company'})]}:{})}),status=await f.worker.run(owner);
 assert.equal(status.counts.BLOCKED,1,JSON.stringify(status));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);
});
test('Node preserves absent Bankgiro information as a visible review reason',async t=>{
 const f=await fixture(t,{reports:[report({information:false})]}),status=await f.worker.run(owner);
 assert.equal(status.counts.REVIEW,1);assert.equal(status.jobs[0].lastError,'BANKGIRO_INFORMATION_UNAVAILABLE');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);
});
test('same capture identity with changed original hash is blocked and never creates deposits',async t=>{
 const f=await fixture(t,{reports:[report(),report({reference:'599'})]}),status=await f.worker.run(owner);
 assert.equal(status.counts.BLOCKED,2,JSON.stringify(status));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,0);
});

function retainedImport(f,{owner:importOwner=owner,status='needs_review'}={}){
 const capture=f.captures[0],id=recordImport(f.db,{source:'bank_file',name:capture.filename,content:capture.bytes,mime_type:'application/vnd.mgeorge.openpayments-bankgiro+json',status,found:1,review:1});
 f.db.prepare('UPDATE import_jobs SET owner=? WHERE id=?').run(importOwner,id);return id;
}
test('Node capture intake never adopts an ownerless manual import',async t=>{
 const f=await fixture(t),priorId=retainedImport(f,{owner:'',status:'completed'}),status=await f.worker.run(owner);
 assert.equal(status.counts.REVIEW,1,JSON.stringify(status));
 assert.equal(f.db.prepare('SELECT owner FROM import_jobs WHERE id=?').get(priorId).owner,'');
 const imports=f.db.prepare('SELECT * FROM import_jobs WHERE owner=?').all(owner);assert.equal(imports.length,1);assert.equal(imports[0].status,'needs_review');
 assert.notEqual(imports[0].id,priorId);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);
});
test('Node capture saves only the whitelisted current authority receipt',async t=>{
 const f=await fixture(t,{authorization:{accessToken:'secret-access',refreshToken:'secret-refresh',clientSecret:'secret-client',untrusted:{token:'secret-nested'}}}),status=await f.worker.run(owner);
 assert.equal(status.counts.REVIEW,1,JSON.stringify(status));
 const metadata=JSON.parse(f.db.prepare("SELECT metadata FROM documents WHERE source='bankgiro_source'").get().metadata),auth=await f.source.authorize();
 const keys=['status','origin','owner','companyId','sourceId','scopeId','generation','accountId','iban','bankgiro','profileId','evidenceId','checkedAt','validUntil','capabilities'];
 assert.deepEqual(metadata.openPaymentsAuthorization,Object.fromEntries(keys.map(key=>[key,auth[key]])));
 assert.equal(JSON.stringify(metadata).includes('secret-'),false);
 const events=reviewAudit(f.db);assert.equal(events.length,1);assert.deepEqual(events[0].currentReceipt,metadata.openPaymentsAuthorization);assert.equal(JSON.stringify(events).includes('secret-'),false);
});
test('Node exact capture replay reuses its owned review import and normalized child count',async t=>{
 const f=await fixture(t),priorId=retainedImport(f),status=await f.worker.run(owner);
 assert.equal(status.counts.REVIEW,1,JSON.stringify(status));assert.equal(status.jobs[0].paymentCount,1);assert.equal(status.jobs[0].lastError,'BANKGIRO_ENRICHMENT_REVIEW');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,1);assert.equal(f.db.prepare('SELECT id FROM import_jobs').get().id,priorId);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
});
test('Node duplicate still requires the exact capture report identity',async t=>{
 const f=await fixture(t),priorId=retainedImport(f),capture=f.captures[0];
 f.source.listReports=async()=>({reports:[{reportId:'wrong-report-identity',filename:capture.filename,sha256:capture.sha256}],nextCursor:null});
 f.source.fetchReport=async()=>capture.bytes;
 const status=await f.worker.run(owner);assert.equal(status.counts.BLOCKED,1,JSON.stringify(status));assert.equal(status.jobs[0].lastError,'IDENTITY_CONFLICT');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,1);assert.equal(f.db.prepare('SELECT id FROM import_jobs').get().id,priorId);
});
test('Node duplicate still requires current Bankgiro authority',async t=>{
 const f=await fixture(t,{capabilities:['bankgiro_reports:read','accountinformation','corporate']});retainedImport(f);
 const status=await f.worker.run(owner);assert.equal(status.counts.BLOCKED,1,JSON.stringify(status));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);
});
test('Node commit fence rechecks the company binding after writing an import',async t=>{
 const f=await fixture(t);
 f.db.exec("CREATE TRIGGER switch_company_after_import AFTER INSERT ON import_jobs BEGIN UPDATE app_settings SET data=json_set(data,'$.company_id','foreign-company') WHERE id=1; END;");
 const status=await f.worker.run(owner);assert.equal(status.counts.BLOCKED,1,JSON.stringify(status));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,0);
 assert.equal(getSettings(f.db).company_id,companyId);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);assert.equal(reviewAudit(f.db).length,0);
});

function reviewAudit(db){return db.prepare("SELECT details FROM audit_events WHERE action='bankgiro_enrichment_review' ORDER BY rowid").all().map(row=>JSON.parse(row.details));}
test('Node exposes partial Bankgiro information for review without posting rows',async t=>{
 const f=await fixture(t,{reports:[report({enriched:false})]}),status=await f.worker.run(owner);
 assert.equal(status.counts.REVIEW,1,JSON.stringify(status));assert.equal(status.jobs[0].paymentCount,1);assert.equal(status.jobs[0].lastError,'BANKGIRO_INFORMATION_PARTIAL');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
});
test('Node commit fence rechecks current authority and rolls back the audit',async t=>{
 const f=await fixture(t);
 f.db.exec("CREATE TRIGGER revoke_authority_after_import AFTER INSERT ON import_jobs BEGIN UPDATE bankgiro_ingest_sources SET authorization_status='BLOCKED'; END;");
 const status=await f.worker.run(owner);assert.equal(status.counts.BLOCKED,1,JSON.stringify(status));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,0);
 assert.equal(f.db.prepare('SELECT authorization_status FROM bankgiro_ingest_sources WHERE owner=?').get(owner).authorization_status,'BLOCKED');assert.equal(reviewAudit(f.db).length,0);
 assert.equal(JSON.parse(f.db.prepare("SELECT metadata FROM documents WHERE source='bankgiro_source'").get().metadata).openPaymentsAuthorization,undefined);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
});
test('Node renewed authority preserves earlier audit evidence while stable duplicates do not grow it',async t=>{
 const authorization={},f=await fixture(t,{authorization});
 let status=await f.worker.run(owner);assert.equal(status.counts.REVIEW,1,JSON.stringify(status));
 const first=reviewAudit(f.db);assert.equal(first.length,1);assert.equal(first[0].currentReceipt.evidenceId,'synthetic-proof');
 assert.deepEqual(Object.keys(first[0]).sort(),['owner','documentId','importId','reportId','sha256','currentReceipt','paymentCount','reasonCode','allocationsCreated'].sort());
 assert.equal(first[0].owner,owner);assert.equal(first[0].reportId,f.captures[0].reportId);assert.equal(first[0].sha256,f.captures[0].sha256);assert.equal(first[0].paymentCount,1);assert.equal(first[0].allocationsCreated,0);
 authorization.evidenceId='renewed-synthetic-proof';
 f.db.prepare("UPDATE bankgiro_ingest_jobs SET status='RETRY',next_attempt_at=0 WHERE owner=?").run(owner);
 status=await f.worker.run(owner);assert.equal(status.counts.REVIEW,1,JSON.stringify(status));
 const renewed=reviewAudit(f.db);assert.equal(renewed.length,2);assert.deepEqual(renewed[0],first[0]);assert.equal(renewed[1].currentReceipt.evidenceId,'renewed-synthetic-proof');assert.equal(renewed[1].importId,first[0].importId);
 const metadata=JSON.parse(f.db.prepare("SELECT metadata FROM documents WHERE source='bankgiro_source'").get().metadata);assert.equal(metadata.openPaymentsAuthorization.evidenceId,'renewed-synthetic-proof');
 f.db.prepare("UPDATE bankgiro_ingest_jobs SET status='RETRY',next_attempt_at=0 WHERE owner=?").run(owner);
 status=await f.worker.run(owner);assert.equal(status.counts.REVIEW,1,JSON.stringify(status));assert.equal(reviewAudit(f.db).length,2);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
});

for(const [label,boundCompany,boundOwner,expected] of [
 ['authoritative company overrides a forged profile',companyId,owner,'REVIEW'],
 ['foreign immutable company defeats matching editable settings','foreign-company',owner,'BLOCKED'],
 ['storage owner differs from company identity',companyId,'foreign-storage','BLOCKED'],
])test('Node catalog boundary: '+label,async t=>{
 const f=await fixture(t);
 f.db.exec('CREATE TABLE company_database_boundary(id INTEGER PRIMARY KEY,company_id TEXT,storage_owner TEXT,boundary_version INTEGER,verification_ref TEXT,verified_by TEXT)');
 f.db.prepare('INSERT INTO company_database_boundary VALUES(1,?,?,1,?,?)').run(boundCompany,boundOwner,'synthetic-proof','synthetic-operator');
 if(expected==='REVIEW')saveSettings(f.db,{...getSettings(f.db),company_id:'forged-profile-id'});
 const status=await f.worker.run(owner);
 assert.equal(status.counts[expected],1,JSON.stringify(status));
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
});
