import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeDocument} from '../src/db.js';
import {createIntegrationJobs} from '../src/integration-jobs.js';
import {encryptObject,decryptObject,digest} from '../src/security.js';

const adapterUrl=new URL('../src/company-bank-sync.js',import.meta.url);
const facadeUrl=new URL('../src/company-sync-database.js',import.meta.url);
const implementation=existsSync(adapterUrl)?await import(adapterUrl):null;
const facadeImplementation=existsSync(facadeUrl)?await import(facadeUrl):null;
const START=Date.parse('2026-11-04T12:00:00Z');
process.env.BANK_DATA_KEY='7'.repeat(64);delete process.env.ENCRYPTION_KEY;
const raw=(id='synthetic-entry')=>({status:'BOOK',entry_reference:id,transaction_id:'lookup-'+id,booking_date:'2026-11-04',transaction_amount:{amount:'125.00',currency:'SEK'},credit_debit_indicator:'CRDT',debtor:{name:'Synthetic payer AB'},reference_number:'000123'});
const selector={companyId:'company-A',connectionId:'connection-A',accountKey:implementation.nodeCompanyBankAccountKey({bank:'Swedbank',account:{account_id:{other:{identification:'SYNTHETIC-ACCOUNT-A'}}}})};
const liveSession=()=>({status:'AUTHORIZED',accounts:['uid-A'],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:'2026-11-06T12:00:00Z'}});

async function fixture(t,{provider,bankgiroEnabled=false,...options}={}){
 assert.ok(implementation?.createNodeCompanyBankSyncRuntime,'Node company adapter must be available');
 const folder=mkdtempSync(join(tmpdir(),'mg-company-sync-')),db=openDatabase(join(folder,'company.sqlite'));
 t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
 const account={uid:'uid-A',name:'Synthetic account',currency:'SEK',account_id:{other:{identification:'SYNTHETIC-ACCOUNT-A'}}};
 db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,selected_account_uid) VALUES(?,?,?,?,?,?,?,?)').run('connection-A','enablebanking','Swedbank',encryptObject({session_id:'consent-A'}),encryptObject([account]),'2026-11-06T12:00:00Z','owner-A','uid-A');
 db.exec('CREATE TABLE synthetic_authority(active INTEGER,revision INTEGER,generation TEXT); INSERT INTO synthetic_authority VALUES(1,1,\'generation-1\')');
 const calls=[];let time=START;
 const context=()=>{
  const state=db.prepare('SELECT * FROM synthetic_authority').get();
  return {...selector,owner:'owner-A',provider:'enablebanking',accountUid:'uid-A',consentId:'consent-A',generation:state.generation,revision:state.revision,authorizationStatus:state.active?'VERIFIED':'REVOKED',validUntil:'2026-11-06T12:00:00Z',ratePolicy:{verified:true,evidenceId:'synthetic-quota',maxRequests:100,windowMs:60000},bankgiroEnabled};
 };
 const config={db,companyId:'company-A',owner:'owner-A',evidenceId:'synthetic-binding',now:()=>time,
  resolveContext:async()=>context(),assertCurrent:snapshot=>{const current=context();if(current.authorizationStatus!=='VERIFIED'||current.generation!==snapshot.generation||current.revision!==snapshot.revision)throw Object.assign(new Error('changed'),{code:'AUTHORIZATION_CHANGED'});},
  listJobs:async()=>[{...selector}],
  providerRequest:async(path,request)=>{calls.push(path);if(path.startsWith('/sessions/'))return liveSession();return provider?provider({path,request,db,calls}):{transactions:[raw()]};},...options};
 const runtime=await implementation.createNodeCompanyBankSyncRuntime(config);
 await runtime.store.setReferencePolicy({companyId:'company-A',owner:'owner-A',revision:1,companyName:'Synthetic Company A',mode:'invoice_number',evidenceId:'synthetic-reference-policy'});
 return {db,runtime,config,context,calls,setTime:value=>{time=value;}};
}

