import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createCipheriv,createHash,randomBytes} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase,storeDocument} from '../src/db.js';
import {createCompanyRuntime} from '../src/company-runtime.js';
import {createBackup,restoreBackup,verifyBackup} from '../src/backup.js';

const key='8'.repeat(64),at='2026-11-04T12:00:00.000Z',sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(t,{bound=true}={}){
 const directory=mkdtempSync(join(tmpdir(),'mg-provider-backup-node-')),path=join(directory,'legacy.sqlite'),control=openDatabase(path);
 const runtime=createCompanyRuntime({controlDb:control,legacyDatabasePath:path});
 const context=bound?runtime.provisionCompany({companyId:'synthetic-provider-company',name:'Synthetic provider company',actorId:'synthetic-actor',verification:{status:'verified',evidenceId:'synthetic-evidence',verifiedBy:'synthetic-operator'}}):{companyId:'synthetic-provider-company',storageOwner:'synthetic-owner'};
 const databasePath=bound?runtime.databasePath(context):path,db=new DatabaseSync(databasePath);
 t.after(()=>{db.close();runtime.close();control.close();rmSync(directory,{recursive:true,force:true});});
 return {directory,context,db,databasePath,archive:join(directory,'backup.mgbak'),target:join(directory,'recovered.sqlite')};
}
function records(f){
 const row={id:'synthetic-connection',owner:f.context.storageOwner,company_id:f.context.companyId,provider_kind:'open_payments',environment:'SANDBOX',app_generation:'synthetic-generation',bank_id:'synthetic-bank',bank_name:'Synthetic bank',status:'connected',encrypted_state:'SYNTHETIC_OPAQUE_ENCRYPTED_PROVIDER_STATE',selected_accounts:'[]',valid_until:at,revision:4,last_synced_at:at,last_error:null,request_key_hash:sha('synthetic-request'),created_at:at,updated_at:at,grant_fingerprint:sha('synthetic-current-grant')};
 const claim=fingerprint=>({fingerprint,owner:row.owner,company_id:row.company_id,connection_id:row.id,provider_kind:row.provider_kind,environment:row.environment,created_at:at});
 return {connections:[row],claims:[claim(row.grant_fingerprint),claim(sha('synthetic-historical-grant'))]};
}
function seed(f,value){
 for(const [table,rows]of [['bank_provider_connections',value.connections],['bank_provider_grant_claims',value.claims]])for(const row of rows){const keys=Object.keys(row);f.db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>row[key]));}
}
function authenticatedOldArchive(f){
 const path=join(f.directory,'old.sqlite');f.db.prepare('VACUUM INTO ?').run(path);
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);cipher.setAAD(Buffer.from('MGBAK001'));
 const bytes=Buffer.concat([cipher.update(readFileSync(path)),cipher.final()]);
 writeFileSync(f.archive,Buffer.concat([Buffer.from('MGBAK001'),iv,cipher.getAuthTag(),bytes]));
}

for(const [label,change]of [
 ['missing current claim',value=>value.claims.shift()],
 ['foreign connection company',value=>{value.connections[0].company_id='synthetic-other-company';}],
 ['foreign connection owner',value=>{value.connections[0].owner='synthetic-other-owner';}],
 ['foreign historical company',value=>{value.claims[1].company_id='synthetic-other-company';}],
 ['foreign historical owner',value=>{value.claims[1].owner='synthetic-other-owner';}],
 ['missing retained connection',value=>{value.claims[1].connection_id='missing';}],
 ['different historical environment',value=>{value.claims[1].environment='PRODUCTION';}],
])test('Node backup rejects '+label+' before creating an authenticated archive or restore target',t=>{
 const f=fixture(t),value=records(f);change(value);seed(f,value);
 const retained=()=>JSON.stringify(['bank_provider_connections','bank_provider_grant_claims'].map(name=>f.db.prepare('SELECT * FROM '+name).all())),before=retained();
 assert.throws(()=>createBackup(f.databasePath,f.archive,key),{code:'backup_provider_claim_invalid'});assert.equal(existsSync(f.archive),false);
 authenticatedOldArchive(f);
 assert.throws(()=>verifyBackup(f.archive,key),{code:'backup_provider_claim_invalid'});
 assert.throws(()=>restoreBackup(f.archive,f.target,key),{code:'backup_provider_claim_invalid'});assert.equal(existsSync(f.target),false);
 assert.equal(retained(),before);
});

