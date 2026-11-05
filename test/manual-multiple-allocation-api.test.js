import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import vm from 'node:vm';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {storeTransactions,saveSettings} from '../src/db.js';
import {normalizeBankApiTransaction} from '../src/importers.js';
import {digest} from '../src/security.js';
import {approveSyntheticBankAccount} from './bank-fixtures.js';

const directory=mkdtempSync(join(tmpdir(),'mg-manual-multiple-api-'));
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'http://localhost:3000',DB_PATH:join(directory,'synthetic.sqlite'),SESSION_SECRET:'1'.repeat(64),BANK_DATA_KEY:'3'.repeat(64)});
delete process.env.MG_ADMIN_PASSWORD;delete process.env.ENCRYPTION_KEY;
const {server,db}=await import('../src/server.js');
const base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const login=await fetch(base+'/api/me'),cookie=login.headers.get('set-cookie').split(';')[0];
test.after(()=>new Promise(resolve=>server.close(()=>{db.close();rmSync(directory,{recursive:true,force:true});resolve();})));
const account='SE4280000890119146168423',owner='local-admin';
const call=async(path,body,method=body?'POST':'GET')=>{
 const response=await fetch(base+path,{method,headers:{Cookie:cookie,Origin:'http://localhost:3000','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,body:await response.json()};
};
function fixture(amounts=[30001,43099],adjust=0){
 for(const trigger of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'synthetic_manual_%'").all())db.exec(`DROP TRIGGER ${trigger.name}`);
 for(const table of ['allocations','payer_links','documents','invoices','bank_transactions','import_jobs','bank_connections','audit_events'])db.prepare('DELETE FROM '+table).run();
 saveSettings(db,{company_name:'M.George Vitvaror AB'});approveSyntheticBankAccount(db,account);db.prepare('UPDATE bank_connections SET owner=?').run(owner);
 const allocations=amounts.map((amountMinor,index)=>{
  const id='synthetic-invoice-'+index,number=String(42+index).padStart(5,'0'),bytes=Buffer.from(`Synthetic retained invoice ${number}; ${amountMinor} minor units; no customer data.`);
  db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,issued_at,reference) VALUES(?,?,?,?,?,?,?)').run(id,'customer',number,'Synthetic explicit customer AB',amountMinor,'2026-10-01',number);
  db.prepare("INSERT INTO documents(id,invoice_id,name,mime_type,content,fingerprint,status) VALUES(?,?,?,?,?,?,'registered')").run('document-'+id,id,'synthetic.txt','text/plain',bytes,digest(bytes));
  return {invoiceId:id,amountMinor};
 });
 const amount=amounts.reduce((sum,value)=>sum+value,0)+adjust,raw={status:'BOOK',booking_date:'2026-10-26',credit_debit_indicator:'CRDT',transaction_amount:{amount:(amount/100).toFixed(2),currency:'SEK'},debtor:{name:'Synthetic explicit customer AB'},reference_number:'',remittance_information:amounts.map((_,index)=>'Faktura '+String(42+index).padStart(5,'0')),entry_reference:'SYNTHETIC-MULTI-PAYMENT'};
 const imported=storeTransactions(db,[normalizeBankApiTransaction(raw,account)],'enablebanking');db.prepare('UPDATE import_jobs SET owner=? WHERE id=?').run(owner,imported.import_id);
 const transactionId=db.prepare('SELECT id FROM bank_transactions').get().id;
 return {transactionId,allocations,note:'Synthetic explicit review of the complete invoice vector and preserved bank original.'};
}
const stored=()=>Object.fromEntries(['allocations','invoices','bank_transactions','documents','audit_events'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY id').all()]));
const quote=async request=>{const result=await call('/api/manual-allocations/preview',request);assert.equal(result.status,200,JSON.stringify(result.body));return result.body;};
const approval=(request,review,requestId='synthetic-manual-request-001')=>({...request,reviewHash:review.reviewHash,requestId,confirm:true});

for(const amounts of [[30001,43099],[10001,20002,43097]])test(`Node manual API commits ${amounts.length} invoices in one explicit manual receipt and replays after revocation`,async()=>{
 const request=fixture(amounts),before=stored();
 const discovery=await call('/api/manual-allocations?transactionId='+request.transactionId);assert.equal(discovery.status,200);assert.equal(discovery.body.invoices.length,amounts.length);
 const review=await quote(request);assert.deepEqual(stored(),before,'Discovery and quote never write money or audit');
 const body=approval(request,review),saved=await call('/api/manual-allocations',body);assert.equal(saved.status,201,JSON.stringify(saved.body));
 assert.equal(saved.body.receipt.method,'manual_multiple');assert.equal(saved.body.receipt.automatic,false);assert.equal(saved.body.receipt.allocations.length,amounts.length);
 assert.match(saved.body.receipt.evidence.bankOriginal.sha256,/^[a-f0-9]{64}$/);assert.ok(saved.body.receipt.evidence.invoiceOriginals.every(row=>/^[a-f0-9]{64}$/.test(row.fingerprint)));
 assert.equal(db.prepare('SELECT SUM(amount_cents) total FROM allocations').get().total,73100);assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='manual_multiple_allocation'").get().n,1);
 assert.deepEqual(stored().bank_transactions,before.bank_transactions);assert.deepEqual(stored().documents,before.documents);
 db.prepare("UPDATE bank_connections SET status='disconnected'").run();const committed=stored();
 const replay=await call('/api/manual-allocations',body);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.deepEqual(replay.body.receipt,saved.body.receipt);assert.deepEqual(stored(),committed);
 const read=await call('/api/manual-allocations?requestId='+body.requestId);assert.equal(read.status,200);assert.deepEqual(read.body.receipt,saved.body.receipt);
 const changed=await call('/api/manual-allocations',{...body,note:body.note+' changed'});assert.equal(changed.status,409);assert.deepEqual(stored(),committed);
});
for(const [name,change]of [
 ['one changed minor unit',r=>{r.allocations[0].amountMinor--;r.allocations[1].amountMinor++;}],
 ['missing confirmation',r=>r.confirm=false],
 ['foreign scope supplied by browser',r=>r.ownerId='another-owner'],
])test('Node manual API rejects '+name,async()=>{
 const request=fixture(),review=await quote(request),body=approval(request,review);change(body);const before=stored();
 const result=await call('/api/manual-allocations',body);assert.ok([400,409].includes(result.status),JSON.stringify(result));assert.deepEqual(stored(),before);
});
for(const [name,change]of [
 ['revoked consent',()=>db.prepare("UPDATE bank_connections SET status='disconnected'").run()],
 ['replaced consent',()=>db.prepare("UPDATE bank_connections SET encrypted_session=encrypted_session||'x'").run()],
 ['changed bank original',()=>db.prepare("UPDATE bank_transactions SET raw_bank_data_sha256='bad'").run()],
 ['changed invoice original',()=>db.prepare("UPDATE documents SET content=x'00' WHERE invoice_id='synthetic-invoice-1'").run()],
 ['changed invoice debt',()=>db.prepare("UPDATE invoices SET total_cents=total_cents+1 WHERE id='synthetic-invoice-1'").run()],
 ['new conflicting reference owner',()=>db.prepare("INSERT INTO invoices(id,direction,invoice_number,party,total_cents,reference,issued_at) VALUES('conflicting-owner','customer','00042','Synthetic other customer',1,'00042','2026-10-01')").run()],
])test('Node manual API stops the whole vector after '+name,async()=>{
 const request=fixture(),review=await quote(request);change();const before=stored();
 const result=await call('/api/manual-allocations',approval(request,review));assert.equal(result.status,409,JSON.stringify(result));assert.deepEqual(stored(),before);
});
for(const [name,trigger]of [
 ['second allocation failure',"CREATE TRIGGER synthetic_manual_failure BEFORE INSERT ON allocations WHEN NEW.invoice_id='synthetic-invoice-1' BEGIN SELECT RAISE(ABORT,'Synthetic second allocation failure'); END"],
 ['receipt audit failure',"CREATE TRIGGER synthetic_manual_failure BEFORE INSERT ON audit_events WHEN NEW.action='manual_multiple_allocation' BEGIN SELECT RAISE(ABORT,'Synthetic audit failure'); END"],
])test('Node manual API rolls back every allocation and invoice update after '+name,async()=>{
 const request=fixture(),review=await quote(request);db.exec(trigger);const before=stored();
 const result=await call('/api/manual-allocations',approval(request,review));assert.ok(result.status>=400);assert.deepEqual(stored(),before);
});
test('Node concurrent approvals for the same money commit exactly one whole vector',async()=>{
 const request=fixture(),review=await quote(request);
 const results=await Promise.all([call('/api/manual-allocations',approval(request,review,'synthetic-concurrent-001')),call('/api/manual-allocations',approval(request,review,'synthetic-concurrent-002'))]);
 assert.deepEqual(results.map(result=>result.status).sort(),[201,409]);assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,2);assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='manual_multiple_allocation'").get().n,1);
});
test('Node manual API requires a quote before any complete-vector write',async()=>{
 const request=fixture(),before=stored(),result=await call('/api/manual-allocations',{...request,requestId:'synthetic-without-review',confirm:true});
 assert.equal(result.status,400);assert.deepEqual(stored(),before);
});

test('Node lost COMMIT reply recovers the exact durable receipt without a second financial write',async()=>{
 const {commitManualMultiple}=await import('../src/manual-multiple-allocation.js');
 const request=fixture(),review=await quote(request),body=approval(request,review);let lost=false;
 const database=new Proxy(db,{get(target,property){if(property==='exec')return sql=>{const value=target.exec(sql);if(sql==='COMMIT'&&!lost){lost=true;throw Error('Synthetic lost COMMIT reply');}return value;};return Reflect.get(target,property);}});
 const result=await commitManualMultiple(database,{owner,request:body});assert.equal(result.recovered,true);assert.equal(result.receipt.allocations.length,2);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,2);assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='manual_multiple_allocation'").get().n,1);
 const replay=await call('/api/manual-allocations',body);assert.equal(replay.status,200);assert.deepEqual(replay.body.receipt,result.receipt);
});

test('Node unreadable receipt after a lost COMMIT reply reports unknown and preserves the committed outcome',async()=>{
 const {commitManualMultiple}=await import('../src/manual-multiple-allocation.js');
 const request=fixture(),review=await quote(request),body=approval(request,review);let unreadable=false;
 const database=new Proxy(db,{get(target,property){
  if(property==='exec')return sql=>{const value=target.exec(sql);if(sql==='COMMIT'){unreadable=true;throw Error('Synthetic lost COMMIT reply');}return value;};
  if(property==='prepare')return sql=>{if(unreadable&&sql.startsWith('SELECT details FROM audit_events'))throw Error('Synthetic receipt read unavailable');return target.prepare(sql);};
  return Reflect.get(target,property);
 }});
 await assert.rejects(commitManualMultiple(database,{owner,request:body}),{code:'MANUAL_OUTCOME_UNKNOWN',status:503});
 assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,2);assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='manual_multiple_allocation'").get().n,1);
 const replay=await call('/api/manual-allocations',body);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
});

test('Node final write-lock snapshot rejects a consent change after review computation',async()=>{
 const {commitManualMultiple}=await import('../src/manual-multiple-allocation.js');
 const request=fixture(),review=await quote(request),body=approval(request,review);let changed=false;
 const database=new Proxy(db,{get(target,property){if(property==='exec')return sql=>{if(sql==='BEGIN IMMEDIATE'&&!changed){changed=true;target.prepare("UPDATE bank_connections SET status='disconnected'").run();}return target.exec(sql);};return Reflect.get(target,property);}});
 const before=stored();await assert.rejects(commitManualMultiple(database,{owner,request:body}),{code:'MANUAL_STALE_REVIEW'});assert.deepEqual(stored(),before);
});

for(const adjust of [-100,101])test(`Node explicit ${adjust<0?'underpayment':'overpayment'} persists exact invoice and bank remainders`,async()=>{
 const request=fixture([30001,43099],adjust);if(adjust<0)request.allocations[1].amountMinor+=adjust;
 const review=await quote(request),saved=await call('/api/manual-allocations',approval(request,review));assert.equal(saved.status,201,JSON.stringify(saved));
 assert.equal(saved.body.receipt.paymentRemainingMinor,Math.max(0,adjust));assert.equal(saved.body.receipt.allocations.reduce((sum,row)=>sum+row.invoiceRemainingAfterMinor,0),Math.max(0,-adjust));
 assert.equal(db.prepare('SELECT SUM(amount_cents) n FROM allocations').get().n,73100+Math.min(0,adjust));
});
test('Node two identical concurrent confirmations return the same receipt',async()=>{
 const request=fixture(),review=await quote(request),body=approval(request,review);
 const results=await Promise.all([call('/api/manual-allocations',body),call('/api/manual-allocations',body)]);
 assert.deepEqual(results.map(result=>result.status).sort(),[200,201]);assert.deepEqual(results[0].body.receipt,results[1].body.receipt);assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,2);
});

test('actual Node API responses pass through the shipped client from discovery to approval and historical receipt',async()=>{
 const selection=fixture(),values=new Map(),calls=[],memory={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 // Execute the shipped classic client and its unchanged JSON transport. The
 // only fetch adaptation supplies the local test server origin/session cookie.
 const context=vm.createContext({Intl,Date,URLSearchParams,fetch:async(path,options={})=>{calls.push({path,method:options.method});return fetch(base+path,{...options,headers:{...options.headers,Cookie:cookie,Origin:'http://localhost:3000'}});}});
 vm.runInContext(readFileSync(new URL('../public/manual-multiple-client.js',import.meta.url),'utf8'),context);
 const module=vm.runInContext('manualMultipleClient',context),options={transactionId:selection.transactionId,scopeKey:'synthetic-real-node-api',storage:memory,newRequestId:()=> 'synthetic-real-node-client'};
 const client=module.createManualMultipleClient(options);await client.load();assert.equal(client.snapshot.phase,'editing',client.snapshot.error);
 const revision=client.snapshot.discovery.revision;assert.equal(typeof revision,'string');assert.match(revision,/^[a-f0-9]{64}$/);
 await client.review(selection);assert.equal(client.snapshot.phase,'review',client.snapshot.error);assert.strictEqual(client.snapshot.quote.revision,revision);
 await client.confirm(false);assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
 await client.confirm(true);assert.equal(client.snapshot.phase,'saved',client.snapshot.error);const saved=client.snapshot.receipt;assert.strictEqual(saved.revisionBefore,revision);assert.equal(saved.allocations.length,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,2);assert.equal(values.size,0);
 db.prepare("UPDATE bank_connections SET status='disconnected'").run();const before=stored(),history=module.createManualMultipleClient(options),historyStart=calls.length;
 await history.readReceipt(saved.requestId);assert.equal(history.snapshot.phase,'saved',history.snapshot.error);assert.deepEqual(history.snapshot.receipt,saved);assert.deepEqual(stored(),before);assert.deepEqual(calls.slice(historyStart),[{path:'/api/manual-allocations?requestId='+saved.requestId,method:'GET'}]);
});