test('Node SQL facade rolls back canonical work when receipt statements fail',async t=>{
 assert.ok(facadeImplementation?.createCompanySyncDatabase,'Node SQL transaction bridge must be available');
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec('CREATE TABLE records(id TEXT PRIMARY KEY); CREATE TABLE receipts(id TEXT PRIMARY KEY)');
 const database=facadeImplementation.createCompanySyncDatabase(sql);
 await assert.rejects(database.batchWork([],()=>{sql.prepare('INSERT INTO records VALUES(?)').run('bank-row');return {imported:1};},()=>[database.prepare('INSERT INTO missing_receipts VALUES(?)').bind('receipt')]),/missing_receipts/);
 assert.equal(sql.prepare('SELECT count(*) n FROM records').get().n,0);
 const result=await database.batchWork([],()=>{sql.prepare('INSERT INTO records VALUES(?)').run('bank-row');return {imported:1};},value=>[database.prepare('INSERT INTO receipts VALUES(?)').bind(String(value.imported))]);
 assert.deepEqual(result,{imported:1});assert.equal(sql.prepare('SELECT count(*) n FROM receipts').get().n,1);
});

test('Node SQL facade rejects asynchronous work and foreign database statements',async t=>{
 assert.ok(facadeImplementation?.createCompanySyncDatabase,'Node SQL transaction bridge must be available');
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('CREATE TABLE records(id TEXT)');
 const database=facadeImplementation.createCompanySyncDatabase(sql),foreign=facadeImplementation.createCompanySyncDatabase(sql);
 await assert.rejects(database.batchWork([],()=>{sql.prepare('INSERT INTO records VALUES(?)').run('late');return Promise.resolve({});},()=>[]),/synchronous/);
 await assert.rejects(database.batch([foreign.prepare('INSERT INTO records VALUES(?)').bind('foreign')]),/statement/i);
 assert.equal(sql.prepare('SELECT count(*) n FROM records').get().n,0);
});

test('Node company import preserves raw bank evidence and atomically deduplicates replay receipts',async t=>{
 const f=await fixture(t),first=await f.runtime.run(selector);
 assert.equal(first.status,'success');assert.equal(first.imported,1);
 const row=f.db.prepare('SELECT * FROM bank_transactions').get();
 assert.deepEqual(JSON.parse(row.raw_bank_data),raw());assert.equal(row.raw_bank_data_sha256,digest(JSON.stringify(raw())));
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_receipts').get().n,1);
 assert.ok(decryptObject(f.db.prepare('SELECT encrypted_session FROM bank_connections').get().encrypted_session).sync_coverage);
 const second=await f.runtime.run(selector),third=await f.runtime.run(selector);
 assert.equal(second.status,'success');assert.equal(second.imported,0);assert.equal(second.duplicate,1);
 assert.equal(third.status,'success');assert.equal(third.imported,0);assert.equal(third.duplicate,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM import_jobs').get().n,2);
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n,12);
 assert.equal(f.db.prepare('SELECT count(*) n FROM allocations').get().n,0);
});

test('receipt failure rolls back bank rows, raw originals, import history and coverage together',async t=>{
 const f=await fixture(t),before=f.db.prepare('SELECT encrypted_session FROM bank_connections').get().encrypted_session;
 f.db.exec("CREATE TRIGGER fail_company_receipt BEFORE INSERT ON company_bank_sync_receipts BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END");
 const result=await f.runtime.run(selector);
 assert.equal(result.status,'retry');
 for(const table of ['bank_transactions','import_jobs','company_bank_sync_receipts'])assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
 assert.equal(f.db.prepare('SELECT encrypted_session FROM bank_connections').get().encrypted_session,before);
 assert.equal(f.db.prepare('SELECT checkpoint FROM company_bank_sync_jobs').get().checkpoint,null);
});

