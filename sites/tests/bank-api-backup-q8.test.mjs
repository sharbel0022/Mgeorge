import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {backupStep,backupStatus,sealBackup,unsealBackup,validateSnapshot,BACKUP_TABLES} from '../lib/backup-engine.ts';

const owner='synthetic-backup-owner',key='a'.repeat(64),at=new Date('2026-10-30T10:00:00Z');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const id=index=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
function database(){
 const sql=new DatabaseSync(':memory:');
 for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 return sql;
}
function fixture(t,count=6){
 const sql=database();t.after(()=>sql.close());const objects=new Map(),gets=[],puts=[];
 const bucket={async get(path){gets.push(path);const bytes=objects.get(path);return bytes?{async arrayBuffer(){return bytes.slice().buffer;}}:null;},async put(path,bytes){puts.push(path);objects.set(path,new Uint8Array(bytes));}};
 const db={prepare(query){let args=[];return{bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return{results:sql.prepare(query).all(...args)};},async run(){return{meta:{changes:sql.prepare(query).run(...args).changes}};}};},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const statement of statements)out.push(await statement.all());sql.exec('COMMIT');return out;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const state={schemaVersion:1,invoices:[{id:'invoice',number:'SYNTHETIC-01',party:'Synthetic customer',total:62500}],transactions:[{id:'payment',amount:62500,currency:'SEK'}],allocations:[{id:'allocation',invoiceId:'invoice',transactionId:'payment',amount:62500}],credits:[],imports:[],receipts:[]};
 sql.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,?,?,?)').run(owner,7,JSON.stringify(state),at.toISOString());
 sql.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,?,?,?)').run('other-synthetic-owner',1,JSON.stringify({...state,private:'OTHER_OWNER'}),at.toISOString());
 for(let index=0;index<count;index++){
  const bytes=Buffer.from('%PDF-Synthetic retained original '+index);
  sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(id(index),owner,'synthetic.pdf','application/pdf',bytes.length,hash(bytes),at.toISOString());
  objects.set(owner+'/'+id(index),new Uint8Array(bytes));
 }
 const row=()=>sql.prepare('SELECT * FROM backup_runs WHERE owner=?').get(owner);
 return{sql,db,bucket,objects,gets,puts,state,row,path:index=>row().snapshot_key.replace('snapshot.bin',id(index)+'.bin')};
}
async function finish(f,bucket=f.bucket,limit=5){
 let result;
 for(let step=0;step<20;step++){
  result=await backupStep(f.db,bucket,owner,key,at,limit);
  if(['complete','failed'].includes(result.status))return result;
 }
 assert.fail('synthetic backup did not finish within its bounded steps');
}


