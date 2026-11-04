import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase} from '../src/db.js';
import {digest} from '../src/security.js';
import {createNodeBankgiroIngest,createNodeBankgiroSink} from '../src/bankgiro-ingest.js';

const OWNER='synthetic-local-admin',SOURCE='synthetic-source';
const bytes=Buffer.from('Datum;Belopp;Betalare;OCR;Valuta;Konto\n2026-10-26;625,00;Synthetic Payer;0599;SEK;SE4280000890119146168423');
const sha256=digest(bytes),report={reportId:'synthetic-report',filename:'synthetic.csv',sha256};
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}
function fixture(t,{schema=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'company-bankgiro-boundary-')),db=openDatabase(join(dir,'db.sqlite'));
 const install=()=>db.exec(readFileSync(new URL('../sites/drizzle/0023_saas_bank_sync.sql',import.meta.url),'utf8'));
 if(schema)install();
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 t.mock.method(globalThis,'fetch',async()=>{throw Error('Live network forbidden in company Bankgiro tests');});
 const f={db,calls:[],install,count:table=>db.prepare('SELECT count(*) n FROM '+table).get().n,bind(owner=OWNER){db.prepare('INSERT INTO company_bank_sync_scopes(company_id,owner,evidence_id,created_at) VALUES(?,?,?,?)').run('synthetic-company',owner,'synthetic-binding-proof',Date.now());}};
 const registration={id:SOURCE,owner:OWNER,companyId:'synthetic-company',bankgiro:'0599',scopeId:'synthetic-contract',generation:'source-generation-1',profileId:'synthetic-report-profile',configurationRevision:1,enabled:true};
 const invoke=async(method,value)=>{f.calls.push(method);await f.onCall?.(method);return value;};
 f.source={id:SOURCE,mode:'production',configurationValid:true,registration,intervalMinutes:0,
  authorize({owner}){assert.equal(owner,OWNER);return invoke('authorize',{status:'VERIFIED',owner,sourceId:SOURCE,scopeId:registration.scopeId,generation:registration.generation,validUntil:'2099-01-01T00:00:00Z',evidenceId:'synthetic-provider-proof',companyId:registration.companyId,bankgiro:registration.bankgiro,profileId:registration.profileId,origin:'provider_authorization',capabilities:['bankgiro_reports:read'],checkedAt:new Date().toISOString()});},
  listReports(){return invoke('listReports',{reports:[report],nextCursor:null});},
  fetchReport(){return invoke('fetchReport',bytes);},
 };
 f.sink=createNodeBankgiroSink(db);
 f.lease={owner:OWNER,token:'synthetic-lease',until:Date.now()+300000,async assert(){}};
 f.lock=()=>db.prepare('INSERT OR REPLACE INTO bankgiro_ingest_leases(owner,token,expires_at) VALUES(?,?,?)').run(OWNER,f.lease.token,f.lease.until);
 f.input=()=>({owner:OWNER,report,bytes,sha256,lease:f.lease});
 f.retained=async()=>{
  f.lock();const {documentId}=await f.sink.retain(f.input()),job={...report,id:'synthetic-job',owner:OWNER,documentId,sourceId:SOURCE,scopeId:'synthetic-contract',authorizationGeneration:'source-generation-1'};
  db.prepare('INSERT INTO bankgiro_ingest_sources(owner,source_id,scope_id,authorization_generation,authorization_status,updated_at) VALUES(?,?,?,?,?,?)').run(OWNER,SOURCE,job.scopeId,job.authorizationGeneration,'VERIFIED',Date.now());
  db.prepare('INSERT INTO bankgiro_ingest_jobs(id,owner,source_id,scope_id,report_id,sha256,filename,authorization_generation,document_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(job.id,OWNER,SOURCE,job.scopeId,job.reportId,sha256,job.filename,job.authorizationGeneration,documentId,Date.now(),Date.now());
  return {owner:OWNER,job,documentId,lease:f.lease,authorization:{status:'VERIFIED',owner:OWNER,sourceId:SOURCE,scopeId:job.scopeId,generation:job.authorizationGeneration,evidenceId:'synthetic-provider-proof',validUntil:'2099-01-01T00:00:00Z'}};
 };
 return f;
}
function noFinancialEffects(f,{documents=0}={}){assert.equal(f.count('documents'),documents);assert.equal(f.count('import_jobs'),0);assert.equal(f.count('bank_transactions'),0);assert.equal(f.count('allocations'),0);}

