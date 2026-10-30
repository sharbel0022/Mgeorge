import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {applyCommand,emptyState,today} from '../lib/domain.ts';
import {randomToken} from '../lib/banking/security.ts';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const url=path=>new URL(path,import.meta.url).href;
function compiled(path,imports){let code=stripTypeScriptTypes(source(path),{mode:'transform'});for(const [name,value]of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(value));return data(code);}
const {reconcileState}=await import(compiled('../lib/reconciliation.ts',{'./domain':url('../lib/domain.ts'),'./reconciliation-engine.js':url('../lib/reconciliation-engine.js')}));
class LocalD1{
 constructor(sql){this.sql=sql;this.beforeBatch=null;}
 prepare(query){const database=this;return{query,values:[],bind(...values){this.values=values;return this;},async first(){return database.sql.prepare(query).get(...this.values)||null;},async all(){return{results:database.sql.prepare(query).all(...this.values)};},async run(){return this.execute();},execute(){return{meta:{changes:database.sql.prepare(query).run(...this.values).changes}};}};}
 async batch(statements){if(this.beforeBatch)await this.beforeBatch(statements);this.sql.exec('BEGIN');try{const results=statements.map(statement=>statement.execute());this.sql.exec('COMMIT');return results;}catch(error){this.sql.exec('ROLLBACK');throw error;}}
}
const accountUid='22222222-2222-4222-8222-222222222222',appId='11111111-1111-4111-8111-111111111111',owner='q8-synthetic-owner',iban='SE4280000890119146168423',origin='https://synthetic-bank.test';
const future=()=>new Date(Date.now()+86400000).toISOString();
const row=extra=>({entry_reference:'Q8-BANK-1',transaction_amount:{amount:'625.00',currency:'SEK'},credit_debit_indicator:'CRDT',status:'BOOK',booking_date:today(),debtor:{name:'Synthetic customer AB'},reference_number:'000018',...extra});