const domainUrl=new URL('../lib/domain.ts',import.meta.url).href;
const {emptyState,applyCommand,paymentOriginalIssue}=await import(domainUrl);
const {stripTypeScriptTypes}=await import('node:module');
let normalizedCode=stripTypeScriptTypes(readFileSync(new URL('../lib/banking/transactions.ts',import.meta.url),'utf8'),{mode:'transform'}).replaceAll("'../domain'",JSON.stringify(domainUrl)).replaceAll("'../payment-references.js'",JSON.stringify(new URL('../lib/payment-references.js',import.meta.url).href));
const {normalizeTransactions}=await import('data:text/javascript;base64,'+Buffer.from(normalizedCode).toString('base64'));
async function apiState(){
 const raw={status:'BOOK',transaction_amount:{amount:'625.00',currency:'SEK'},credit_debit_indicator:'CRDT',booking_date:'2026-10-26',debtor:{name:'Synthetic backup payer AB'},reference_number:'000018',entry_reference:'SYNTHETIC-BACKUP-API'};
 const normalized=await normalizeTransactions([raw],{accountKey:'Synthetic account',accountLabel:'Synthetic account',bankName:'Synthetic bank',dateFrom:'2026-10-01',dateTo:'2026-10-30'});
 return applyCommand(emptyState(),{type:'transactions.import',trustedBankImport:true,rows:normalized.rows}).state;
}
const envelope=state=>({format:'MG-Sites-backup-1',owner,createdAt:at.toISOString(),tables:BACKUP_TABLES.map(name=>({name,rows:name==='workspaces'?[{owner,revision:1,payload:JSON.stringify(state),updated_at:at.toISOString()}]:[]}))});
for(const [label,damage]of [
 ['changed raw original',t=>{t.bankData.debtor.name='Different sender';}],
 ['missing raw original',t=>{delete t.bankData;}],
 ['empty raw original with a matching hash',t=>{t.bankData={};t.bankDataSha256=hash(JSON.stringify(t.bankData));}],
 ['missing new checksum',t=>{delete t.bankDataSha256;}],
 ['malformed checksum',t=>{t.bankDataSha256='not-a-hash';}],
 ['missing receipt version',t=>{delete t.bankDataVersion;}],
 ['unknown receipt version',t=>{t.bankDataVersion='unknown';}],
])test('API archive rejects '+label+' before certifying a snapshot',async()=>{
 const state=await apiState();damage(state.transactions[0]);assert.throws(()=>validateSnapshot(envelope(state),owner),/backup_api_original/);
});
test('unversioned missing receipts remain faithful archival data with explicitly unknown bank evidence',async()=>{
 const state=await apiState(),t=state.transactions[0];delete t.bankDataSha256;delete t.bankDataVersion;const before=JSON.stringify(state),checked=validateSnapshot(envelope(state),owner);
 assert.deepEqual(checked.apiEvidence,{version:'retained-api-receipts-v1',scope:'retained_json_checksums',records_checked:0,records_without_receipt:1});assert.equal(JSON.stringify(state),before);const restored=JSON.parse(checked.tables[0].rows[0].payload);assert.ok(paymentOriginalIssue(restored,restored.transactions[0]));assert.equal(restored.transactions[0].bankDataSha256,undefined);
});
test('a valid receipt count is explicit and a forged archived summary is rejected',async()=>{
 const state=await apiState(),checked=validateSnapshot(envelope(state),owner);assert.deepEqual(checked.apiEvidence,{version:'retained-api-receipts-v1',scope:'retained_json_checksums',records_checked:1,records_without_receipt:0});checked.apiEvidence.records_checked=2;assert.throws(()=>validateSnapshot(checked,owner),/backup_api_evidence/);
});
test('retained conflicting incoming API originals are checked even when the live original is intact',async()=>{
 const state=await apiState(),t=state.transactions[0],incoming=structuredClone(t);incoming.bankData.transaction_amount.amount='700.00';t.bankEvidenceConflicts=[{at:at.toISOString(),fields:['amount'],incoming}];assert.throws(()=>validateSnapshot(envelope(state),owner),/backup_api_original/);
});
test('a compact rejected-import audit retains a checked API receipt outside the workspace payload',async()=>{
 const state=await apiState(),t=state.transactions[0],incoming=structuredClone(t),snapshot=envelope(emptyState());incoming.bankData.transaction_amount.amount='700.00';snapshot.tables.find(t=>t.name==='audit_events').rows.push({owner,action:'bank.import_rejected',detail:JSON.stringify({retained_conflicts:[{transactionId:'synthetic',conflicts:[{incoming}]}]})});assert.throws(()=>validateSnapshot(snapshot,owner),/backup_api_original/);
});
test('a specification conflict summary is not misclassified as a provider API receipt',()=>{
 const state=emptyState();state.transactions=[{id:'synthetic-child',source:'Synthetic.xml',evidence:'bankgiro_file',bankData:{specification:{count:1}}}];const checked=validateSnapshot(envelope(state),owner);assert.equal(checked.apiEvidence.records_checked,0);assert.equal(checked.apiEvidence.records_without_receipt,0);
});
test('encrypted backup and public status disclose unreceipted API records without upgrading restored financial proof',async t=>{
 const f=fixture(t,0),state=await apiState();delete state.transactions[0].bankDataSha256;delete state.transactions[0].bankDataVersion;const before=JSON.stringify(state);f.sql.prepare('UPDATE workspaces SET payload=? WHERE owner=?').run(before,owner);
 const result=await finish(f);assert.equal(result.status,'complete');assert.equal(result.verification_scope,'manifest_pass');assert.equal(result.api_evidence.records_without_receipt,1);assert.equal(result.api_evidence.records_checked,0);
 const status=await backupStatus(f.db,owner);assert.deepEqual(status.last_verified.api_evidence,result.api_evidence);const row=f.row(),restored=validateSnapshot(JSON.parse(new TextDecoder().decode(await unsealBackup(f.objects.get(row.snapshot_key),key,owner,row.id,'snapshot'))),owner);assert.equal(restored.tables.find(t=>t.name==='workspaces').rows[0].payload,before);assert.deepEqual(restored.apiEvidence,result.api_evidence);assert.equal(f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(owner).payload,before);
});
test('a present invalid receipt stops backup before writing any archive object and preserves the live workspace',async t=>{
 const f=fixture(t,0),state=await apiState();state.transactions[0].bankData.debtor.name='Changed original';const before=JSON.stringify(state);f.sql.prepare('UPDATE workspaces SET payload=? WHERE owner=?').run(before,owner);const result=await finish(f);assert.equal(result.status,'failed');assert.equal(result.error,'backup_api_original_invalid');assert.equal(result.verified_at,'');assert.equal(f.puts.length,0);assert.equal(f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(owner).payload,before);
});
test('historical completed backups disclose API evidence as unassessed without inventing zero unknowns',async t=>{
 const f=fixture(t,0),stamp='2026-10-30T01:00:00Z';f.sql.prepare("INSERT INTO backup_runs(id,owner,day,state,created_at,updated_at,finished_at) VALUES(?,?,?,'complete',?,?,?)").run('historical-api-scope',owner,'2026-10-30',stamp,stamp,stamp);const result=await backupStep(f.db,f.bucket,owner,key,at);assert.deepEqual(result.api_evidence,{scope:'unassessed'});assert.equal(result.verified_at,stamp);assert.equal(f.gets.length,0);
});

