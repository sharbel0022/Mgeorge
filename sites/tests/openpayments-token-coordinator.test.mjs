import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createCompanySyncDatabase} from '../../src/company-sync-database.js';
import {createOpenPaymentsTokenCoordinator} from '../lib/banking/openpayments/token-coordinator.js';
import {BankProviderError} from '../lib/banking/bank-data-provider.js';
import {OpenPaymentsTokenClient} from '../lib/banking/openpayments/token.js';
import {createOpenPaymentsTokenCacheIdentity} from '../lib/banking/openpayments/token-cache.js';
import {createOpenPaymentsHttpClient} from '../lib/banking/openpayments/http.js';
import {validateOpenPaymentsConfig} from '../lib/banking/openpayments/config.js';

const schema=readFileSync(new URL('../lib/banking/openpayments/token-coordinator.schema.sql',import.meta.url),'utf8');
const configuration={environment:'SANDBOX',clientId:'synthetic-distributed-app',clientSecret:'synthetic-secret',credentialGeneration:'g1',features:['bank_discovery']};
const transportIdentity='a'.repeat(64);
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'mg-token-coordinator-')),path=join(dir,'control.sqlite'),dbs=[];
 const connect=()=>{const db=new DatabaseSync(path);db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');dbs.push(db);return db;};
 const db=connect();db.exec(schema);const key=randomBytes(32);
 const codec={async seal(binding,value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(binding)));const encrypted=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');},async unseal(binding,value){const bytes=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAAD(Buffer.from(JSON.stringify(binding)));cipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString());}};
 t.after(()=>{dbs.forEach(value=>value.close());rmSync(dir,{recursive:true,force:true});});
 const create=(overrides={})=>createOpenPaymentsTokenCoordinator({database:createCompanySyncDatabase(connect()),codec,configuration,transportIdentity,assertCurrent:()=>{},...overrides});
 let calls=0;const issue=async({assertBeforeSend})=>{await assertBeforeSend();calls++;return {value:'synthetic-issued-token-'+calls,seconds:3600};};
 return{db,path,key:key.toString('hex'),codec,create,issue,calls:()=>calls,row:()=>db.prepare('SELECT * FROM company_application_tokens').get()};
}