test('revocation during provider response prevents new import and retains earlier originals',async t=>{
 let revoked=false;
 const f=await fixture(t,{provider:({db})=>{if(revoked)db.prepare('UPDATE synthetic_authority SET active=0').run();return {transactions:[raw(revoked?'late-entry':'retained-entry')]};}});
 assert.equal((await f.runtime.run(selector)).status,'success');
 const before=f.db.prepare('SELECT * FROM bank_transactions').all();revoked=true;
 assert.equal((await f.runtime.run(selector)).status,'blocked');
 assert.deepEqual(f.db.prepare('SELECT * FROM bank_transactions').all(),before);
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_receipts').get().n,1);
});

test('current selected account is checked after a provider request',async t=>{
 const f=await fixture(t,{provider:({db})=>{db.prepare("UPDATE bank_connections SET selected_account_uid='other-account'").run();return {transactions:[raw()]};}});
 assert.equal((await f.runtime.run(selector)).status,'blocked');
 assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,0);
});

test('ambiguous duplicate selected account UIDs block before any provider call',async t=>{
 const f=await fixture(t),accounts=decryptObject(f.db.prepare('SELECT accounts_json FROM bank_connections').get().accounts_json);
 f.db.prepare('UPDATE bank_connections SET accounts_json=?').run(encryptObject([accounts[0],{...accounts[0],account_id:{other:{identification:'DIFFERENT-SYNTHETIC-ACCOUNT'}}}]));
 assert.equal((await f.runtime.run(selector)).status,'blocked');assert.equal(f.calls.length,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,0);
});

test('selected non-SEK or unknown currency blocks this adapter before provider access',async t=>{
 for(const currency of ['EUR',undefined]){
  const f=await fixture(t),accounts=decryptObject(f.db.prepare('SELECT accounts_json FROM bank_connections').get().accounts_json);
  if(currency===undefined)delete accounts[0].currency;else accounts[0].currency=currency;
  f.db.prepare('UPDATE bank_connections SET accounts_json=?').run(encryptObject(accounts));
  const result=await f.runtime.run(selector);assert.equal(result.status,'blocked');assert.equal(result.code,'ACCOUNT_MISMATCH');
  assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,0);
 }
});

test('caller and resolver cannot relabel the same bank account with a fresh quota key',async t=>{
 const f=await fixture(t),wrong={...selector,accountKey:'account:arbitrary-renewal-key'};
 const runtime=await implementation.createNodeCompanyBankSyncRuntime({...f.config,resolveContext:async()=>({...f.context(),accountKey:wrong.accountKey})});
 const result=await runtime.run(wrong);assert.equal(result.status,'blocked');assert.equal(result.code,'ACCOUNT_MISMATCH');
 assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_jobs').get().n,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n,0);
});

test('actual provider UID and consent renewal preserves the stable account budget and receipts',async t=>{
 const f=await fixture(t);let uid='uid-A',consent='consent-A',providerCalls=0;
 const config={...f.config,
  resolveContext:async()=>({...f.context(),accountUid:uid,consentId:consent,ratePolicy:{verified:true,evidenceId:'synthetic-four-request-budget',maxRequests:4,windowMs:60000}}),
  providerRequest:async path=>{providerCalls++;return path.startsWith('/sessions/')?{...liveSession(),accounts:[uid]}:{transactions:[raw()]};},
 };
 const first=await implementation.createNodeCompanyBankSyncRuntime(config);
 assert.equal((await first.run(selector)).status,'success');assert.equal(providerCalls,4);
 const original=f.db.prepare('SELECT id,raw_bank_data,raw_bank_data_sha256 FROM bank_transactions').get();
 const connection=f.db.prepare('SELECT * FROM bank_connections').get(),accounts=decryptObject(connection.accounts_json),session=decryptObject(connection.encrypted_session);
 uid='uid-renewed';consent='consent-renewed';accounts[0].uid=uid;session.session_id=consent;
 f.db.prepare('UPDATE bank_connections SET selected_account_uid=?,accounts_json=?,encrypted_session=?').run(uid,encryptObject(accounts),encryptObject(session));
 f.db.prepare("UPDATE synthetic_authority SET revision=2,generation='generation-2'").run();
 const renewed=await implementation.createNodeCompanyBankSyncRuntime(config),blocked=await renewed.run(selector);
 assert.equal(blocked.status,'retry');assert.equal(blocked.code,'PROVIDER_BUDGET_EXHAUSTED');assert.equal(providerCalls,4);
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_jobs').get().n,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_receipts').get().n,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n,4);
 f.setTime(START+60000);
 const replay=await renewed.run(selector);assert.equal(replay.status,'success');assert.equal(replay.imported,0);assert.equal(replay.duplicate,1);
 assert.deepEqual(f.db.prepare('SELECT id,raw_bank_data,raw_bank_data_sha256 FROM bank_transactions').get(),original);
 assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_jobs').get().n,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_receipts').get().n,2);
});

