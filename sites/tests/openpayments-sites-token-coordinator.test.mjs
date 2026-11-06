import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import {companyFixture} from './helpers/company-storage-fixture.mjs';
import {workersBindingConfiguration} from './helpers/openpayments-workers-fixture.mjs';
import {configuredOpenPaymentsWorkersTransport} from '../lib/banking/openpayments-workers-transport.js';
import {OpenPaymentsTokenClient} from '../lib/banking/openpayments/token.js';
import {createOpenPaymentsHttpClient} from '../lib/banking/openpayments/http.js';
import {validateOpenPaymentsConfig} from '../lib/banking/openpayments/config.js';
import {backupStep,unsealBackup,BACKUP_TABLES,validateSnapshot} from '../lib/backup-engine.ts';
import {ownerTables} from '../lib/company-storage.js';

const directory=mkdtempSync(join(tmpdir(),'mg-sites-app-token-'));
after(()=>rmSync(directory,{recursive:true,force:true}));
const source=new URL('../lib/banking/openpayments-sites-token-coordinator.ts',import.meta.url);
let code=stripTypeScriptTypes(readFileSync(source,'utf8'),{mode:'transform'});
code=code.replace(/(['"])\.\/security\1/g,JSON.stringify(new URL('../lib/banking/security.ts',import.meta.url).href));
code=code.replace(/(['"])(\.{1,2}\/[^'"]+\.js)\1/g,(_all,_quote,specifier)=>JSON.stringify(new URL(specifier,source).href));
const compiled=join(directory,'adapter.mjs');writeFileSync(compiled,code);
const {createSitesOpenPaymentsTokenCoordinator}=await import(pathToFileURL(compiled).href);
const configuration={environment:'PRODUCTION',clientId:'synthetic-durable-app',clientSecret:'synthetic-secret',credentialGeneration:'g1',redirectUris:[]};
const key='A'.repeat(43),marker='synthetic-application-secret-token';
async function fixture(t){
 const f=companyFixture(t);await f.create('company-a');const scope=await f.scope();let posts=0;
 function connection({config=configuration,encryptionKey=key,database=f.raw}={}){
  const binding={async fetch(url,init){assert.equal(new URL(url).pathname,'/connect/token');posts++;const form=new URLSearchParams(init.body);return Response.json({access_token:marker,token_type:'Bearer',expires_in:3600,scope:form.get('scope')});}};
  const env={DB:database,BANK_DATA_ENCRYPTION_KEY:encryptionKey,SAAS_BANK_ENABLED:'true',SAAS_OPENPAYMENTS_CONFIG:JSON.stringify(config),SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG:JSON.stringify(workersBindingConfiguration({credentialGeneration:config.credentialGeneration})),OPENPAYMENTS_MTLS:binding};
  const mtls=configuredOpenPaymentsWorkersTransport({configuration:config,environment:()=>env});
  const coordinator=createSitesOpenPaymentsTokenCoordinator({configuration:config,mtls,environment:()=>env});
  const validated=validateOpenPaymentsConfig(config),client=new OpenPaymentsTokenClient(validated,createOpenPaymentsHttpClient(validated,{transport:mtls.transport}),Date.now,{identity:mtls.cacheIdentity,coordinator});
  return{env,binding,mtls,coordinator,client};
 }
 return{f,scope,connection,posts:()=>posts};
}

test('independent Sites transport identities share encrypted app state through D1-shaped storage',async t=>{
 const f=await fixture(t),first=f.connection(),second=f.connection();
 assert.notEqual(first.mtls.cacheIdentity,second.mtls.cacheIdentity);
 assert.equal(await first.client.accessToken(),marker);assert.equal(await second.client.accessToken(),marker);assert.equal(f.posts(),1);
 const rows=f.f.sql.prepare('SELECT * FROM company_application_tokens').all();assert.equal(rows.length,1);
 assert.ok(!JSON.stringify(rows).includes(marker));assert.ok(!JSON.stringify(rows).includes(configuration.clientSecret));
});

test('a wrong encryption key cannot replace an unreadable stored app token',async t=>{
 const f=await fixture(t);await f.connection().client.accessToken();const before=f.f.sql.prepare('SELECT * FROM company_application_tokens').all();
 await assert.rejects(f.connection({encryptionKey:'B'.repeat(43)}).client.accessToken());
 assert.equal(f.posts(),1);assert.deepEqual(f.f.sql.prepare('SELECT * FROM company_application_tokens').all(),before);
});

test('rolling credential generations do not overwrite the active app-family registry',async t=>{
 const f=await fixture(t),old=f.connection();await old.client.accessToken();const before=f.f.sql.prepare('SELECT * FROM company_application_tokens').all();
 await assert.rejects(f.connection({config:{...configuration,credentialGeneration:'g2',clientSecret:'synthetic-new-secret'}}).client.accessToken());
 assert.equal(f.posts(),1);assert.deepEqual(f.f.sql.prepare('SELECT * FROM company_application_tokens').all(),before);assert.equal(await old.client.accessToken(),marker);assert.equal(f.posts(),1);
});

for(const name of ['DB','BANK_DATA_ENCRYPTION_KEY','SAAS_OPENPAYMENTS_CONFIG','SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG','SAAS_BANK_ENABLED','OPENPAYMENTS_MTLS'])test('Sites app-token storage rejects captured environment rotation of '+name,async t=>{
 const f=await fixture(t),runtime=f.connection();
 runtime.env[name]=name==='DB'?{...f.f.raw}:name==='OPENPAYMENTS_MTLS'?{fetch:runtime.binding.fetch}:name==='SAAS_BANK_ENABLED'?'false':String(runtime.env[name])+' ';
 await assert.rejects(runtime.client.accessToken());assert.equal(f.posts(),0);
});

test('D1 failure cannot fall back to an empty process cache and mint another token',async t=>{
 const f=await fixture(t),broken={prepare(){throw Error('synthetic DB failure containing private detail');},batch(){throw Error('synthetic DB failure');}};
 await assert.rejects(f.connection({database:broken}).client.accessToken(),error=>!error.message.includes('private detail'));
 assert.equal(f.posts(),0);
});

test('missing app-token schema gives no issuer traffic',async t=>{
 const f=await fixture(t);f.f.sql.exec('DROP TABLE company_application_tokens');
 await assert.rejects(f.connection().client.accessToken());assert.equal(f.posts(),0);
});

test('global app-token rows cannot be read or changed through the tenant database capability',async t=>{
 const f=await fixture(t);await f.connection().client.accessToken();const before=f.f.sql.prepare('SELECT * FROM company_application_tokens').all(),scoped=f.f.database(f.scope);
 for(const name of ['company_application_tokens','company_application_token_control','COMPANY_APPLICATION_TOKENS','"company_application_tokens"','[company_application_tokens]',"'company_application_tokens'"]){
  assert.throws(()=>scoped.prepare('SELECT * FROM '+name),/COMPANY_SQL_DENIED/);
  assert.throws(()=>scoped.prepare('DELETE FROM '+name),/COMPANY_SQL_DENIED/);
 }
 assert.deepEqual(f.f.sql.prepare('SELECT * FROM company_application_tokens').all(),before);assert.ok(!ownerTables.includes('company_application_tokens'));
});

test('a real encrypted customer backup excludes all global token and issuer state',async t=>{
 const f=await fixture(t);await f.connection().client.accessToken();const before=f.f.sql.prepare('SELECT * FROM company_application_tokens').all(),objects=new Map(),backupKey='9'.repeat(64),owner=f.scope.owner;
 const bucket={async get(path){const bytes=objects.get(path);return bytes?{async arrayBuffer(){return bytes.slice().buffer;}}:null;},async put(path,value){objects.set(path,new Uint8Array(value));}};
 let result;for(let count=0;count<4;count++){result=await backupStep(f.f.database(f.scope),bucket,owner,backupKey,new Date());assert.notEqual(result.status,'failed',result.error);if(result.status==='complete')break;}
 assert.equal(result.status,'complete');const row=f.f.sql.prepare('SELECT * FROM backup_runs WHERE owner=?').get(owner);
 const snapshot=JSON.parse(new TextDecoder().decode(await unsealBackup(objects.get(row.snapshot_key),backupKey,owner,row.id,'snapshot')));
 assert.ok(!BACKUP_TABLES.includes('company_application_tokens'));assert.ok(!snapshot.tables.some(table=>table.name==='company_application_tokens'));
 assert.ok(!JSON.stringify(snapshot).includes(marker));assert.deepEqual(f.f.sql.prepare('SELECT * FROM company_application_tokens').all(),before);
 assert.throws(()=>validateSnapshot({...snapshot,tables:[...snapshot.tables,{name:'company_application_tokens',rows:before}]},owner),/backup_/);
});

test('read-only readiness never registers an app family or requests a token',async t=>{
 const f=await fixture(t),runtime=f.connection();await runtime.coordinator.assertCurrent();await runtime.coordinator.captureFence();
 assert.equal(f.f.sql.prepare('SELECT count(*) n FROM company_application_tokens').get().n,0);assert.equal(f.posts(),0);
});

test('durable restore quarantine prevents use of an already warm local app token',async t=>{
 const f=await fixture(t),runtime=f.connection();await runtime.client.accessToken();
 f.f.sql.prepare("UPDATE company_application_token_control SET recovery_required=1,revision=2,restore_marker='synthetic-restore'").run();
 await assert.rejects(runtime.client.accessToken(),error=>error.code==='APPLICATION_TOKEN_RECOVERY_REQUIRED');assert.equal(f.posts(),1);
});

test('ciphertext copied between application families fails its authenticated binding',async t=>{
 const f=await fixture(t),first=f.connection(),second=f.connection({config:{...configuration,clientId:'synthetic-second-app'}});
 await first.client.accessToken();await second.client.accessToken();
 const source=f.f.sql.prepare('SELECT token_ciphertext FROM company_application_tokens WHERE family_key=?').get(first.coordinator.binding.familyKey);
 f.f.sql.prepare('UPDATE company_application_tokens SET token_ciphertext=? WHERE family_key=?').run(source.token_ciphertext,second.coordinator.binding.familyKey);
 await assert.rejects(second.client.accessToken(),error=>error.code==='APPLICATION_TOKEN_STORAGE_UNAVAILABLE');assert.equal(f.posts(),2);
});

test('binding replacement during the actual D1 read is detected before issuance',async t=>{
 const f=await fixture(t),prepare=f.f.raw.prepare;let runtime,changed=0;
 f.f.raw.prepare=function(query){const statement=prepare.call(this,query),bind=statement.bind;statement.bind=function(...values){const bound=bind.apply(this,values),first=bound.first;bound.first=async function(...args){const result=await first.apply(this,args);if(!changed&&query.includes('FROM company_application_tokens')){changed++;runtime.env.OPENPAYMENTS_MTLS={fetch:runtime.binding.fetch};}return result;};return bound;};return statement;};
 runtime=f.connection();await assert.rejects(runtime.client.accessToken());assert.equal(changed,1);assert.equal(f.posts(),0);
});