test('readiness does not bootstrap; 100 independent SQLite connections reuse one encrypted app token',async t=>{
 const f=fixture(t);await f.create().assertCurrent();assert.equal(f.row(),undefined);
 const tokens=await Promise.all(Array.from({length:100},()=>f.create().access(f.issue)));
 assert.equal(f.calls(),1);assert.equal(new Set(tokens.map(v=>v.value)).size,1);
 assert.ok(tokens.every(Object.isFrozen));assert.ok(!JSON.stringify(f.row()).includes('synthetic-issued-token'));
 assert.equal(f.row().lease_token,'');assert.equal(f.row().uncertain_until,0);
});
test('configuration and transport rotations never automatically overwrite the active family',async t=>{
 const f=fixture(t),old=f.create();await old.access(f.issue);const before=f.row();
 for(const overrides of [{configuration:{...configuration,clientSecret:'different-secret'}},{configuration:{...configuration,credentialGeneration:'g2'}},{transportIdentity:'b'.repeat(64)}]){
  const next=f.create(overrides);await assert.rejects(next.assertCurrent(),{code:'APPLICATION_TOKEN_CONFIGURATION_CHANGED'});await assert.rejects(next.access(f.issue),{code:'APPLICATION_TOKEN_CONFIGURATION_CHANGED'});
 }
 assert.equal(f.calls(),1);assert.deepEqual(f.row(),before);
});
test('explicit rotation is CAS and fences old processes while preserving issued-token quarantine',async t=>{
 const f=fixture(t),old=f.create();await old.access(f.issue);const before=f.row(),next=f.create({configuration:{...configuration,credentialGeneration:'g2'}});
 await assert.rejects(next.rotate({expectedConfigHash:before.config_hash,expectedEpoch:2,evidenceId:'synthetic-rotation'}),{code:'APPLICATION_TOKEN_CONFIGURATION_CHANGED'});
 await next.rotate({expectedConfigHash:before.config_hash,expectedEpoch:1,evidenceId:'synthetic-rotation'});
 assert.equal(f.row().epoch,2);assert.equal(f.row().token_ciphertext,'');assert.ok(f.row().uncertain_until>=before.expires_at);
 await assert.rejects(old.access(f.issue),{code:'APPLICATION_TOKEN_CONFIGURATION_CHANGED'});await assert.rejects(next.access(f.issue),{code:'APPLICATION_TOKEN_UNCERTAIN'});assert.equal(f.calls(),1);
});
test('late 401 invalidates exactly one token version even when provider reuses a token value',async t=>{
 const f=fixture(t),a=f.create(),b=f.create();let calls=0;const issue=async({assertBeforeSend})=>{await assertBeforeSend();calls++;return{value:'synthetic-same-opaque-value',seconds:3600};};
 const first=await a.access(issue);await a.invalidate(first);const second=await b.access(issue);await a.invalidate(first);
 assert.equal((await b.access(issue)).value,second.value);assert.equal(calls,2);assert.ok(f.row().token_ciphertext);
 await assert.rejects(b.invalidate({...second}),{code:'INVALID_ACCESS_TOKEN'});
});
test('issuer 429 is shared across fresh coordinators and cannot be cleared by token rejection',async t=>{
 const f=fixture(t);let calls=0;
 await assert.rejects(f.create().access(async({assertBeforeSend})=>{await assertBeforeSend();calls++;throw new BankProviderError('PROVIDER_RATE_LIMIT',429,{retryAfter:120});}),{code:'PROVIDER_RATE_LIMIT'});
 await assert.rejects(f.create().access(f.issue),e=>e.code==='PROVIDER_RATE_LIMIT'&&e.retryAfter>=119);assert.equal(calls,1);assert.equal(f.calls(),0);assert.equal(f.row().uncertain_until,0);
 f.db.prepare('UPDATE company_application_tokens SET cooldown_until=0').run();await f.create().access(f.issue);assert.equal(f.calls(),1);
});
test('unknown token outcome survives lease expiry and process replacement',async t=>{
 const f=fixture(t);let calls=0;
 await assert.rejects(f.create().access(async({assertBeforeSend})=>{await assertBeforeSend();calls++;throw new BankProviderError('PROVIDER_TIMEOUT',504,{mayHaveSucceeded:true});}),{code:'PROVIDER_TIMEOUT'});
 f.db.prepare('UPDATE company_application_tokens SET lease_token=\'\',lease_until=0').run();
 await assert.rejects(f.create().access(f.issue),{code:'APPLICATION_TOKEN_UNCERTAIN'});assert.equal(f.calls(),0);assert.equal(calls,1);
});
test('pre-send lease fence blocks delayed request dispatch and never accepts an unfenced issuer',async t=>{
 const f=fixture(t);let sent=false;
 await assert.rejects(f.create().access(async({assertBeforeSend})=>{f.db.prepare('UPDATE company_application_tokens SET lease_until=1').run();await assertBeforeSend();sent=true;return{value:'synthetic',seconds:3600};}),{code:'APPLICATION_TOKEN_LEASE_LOST'});
 assert.equal(sent,false);assert.equal(f.row().token_ciphertext,'');
 const g=fixture(t);await assert.rejects(g.create().access(async()=>({value:'synthetic-unfenced',seconds:3600})),{code:'APPLICATION_TOKEN_LEASE_LOST'});assert.equal(g.row().token_ciphertext,'');
});
test('late response, overlong expiry and codec failure cannot publish or retry uncertain issuance',async t=>{
 for(const kind of ['lease','ttl','codec']){
  const f=fixture(t),coordinator=f.create(kind==='codec'?{codec:{...f.codec,async seal(){throw Error('synthetic secret should not leak');}}}:{});
  await assert.rejects(coordinator.access(async({assertBeforeSend})=>{await assertBeforeSend();if(kind==='lease')f.db.prepare('UPDATE company_application_tokens SET lease_until=1').run();return{value:'synthetic-sensitive-value',seconds:kind==='ttl'?3601:3600};}),e=>!e.message.includes('secret')&&['APPLICATION_TOKEN_LEASE_LOST','INVALID_OAUTH_RESULT','APPLICATION_TOKEN_STORAGE_UNAVAILABLE'].includes(e.code));
  assert.equal(f.row().token_ciphertext,'');assert.ok(f.row().uncertain_until>Date.now());await assert.rejects(f.create().access(f.issue),{code:'APPLICATION_TOKEN_UNCERTAIN'});assert.equal(f.calls(),0);
 }
});
test('missing schema, broken database and modified ciphertext fail closed without provider traffic',async t=>{
 const f=fixture(t);await f.create().access(f.issue);f.db.prepare("UPDATE company_application_tokens SET token_ciphertext='synthetic-invalid-cipher'").run();
 await assert.rejects(f.create().access(f.issue),{code:'APPLICATION_TOKEN_STORAGE_UNAVAILABLE'});assert.equal(f.calls(),1);
 f.db.exec('DROP TABLE company_application_tokens');await assert.rejects(f.create().assertCurrent(),{code:'APPLICATION_TOKEN_STORAGE_UNAVAILABLE'});await assert.rejects(f.create().access(f.issue),{code:'APPLICATION_TOKEN_STORAGE_UNAVAILABLE'});assert.equal(f.calls(),1);
 const broken=f.create({database:{prepare(){throw Error('synthetic-private-database-path');}}});await assert.rejects(broken.access(f.issue),e=>e.code==='APPLICATION_TOKEN_STORAGE_UNAVAILABLE'&&!e.message.includes('path'));
});
test('changed global epoch during decrypt never returns the old plaintext token',async t=>{
 const f=fixture(t);await f.create().access(f.issue);
 const current=f.create({codec:{...f.codec,async unseal(binding,value){const decoded=await f.codec.unseal(binding,value);f.db.prepare('UPDATE company_application_tokens SET epoch=epoch+1').run();return decoded;}}});
 await assert.rejects(current.access(f.issue),{code:'INVALID_ACCESS_TOKEN'});assert.equal(f.calls(),1);
});
test('readiness and token access preserve a permanent restore gate until an exact operator CAS',async t=>{
 const f=fixture(t),coordinator=f.create();f.db.prepare("UPDATE company_application_token_control SET revision=revision+1,recovery_required=1,restore_marker='synthetic-restore'").run();
 await assert.rejects(coordinator.assertCurrent(),{code:'APPLICATION_TOKEN_RECOVERY_REQUIRED'});await assert.rejects(coordinator.access(f.issue),{code:'APPLICATION_TOKEN_RECOVERY_REQUIRED'});assert.equal(f.calls(),0);
 await assert.rejects(coordinator.releaseRecovery({expectedRevision:1,expectedMarker:'synthetic-restore',evidenceId:'synthetic-provider-recovery'}),{code:'APPLICATION_TOKEN_RECOVERY_REQUIRED'});
 await coordinator.releaseRecovery({expectedRevision:2,expectedMarker:'synthetic-restore',evidenceId:'synthetic-provider-recovery'});await coordinator.access(f.issue);assert.equal(f.calls(),1);
 const row=f.db.prepare('SELECT * FROM company_application_token_control').get();assert.equal(row.recovery_required,0);assert.equal(row.recovery_evidence,'synthetic-provider-recovery');
});
test('activation issuer cooldown is global while a still-valid cached app token remains usable',async t=>{
 const f=fixture(t),a=f.create();const token=await a.access(f.issue);
 await a.recordIssuerFailure(new BankProviderError('PROVIDER_RATE_LIMIT',429,{retryAfter:120}));
 await assert.rejects(f.create().assertIssuerAvailable(),{code:'PROVIDER_RATE_LIMIT'});assert.equal((await f.create().access(f.issue)).value,token.value);assert.equal(f.calls(),1);
});
test('schema rejects null family identities, invalid counters, split token state and malformed leases',t=>{
 const f=fixture(t);
 assert.throws(()=>f.db.prepare('INSERT INTO company_application_tokens(family_key,config_hash) VALUES(NULL,?)').run('a'.repeat(64)));
 for(const expression of ['epoch=0','revision=-1','fence=1.5',"token_version='orphan'","lease_token='orphan'",'cooldown_blocked=2']){
  f.db.prepare('INSERT OR IGNORE INTO company_application_tokens(family_key,config_hash) VALUES(?,?)').run('a'.repeat(64),'b'.repeat(64));
  assert.throws(()=>f.db.exec('UPDATE company_application_tokens SET '+expression),expression);
 }
});