test('replacement connection ID for the same stable bank account requires an explicit migration',async t=>{
 const f=await fixture(t);assert.equal((await f.runtime.run(selector)).status,'success');
 const beforeCalls=f.calls.length;
 f.db.prepare("UPDATE bank_connections SET id='connection-replacement'").run();
 f.db.prepare("UPDATE synthetic_authority SET revision=2,generation='generation-2'").run();
 const replacement={...selector,connectionId:'connection-replacement'};
 const runtime=await implementation.createNodeCompanyBankSyncRuntime({...f.config,resolveContext:async()=>({...f.context(),connectionId:replacement.connectionId})});
 const result=await runtime.run(replacement);assert.equal(result.status,'blocked');assert.equal(result.code,'COMPANY_SCOPE_MISMATCH');
 assert.equal(f.calls.length,beforeCalls);
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_jobs').get().n,1);
 assert.equal(f.db.prepare('SELECT connection_id FROM company_bank_sync_jobs').get().connection_id,'connection-A');
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_receipts').get().n,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);
});

test('Node account key helper preserves identity namespaces and ignores provider session UIDs',()=>{
 assert.ok(implementation?.nodeCompanyBankAccountKey,'Agent 1 needs the same stable account-key derivation as the Node runtime');
 const key=account=>implementation.nodeCompanyBankAccountKey({provider:'enablebanking',bank:'Swedbank',country:'SE',account});
 const iban='SE3550000000054910000003';
 assert.equal(key({uid:'old-uid',account_id:{iban}}),key({uid:'renewed-uid',account_id:{iban:'se35 5000 0000 0549 1000 0003'}}));
 const other=key({uid:'old-uid',account_id:{other:{identification:'000123',scheme_name:'BBAN'}}});
 assert.equal(other,key({uid:'renewed-uid',account_id:{other:{identification:'000123',scheme_name:'BBAN'}}}));
 assert.notEqual(other,key({account_id:{other:{identification:'000123'}}}));
 assert.notEqual(other,key({identification_hash:'000123'}));
 assert.notEqual(other,key({account_id:{other:{identification:'123',scheme_name:'BBAN'}}}));
 assert.notEqual(key({account_id:{other:{scheme_name:'A:B',identification:'C'}}}),key({account_id:{other:{scheme_name:'A',identification:'B:C'}}}));
 assert.throws(()=>key({uid:'session-account-only'}),error=>error.code==='ACCOUNT_MISMATCH');
});

test('existing legacy bank lease blocks company sync before any provider call',async t=>{
 const f=await fixture(t),legacy=createIntegrationJobs(f.db,{now:()=>START}).claim('bank:connection-A');
 try{const result=await f.runtime.run(selector);assert.equal(result.status,'retry');assert.equal(result.code,'ACCOUNT_BUSY');assert.equal(f.calls.length,0);}
 finally{legacy.release();}
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n,0);
});

