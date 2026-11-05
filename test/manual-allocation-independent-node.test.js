import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
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


const {validManualDiscovery,createManualMultipleClient}=await import('../sites/lib/manual-multiple-client.js');
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),values};};
function controller(request,store=memory(),transport){const calls=[],client=createManualMultipleClient({transactionId:request.transactionId,scopeKey:'synthetic-independent-node:'+request.transactionId,storage:store,newRequestId:()=> 'synthetic-independent-node-client',request:async(path,body)=>{calls.push({path,body:body&&structuredClone(body)});if(transport)return transport(path,body);const result=await call(path,body);if(result.status>=400)throw Object.assign(Error(result.body.error),{status:result.status,code:result.body.code});return result.body;}});return {client,store,calls};}
for(const amounts of [[30001,43099],[10001,20002,43097]])test('independent actual Node discovery, quote and historical receipt accept unchanged hash revision: '+amounts.length,async()=>{const request=fixture(amounts),{client,store}=controller(request);await client.load();assert.equal(client.snapshot.phase,'editing',JSON.stringify(client.snapshot));assert.match(client.snapshot.discovery.revision,/^[a-f0-9]{64}$/);const revision=client.snapshot.discovery.revision;await client.review(request);assert.equal(client.snapshot.phase,'review',JSON.stringify(client.snapshot));assert.strictEqual(client.snapshot.quote.revision,revision);await client.confirm(false);assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);await client.confirm(true);assert.equal(client.snapshot.phase,'saved',JSON.stringify(client.snapshot));assert.strictEqual(client.snapshot.receipt.revisionBefore,revision);assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,amounts.length);assert.equal(store.values.size,0);db.prepare("UPDATE bank_connections SET status='disconnected'").run();const history=controller(request);await history.client.readReceipt(client.snapshot.receipt.requestId);assert.equal(history.client.snapshot.phase,'saved');assert.deepEqual(history.client.snapshot.receipt,client.snapshot.receipt);assert.equal(history.calls.length,1);assert.ok(history.calls[0].path.includes('?requestId='));});
for(const adjust of [-100,101])test('independent actual Node client uses exact remainder math '+adjust,async()=>{const request=fixture([30001,43099],adjust);if(adjust<0)request.allocations[1].amountMinor+=adjust;const {client}=controller(request);await client.load();await client.review(request);assert.equal(client.snapshot.phase,'review',JSON.stringify(client.snapshot));await client.confirm(true);assert.equal(client.snapshot.phase,'saved',JSON.stringify(client.snapshot));assert.equal(client.snapshot.receipt.paymentRemainingMinor,Math.max(0,adjust));assert.equal(client.snapshot.receipt.allocations.reduce((n,row)=>n+row.invoiceRemainingAfterMinor,0),Math.max(0,-adjust));});
test('independent actual Node committed HTTP response lost then remount retries identical request after revocation',async()=>{const request=fixture(),store=memory();let unavailable=false,first=true,sent;const transport=async(path,body)=>{if(path.includes('?requestId=')&&unavailable)throw Object.assign(Error('Temporarily absent'),{status:404,code:'MANUAL_RECEIPT_NOT_FOUND'});const result=await call(path,body);if(path==='/api/manual-allocations'&&first){first=false;assert.equal(result.status,201);sent=structuredClone(body);unavailable=true;throw Object.assign(Error('Network connection lost'),{status:400});}if(result.status>=400)throw Object.assign(Error(result.body.error),{status:result.status,code:result.body.code});return result.body;};const current=controller(request,store,transport);await current.client.load();await current.client.review(request);await current.client.confirm(true);assert.equal(current.client.snapshot.phase,'unknown');assert.equal(store.values.size,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,2);current.client.dispose();const reopened=controller(request,store,transport);await reopened.client.load();assert.equal(reopened.client.snapshot.phase,'unknown');assert.equal(reopened.calls.length,1);db.prepare("UPDATE bank_connections SET status='disconnected'").run();unavailable=false;await reopened.client.retry();assert.equal(reopened.client.snapshot.phase,'saved',JSON.stringify(reopened.client.snapshot));assert.deepEqual(reopened.calls.find(row=>row.path==='/api/manual-allocations').body,sent);assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,2);assert.equal(store.values.size,0);});