test('TokenClient delegates every fresh runtime and identity to shared storage, never a memory fallback',async t=>{
 const f=fixture(t);let calls=0;const config=validateOpenPaymentsConfig(configuration);
 const transport={kind:'sandbox',async request(url,init){calls++;return Response.json({access_token:'synthetic-provider-token',token_type:'Bearer',expires_in:3600,scope:new URLSearchParams(init.body).get('scope')});}};
 const client=()=>new OpenPaymentsTokenClient(config,createOpenPaymentsHttpClient(config,{transport}),Date.now,{identity:createOpenPaymentsTokenCacheIdentity(),coordinator:f.create()});
 const values=await Promise.all(Array.from({length:10},()=>client().accessToken()));assert.equal(calls,1);assert.equal(new Set(values).size,1);
 f.db.exec('DROP TABLE company_application_tokens');await assert.rejects(client().accessToken(),{code:'APPLICATION_TOKEN_STORAGE_UNAVAILABLE'});assert.equal(calls,1);
});
test('queued HTTP issuance rechecks the transient tenant guard and SQL lease immediately before dispatch',async t=>{
 const f=fixture(t);let active=true,calls=0;
 const config=validateOpenPaymentsConfig(configuration),http=createOpenPaymentsHttpClient(config,{transport:{kind:'sandbox',async request(){calls++;return Response.json({});}},requestBoundary:async operation=>{active=false;return operation({signal:new AbortController().signal});}});
 const client=new OpenPaymentsTokenClient(config,http,Date.now,{identity:createOpenPaymentsTokenCacheIdentity(),coordinator:f.create()});
 await assert.rejects(client.accessTokenReceipt(async()=>{if(!active)throw new BankProviderError('RESOURCE_SCOPE_MISMATCH',403);}),{code:'RESOURCE_SCOPE_MISMATCH'});assert.equal(calls,0);assert.equal(f.row().uncertain_until,0);
});