test('provider 429 persists a cooldown across runtime restart and consent renewal',async t=>{
 const f=await fixture(t,{provider:()=>{throw Object.assign(new Error('synthetic rate limit'),{status:429,code:'rate_limited',retryAfter:120});}});
 const first=await f.runtime.run(selector);assert.equal(first.status,'retry');assert.equal(first.nextAttemptAt,START+120000);
 f.db.prepare("UPDATE synthetic_authority SET revision=2,generation='generation-2'").run();
 const restarted=await implementation.createNodeCompanyBankSyncRuntime(f.config);
 assert.equal((await restarted.run(selector)).status,'retry');assert.equal(f.calls.length,2);
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n,2);
 assert.equal(f.db.prepare('SELECT retry_after FROM bank_connections').get().retry_after,START+120000);
});

test('provider 503 Retry-After remains authoritative for company and legacy paths',async t=>{
 const f=await fixture(t,{provider:()=>{throw Object.assign(new Error('synthetic service outage'),{status:503,code:'bank_unavailable',retryAfter:172800});}});
 const result=await f.runtime.run(selector);
 assert.equal(result.status,'retry');assert.equal(result.nextAttemptAt,START+172800000);
 assert.equal(f.db.prepare('SELECT retry_after FROM bank_connections').get().retry_after,START+172800000);
 assert.equal((await f.runtime.run(selector)).status,'retry');assert.equal(f.calls.length,2);
});

test('all pages reserve quota and absent Bankgiro detail remains explicitly partial',async t=>{
 const f=await fixture(t,{bankgiroEnabled:true,provider:({path})=>new URL(path,'https://synthetic.invalid').searchParams.has('continuation_key')?{transactions:[raw('entry-2')]}:{transactions:[raw('entry-1')],continuation_key:'page-2'}});
 const result=await f.runtime.run(selector);
 assert.equal(result.status,'partial');assert.equal(result.imported,2);assert.equal(result.coverage.bankgiro,'unavailable');assert.equal(result.coverage.paymentDataComplete,false);
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n,5);
});

