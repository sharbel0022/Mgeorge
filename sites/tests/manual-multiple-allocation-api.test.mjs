import test from 'node:test';
import assert from 'node:assert/strict';
import {manualMultipleFixture,owner} from './helpers/manual-multiple-fixture.mjs';
import {createManualMultipleClient} from '../lib/manual-multiple-client.js';
const quote=async f=>{const result=await f.call('/api/manual-allocations/preview',f.request);assert.equal(result.status,200,JSON.stringify(result.body));return result.body;};
const approval=(f,review,requestId='synthetic-manual-request-001')=>({...f.request,reviewHash:review.reviewHash,requestId,confirm:true});

for(const amounts of [[30001,43099],[10001,20002,43097]])test(`Sites atomically commits ${amounts.length} explicit rows and replays its historical receipt after revocation`,async t=>{
 const f=await manualMultipleFixture(t,{amounts}),before=f.stored(),discovery=await f.call('/api/manual-allocations?transactionId='+f.request.transactionId);assert.equal(discovery.status,200);assert.equal(discovery.body.invoices.length,amounts.length);
 const review=await quote(f);assert.deepEqual(f.stored(),before);assert.ok(!JSON.stringify(review).includes('encrypted_session'));assert.ok(!JSON.stringify(review).includes('synthetic-private'));
 const body=approval(f,review),saved=await f.call('/api/manual-allocations',body);assert.equal(saved.status,201,JSON.stringify(saved.body));
 assert.match(saved.body.receipt.evidence.bankOriginal.sha256,/^[a-f0-9]{64}$/);assert.ok(saved.body.receipt.evidence.originals.every(item=>item.objectVersion==='synthetic-object-version-1'));
 const current=f.read();assert.equal(current.state.allocations.length,amounts.length);assert.equal(current.state.allocations.reduce((sum,row)=>sum+row.amount,0),73100);assert.ok(current.state.allocations.every(row=>row.manualReview?.method==='manual_multiple'));
 assert.deepEqual(current.state.transactions,f.state.transactions);assert.deepEqual(f.stored().documents,before.documents);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='manual_multiple_allocation'").get().n,1);
 f.sqlite.prepare("UPDATE bank_connections SET status='disconnected'").run();const committed=f.stored();
 const replay=await f.call('/api/manual-allocations',body);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.deepEqual(replay.body.receipt,saved.body.receipt);assert.deepEqual(f.stored(),committed);
 const read=await f.call('/api/manual-allocations?requestId='+body.requestId);assert.equal(read.status,200);assert.deepEqual(read.body.receipt,saved.body.receipt);
 const collision=await f.call('/api/manual-allocations',{...body,note:body.note+' changed'});assert.equal(collision.status,409);assert.deepEqual(f.stored(),committed);
});

for(const [name,change]of [
 ['revoked consent',f=>f.sqlite.prepare("UPDATE bank_connections SET status='disconnected'").run()],
 ['new consent session',f=>f.sqlite.prepare("UPDATE bank_connections SET encrypted_session='synthetic-replaced-session'").run()],
 ['changed original bytes',f=>f.objects.set(owner+'/synthetic-manual-invoice-1',new Uint8Array([0]))],
 ['new object version with unchanged bytes',f=>f.objectVersions.set(owner+'/synthetic-manual-invoice-1','synthetic-version-2')],
 ['changed document metadata',f=>f.sqlite.prepare("UPDATE documents SET filename='changed.pdf' WHERE id='synthetic-manual-invoice-1'").run()],
 ['changed bank original without revision bump',f=>{const row=f.read();row.state.transactions[0].bankDataSha256='bad';f.sqlite.prepare('UPDATE workspaces SET payload=? WHERE owner=?').run(JSON.stringify(row.state),owner);}],
 ['new competing reference owner without revision bump',f=>{const row=f.read();row.state.invoices.push({...row.state.invoices[0],id:'synthetic-competitor',voided:true});f.sqlite.prepare('UPDATE workspaces SET payload=? WHERE owner=?').run(JSON.stringify(row.state),owner);}],
])test('Sites rejects the whole quote after '+name,async t=>{
 const f=await manualMultipleFixture(t),review=await quote(f);change(f);const before=f.stored();
 const result=await f.call('/api/manual-allocations',approval(f,review));assert.equal(result.status,409,JSON.stringify(result));assert.deepEqual(f.stored(),before);
});