for(const boundOwner of [OWNER,'different-company-owner'])test('configured legacy worker is blocked by any durable company binding: '+boundOwner,async t=>{
 const f=fixture(t),worker=await createNodeBankgiroIngest(f.db,{source:f.source});f.bind(boundOwner);const changes=f.db.prepare('SELECT total_changes() n').get().n;
 for(const operation of ['status','run']){const result=await worker[operation](OWNER);assert.equal(result.state,'BLOCKED');assert.equal(result.reason,'AUTHORIZATION_BLOCKED');assert.equal(result.authorization.status,'BLOCKED');assert.equal(result.enabled,false);assert.deepEqual(result.jobs,[]);}
 assert.deepEqual(f.calls,[]);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,changes);noFinancialEffects(f);assert.equal(f.count('bankgiro_ingest_leases'),0);
});

for(const stage of ['authorize','listReports','fetchReport'])test('company binding during '+stage+' discards the awaited legacy provider result',async t=>{
 const f=fixture(t),entered=deferred(),resume=deferred();let reached=false;
 f.onCall=async method=>{if(method===stage&&!reached){reached=true;entered.resolve();await resume.promise;}};
 const worker=await createNodeBankgiroIngest(f.db,{source:f.source}),work=worker.run(OWNER);
 await Promise.race([entered.promise,work.then(result=>{throw Error('Provider wait was not reached: '+JSON.stringify(result));})]);
 f.bind();const calls=f.calls.length;resume.resolve();const result=await work;
 assert.equal(result.state,'BLOCKED');assert.equal(result.reason,'AUTHORIZATION_BLOCKED');assert.equal(f.calls.length,calls,'no provider request may follow the changed binding');noFinancialEffects(f);
});

test('creating the company schema during an awaited fetch cannot evade the live binding check',async t=>{
 const f=fixture(t,{schema:false}),entered=deferred(),resume=deferred();f.onCall=async method=>{if(method==='fetchReport'){entered.resolve();await resume.promise;}};
 const worker=await createNodeBankgiroIngest(f.db,{source:f.source}),work=worker.run(OWNER);
 await Promise.race([entered.promise,work.then(()=>{throw Error('Fetch wait was not reached');})]);f.install();f.bind();resume.resolve();assert.equal((await work).state,'BLOCKED');noFinancialEffects(f);
});

test('direct legacy sink rejects original retention in a company database',async t=>{
 const f=fixture(t);f.lock();f.bind('different-company-owner');await assert.rejects(f.sink.retain(f.input()),{code:'AUTHORIZATION_BLOCKED'});noFinancialEffects(f);
});

test('direct legacy sink rejects import while preserving an already retained original',async t=>{
 const f=fixture(t),input=await f.retained();f.bind();await assert.rejects(f.sink.importReport(input),{code:'AUTHORIZATION_BLOCKED'});noFinancialEffects(f,{documents:1});assert.equal(digest(f.db.prepare('SELECT content FROM documents WHERE id=?').get(input.documentId).content),sha256);
});

for(const target of ['documents','import_jobs'])test('company binding inside the '+target+' transaction rolls all legacy writes back',async t=>{
 const f=fixture(t);let input;if(target==='import_jobs')input=await f.retained();else f.lock();
 f.db.exec(`CREATE TRIGGER synthetic_company_binding AFTER INSERT ON ${target} BEGIN INSERT INTO company_bank_sync_scopes(company_id,owner,evidence_id,created_at) VALUES('synthetic-company','${OWNER}','synthetic-binding-proof',1); END`);
 await assert.rejects(target==='documents'?f.sink.retain(f.input()):f.sink.importReport(input),{code:'AUTHORIZATION_BLOCKED'});noFinancialEffects(f,{documents:target==='documents'?0:1});assert.equal(f.count('company_bank_sync_scopes'),0,'the trigger and financial work share the rolled-back transaction');
});

test('unbound configured legacy worker still imports one owned original without allocating',async t=>{
 const f=fixture(t),worker=await createNodeBankgiroIngest(f.db,{source:f.source}),first=await worker.run(OWNER);assert.equal(first.counts.IMPORTED,1,JSON.stringify(first));await worker.run(OWNER);assert.equal(f.count('documents'),1);assert.equal(f.count('import_jobs'),1);assert.equal(f.count('bank_transactions'),1);assert.equal(f.count('allocations'),0);assert.equal(f.db.prepare('SELECT reference FROM bank_transactions').get().reference,'0599');
});

test('absent and disabled synthetic sources require no database or provider access',async()=>{
 const db={prepare(){throw Error('Disabled source cannot access the database');}},unexpected=()=>{throw Error('Disabled source cannot call a provider');};
 for(const source of [null,{id:SOURCE,mode:'synthetic',authorize:unexpected,listReports:unexpected,fetchReport:unexpected}]){const worker=await createNodeBankgiroIngest(db,{source});assert.equal((await worker.status(OWNER)).state,'DISABLED');assert.equal((await worker.run(OWNER)).state,'DISABLED');}
});