test('remote consent revoked during enrichment retains AIS evidence and blocks actual invoice allocation',async t=>{
 t.mock.timers.enable({apis:['Date'],now:START});
 const requestCounts=[];
 for(const revoked of [false,true]){
  const f=await fixture(t,{bankgiroEnabled:true}),iban='SE4280000890119146168423';
  const account={uid:'uid-A',currency:'SEK',account_id:{iban}};
  f.db.prepare('UPDATE bank_connections SET accounts_json=?').run(encryptObject([account]));
  const chosen={...selector,accountKey:implementation.nodeCompanyBankAccountKey({account,bank:'Swedbank'})};
  f.db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,issued_at) VALUES(?,?,?,?,?,?)').run('invoice','customer','000123','Synthetic payer AB',12500,'2026-10-01');
  const document=storeDocument(f.db,{invoice_id:'invoice',name:'synthetic-invoice.txt',mime_type:'text/plain',bytes:Buffer.from('Synthetic Company A invoice 000123')});
  f.db.prepare('UPDATE documents SET extraction=? WHERE id=?').run(JSON.stringify({fields:{invoice_number:{value:'000123'},reference:{value:''}},details:{supplier:{name:'Synthetic Company A'}}}),document.id);
  let remoteStatus='AUTHORIZED',retained;
  const calls=[];
  const snapshot=()=>Object.fromEntries(['invoices','bank_transactions','documents','company_bank_sync_receipts','audit_events','allocations','payer_links'].map(table=>[table,f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
  const runtime=await implementation.createNodeCompanyBankSyncRuntime({...f.config,
   resolveContext:async()=>({...f.context(),accountKey:chosen.accountKey}),
   providerRequest:async path=>{calls.push(path);return path.startsWith('/sessions/')?{...liveSession(),status:remoteStatus}:{transactions:[raw()]};},
   enrich:async()=>{retained=snapshot();assert.equal(retained.company_bank_sync_receipts.length,1);await Promise.resolve();if(revoked)remoteStatus='REVOKED';return {state:'verified'};},
  });
  const result=await runtime.run(chosen);
  if(revoked){
   assert.equal(f.db.prepare('SELECT count(*) n FROM allocations').get().n,0);
   assert.equal(result.status,'blocked');assert.equal(result.imported,1);
   assert.deepEqual(snapshot(),retained);
   assert.deepEqual(JSON.parse(retained.bank_transactions[0].raw_bank_data),raw());
   assert.equal(retained.bank_transactions[0].raw_bank_data_sha256,digest(JSON.stringify(raw())));
  }else{
   // Positive control: this original, policy, IBAN, payer, amount and exact
   // reference really reach the financial engine when authority remains live.
   assert.equal(result.status,'success');assert.equal(f.db.prepare('SELECT count(*) n FROM allocations').get().n,1);
   assert.equal(f.db.prepare('SELECT amount_cents FROM allocations').get().amount_cents,12500);
   assert.equal(f.db.prepare("SELECT count(*) n FROM audit_events WHERE action='automatic_match'").get().n,1);
  }
  requestCounts.push(calls.length);assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n,calls.length);
 }
 assert.deepEqual(requestCounts,[4,4]);
});

test('remote consent revoked during a successful page is checked again before import',async t=>{
 let sessionChecks=0;
 const f=await fixture(t,{providerRequest:async path=>path.startsWith('/sessions/')?{...liveSession(),status:++sessionChecks===1?'AUTHORIZED':'REVOKED'}:{transactions:[raw()]}});
 assert.equal((await f.runtime.run(selector)).status,'blocked');assert.equal(sessionChecks,2);
 assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n,3);
});

for(const flag of [false,null,'true',0])test('present denied or malformed transaction access '+JSON.stringify(flag)+' blocks remote consent before transaction reads',async t=>{
 let transactionReads=0,sessionReads=0;
 const f=await fixture(t,{providerRequest:async path=>{if(path.startsWith('/sessions/')){sessionReads++;return {...liveSession(),access:{...liveSession().access,transactions:flag}};}transactionReads++;return {transactions:[raw()]};}});
 const result=await f.runtime.run(selector);assert.equal(result.status,'blocked');assert.equal(result.code,'AUTHORIZATION_CHANGED');assert.equal(transactionReads,0);assert.equal(sessionReads,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n,1);
});

test('financial conflict retains both originals and review evidence without adding money',async t=>{
 let amount='125.00';
 const f=await fixture(t,{provider:()=>({transactions:[{...raw(),transaction_amount:{amount,currency:'SEK'}}]})});
 assert.equal((await f.runtime.run(selector)).status,'success');
 const before=f.db.prepare('SELECT * FROM bank_transactions').get();amount='250.00';
 const result=await f.runtime.run(selector);assert.equal(result.status,'blocked');assert.equal(result.code,'IMPORT_IDENTITY_CONFLICT');
 const after=f.db.prepare('SELECT * FROM bank_transactions').get();
 assert.equal(after.id,before.id);assert.equal(after.amount_cents,12500);assert.equal(after.raw_bank_data,before.raw_bank_data);assert.equal(after.raw_bank_data_sha256,before.raw_bank_data_sha256);
 assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM allocations').get().n,0);
 const rejected=f.db.prepare("SELECT * FROM import_jobs WHERE status='blocked'").get();assert.ok(rejected);assert.equal(rejected.owner,'owner-A');
 assert.equal(JSON.parse(Buffer.from(rejected.content).toString()).transactions[0].transaction_amount.amount,'250.00');
 const conflicts=JSON.parse(after.bank_evidence_conflicts);assert.equal(conflicts.length,1);assert.deepEqual(conflicts[0].fields,['amount_cents']);assert.deepEqual(conflicts[0].original_import_ids,[rejected.id]);
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_receipts').get().n,2);
});