for(const [name,change]of [
 ['consent changes immediately before the batch',f=>f.sqlite.prepare("UPDATE bank_connections SET encrypted_session='synthetic-final-session'").run()],
 ['invoice metadata changes immediately before the batch',f=>f.sqlite.prepare("UPDATE documents SET filename='changed-at-batch.pdf' WHERE id='synthetic-manual-invoice-1'").run()],
 ['workspace bank payload changes without revision bump',f=>{const current=f.read();current.state.transactions[0].bankDataSha256='changed-at-batch';f.sqlite.prepare('UPDATE workspaces SET payload=? WHERE owner=?').run(JSON.stringify(current.state),owner);}],
])test('Sites final transaction fence rejects '+name,async t=>{
 const f=await manualMultipleFixture(t),review=await quote(f);let afterChange;
 f.beforeBatch=()=>{f.beforeBatch=null;change(f);afterChange=f.stored();};
 const result=await f.call('/api/manual-allocations',approval(f,review));assert.equal(result.status,409,JSON.stringify(result));assert.deepEqual(f.stored(),afterChange);assert.equal(f.read().state.allocations.length,0);
});
test('Sites audit failure rolls back the whole state vector and receipt',async t=>{
 const f=await manualMultipleFixture(t),review=await quote(f);f.sqlite.exec("CREATE TRIGGER synthetic_manual_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='manual_multiple_allocation' BEGIN SELECT RAISE(ABORT,'Synthetic audit failure'); END");const before=f.stored();
 const result=await f.call('/api/manual-allocations',approval(f,review));assert.ok(result.status>=400);assert.deepEqual(f.stored(),before);
});
test('Sites concurrent intents for the same money produce one atomic vector',async t=>{
 const f=await manualMultipleFixture(t),review=await quote(f);
 const results=await Promise.all([f.call('/api/manual-allocations',approval(f,review,'synthetic-concurrent-001')),f.call('/api/manual-allocations',approval(f,review,'synthetic-concurrent-002'))]);
 assert.deepEqual(results.map(result=>result.status).sort(),[201,409]);assert.equal(f.read().state.allocations.length,2);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='manual_multiple_allocation'").get().n,1);
});
test('Sites lost batch reply is recovered from its durable receipt',async t=>{
 const f=await manualMultipleFixture(t),review=await quote(f);f.afterBatch=()=>{f.afterBatch=null;throw Error('Synthetic lost batch reply');};
 const result=await f.call('/api/manual-allocations',approval(f,review));assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.recovered,true);assert.equal(f.read().state.allocations.length,2);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='manual_multiple_allocation'").get().n,1);
});
test('Sites unavailable receipt after a lost reply preserves outcome unknown and supports exact retry',async t=>{
 const f=await manualMultipleFixture(t),review=await quote(f),body=approval(f,review);f.afterBatch=()=>{f.afterBatch=null;f.receiptsUnavailable=true;throw Error('Synthetic lost batch reply');};
 const unknown=await f.call('/api/manual-allocations',body);assert.equal(unknown.status,503);assert.equal(f.read().state.allocations.length,2);
 f.receiptsUnavailable=false;const replay=await f.call('/api/manual-allocations',body);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(f.read().state.allocations.length,2);
});