function child(f,mode='normal'){
 return new Promise((resolve,reject)=>{
  const process=spawn(globalThis.process.execPath,[fileURLToPath(new URL('./helpers/openpayments-token-coordinator-process.mjs',import.meta.url)),f.path,f.key,mode],{env:{...globalThis.process.env,NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
  let output='',error='';process.stdout.on('data',chunk=>output+=chunk);process.stderr.on('data',chunk=>error+=chunk);
  process.on('error',reject);process.on('exit',code=>resolve({code,output,error}));
 });
}
test('independent OS processes share one issuer and an actual crashed issuer remains quarantined',async t=>{
 const f=fixture(t);f.db.exec('CREATE TABLE synthetic_token_posts(id INTEGER PRIMARY KEY)');
 const results=await Promise.all(Array.from({length:6},()=>child(f)));
 assert.ok(results.every(value=>value.code===0),JSON.stringify(results));assert.equal(f.db.prepare('SELECT count(*) n FROM synthetic_token_posts').get().n,1);
 assert.equal(new Set(results.map(value=>value.output)).size,1);assert.equal((await f.create().access(f.issue)).value,'synthetic-process-token');assert.equal(f.calls(),0);
 const g=fixture(t);g.db.exec('CREATE TABLE synthetic_token_posts(id INTEGER PRIMARY KEY)');assert.equal((await child(g,'crash')).code,27);
 g.db.prepare('UPDATE company_application_tokens SET lease_until=1').run();await assert.rejects(g.create().access(g.issue),{code:'APPLICATION_TOKEN_UNCERTAIN'});assert.equal(g.calls(),0);assert.equal(g.db.prepare('SELECT count(*) n FROM synthetic_token_posts').get().n,1);
});

test('a forged coordinator or a coordinator for another credential cannot reach token HTTP',t=>{
 const f=fixture(t),identity=createOpenPaymentsTokenCacheIdentity(),config=validateOpenPaymentsConfig(configuration),http={async send(){assert.fail('no HTTP permitted');}};
 assert.throws(()=>new OpenPaymentsTokenClient(config,http,Date.now,{identity,coordinator:{access:async()=>({value:'forged'})}}),{code:'PROVIDER_CONFIGURATION_INVALID'});
 assert.throws(()=>new OpenPaymentsTokenClient({...configuration,clientSecret:'different'},http,Date.now,{identity,coordinator:f.create()}),{code:'PROVIDER_CONFIGURATION_INVALID'});
});
