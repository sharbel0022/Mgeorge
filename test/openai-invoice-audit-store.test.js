import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createNodeAuditStore,createD1AuditStore} from '../sites/lib/openai-invoices/audit-store.js';

function fixture(t,mode='node',owner='owner-a',shared){
  const sql=shared||new DatabaseSync(':memory:');
  if(!shared){sql.exec('CREATE TABLE audit_events(id TEXT PRIMARY KEY,owner TEXT,revision INTEGER,action TEXT,details TEXT,detail TEXT,created_at TEXT)');t.after(()=>sql.close());}
  let authorized=true;
  const authorize=()=>{if(!authorized)throw Error('REVOKED');};
  const now=()=>new Date('2026-11-06T12:00:00.000Z');
  const d1={prepare(query){let args=[];return {bind(...v){args=v;return this;},async first(){return sql.prepare(query).get(...args)||null;},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}};}};
  return {sql,store:mode==='node'?createNodeAuditStore(sql,{owner,authorize,now}):createD1AuditStore(d1,{owner,authorize,now}),revoke(){authorized=false;}};
}
const request=(n=1)=>({key:String(n).padStart(64,'a'),documentId:'document-'+n,sha256:'b'.repeat(64),profileVersion:'test-v1',reservedMicroUsd:600,dailyBudgetMicroUsd:1000});

for(const mode of ['node','d1']){
  test(mode+': one durable reservation wins and duplicate work is not billable twice',async t=>{
    const f=fixture(t,mode),input=request();
    const results=await Promise.all([f.store.reserve(input),f.store.reserve(input)]);
    assert.deepEqual(results.map(r=>r.status).sort(),['existing','reserved']);
    assert.equal(f.sql.prepare("SELECT count(*) n FROM audit_events WHERE action='invoice.ai.reserved'").get().n,1);
    const reopened=fixture(t,mode,'owner-a',f.sql);
    assert.equal((await reopened.store.reserve(input)).status,'existing');
    assert.equal(await reopened.store.load(input.key),null);
  });
  test(mode+': immutable result receipt is reused after reopening',async t=>{
    const f=fixture(t,mode),input=request();await f.store.reserve(input);
    const result={status:'review',code:'AI_REVIEW_REQUIRED',candidate:{invoiceNumber:'00017'}};
    assert.equal(await f.store.record(input.key,result),true);
    assert.equal(await f.store.record(input.key,{status:'overwritten'}),false);
    assert.deepEqual(await fixture(t,mode,'owner-a',f.sql).store.load(input.key),result);
  });
  test(mode+': daily budget counts uncertain and failed attempts conservatively',async t=>{
    const f=fixture(t,mode);
    await f.store.reserve(request());
    assert.equal((await f.store.reserve(request(2))).status,'budget_exhausted');
    assert.equal(f.sql.prepare("SELECT count(*) n FROM audit_events WHERE action='invoice.ai.reserved'").get().n,1);
  });
  test(mode+': result cannot be written without a matching reservation',async t=>{
    const f=fixture(t,mode);assert.equal(await f.store.record(request().key,{status:'review'}),false);
    assert.equal(await f.store.load(request().key),null);
  });
  test(mode+': authorization is checked before cache, reserve and result access',async t=>{
    const f=fixture(t,mode);await f.store.reserve(request());f.revoke();
    await assert.rejects(f.store.load(request().key),/REVOKED/);
    await assert.rejects(f.store.reserve(request(2)),/REVOKED/);
    await assert.rejects(f.store.record(request().key,{status:'review'}),/REVOKED/);
  });
  test(mode+': invalid reservation cannot bypass the integer budget',async t=>{
    const f=fixture(t,mode);
    for(const patch of [{reservedMicroUsd:-1},{reservedMicroUsd:NaN},{dailyBudgetMicroUsd:Infinity},{key:'not-a-hash'},{sha256:'not-a-hash'},{documentId:''}]){
      await assert.rejects(f.store.reserve({...request(),...patch}),/AI_RESERVATION_INVALID/);
    }
    assert.equal(f.sql.prepare('SELECT count(*) n FROM audit_events').get().n,0);
  });
}
test('D1: owner-scoped cache and budget remain separate with colliding document IDs',async t=>{
  const a=fixture(t,'d1','owner-a'),b=fixture(t,'d1','owner-b',a.sql);
  const first=request(),second={...request(2),documentId:first.documentId};
  await a.store.reserve(first);await a.store.record(first.key,{status:'review',candidate:{invoiceNumber:'A'}});
  assert.equal(await b.store.load(first.key),null);
  assert.equal((await b.store.reserve(second)).status,'reserved');
  assert.equal(await a.store.load(second.key),null);
});