const syncRejection=(snapshot,incoming)=>snapshot.tables.find(table=>table.name==='audit_events').rows.push({owner,action:'bank.sync_rejected',detail:JSON.stringify({retained_conflicts:[{transactionId:'synthetic-existing',conflicts:[{at:at.toISOString(),fields:['amount'],incoming}]}],compact_hold:true})});
test('review: rejected provider-sync audit validates every retained arrival receipt',async()=>{
 const state=await apiState(),incoming=structuredClone(state.transactions[0]);incoming.bankData.debtor.name='Corrupted rejected provider original';const snapshot=envelope(emptyState());syncRejection(snapshot,incoming);
 assert.throws(()=>validateSnapshot(snapshot,owner),/backup_api_original_invalid/);
});
for(const legacy of [false,true])test('review: rejected provider-sync audit counts '+(legacy?'unreceipted':'checked')+' originals outside compact state',async()=>{
 const state=await apiState(),incoming=structuredClone(state.transactions[0]);if(legacy){delete incoming.bankDataSha256;delete incoming.bankDataVersion;}
 const snapshot=envelope(emptyState());syncRejection(snapshot,incoming);const before=JSON.stringify(snapshot),checked=validateSnapshot(snapshot,owner);
 assert.equal(checked.apiEvidence.records_checked,legacy?0:1);assert.equal(checked.apiEvidence.records_without_receipt,legacy?1:0);assert.equal(JSON.stringify(snapshot),before);
});
test('review: corrupted compact provider-sync rejection cannot complete an encrypted backup',async t=>{
 const f=fixture(t,0),state=await apiState(),incoming=structuredClone(state.transactions[0]);incoming.bankData.transaction_amount.amount='700.00';
 state.bankEvidenceHold={at:at.toISOString(),auditEventId:'synthetic-sync-rejection',fingerprint:'f'.repeat(64)};const payload=JSON.stringify(state);f.sql.prepare('UPDATE workspaces SET payload=? WHERE owner=?').run(payload,owner);
 const snapshot=envelope(emptyState());syncRejection(snapshot,incoming);const audit=snapshot.tables.find(table=>table.name==='audit_events').rows[0];f.sql.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,?,?,?,?)').run('synthetic-sync-rejection',owner,8,audit.action,audit.detail,at.toISOString());
 const result=await finish(f);assert.equal(result.status,'failed');assert.equal(result.error,'backup_api_original_invalid');assert.equal(result.verified_at,'');assert.equal((await backupStatus(f.db,owner)).last_verified,null);assert.equal(f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(owner).payload,payload);
});
