import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createPaymentControl,CONTROL_STEPS} from '../src/payment-control.js';
import {buildPaymentOverview,paymentGroup,paymentTitle} from '../src/payment-overview.js';

const request='request_000000000001';
function fixture(overrides={},options={}){
  const db=new DatabaseSync(':memory:'),calls=[];
  const adapters=Object.fromEntries(CONTROL_STEPS.map(([key])=>[key,async()=>{calls.push(key);return {state:'done',count:0,note:'Verifierat i test'};}]));
  const control=createPaymentControl(db,{adapters:{...adapters,...overrides},summarize:()=>({counts:{review:0}}),...options});
  return {db,calls,control,close(){control.stop();db.close();}};
}
test('one click runs ordered existing adapters exactly once and records completion',async()=>{
  const f=fixture(),{job}=f.control.start('owner',request,()=>{});
  await f.control.wait(job.id);
  assert.deepEqual(f.calls,CONTROL_STEPS.map(([key])=>key));
  const done=f.control.get('owner',job.id);
  assert.equal(done.status,'complete');assert.ok(done.finished_at);assert.equal(done.steps.length,5);
  const replay=f.control.start('owner',request,()=>{});
  assert.equal(replay.reused,true);assert.equal(replay.job.id,job.id);assert.equal(f.calls.length,5);
  f.close();
});
test('double clicks and concurrent requests share one running job',async()=>{
  let release;const gate=new Promise(r=>release=r);const f=fixture({gmail:async()=>{await gate;return {state:'done'};}});
  const first=f.control.start('owner',request,()=>{});await Promise.resolve();
  const again=f.control.start('owner','request_000000000002',()=>{});
  assert.equal(again.job.id,first.job.id);assert.equal(again.reused,true);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM payment_control_runs').get().n,1);
  release();await f.control.wait(first.job.id);f.close();
});
test('manual control has a persisted cooldown across coordinator instances',async()=>{
  let now=100000;const f=fixture({}, {now:()=>now});
  const {job}=f.control.start('owner',request,()=>{});await f.control.wait(job.id);
  const restart=createPaymentControl(f.db,{adapters:{},summarize:()=>({}),now:()=>now});
  assert.equal(restart.start('owner','request_000000000002',()=>{}).job.id,job.id);
  now+=61000;restart.stop();f.close();
});
test('missing connections and provider rate limits produce partial not false success',async()=>{
  const f=fixture({gmail:async()=>({state:'blocked',note:'Gmail saknas'}),bank:async()=>{throw Object.assign(Error('secret provider payload'),{status:429,retryAfter:120});}});
  const {job}=f.control.start('owner',request,()=>{});await f.control.wait(job.id);
  const done=f.control.get('owner',job.id);assert.equal(done.status,'partial');
  assert.equal(done.steps[0].state,'blocked');assert.equal(done.steps[1].state,'waiting');assert.ok(done.steps[1].next_at);
  assert.equal(done.steps[4].state,'done');assert.doesNotMatch(JSON.stringify(done),/secret provider payload/);f.close();
});
test('provider failure keeps existing processing available and stores no raw errors',async()=>{
  const f=fixture({bank:async()=>{throw Error('Bearer SECRET 1234');}}),{job}=f.control.start('owner',request,()=>{});
  await f.control.wait(job.id);const done=f.control.get('owner',job.id);
  assert.equal(done.status,'partial');assert.equal(done.steps[1].state,'error');assert.equal(done.steps[4].state,'done');
  assert.doesNotMatch(JSON.stringify(done),/Bearer|SECRET/);f.close();
});
test('revoked admin session stops every remaining step',async()=>{
  let allowed=true;const f=fixture({gmail:async()=>{allowed=false;return {state:'done'};}});
  const {job}=f.control.start('owner',request,()=>{if(!allowed)throw Object.assign(Error('Denied'),{status:401});});
  await f.control.wait(job.id);const done=f.control.get('owner',job.id);
  assert.equal(done.status,'interrupted');assert.equal(done.steps[0].state,'interrupted');assert.deepEqual(f.calls,[]);f.close();
});
test('job IDs and status are scoped to the authenticated owner',async()=>{
  const f=fixture(),{job}=f.control.start('one',request,()=>{});await f.control.wait(job.id);
  assert.throws(()=>f.control.get('two',job.id),e=>e.status===404);
  assert.equal(f.control.latest('two'),null);assert.throws(()=>f.control.latest(''),e=>e.status===401);
  assert.throws(()=>f.control.start('','request_000000000002',()=>{}),e=>e.status===401);
  assert.throws(()=>f.control.start('one','short',()=>{}),e=>e.status===400);f.close();
});
test('expired leases are marked interrupted and a late worker cannot claim success',async()=>{
  let now=100000,release;const gate=new Promise(r=>release=r);
  const f=fixture({gmail:async()=>{await gate;return {state:'done'};}},{now:()=>now,leaseMs:90000});
  const {job}=f.control.start('owner',request,()=>{});await Promise.resolve();now+=90001;
  assert.equal(f.control.latest('owner').status,'interrupted');release();await f.control.wait(job.id);
  assert.equal(f.control.get('owner',job.id).status,'interrupted');assert.deepEqual(f.calls,[]);f.close();
});
test('step responses cannot silently add secrets or arbitrary state to a job',async()=>{
  const f=fixture({gmail:async()=>({state:'done',note:'OK',access_token:'SECRET',count:2,raw:{private:true}})});
  const {job}=f.control.start('owner',request,()=>{});await f.control.wait(job.id);
  const done=f.control.get('owner',job.id);assert.equal(done.steps[0].count,2);
  assert.doesNotMatch(JSON.stringify(done),/SECRET|access_token|private/);f.close();
});
const tx=(extra={})=>({id:'t1',amount_cents:10000,available_cents:10000,payer:'',description:'',status:'unmatched',...extra});
test('bank presentation separates wages, card refunds, customers and Bankgiro',()=>{
  assert.equal(paymentGroup(tx({amount_cents:-500000,description:'LÖN'})),'other');
  assert.equal(paymentGroup(tx({amount_cents:40538,description:'ALIEXPRESS Kortköp/uttag'})),'other');
  assert.equal(paymentGroup(tx({is_aggregate:true})),'bankgiro');
  assert.equal(paymentGroup(tx({payer:'Test Bistro AB'})),'incoming');
  assert.equal(paymentGroup(tx({available_cents:0,status:'matched'})),'matched');
  assert.equal(paymentGroup(tx({excluded:true})),'excluded');
  assert.equal(paymentTitle(tx({amount_cents:-10000,description:'Kortköp butik'})),'Kortköp butik');
  assert.doesNotMatch(paymentTitle(tx({amount_cents:-10000})),/Bankgiro/);
});
test('one bank payment creates one queue item even with many candidate invoices',()=>{
  const result=buildPaymentOverview({transactions:[tx()],suggestions:[{transaction_id:'t1',invoice_id:'a'},{transaction_id:'t1',invoice_id:'b'}]});
  assert.equal(result.counts.payments,1);assert.equal(result.queue.length,1);assert.match(result.queue[0].reason,/2 fakturor/);
});
test('unreconciled amounts are not presented as proven unpaid or counted twice',()=>{
  const invoices=[{id:'a',direction:'customer',kind:'invoice',party:'Test',invoice_number:'01',total_cents:312500,paid_cents:0,remaining_cents:312500,status:'unreconciled'},
    {id:'b',direction:'customer',kind:'invoice',party:'Test',invoice_number:'02',total_cents:312500,paid_cents:250000,remaining_cents:62500,status:'partial'},
    {id:'c',direction:'customer',kind:'credit',remaining_cents:10000,status:'unreconciled'}];
  const result=buildPaymentOverview({invoices});assert.equal(result.totals.remaining_cents,375000);assert.equal(result.totals.unreconciled_cents,312500);
  assert.equal(result.totals.partial_remaining_cents,62500);assert.equal(result.totals.partial_count,1);
  assert.match(result.queue[0].reason,/inte samma sak/);
});
test('unknown mail delivery is first in review; sent and old stale messages do not clutter the queue',()=>{
  const result=buildPaymentOverview({messages:[{id:'x',status:'unknown',invoice_id:'a'}, {id:'y',status:'sent'}, {id:'z',status:'stale'}],documents:[{id:'doc',status:'needs_review'}],transactions:[tx({amount_cents:-10000}),tx({id:'aggregate',is_aggregate:true})]});
  assert.equal(result.queue[0].type,'message');assert.equal(result.queue[0].blocked,true);assert.equal(result.counts.messages,1);
  assert.equal(result.counts.other,1);assert.equal(result.counts.specifications,1);assert.equal(result.counts.review,3);
});
