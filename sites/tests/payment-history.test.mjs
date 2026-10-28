import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {paymentHistoryEntry} from '../lib/payment-history.ts';
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const server=data(`export async function identity(){if(!globalThis.paymentHistoryFixture.owner)throw Error('AUTH_REQUIRED');return {userId:globalThis.paymentHistoryFixture.owner};}export const db=()=>globalThis.paymentHistoryFixture.DB;export async function readWorkspace(owner){return {state:{transactions:owner==='owner'?[{id:'payment',parentId:'parent'}]:[],allocations:[{id:'allocation',transactionId:'payment',invoiceId:'old-invoice',amount:62500,effect:'payment'}],invoices:[{id:'old-invoice',number:'0599'}]}};}export const response=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});export const failure=e=>response({error:e.message},e.message==='AUTH_REQUIRED'?401:400);`);
let source=ts.transpileModule(readFileSync(new URL('../app/api/bank/history/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
for(const [name,target]of Object.entries({'@/lib/server':server,'@/lib/payment-history':new URL('../lib/payment-history.ts',import.meta.url).href}))for(const quote of ['"',"'"])source=source.replaceAll(quote+name+quote,JSON.stringify(target));
const {GET}=await import(data(source));
const request=extra=>new Request('https://test/api/bank/history?transactionId=payment'+(extra||''));
function fixture(t){const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('CREATE TABLE audit_events(id TEXT,owner TEXT,revision INTEGER,action TEXT,detail TEXT,created_at TEXT)');const f={sql,owner:'owner',DB:{prepare(query){return {bind(...args){return {async all(){return {results:sql.prepare(query).all(...args)};}};}};}},add(action,detail,owner='owner'){const id=crypto.randomUUID();sql.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?)').run(id,owner,1,action,typeof detail==='string'?detail:JSON.stringify(detail),'2026-10-28T10:00:00Z');return id;}};globalThis.paymentHistoryFixture=f;return f;}

test('old verification is visible beyond the global last-100 history, with correction and undo retained',async t=>{
 const f=fixture(t),first=f.add('transaction.verify',{command:{id:'payment',party:'Första verifierade namn',payerReference:'000018',note:'Kontrollerat original'}});
 for(let n=0;n<120;n++)f.add('transaction.verify',{command:{id:'unrelated',party:'OTHER PAYMENT'}});
 f.add('transaction.unverify',{command:{id:'payment',note:'Rättelse krävs'}});f.add('match.undo',{command:{id:'allocation',note:'Fel koppling återtagen'}});
 const res=await GET(request()),out=await res.json();assert.equal(res.status,200);assert.match(res.headers.get('Cache-Control'),/no-store/);assert.equal(out.entries.length,3);assert.equal(out.entries.at(-1).id,first);assert.equal(out.entries.at(-1).reference,'000018');assert.equal(out.entries[0].label,'Fakturakoppling återtagen');assert.deepEqual(out.entries[0].settlement,{invoice:'0599',amount:62500,effect:'payment'});assert.doesNotMatch(JSON.stringify(out),/OTHER PAYMENT/);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,123);
});
test('automatic events expose only the selected payment decision and exact matching rule',async t=>{
 const f=fixture(t);f.add('transaction.verify',{command:{id:'other',party:'PRIVATE NAME',note:'PRIVATE NOTE',payerReference:'PRIVATE REF'},automatic:[{transaction_id:'payment',reason:'Unik bankreferens',rule_version:'verified-rule'},{transaction_id:'other',reason:'PRIVATE OTHER',party:'PRIVATE NAME'}]});
 const out=await (await GET(request())).json();assert.deepEqual(out.entries[0].decisions,[{reason:'Unik bankreferens',rule:'verified-rule'}]);assert.doesNotMatch(JSON.stringify(out),/PRIVATE/);
});
test('history paginates stably without duplicates when new events arrive',async t=>{
 const f=fixture(t);for(let n=0;n<55;n++)f.add('transaction.verify',{command:{id:'payment',note:'Kontroll '+n}});
 const first=await (await GET(request())).json();assert.equal(first.entries.length,50);assert.ok(first.next);
 f.add('transaction.verify',{command:{id:'payment',note:'Ny kontroll'}});
 const second=await (await GET(request('&before='+first.next))).json();assert.equal(second.entries.length,5);assert.equal(second.next,null);assert.equal(new Set([...first.entries,...second.entries].map(e=>e.id)).size,55);
});
test('history excludes other owners, rejects unknown transactions and malformed cursors',async t=>{
 const f=fixture(t);f.add('transaction.verify',{command:{id:'payment',party:'PRIVATE OTHER OWNER'}},'other');assert.equal((await (await GET(request())).json()).entries.length,0);
 f.owner='other';assert.equal((await GET(request())).status,404);f.owner=null;assert.equal((await GET(request())).status,401);f.owner='owner';
 for(const cursor of ['0','-1','Infinity','1.5','9007199254740992',"1' OR 1=1"])assert.equal((await GET(request('&before='+encodeURIComponent(cursor)))).status,400);
});
test('malformed old audit payloads and scalar decision entries do not hide payment history',async t=>{
 const f=fixture(t);f.add('transaction.verify','broken JSON');f.add('automatic.reconciliation',{decisions:['bad',null,1,{transaction_id:'payment',reason:'Bevarat beslut'}]});
 assert.equal((await GET(request())).status,200);assert.equal(paymentHistoryEntry({id:'x',action:'transaction.verify',detail:'broken',created_at:'at'},'payment'),null);
});
test('child history includes parent split and automatic specification verification without sibling details',async t=>{
 const f=fixture(t);f.add('transaction.split',{command:{id:'parent',rows:[{party:'PRIVATE SIBLING'}]}});f.add('automatic.reconciliation',{decisions:[{transaction_id:'parent',child_ids:['payment','PRIVATE SIBLING ID'],reason:'Kontrollerad hel totalsumma',rule_version:'batch-rule',rows:[{party:'PRIVATE SIBLING NAME'}]}]});
 const out=await (await GET(request())).json();assert.equal(out.entries.length,2);assert.equal(out.entries[1].label,'Samlingsbetalning uppdelad manuellt');assert.equal(out.entries[0].decisions[0].rule,'batch-rule');assert.doesNotMatch(JSON.stringify(out),/PRIVATE/);
});
test('extra invoice fields on a verification command never claim an invoice allocation',()=>{
 const row={id:'event',action:'transaction.verify',created_at:'2026-10-28T10:00:00Z',detail:JSON.stringify({command:{id:'payment',party:'Verifierad betalare',invoiceId:'unrelated',amount:99900}})};
 assert.equal(paymentHistoryEntry(row,'payment').settlement,null);
});
