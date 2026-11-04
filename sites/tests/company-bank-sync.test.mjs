import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {applyCommand,balance,emptyState} from '../lib/domain.ts';
import {randomToken} from '../lib/banking/security.ts';
import {bankUtcDate} from '../lib/banking/sync-periods.ts';
import {ProviderError} from '../lib/banking/enable-banking.ts';
import {createCompanyBankSyncStore,companySyncError} from '../lib/company-bank-sync-store.js';
import {companyBankAccountKey} from '../lib/company-bank-account-key.js';
import {INVOICE_REFERENCE_POLICY_VERSION} from '../lib/invoice-reference-policy.js';
import {syntheticBankRow} from './helpers/bank-api-fixture.mjs';
import {ingestFixture} from './helpers/bankgiro-ingest-fixture.mjs';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const local=name=>new URL('../lib/'+name,import.meta.url).href;
const source=name=>readFileSync(new URL(name,import.meta.url),'utf8');
function compiled(name,imports={}){
 const path=new URL('../lib/'+name,import.meta.url);
 let code=existsSync(path)?stripTypeScriptTypes(readFileSync(path,'utf8'),{mode:'transform'}):'export {};';
 for(const [from,to] of Object.entries(imports))for(const q of ['"',"'"])code=code.replaceAll(q+from+q,JSON.stringify(to));
 return data(code);
}
class LocalD1{
 constructor(sql){this.sql=sql;this.beforeBatch=null;this.afterBatch=null;}
 prepare(query){const db=this;return {query,values:[],bind(...values){this.values=values;return this;},async first(){return db.sql.prepare(query).get(...this.values)||null;},async all(){return {results:db.sql.prepare(query).all(...this.values)};},async run(){return this.execute();},execute(){return {success:true,meta:{changes:Number(db.sql.prepare(query).run(...this.values).changes)}};}};}
 async batch(statements){await this.beforeBatch?.(statements);this.sql.exec('BEGIN IMMEDIATE');let result;try{result=statements.map(s=>s.execute());this.sql.exec('COMMIT');}catch(error){this.sql.exec('ROLLBACK');throw error;}await this.afterBatch?.(statements);return result;}
}
const UID='22222222-2222-4222-8222-222222222222',APP='11111111-1111-4111-8111-111111111111',SESSION='33333333-3333-4333-8333-333333333333';
const raw=overrides=>({entry_reference:'SYNTHETIC-BANK-1',status:'BOOK',transaction_amount:{amount:'100.00',currency:'SEK'},credit_debit_indicator:'CRDT',booking_date:bankUtcDate(),debtor:{name:'Synthetic customer AB'},reference_number:'0599',...overrides});
async function fixture(t,{bound=true,registered=true,bankgiro=false}={}){
 const key='__company_sync_'+crypto.randomUUID().replaceAll('-',''),sql=new DatabaseSync(':memory:');
 for(const entry of JSON.parse(source('../drizzle/meta/_journal.json')).entries)sql.exec(source('../drizzle/'+entry.tag+'.sql'));
 sql.exec('CREATE TABLE synthetic_authority(owner TEXT PRIMARY KEY,generation TEXT NOT NULL,revision INTEGER NOT NULL,active INTEGER NOT NULL)');
 const DB=new LocalD1(sql),owner='synthetic-owner-A',companyId='synthetic-company-A',connectionId='synthetic-connection-A';
 const f={sql,DB,owner,companyId,connectionId,calls:[],rows:[raw()],authorized:true,liveStatus:'AUTHORIZED',sessionCalls:0,objects:new Map(),env:{DB,BANK_DATA_ENCRYPTION_KEY:randomToken(),ENABLE_BANKING_APPLICATION_ID:APP,ENABLE_BANKING_PRIVATE_KEY:'-----BEGIN PRIVATE KEY-----\nVEVTVC1PTkxZLU5PVC1SRUFM\n-----END PRIVATE KEY-----',ENABLE_BANKING_ENVIRONMENT:'PRODUCTION',ENABLE_BANKING_KEY_ROTATED:'true'}};
 f.env.BUCKET={async get(key){const bytes=f.objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}:null;}};
 globalThis[key]=f;t.after(()=>{delete globalThis[key];sql.close();});
 t.mock.method(globalThis,'fetch',async()=>{throw Error('Live network is forbidden in company sync tests.');});
 const domain=local('domain.ts'),security=local('banking/security.ts'),runtime=local('banking/runtime-config.ts');
 const server=compiled('server.ts',{'cloudflare:workers':data(`export const env=globalThis[${JSON.stringify(key)}].env;`),'@/app/chatgpt-auth':data(`export async function getChatGPTUser(){return {userId:${JSON.stringify(owner)}};}`),'./domain':domain});
 const storeUrl=compiled('banking/store.ts',{'cloudflare:workers':data(`export const env=globalThis[${JSON.stringify(key)}].env;`),'@/lib/server':server,'./security':security,'./runtime-config':runtime}),bankStore=await import(storeUrl);
 const normalizer=compiled('banking/transactions.ts',{'../domain':domain,'../payment-references.js':local('payment-references.js'),'../payer-evidence.js':local('payer-evidence.js')});
 const provider=data(`export {ProviderError,providerCooldownDiagnostic,providerErrorCode} from ${JSON.stringify(local('banking/enable-banking.ts'))};export async function getSession(...args){return globalThis[${JSON.stringify(key)}].getSession(...args);}export async function getTransactions(...args){return globalThis[${JSON.stringify(key)}].getTransactions(...args);}export async function getApplication(){}export async function listBusinessBanks(){}export async function startAuth(){}export async function createSession(){}export async function deleteSession(){}`);
 const readGuard=compiled('banking/account-read-guard.ts',{'../server':server,'./store':storeUrl,'./enable-banking':provider,'./account-read-cooldown':local('banking/account-read-cooldown.ts')});
 const bankgiroService=compiled('bankgiro-service.ts',{'./server':server,'./domain':domain,'./bankgiro-parser.js':local('bankgiro-parser.js'),'./banking/store':storeUrl,'./banking/transactions':normalizer});
 const reconciliation=compiled('reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':local('reconciliation-engine.js'),'./company-reconciliation-policy.js':local('company-reconciliation-policy.js')});
 const evidence=compiled('reconciliation-evidence.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-engine.js':local('reconciliation-engine.js'),'./bankgiro-service':bankgiroService});
 const companyReconciliation=compiled('company-reconciliation.ts',{'./domain':domain,'./reconciliation-evidence':evidence,'./company-reconciliation-policy.js':local('company-reconciliation-policy.js'),'./company-bank-sync-store.js':local('company-bank-sync-store.js')});
 const adapter=compiled('banking/company-sync.ts',{'../server':server,'../domain':domain,'./store':storeUrl,'./security':security,'./enable-banking':provider,'./transactions':normalizer,'./account-read-guard':readGuard,'./account-read-cooldown':local('banking/account-read-cooldown.ts'),'./sync-periods':local('banking/sync-periods.ts'),'../company-bank-sync.js':local('company-bank-sync.js'),'../company-bank-sync-store.js':local('company-bank-sync-store.js'),'../company-bank-account-key.js':local('company-bank-account-key.js'),'../company-reconciliation':companyReconciliation,'../reconciliation-evidence':evidence});
 const service=compiled('banking/service.ts',{'@/lib/server':server,'@/lib/domain':domain,'./store':storeUrl,'./security':security,'./runtime-config':runtime,'./transactions':normalizer,'./enable-banking':provider,'./account-read-guard':readGuard,'./account-read-cooldown':local('banking/account-read-cooldown.ts'),'./sync-periods':local('banking/sync-periods.ts'),'./company-sync':adapter,'../customer-messages':data(`export async function reconcileAndPrepare(){globalThis[${JSON.stringify(key)}].legacyReconciled=true;}`),'../bankgiro-ingest-service':data(`export async function runBankgiroSource(){globalThis[${JSON.stringify(key)}].legacyBankgiro=true;return {state:'DISABLED'};}`)});
 f.adapter=await import(adapter);f.service=await import(service);f.bankStore=bankStore;f.store=createCompanyBankSyncStore(DB);
 f.customerApi=await import(compiled('customer-messages.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-evidence':evidence,'./customer-message-text.js':local('customer-message-text.js'),'./banking/security':security,'./banking/store':storeUrl,'./gmail-adapter.js':data('export async function prepareGmailSend(){throw Error("Sending is forbidden in company sync tests");}export function gmailAccount(){return "synthetic@example.test";}export function hasGmailSendScope(){return false;}')}));
 const app=await bankStore.application(owner),at=new Date().toISOString();f.validUntil=new Date(Date.now()+86400000).toISOString();
 sql.prepare('INSERT INTO bank_applications VALUES(?,?,?,?,?,?,?)').run(owner,APP,await bankStore.encrypt(owner,'key:generation-one','SYNTHETIC PRIVATE KEY'),JSON.stringify({name:'Synthetic app',kid:APP,environment:'PRODUCTION',active:true,redirect_urls:[],countries:['SE'],services:['AIS']}),app.generation,at,at);
 sql.prepare('INSERT INTO bank_connections(id,owner,app_generation,environment,bank_name,country,encrypted_session,encrypted_accounts,selected_accounts,valid_until,date_from,status,created_at,updated_at,auto_sync_enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)').run(connectionId,owner,app.generation,'PRODUCTION','Synthetic bank','SE',await bankStore.encrypt(owner,'session:'+connectionId,SESSION),await bankStore.encrypt(owner,'accounts:'+connectionId,[{uid:UID,currency:'SEK',account_id:{iban:'SE4280000890119146168423'},name:'Synthetic account'}]),JSON.stringify([UID]),f.validUntil,bankUtcDate(),'connected',at,at);
 sql.prepare('INSERT INTO workspaces VALUES(?,?,?,?)').run(owner,1,JSON.stringify(emptyState()),at);
 sql.prepare('INSERT INTO synthetic_authority VALUES(?,?,1,1)').run(owner,'consent-generation-1');
 f.context={companyId,owner,connectionId,provider:'enable-banking',accountKey:companyBankAccountKey({provider:'enable-banking',bank:'Synthetic bank',country:'SE',accountIdentity:'iban:SE4280000890119146168423'}),accountUid:UID,consentId:SESSION,generation:'consent-generation-1',revision:1,validUntil:f.validUntil,authorizationStatus:'VERIFIED',ratePolicy:{verified:true,evidenceId:'synthetic-quota-proof',maxRequests:20,windowMs:60000,scope:'connection'},bankgiroEnabled:bankgiro};
 if(bound){await f.store.bindScope({companyId,owner,evidenceId:'synthetic-company-owner-proof'});await f.store.setReferencePolicy({companyId,owner,revision:1,companyName:'Synthetic company A AB',mode:'invoice_number',evidenceId:'synthetic-reference-proof'});}
 f.getSession=async()=>{f.calls.push('session');f.sessionCalls++;await f.onSession?.(f.sessionCalls);return {status:f.liveStatus,accounts:f.liveAccounts??[f.context.accountUid],accounts_data:[{uid:f.context.accountUid}],aspsp:{name:'Synthetic bank',country:'SE'},psu_type:'business',access:{valid_until:f.validUntil,transactions:f.transactionsAllowed??true},created:at};};
 f.getTransactions=async(_config,uid,input)=>{f.calls.push('transactions');assert.equal(uid,f.context.accountUid);await f.onTransactions?.(input);return {transactions:f.rows,...f.page};};
 if(registered&&typeof f.adapter.registerCompanyBankSyncRuntime==='function')f.adapter.registerCompanyBankSyncRuntime({
  async jobsForOwner(received){assert.equal(received,owner);return f.jobs??[{companyId,connectionId,accountKey:f.context.accountKey}];},
  async resolveContext(){if(!f.authorized)throw companySyncError('AUTHORIZATION_UNVERIFIED');return {...f.context};},
  async currentGuard(context){return {async assert(){const current=sql.prepare('SELECT * FROM synthetic_authority WHERE owner=?').get(owner);if(!current.active||current.generation!==context.generation||current.revision!==context.revision)throw companySyncError('AUTHORIZATION_CHANGED');},fence(){return DB.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM synthetic_authority WHERE owner=? AND generation=? AND revision=? AND active=1) THEN 1 ELSE json('AUTHORIZATION_CHANGED') END").bind(owner,context.generation,context.revision);}};},
 });
 f.run=async()=>{const response=await f.service.automaticSync();return response.json();};
 f.read=()=>JSON.parse(sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(owner).payload);
 f.invoice=()=>{const bytes=Buffer.from('Synthetic company A invoice 0599'),state=applyCommand(f.read(),{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',number:'0599',ocr:'',total:10000,issued:bankUtcDate(),due:bankUtcDate(),reviewed:true,documentId:'synthetic-invoice-original'}}).state;state.invoices[0].referenceOriginal={invoice_number:'0599',reference:'',issuer_name:'Synthetic company A AB'};sql.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?)').run('synthetic-invoice-original',owner,'synthetic.txt','text/plain',bytes.length,createHash('sha256').update(bytes).digest('hex'),at);f.objects.set(owner+'/synthetic-invoice-original',bytes);sql.prepare('UPDATE workspaces SET payload=? WHERE owner=?').run(JSON.stringify(state),owner);};
 f.count=table=>sql.prepare('SELECT count(*) n FROM '+table).get().n;
 f.due=()=>sql.prepare("UPDATE bank_connections SET auto_next_at=NULL,auto_last_attempt_at=NULL,last_synced_at=NULL,sync_failures=0,retry_after='' WHERE owner=?").run(owner);
 return f;
}

test('company scheduler imports with two live consent checks and one atomic durable receipt',async t=>{
 const f=await fixture(t);assert.equal(typeof f.adapter.registerCompanyBankSyncRuntime,'function','Sites requires a trusted scheduler adapter');
 const result=await f.run();assert.equal(result.results[0].status,'success',JSON.stringify(result));assert.equal(result.imported,1);
 assert.deepEqual(f.calls,['session','transactions','session']);assert.equal(f.count('company_bank_sync_requests'),3);
 assert.equal(f.count('company_bank_sync_receipts'),1);assert.equal(f.count('bank_sync_runs'),1);assert.equal(f.read().transactions.length,1);
 assert.equal(f.read().transactions[0].bankData.reference_number,'0599');assert.equal(result.results[0].coverage.paymentDataComplete,false);
 assert.equal(f.legacyReconciled,undefined);assert.equal(f.legacyBankgiro,undefined);
});

test('durably bound company owner fails closed without its authorization runtime',async t=>{
 const f=await fixture(t,{registered:false}),result=await f.run();assert.equal(result.status,'blocked');assert.equal(f.calls.length,0);assert.equal(f.count('bank_sync_runs'),0);assert.equal(f.legacyBankgiro,undefined);
});

test('documented optional transaction flag may be omitted by a currently authorized session',async t=>{
 const f=await fixture(t),read=f.getSession;
 f.getSession=async(...args)=>{const session=await read(...args);delete session.access.transactions;return session;};
 const result=await f.run();assert.equal(result.results[0].status,'success',JSON.stringify(result));assert.equal(result.imported,1);
 assert.deepEqual(f.calls,['session','transactions','session']);
});

for(const flag of [null,'true',0])test('present malformed transaction access '+JSON.stringify(flag)+' blocks before account data',async t=>{
 const f=await fixture(t),read=f.getSession;
 f.getSession=async(...args)=>{const session=await read(...args);session.access.transactions=flag;return session;};
 const result=await f.run();assert.equal(result.results[0].status,'blocked');assert.deepEqual(f.calls,['session']);assert.equal(f.read().transactions.length,0);
});

test('unbound owner retains the existing automatic sync entrypoint',async t=>{
 const f=await fixture(t,{registered:false,bound:false}),result=await f.run();assert.equal(result.imported,1);assert.equal(f.legacyBankgiro,true);assert.equal(f.legacyReconciled,true);assert.equal(f.count('company_bank_sync_requests'),0);
});

for(const change of ['revoked','account','permission'])test('remote '+change+' after page fetch prevents all financial writes',async t=>{
 const f=await fixture(t);f.onTransactions=()=>{if(change==='revoked')f.liveStatus='REVOKED';if(change==='account')f.liveAccounts=[];if(change==='permission')f.transactionsAllowed=false;};
 const result=await f.run();assert.equal(result.results[0].status,'blocked');assert.equal(f.count('company_bank_sync_receipts'),0);assert.equal(f.count('bank_sync_runs'),0);assert.equal(f.read().transactions.length,0);
});

test('same provider response replay has one original, one financial import and one receipt',async t=>{
 const f=await fixture(t);await f.run();f.due();const replay=await f.run();assert.equal(replay.imported,0);assert.equal(replay.results[0].status,'success');assert.equal(f.read().transactions.length,1);assert.equal(f.count('bank_sync_runs'),1);assert.equal(f.count('company_bank_sync_receipts'),1);
});

for(const change of ['workspace','owner lease','membership','scope','connection'])test('atomic '+change+' fence rolls back import and receipt together',async t=>{
 const f=await fixture(t);f.DB.beforeBatch=statements=>{if(!statements.some(s=>s.query.startsWith('INSERT INTO company_bank_sync_receipts')))return;f.DB.beforeBatch=null;
  if(change==='workspace')f.sql.prepare('UPDATE workspaces SET revision=revision+1 WHERE owner=?').run(f.owner);
  if(change==='owner lease')f.sql.prepare("UPDATE bank_locks SET token='replacement-worker' WHERE owner=?").run(f.owner);
  if(change==='membership')f.sql.prepare('UPDATE synthetic_authority SET active=0 WHERE owner=?').run(f.owner);
  if(change==='scope')f.sql.prepare('UPDATE company_bank_sync_scopes SET revision=revision+1 WHERE owner=?').run(f.owner);
  if(change==='connection')f.sql.prepare("UPDATE bank_connections SET selected_accounts='[]' WHERE owner=?").run(f.owner);
 };
 const result=await f.run();assert.notEqual(result.results[0].status,'success');assert.equal(f.count('company_bank_sync_receipts'),0);assert.equal(f.count('bank_sync_runs'),0);assert.equal(f.read().transactions.length,0);
});

test('provider quota is durable and cannot be spent by the second page beyond its allowance',async t=>{
 const f=await fixture(t);f.context.ratePolicy.maxRequests=2;f.page={continuation_key:'next-page'};const result=await f.run();assert.equal(result.results[0].status,'retry');assert.equal(result.results[0].code,'PROVIDER_BUDGET_EXHAUSTED');assert.deepEqual(f.calls,['session','transactions']);assert.equal(f.count('company_bank_sync_requests'),2);assert.equal(f.count('company_bank_sync_receipts'),0);assert.equal(f.read().transactions.length,0);
});

test('enabled Bankgiro without company source adapter reports partial and never complete payments',async t=>{
 const f=await fixture(t,{bankgiro:true}),result=await f.run();assert.equal(result.results[0].status,'partial');assert.equal(result.results[0].coverage.bankgiro,'unavailable');assert.equal(result.results[0].coverage.paymentDataComplete,false);assert.equal(f.read().transactions.length,1);assert.equal(f.legacyBankgiro,undefined);
});

test('stale trusted consent ID cannot borrow a different encrypted provider session',async t=>{
 const f=await fixture(t);f.context.consentId='different-consent';const result=await f.run();assert.equal(result.results[0].status,'blocked');assert.equal(f.calls.length,0);assert.equal(f.count('company_bank_sync_requests'),0);
});

test('lost acknowledgement recovers the committed import count from its durable receipt',async t=>{
 const f=await fixture(t);f.DB.afterBatch=statements=>{if(statements.some(s=>s.query.startsWith('INSERT INTO company_bank_sync_receipts'))){f.DB.afterBatch=null;throw Error('Synthetic acknowledgement lost after commit');}};
 const result=await f.run();assert.equal(result.results[0].status,'success');assert.equal(result.imported,1);assert.equal(f.count('company_bank_sync_receipts'),1);assert.equal(f.count('bank_sync_runs'),1);assert.equal(f.read().transactions.length,1);
});

test('successful receipt replays do not accumulate interrupted legacy attempts',async t=>{
 const f=await fixture(t);await f.run();
 for(let n=0;n<3;n++){f.sql.prepare('UPDATE bank_connections SET auto_next_at=NULL,auto_last_attempt_at=NULL,last_synced_at=NULL WHERE owner=?').run(f.owner);const result=await f.run();assert.equal(result.results[0].status,'success');assert.equal(result.imported,0);assert.equal(f.sql.prepare('SELECT sync_failures,last_error FROM bank_connections WHERE owner=?').get(f.owner).sync_failures,0);}
 assert.equal(f.count('bank_sync_runs'),1);assert.equal(f.count('company_bank_sync_receipts'),1);
});

test('company wrapper persists exact-policy allocation with originals and all payment fences',async t=>{
 const f=await fixture(t);f.invoice();const settings=f.read().company,result=await f.run(),saved=f.read();assert.equal(result.results[0].status,'success',JSON.stringify(result));assert.equal(saved.allocations.length,1);assert.equal(balance(saved,saved.invoices[0]),0);assert.equal(saved.transactions[0].bankData.reference_number,'0599');assert.deepEqual(saved.company,settings);assert.equal(f.sessionCalls,3);assert.equal(f.count('company_bank_sync_requests'),4);
});

test('policy changed at allocation commit preserves accepted AIS but rolls back money and audit',async t=>{
 const f=await fixture(t);f.invoice();f.DB.beforeBatch=statements=>{if(!statements.some(s=>s.values.includes('automatic.reconciliation')))return;f.DB.beforeBatch=null;const row=f.sql.prepare('SELECT reference_policy FROM company_bank_sync_scopes WHERE owner=?').get(f.owner),policy=JSON.parse(row.reference_policy);policy.mode='ocr';policy.revision++;f.sql.prepare('UPDATE company_bank_sync_scopes SET reference_policy=? WHERE owner=?').run(JSON.stringify(policy),f.owner);};
 const result=await f.run(),saved=f.read();assert.notEqual(result.results[0].status,'success');assert.equal(saved.allocations.length,0);assert.equal(balance(saved,saved.invoices[0]),10000);assert.equal(saved.transactions.length,1);assert.equal(f.count('company_bank_sync_receipts'),1);assert.equal(f.sql.prepare("SELECT count(*) n FROM audit_events WHERE action='automatic.reconciliation'").get().n,0);
});

test('429 persists supplier cooldown and cannot be retried through another scheduler call',async t=>{
 const f=await fixture(t);f.getTransactions=async()=>{f.calls.push('transactions');throw Object.assign(new ProviderError('BANK_RATE_LIMIT','Synthetic rate limit',429,true),{retryAfter:3600});};
 const result=await f.run();assert.equal(result.results[0].status,'retry');assert.equal(result.results[0].code,'PROVIDER_429');assert.ok(result.results[0].nextAttemptAt>Date.now()+3500000);const count=f.calls.length,next=await f.run();assert.equal(next.status,'retry');assert.equal(f.calls.length,count);assert.equal(f.count('company_bank_sync_receipts'),0);assert.equal(f.read().transactions.length,0);
});

test('successful company sync preserves the independent unknown account-evidence wait',async t=>{
 const f=await fixture(t),guard=JSON.stringify({status:'unknown',checkedAt:new Date().toISOString(),provenance:'retry_after_missing'});f.sql.prepare('UPDATE bank_connections SET account_evidence_retry=? WHERE owner=?').run(guard,f.owner);const result=await f.run();assert.equal(result.results[0].status,'success');assert.equal(f.sql.prepare('SELECT account_evidence_retry FROM bank_connections WHERE owner=?').get(f.owner).account_evidence_retry,guard);
});

for(const duplicate of ['selection','resource'])test('ambiguous duplicate account '+duplicate+' is blocked before provider reads',async t=>{
 const f=await fixture(t);
 if(duplicate==='selection')f.sql.prepare('UPDATE bank_connections SET selected_accounts=? WHERE owner=?').run(JSON.stringify([UID,UID]),f.owner);
 else {const conn=await f.bankStore.connection(f.owner),available=await f.bankStore.accounts(conn),encrypted=await f.bankStore.encrypt(f.owner,'accounts:'+f.connectionId,[available[0],{...available[0],account_id:{iban:'SE4550000000058398257466'}}]);f.sql.prepare('UPDATE bank_connections SET encrypted_accounts=? WHERE owner=?').run(encrypted,f.owner);}
 const result=await f.run();assert.equal(result.results[0].status,'blocked');assert.equal(f.calls.length,0);assert.equal(f.count('company_bank_sync_receipts'),0);
});

test('two concurrent scheduler jobs cannot fetch or write the same owner and account',async t=>{
 const f=await fixture(t);let entered,resume;const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{resume=resolve;});
 f.onTransactions=async()=>{entered();await gate;};const first=f.run();await ready;const second=await f.run();assert.equal(second.status,'retry');assert.equal(second.code,'ACCOUNT_BUSY');assert.deepEqual(f.calls,['session','transactions']);resume();const result=await first;assert.equal(result.results[0].status,'success');assert.equal(f.count('company_bank_sync_receipts'),1);assert.equal(f.read().transactions.length,1);
});

test('contradictory provider original retains evidence without new money or successful checkpoint',async t=>{
 const f=await fixture(t);await f.run();const old=f.read(),checkpoint=(await f.store.status(f.context)).checkpoint;f.due();f.rows=[raw({debtor:{name:'Contradictory synthetic payer'},transaction_amount:{amount:'101.00',currency:'SEK'}})];
 const result=await f.run(),saved=f.read();assert.equal(result.results[0].status,'blocked');assert.equal(result.results[0].code,'IMPORT_IDENTITY_CONFLICT');assert.equal(saved.transactions.length,1);assert.deepEqual(saved.transactions[0].bankData,old.transactions[0].bankData);assert.equal(saved.transactions[0].bankEvidenceConflicts[0].incoming.bankData.debtor.name,'Contradictory synthetic payer');assert.deepEqual((await f.store.status(f.context)).checkpoint,checkpoint);assert.equal(f.count('company_bank_sync_receipts'),1);assert.equal(f.count('bank_sync_runs'),1);assert.equal(saved.allocations.length,0);
});

test('unparseable provider retry advice remains blocked even if legacy retry fields are reset',async t=>{
 const f=await fixture(t);f.getTransactions=async()=>{f.calls.push('transactions');throw Object.assign(new ProviderError('BANK_RATE_LIMIT','Synthetic unusable retry advice',429,true),{retryBlocked:true});};
 const result=await f.run();assert.equal(result.results[0].status,'blocked');assert.equal(result.results[0].code,'RETRY_AFTER_UNKNOWN');const count=f.calls.length;f.due();const next=await f.run();assert.equal(next.results[0].status,'blocked');assert.equal(f.calls.length,count);assert.equal(f.count('company_bank_sync_receipts'),0);
});

for(const entrypoint of ['sync','syncControl'])test('bound company cannot use legacy '+entrypoint+' to bypass company authority',async t=>{
 const f=await fixture(t);const request=new Request('https://synthetic.test/api/bank/sync',{method:'POST',headers:{origin:'https://synthetic.test'}});
 await assert.rejects(f.service[entrypoint](request),error=>error.status===409&&/företag/i.test(error.message));assert.equal(f.calls.length,0);assert.equal(f.read().transactions.length,0);assert.equal(f.count('bank_sync_runs'),0);
});

test('company binding installed at legacy commit fences the financial write atomically',async t=>{
 const f=await fixture(t,{registered:false,bound:false});f.DB.beforeBatch=statements=>{if(!statements.some(s=>s.query.startsWith('INSERT INTO bank_sync_runs')))return;f.DB.beforeBatch=null;f.sql.prepare('INSERT INTO company_bank_sync_scopes(company_id,owner,evidence_id,created_at) VALUES(?,?,?,?)').run(f.companyId,f.owner,'synthetic-concurrent-binding',Date.now());};
 await assert.rejects(f.service.sync(new Request('https://synthetic.test/api/bank/sync',{method:'POST',headers:{origin:'https://synthetic.test'}})),error=>error.status===409);assert.equal(f.read().transactions.length,0);assert.equal(f.count('bank_sync_runs'),0);assert.equal(f.count('company_bank_sync_receipts'),0);
});

test('caller chosen account key cannot reset the authoritative account quota',async t=>{
 const f=await fixture(t);f.context.accountKey='made-up-key';const result=await f.run();assert.equal(result.results[0].status,'blocked');assert.equal(result.results[0].code,'ACCOUNT_MISMATCH');assert.equal(f.calls.length,0);assert.equal(f.count('company_bank_sync_jobs'),0);
});

test('company-bound owner cannot run legacy autonomous reconciliation and draft creation',async t=>{
 const f=await fixture(t);f.invoice();await assert.rejects(f.customerApi.reconcileAndPrepare(f.owner),error=>error.status===409);assert.equal(f.read().allocations.length,0);assert.equal(f.count('customer_messages'),0);
});

for(const concurrent of [false,true])test('legacy reconciliation '+(concurrent?'fences concurrent company enrollment':'remains available to unbound owners'),async t=>{
 const f=await fixture(t,{bound:false,registered:false});f.invoice();let state=applyCommand(f.read(),{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({date:bankUtcDate(),amount:10000,account:'iban:SE4280000890119146168423',party:'Synthetic customer AB',payerReference:'0599',bankReference:'SYNTHETIC-BANK-1'})]}).state;
 state.company.name='Synthetic company A AB';state.company.invoiceReferencePolicies=[{version:INVOICE_REFERENCE_POLICY_VERSION,id:'synthetic-explicit-policy',companyName:'Synthetic company A AB',referenceSource:'invoice_number',direction:'customer',matchMode:'exact'}];f.sql.prepare('UPDATE workspaces SET payload=? WHERE owner=?').run(JSON.stringify(state),f.owner);
 if(concurrent)f.DB.beforeBatch=statements=>{if(!statements.some(s=>s.values.includes('automatic.reconciliation')))return;f.DB.beforeBatch=null;f.sql.prepare('INSERT INTO company_bank_sync_scopes(company_id,owner,evidence_id,created_at) VALUES(?,?,?,?)').run(f.companyId,f.owner,'synthetic-concurrent-binding',Date.now());};
 if(concurrent){await assert.rejects(f.customerApi.reconcileAndPrepare(f.owner));assert.equal(f.read().allocations.length,0);assert.equal(f.sql.prepare("SELECT count(*) n FROM audit_events WHERE action='automatic.reconciliation'").get().n,0);}
 else {const result=await f.customerApi.reconcileAndPrepare(f.owner);assert.equal(result.automatic,1);assert.equal(f.read().allocations.length,1);}
});