async function fixture(t){
 const key='__q8_sync_'+crypto.randomUUID().replaceAll('-',''),sql=new DatabaseSync(':memory:');
 for(const migration of ['0000_confused_umar','0001_sudden_whirlwind','0002_brief_chronomancer','0012_minor_naoko'])sql.exec(source('../drizzle/'+migration+'.sql'));
 const DB=new LocalD1(sql),f={sql,DB,rows:[],env:{DB,BANK_DATA_ENCRYPTION_KEY:randomToken(),ENABLE_BANKING_APPLICATION_ID:appId,ENABLE_BANKING_PRIVATE_KEY:'-----BEGIN PRIVATE KEY-----\nVEVTVC1PTkxZLU5PVC1SRUFM\n-----END PRIVATE KEY-----',ENABLE_BANKING_ENVIRONMENT:'PRODUCTION',ENABLE_BANKING_KEY_ROTATED:'true'}};
 globalThis[key]=f;t.after(()=>{delete globalThis[key];sql.close();});
 t.mock.method(globalThis,'fetch',async()=>{throw Error('Live network is forbidden in synthetic bank tests.');});
 const domain=url('../lib/domain.ts'),security=url('../lib/banking/security.ts'),runtime=url('../lib/banking/runtime-config.ts'),cloudflare=data(`export const env=globalThis[${JSON.stringify(key)}].env;`);
 const server=compiled('../lib/server.ts',{'cloudflare:workers':cloudflare,'@/app/chatgpt-auth':data(`export async function getChatGPTUser(){return {userId:${JSON.stringify(owner)}};}`),'./domain':domain});
 const storeUrl=compiled('../lib/banking/store.ts',{'cloudflare:workers':cloudflare,'@/lib/server':server,'./security':security,'./runtime-config':runtime}),store=await import(storeUrl);
 const normalizerUrl=compiled('../lib/banking/transactions.ts',{'../domain':domain,'../payment-references.js':url('../lib/payment-references.js')}),normalizer=await import(normalizerUrl);
 const provider=data(`export {ProviderError} from ${JSON.stringify(url('../lib/banking/enable-banking.ts'))};export async function getSession(){return {status:'AUTHORIZED',accounts:[${JSON.stringify(accountUid)}],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:globalThis[${JSON.stringify(key)}].validUntil}};}export async function getTransactions(){return {transactions:globalThis[${JSON.stringify(key)}].rows};}export async function getApplication(){}export async function listBusinessBanks(){}export async function startAuth(){}export async function createSession(){}export async function deleteSession(){}`);
 const service=compiled('../lib/banking/service.ts',{'@/lib/server':server,'@/lib/domain':domain,'./store':storeUrl,'./security':security,'./runtime-config':runtime,'./transactions':normalizerUrl,'./enable-banking':provider,'../customer-messages':data('export async function reconcileAndPrepare(){throw Error("Rejected imports cannot run reconciliation");}')});
 const route=await import(compiled('../app/api/bank/sync/route.ts',{'@/lib/banking/service':service}));
 const app=await store.application(owner),at=new Date().toISOString();f.validUntil=future();
 sql.prepare('INSERT INTO bank_applications VALUES(?,?,?,?,?,?,?)').run(owner,appId,await store.encrypt(owner,'key:generation-one','SYNTHETIC PRIVATE KEY'),JSON.stringify({name:'Synthetic app',kid:appId,environment:'PRODUCTION',active:true,redirect_urls:[origin+'/api/bank/callback'],countries:['SE'],services:['AIS']}),app.generation,at,at);
 const connectionId='q8-synthetic-connection';
 sql.prepare('INSERT INTO bank_connections(id,owner,app_generation,environment,bank_name,country,encrypted_session,encrypted_accounts,selected_accounts,valid_until,date_from,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(connectionId,owner,app.generation,'PRODUCTION','Swedbank','SE',await store.encrypt(owner,'session:'+connectionId,'33333333-3333-4333-8333-333333333333'),await store.encrypt(owner,'accounts:'+connectionId,[{uid:accountUid,currency:'SEK',account_id:{iban},name:'Synthetic account'}]),JSON.stringify([accountUid]),f.validUntil,today(),'connected',at,at);
 const normalized=await normalizer.normalizeTransactions([row(),row({entry_reference:'Q8-IGNORED',transaction_amount:{amount:'100.00',currency:'SEK'},debtor:{name:'Other synthetic payer'},reference_number:'000026'})],{accountKey:'iban:'+iban,accountLabel:'Synthetic account',bankName:'Swedbank',dateFrom:today(),dateTo:today()});
 let initial=applyCommand(emptyState(),{type:'transactions.import',trustedBankImport:true,rows:normalized.rows}).state;
 initial=applyCommand(initial,{type:'transaction.ignore',id:initial.transactions[1].id}).state;
 sql.prepare('INSERT INTO workspaces VALUES(?,?,?,?)').run(owner,1,JSON.stringify(initial),at);
 f.rows=[row({entry_reference:'Q8-FRESH',transaction_amount:{amount:'10.00',currency:'SEK'},debtor:{name:'Fresh synthetic payer'},reference_number:'000034'}),row({debtor:{name:'Contradictory synthetic payer'}}),row({entry_reference:'Q8-IGNORED',transaction_amount:{amount:'101.00',currency:'SEK'},debtor:{name:'Other synthetic payer'},reference_number:'000026'})];
 return{...f,read(){const saved=sql.prepare('SELECT revision,payload FROM workspaces WHERE owner=?').get(owner);return{revision:saved.revision,state:JSON.parse(saved.payload)};},async post(){const response=await route.POST(new Request(origin+'/api/bank/sync',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'}));return{response,body:await response.json()};}};
}

test('Q8: a rejected bank sync persists observed contradictions without new money or a successful run',async t=>{
 const f=await fixture(t),before=f.read(),result=await f.post();
 assert.equal(result.response.status,400);assert.match(result.body.error,/undantagen/i);
 const saved=f.read();assert.equal(saved.revision,2);assert.equal(saved.state.transactions.length,2);
 assert.deepEqual(saved.state.imports,before.state.imports);assert.deepEqual(saved.state.allocations,before.state.allocations);
 assert.deepEqual(saved.state.transactions[0].bankData,before.state.transactions[0].bankData);
 assert.equal(saved.state.transactions[0].bankEvidenceConflicts?.[0].incoming.bankData.debtor.name,'Contradictory synthetic payer');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM bank_sync_runs').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,1);
 assert.equal(f.sql.prepare('SELECT last_synced_at FROM bank_connections').get().last_synced_at,null);
 const retry=await f.post();assert.equal(retry.response.status,400);assert.equal(f.read().revision,2);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,1);
});

test('Q8: evidence-only bank failure cannot overwrite a concurrent workspace revision',async t=>{
 const f=await fixture(t),before=f.read();
 f.DB.beforeBatch=statements=>{if(statements.some(statement=>statement.values.includes('bank.sync_rejected'))){f.DB.beforeBatch=null;const concurrent=structuredClone(before.state);concurrent.company.name='Concurrent synthetic edit';f.sql.prepare('UPDATE workspaces SET revision=revision+1,payload=? WHERE owner=?').run(JSON.stringify(concurrent),owner);}};
 const result=await f.post();assert.equal(result.response.status,409);assert.equal(f.read().revision,2);assert.equal(f.read().state.company.name,'Concurrent synthetic edit');assert.equal(f.read().state.transactions[0].bankEvidenceConflicts,undefined);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
});

test('Q8: evidence-only bank failure cannot write after its lease is replaced',async t=>{
 const f=await fixture(t),before=f.read();
 f.DB.beforeBatch=statements=>{if(statements.some(statement=>statement.values.includes('bank.sync_rejected'))){f.DB.beforeBatch=null;f.sql.prepare("UPDATE bank_locks SET token='another-worker',expires_at=?").run(future());}};
 const result=await f.post();assert.equal(result.response.status,409);assert.match(result.body.error,/lås.*löpt ut/);assert.deepEqual(f.read(),before);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
});

function atCapacity(f){
 const state=applyCommand(f.read().state,{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',number:'0599',ocr:'000018',total:62500,issued:today(),due:today(),reviewed:true}}).state;
 for(let n=0;n<600;n++)state.invoices.push({...state.invoices[0],id:crypto.randomUUID(),party:'Synthetic filler '+n,number:'FILL-'+n,ocr:'',total:1,note:''});
 let remaining=1799000-Buffer.byteLength(JSON.stringify(state));for(const item of state.invoices.slice(1)){const count=Math.min(3000,remaining);item.note='x'.repeat(count);remaining-=count;if(!remaining)break;}
 assert.equal(remaining,0);f.sql.prepare('UPDATE workspaces SET payload=? WHERE owner=?').run(JSON.stringify(state),owner);f.rows[1].note='d'.repeat(1000);
}

test('Q8 review: capped bank sync retains raw conflict evidence and a bounded hold without new financial rows',async t=>{
 for(const otherwiseValid of [false,true]){
  const f=await fixture(t);atCapacity(f);if(otherwiseValid)f.rows.splice(2,1);const before=f.read(),result=await f.post();
  assert.equal(result.response.status,400);const saved=f.read();assert.equal(saved.revision,2);assert.ok(saved.state.bankEvidenceHold);assert.ok(Buffer.byteLength(JSON.stringify(saved.state))<=1800256);
  const {bankEvidenceHold,...preserved}=saved.state;assert.deepEqual(preserved,before.state);const event=f.sql.prepare('SELECT owner,action,detail FROM audit_events WHERE id=?').get(bankEvidenceHold.auditEventId);assert.equal(event.owner,owner);assert.equal(event.action,'bank.sync_rejected');
  const evidence=JSON.parse(event.detail).retained_conflicts.flatMap(entry=>entry.conflicts).find(conflict=>conflict.incoming.bankData?.debtor?.name==='Contradictory synthetic payer').incoming;
  assert.equal(evidence.bankData.note,'d'.repeat(1000));assert.equal(evidence.amount,62500);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM bank_sync_runs').get().n,0);assert.equal(f.sql.prepare('SELECT last_synced_at FROM bank_connections').get().last_synced_at,null);
  const retry=await f.post();assert.equal(retry.response.status,400);assert.equal(f.read().revision,2);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,1);
  assert.equal(reconcileState(f.read().state).state.allocations.length,0);assert.throws(()=>applyCommand(f.read().state,{type:'match.create',invoiceId:saved.state.invoices[0].id,transactionId:saved.state.transactions[0].id,amount:62500,note:'Cannot bypass the compact safety hold.'}),/motstrid/i);
 }
});

test('Q8 review: a capped sync conflict audit and hold are fenced by the workspace revision',async t=>{
 const f=await fixture(t);atCapacity(f);const before=f.read();
 f.DB.beforeBatch=statements=>{if(statements.some(statement=>statement.values.includes('bank.sync_rejected'))){f.DB.beforeBatch=null;const concurrent=structuredClone(before.state);concurrent.company.name='Concurrent synthetic edit';f.sql.prepare('UPDATE workspaces SET revision=revision+1,payload=? WHERE owner=?').run(JSON.stringify(concurrent),owner);}};
 const result=await f.post();assert.equal(result.response.status,409);assert.equal(f.read().revision,2);assert.equal(f.read().state.company.name,'Concurrent synthetic edit');assert.equal(f.read().state.bankEvidenceHold,undefined);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
});

test('Q8 review: a capped sync conflict audit and hold are fenced by a replacement lease',async t=>{
 const f=await fixture(t);atCapacity(f);const before=f.read();
 f.DB.beforeBatch=statements=>{if(statements.some(statement=>statement.values.includes('bank.sync_rejected'))){f.DB.beforeBatch=null;f.sql.prepare("UPDATE bank_locks SET token='another-worker',expires_at=?").run(future());}};
 const result=await f.post();assert.equal(result.response.status,409);assert.match(result.body.error,/lås.*löpt ut/);assert.deepEqual(f.read(),before);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
});