test('lease cleanup failure cannot relabel a committed company import as failed',async t=>{
 const f=await fixture(t);
 f.db.exec("CREATE TRIGGER fail_legacy_cleanup BEFORE UPDATE OF lease ON integration_jobs WHEN NEW.lease='' BEGIN SELECT RAISE(ABORT,'synthetic cleanup failure'); END");
 const result=await f.runtime.run(selector);assert.equal(result.status,'success');assert.equal(result.imported,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_receipts').get().n,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);
});

test('one financial SQLite database cannot be relabeled for a second company',async t=>{
 const f=await fixture(t);await f.runtime.run(selector);
 await assert.rejects(implementation.createNodeCompanyBankSyncRuntime({...f.config,companyId:'company-B',owner:'owner-B',evidenceId:'different-binding'}),error=>error.code==='COMPANY_SCOPE_MISMATCH');
 assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);
 assert.equal(f.db.prepare('SELECT company_id FROM company_bank_sync_scopes').get().company_id,'company-A');
});

test('legacy financial data needs an explicit company designation before its first binding',async t=>{
 const f=await fixture(t);await f.runtime.run(selector);
 f.db.exec('DELETE FROM company_bank_sync_scopes');
 await assert.rejects(implementation.createNodeCompanyBankSyncRuntime(f.config),error=>error.code==='COMPANY_SCOPE_MISMATCH');
 assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_scopes').get().n,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);
 const designated=await implementation.createNodeCompanyBankSyncRuntime({...f.config,existingDataCompanyId:'company-A'});
 assert.equal(designated.companyId,'company-A');
});

test('current authorization is guarded synchronously at the receipt commit boundary',async t=>{
 const f=await fixture(t);
 f.db.exec('CREATE TRIGGER revoke_during_receipt AFTER INSERT ON company_bank_sync_receipts BEGIN UPDATE synthetic_authority SET active=0; END');
 assert.equal((await f.runtime.run(selector)).status,'blocked');
 for(const table of ['bank_transactions','import_jobs','company_bank_sync_receipts'])assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
});

test('asynchronous authority guards fail closed before provider calls',async t=>{
 const f=await fixture(t,{assertCurrent:async()=>true});
 assert.equal((await f.runtime.run(selector)).status,'blocked');assert.equal(f.calls.length,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,0);
});

test('unbounded provider Retry-After remains blocked for legacy and company callers',async t=>{
 const f=await fixture(t,{provider:()=>{throw Object.assign(new Error('synthetic unlimited cooldown'),{status:429,code:'rate_limited',retryAfter:120,retryBlocked:true});}});
 const result=await f.runtime.run(selector);assert.equal(result.status,'blocked');assert.equal(result.nextAttemptAt,null);
 assert.ok(f.db.prepare('SELECT retry_blocked FROM company_bank_sync_jobs').get().retry_blocked>0);
 assert.equal(f.db.prepare('SELECT retry_blocked FROM integration_jobs').get().retry_blocked,1);
 assert.equal((await f.runtime.run(selector)).status,'blocked');assert.equal(f.calls.length,2);
});

test('scheduler runs only deliberately registered company runtimes',async t=>{
 const f=await fixture(t);
 const before=await implementation.runScheduledCompanyBankSync();assert.equal(before.results.length,0);assert.equal(f.calls.length,0);
 const unregister=implementation.registerCompanyBankSyncRuntime(f.runtime);t.after(unregister);
 const result=await implementation.runScheduledCompanyBankSync();assert.equal(result.results.length,1);assert.equal(result.results[0].status,'success');
 assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);
 unregister();assert.equal((await implementation.runScheduledCompanyBankSync()).results.length,0);
});