test('company-bound owner cannot call the standalone legacy Bankgiro source or sink',async t=>{
 const f=await ingestFixture(t),input=await f.prepare();f.sql.prepare('INSERT INTO company_bank_sync_scopes(company_id,owner,evidence_id,created_at) VALUES(?,?,?,?)').run('synthetic-company',f.owner,'synthetic-proof',Date.now());f.source={id:'synthetic-source',mode:'production',async authorize(){throw Error('Bound source must not contact transport');},async listReports(){throw Error('Bound source must not contact transport');},async fetchReport(){throw Error('Bound source must not contact transport');}};
 assert.equal((await f.service.runBankgiroSource(f.owner)).state,'BLOCKED');await assert.rejects(f.sink.importReport(input),error=>error.code==='AUTHORIZATION_BLOCKED');assert.equal(f.read().state.transactions.filter(row=>row.evidence==='bankgiro_file').length,0);
});

test('bound configured Bankgiro status and run return sanitized blocked state without provider or storage mutations',async t=>{
 const f=await ingestFixture(t);let outbound=0,r2Reads=0,r2Writes=0;
 f.sql.prepare('INSERT INTO company_bank_sync_scopes(company_id,owner,evidence_id,created_at) VALUES(?,?,?,?)').run('synthetic-company',f.owner,'synthetic-proof',Date.now());
 f.source={id:'synthetic-source',mode:'production',async authorize(){outbound++;throw Error('Unexpected provider call');},async listReports(){outbound++;throw Error('Unexpected provider call');},async fetchReport(){outbound++;throw Error('Unexpected provider call');}};
 f.onRead=()=>{r2Reads++;throw Error('Unexpected original read');};f.onPut=()=>{r2Writes++;throw Error('Unexpected original write');};
 const before=f.sql.prepare('SELECT total_changes() n').get().n,original=f.read();
 for(const operation of ['bankgiroSourceStatus','runBankgiroSource']){const result=await f.service[operation](f.owner);assert.equal(result.state,'BLOCKED');assert.equal(result.reason,'AUTHORIZATION_BLOCKED');assert.equal(result.lastError,'AUTHORIZATION_BLOCKED');assert.equal(result.enabled,false);assert.equal(result.authorization.status,'BLOCKED');assert.deepEqual(result.jobs,[]);assert.equal(Object.hasOwn(result,'cursor'),false);}
 assert.equal(outbound,0);assert.equal(r2Reads,0);assert.equal(r2Writes,0);assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);assert.deepEqual(f.read(),original);
});