for(const committed of [false,true])test(`Sites unclassified ${committed?'lost commit response':'failure before batch commit'} and temporarily absent receipt stays explicitly unknown`,async t=>{
 const f=await manualMultipleFixture(t),review=await quote(f),body=approval(f,review),hook=committed?'afterBatch':'beforeBatch';
 f[hook]=()=>{f[hook]=null;f.receiptsAbsent=true;throw Error('Network connection lost');};
 const result=await f.call('/api/manual-allocations',body);assert.equal(result.status,503,JSON.stringify(result));assert.equal(result.body.code,'MANUAL_OUTCOME_UNKNOWN');assert.equal(f.read().state.allocations.length,committed?2:0);
 const hidden=await f.call('/api/manual-allocations?requestId='+body.requestId);assert.equal(hidden.status,404);
 f.receiptsAbsent=false;const retry=await f.call('/api/manual-allocations',body);assert.equal(retry.status,committed?200:201);assert.equal(retry.body.replayed,committed);assert.equal(f.read().state.allocations.length,2);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='manual_multiple_allocation'").get().n,1);
});

for(const adjust of [-100,101])test(`Sites explicit ${adjust<0?'underpayment':'overpayment'} persists exact invoice and bank remainders`,async t=>{
 const f=await manualMultipleFixture(t,{adjust});if(adjust<0)f.request.allocations[1].amountMinor+=adjust;
 const review=await quote(f),saved=await f.call('/api/manual-allocations',approval(f,review));assert.equal(saved.status,201,JSON.stringify(saved));
 assert.equal(saved.body.receipt.paymentRemainingMinor,Math.max(0,adjust));assert.equal(saved.body.receipt.allocations.reduce((sum,row)=>sum+row.invoiceRemainingAfterMinor,0),Math.max(0,-adjust));
 assert.equal(f.read().state.allocations.reduce((sum,row)=>sum+row.amount,0),73100+Math.min(0,adjust));
});
test('Sites identical concurrent confirmations return one durable receipt',async t=>{
 const f=await manualMultipleFixture(t),review=await quote(f),body=approval(f,review);
 const results=await Promise.all([f.call('/api/manual-allocations',body),f.call('/api/manual-allocations',body)]);
 assert.deepEqual(results.map(result=>result.status).sort(),[200,201]);assert.deepEqual(results[0].body.receipt,results[1].body.receipt);assert.equal(f.read().state.allocations.length,2);
});

test('actual Sites route responses pass through the client with integer revision through approval and historical receipt',async t=>{
 const f=await manualMultipleFixture(t),values=new Map(),calls=[],memory={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const request=async(path,body)=>{calls.push({path,method:body?'POST':'GET'});const result=await f.call(path,body);if(result.status>=400)throw Object.assign(Error(result.body.error),{status:result.status,code:result.body.code});return result.body;};
 const options={transactionId:f.request.transactionId,scopeKey:'synthetic-real-sites-route',storage:memory,request,newRequestId:()=> 'synthetic-real-sites-client'},client=createManualMultipleClient(options);
 await client.load();assert.equal(client.snapshot.phase,'editing',client.snapshot.error);const revision=client.snapshot.discovery.revision;assert.equal(typeof revision,'number');assert.equal(Number.isSafeInteger(revision),true);
 await client.review(f.request);assert.equal(client.snapshot.phase,'review',client.snapshot.error);assert.strictEqual(client.snapshot.quote.revision,revision);
 await client.confirm(false);assert.equal(f.read().state.allocations.length,0);await client.confirm(true);assert.equal(client.snapshot.phase,'saved',client.snapshot.error);const saved=client.snapshot.receipt;assert.strictEqual(saved.revisionBefore,revision);assert.equal(saved.allocations.length,2);assert.equal(f.read().state.allocations.length,2);assert.equal(values.size,0);
 f.sqlite.prepare("UPDATE bank_connections SET status='disconnected'").run();const before=f.stored(),history=createManualMultipleClient(options),historyStart=calls.length;
 await history.readReceipt(saved.requestId);assert.equal(history.snapshot.phase,'saved',history.snapshot.error);assert.deepEqual(history.snapshot.receipt,saved);assert.deepEqual(f.stored(),before);assert.deepEqual(calls.slice(historyStart),[{path:'/api/manual-allocations?requestId='+saved.requestId,method:'GET'}]);
});