test('Node provider backup requires a retained verified company namespace',t=>{
 const f=fixture(t,{bound:false});seed(f,records(f));
 assert.throws(()=>createBackup(f.databasePath,f.archive,key),{code:'backup_company_mismatch'});assert.equal(existsSync(f.archive),false);
});

test('Node whole-database backup retains current and historical grant claims, opaque handles, originals and money exactly',t=>{
 const f=fixture(t),value=records(f);seed(f,value);
 f.db.prepare("INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES('invoice-31','customer','00031','Synthetic provider customer',62500)").run();
 f.db.prepare("INSERT INTO bank_transactions(id,fingerprint,account,booked_at,amount_cents) VALUES('payment-31','synthetic-payment-31','synthetic-account','2026-11-04',62500)").run();
 f.db.prepare("INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES('allocation-31','invoice-31','payment-31',12500)").run();
 const original=storeDocument(f.db,{name:'synthetic.txt',mime_type:'text/plain',bytes:Buffer.from('SYNTHETIC RETAINED PROVIDER ORIGINAL'),invoice_id:'invoice-31'});
 const names=['invoices','bank_transactions','allocations','documents','bank_provider_connections','bank_provider_grant_claims'],before=new Map(names.map(name=>[name,f.db.prepare('SELECT * FROM '+name).all()]));
 assert.equal(createBackup(f.databasePath,f.archive,key,{expectedCompanyId:f.context.companyId}).verified,true);
 assert.equal(readFileSync(f.archive).includes(Buffer.from(value.connections[0].encrypted_state)),false);
 assert.equal(restoreBackup(f.archive,f.target,key,{expectedCompanyId:f.context.companyId}).restored,true);
 const restored=new DatabaseSync(f.target,{readOnly:true});try{
  for(const name of names)assert.deepEqual(restored.prepare('SELECT * FROM '+name).all(),before.get(name),name);
  assert.equal(restored.prepare('SELECT SUM(amount_cents) cents FROM allocations').get().cents,12500);
  assert.deepEqual(Buffer.from(restored.prepare('SELECT content FROM documents WHERE id=?').get(original.id).content),Buffer.from('SYNTHETIC RETAINED PROVIDER ORIGINAL'));
 }finally{restored.close();}
 for(const name of names)assert.deepEqual(f.db.prepare('SELECT * FROM '+name).all(),before.get(name));
});

test('Node revoked evidence keeps historical claims after the current fingerprint is cleared',t=>{
 const f=fixture(t),value=records(f);value.connections[0].status='revoked';value.connections[0].grant_fingerprint='';seed(f,value);
 createBackup(f.databasePath,f.archive,key);restoreBackup(f.archive,f.target,key);
 const restored=new DatabaseSync(f.target,{readOnly:true});try{
  assert.equal(restored.prepare('SELECT grant_fingerprint FROM bank_provider_connections').get().grant_fingerprint,'');
  assert.deepEqual(restored.prepare('SELECT * FROM bank_provider_grant_claims').all().map(row=>({...row})),value.claims);
 }finally{restored.close();}
});

test('Node legacy whole-database archive remains exact without fabricating absent provider tables',t=>{
 const f=fixture(t,{bound:false});f.db.exec('DROP TABLE bank_provider_grant_claims; DROP TABLE bank_provider_connections;');
 f.db.prepare("INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES('legacy','customer','00031','Synthetic legacy customer',62500)").run();
 createBackup(f.databasePath,f.archive,key);restoreBackup(f.archive,f.target,key);
 const restored=new DatabaseSync(f.target,{readOnly:true});try{
  assert.equal(restored.prepare("SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name IN ('bank_provider_connections','bank_provider_grant_claims')").get().n,0);
  assert.equal(restored.prepare('SELECT total_cents FROM invoices').get().total_cents,62500);
 }finally{restored.close();}
});

test('Node provider archive rejects tampered ciphertext before creating a restore target',t=>{
 const f=fixture(t);seed(f,records(f));createBackup(f.databasePath,f.archive,key);
 const damaged=readFileSync(f.archive);damaged[60]^=1;writeFileSync(f.archive,damaged);
 assert.throws(()=>restoreBackup(f.archive,f.target,key));assert.equal(existsSync(f.target),false);
});