test('legacy Bankgiro financial commit rejects concurrent company enrollment',async t=>{
 const f=await ingestFixture(t),input=await f.prepare(),old=f.read();f.beforeBatch=statements=>{if(!statements.some(s=>s.args.includes('bankgiro.import')))return;f.beforeBatch=null;f.sql.prepare('INSERT INTO company_bank_sync_scopes(company_id,owner,evidence_id,created_at) VALUES(?,?,?,?)').run('synthetic-company',f.owner,'synthetic-concurrent-binding',Date.now());};
 await assert.rejects(f.sink.importReport(input));assert.deepEqual(f.read(),old);assert.equal(f.audits().length,0);
});

test('renewed session and account UID retain the original quota and financial receipt',async t=>{
 const f=await fixture(t);f.context.ratePolicy.maxRequests=3;const first=await f.run(),accountKey=f.context.accountKey;assert.equal(first.imported,1);
 const renewedUid='44444444-4444-4444-8444-444444444444',renewedSession='55555555-5555-4555-8555-555555555555',conn=await f.bankStore.connection(f.owner),available=await f.bankStore.accounts(conn);available[0].uid=renewedUid;
 f.context={...f.context,accountUid:renewedUid,consentId:renewedSession,generation:'consent-generation-2',revision:2};
 f.sql.prepare('UPDATE synthetic_authority SET generation=?,revision=? WHERE owner=?').run(f.context.generation,2,f.owner);
 f.sql.prepare('UPDATE bank_connections SET encrypted_session=?,encrypted_accounts=?,selected_accounts=? WHERE owner=?').run(await f.bankStore.encrypt(f.owner,'session:'+f.connectionId,renewedSession),await f.bankStore.encrypt(f.owner,'accounts:'+f.connectionId,available),JSON.stringify([renewedUid]),f.owner);f.due();
 const limited=await f.run();assert.equal(limited.results[0].status,'retry');assert.equal(limited.results[0].code,'PROVIDER_BUDGET_EXHAUSTED');assert.equal(f.calls.length,3);assert.equal(f.count('company_bank_sync_requests'),3);assert.equal(f.count('company_bank_sync_jobs'),1);
 const clock=Date.now();t.mock.method(Date,'now',()=>clock+61000);f.due();const replay=await f.run();assert.equal(replay.results[0].status,'success',JSON.stringify(replay));assert.equal(replay.imported,0);assert.equal(f.context.accountKey,accountKey);assert.equal(f.count('company_bank_sync_requests'),6);assert.equal(f.count('company_bank_sync_receipts'),1);assert.equal(f.count('bank_sync_runs'),1);assert.equal(f.read().transactions.length,1);
});

test('an explicitly earlier configured start date reopens history beyond the prior account checkpoint',async t=>{
 const f=await fixture(t);await f.run();f.due();const earlier=new Date(Date.parse(bankUtcDate()+'T00:00:00Z')-30*86400000).toISOString().slice(0,10);f.sql.prepare('UPDATE bank_connections SET date_from=? WHERE owner=?').run(earlier,f.owner);let requested;f.onTransactions=input=>{requested=input.dateFrom;};const result=await f.run();assert.equal(result.results[0].status,'success');assert.equal(requested,earlier);assert.equal(f.read().transactions.length,1);
});
