import test from 'node:test';
import assert from 'node:assert/strict';
import {balance,economicTransactions} from '../lib/domain.ts';
import {createBankgiroIngest} from '../lib/bankgiro-ingest.js';
import {publicBankgiroStatus} from '../lib/bankgiro-source.js';
import {createBankgiroIngestStore} from '../lib/bankgiro-ingest-store.js';
import {joinedFixture,joinedReport} from './helpers/seven-agent-joined-fixture.mjs';

const children=f=>f.read().state.transactions.filter(row=>row.specification);
const selected=async(f,id)=>(await f.preview(id)).decisions.find(row=>row.transactionId===id);
function conserved(f,initial){
 const state=f.read().state;
 assert.equal(economicTransactions(state).reduce((sum,row)=>sum+row.amount,0),62500);
 assert.deepEqual(state.allocations,[]);
 assert.deepEqual(state.invoices,initial.state.invoices);
 for(const invoice of state.invoices)assert.equal(balance(state,invoice),balance(initial.state,initial.state.invoices.find(row=>row.id===invoice.id)));
}

test('joined multipayer report preserves individual references and names while counting only the declared aggregate',async t=>{
 const f=await joinedFixture(t,{payments:[
  {amount:'300.00',payer:'Synthetic customer AB',reference:'0599',id:'SYNTHETIC-CHILD-1'},
  {amount:'325.00',payer:'Synthetic second payer AB',reference:'599',id:'SYNTHETIC-CHILD-2'},
 ]}),initial=f.read();
 const result=await f.worker().run(f.owner),rows=children(f);
 assert.equal(result.jobs[0].paymentCount,2);assert.equal(rows.length,2);
 assert.deepEqual(rows.map(row=>row.amount).sort((a,b)=>a-b),[30000,32500]);
 assert.deepEqual(new Set(rows.map(row=>row.payerReference)),new Set(['0599','599']));
 assert.deepEqual(new Set(rows.map(row=>row.party)),new Set(['Synthetic customer AB','Synthetic second payer AB']));
 assert.ok(rows.every(row=>row.parentId===initial.state.transactions[0].id));
 const first=rows.find(row=>row.payerReference==='0599'),decision=await selected(f,first.id);
 assert.equal(decision.status,'REVIEW');assert.ok(decision.reasonCodes.includes('PARTIAL_PAYMENT_REQUIRES_REVIEW'));
 const html=f.render();assert.match(html,/Synthetic second payer AB/);assert.match(html,/0599/);assert.match(html,/599/);
 conserved(f,initial);
 const saved=f.read();await f.worker().run(f.owner);assert.deepEqual(f.read(),saved);
});

test('joined missing bank payer stays absent after intake, proposal and presentation',async t=>{
 const f=await joinedFixture(t,{payments:[{amount:'625.00',payer:'',reference:'0599',id:'SYNTHETIC-NO-PAYER'}]}),initial=f.read();
 await f.worker().run(f.owner);const row=children(f)[0],decision=await selected(f,row.id),view=f.presentation.bankPaymentView(f.read().state,row);
 assert.equal(row.party,'');assert.equal(view.fieldSources.payer.value,'');assert.equal(view.payerKnown,false);assert.equal(view.payer,'Betalare okänd');assert.notEqual(decision.status,'VERIFIED');
 assert.equal(view.verified,false);assert.equal(view.reference.value,'0599');assert.equal(view.reference.ocr,'');
 conserved(f,initial);
});

for(const [name,invoiceTotal,reason]of[
 ['partial',100000,'PARTIAL_PAYMENT_REQUIRES_REVIEW'],
 ['excess',50000,'OVERPAYMENT_REQUIRES_REVIEW'],
])test('joined '+name+' payment is retained but never books an invoice',async t=>{
 const f=await joinedFixture(t,{invoiceTotal}),initial=f.read();await f.worker().run(f.owner);
 const row=children(f)[0],decision=await selected(f,row.id);
 assert.equal(decision.status,'REVIEW');assert.ok(decision.reasonCodes.includes(reason),JSON.stringify(decision.reasonCodes));
 assert.equal(row.amount,62500);conserved(f,initial);
});

test('joined same invoice in another report preserves distinct payment identity without inventing another economic deposit',async t=>{
 const f=await joinedFixture(t),initial=f.read();await f.worker().run(f.owner);
 const second=joinedReport({reportId:'SYNTHETIC-SECOND-DELIVERY',depositId:'SYNTHETIC-OTHER-DEPOSIT',payments:[{amount:'625.00',payer:'Synthetic customer AB',reference:'0599',id:'SYNTHETIC-OTHER-PAYMENT'}]});
 f.source.reports.push(second);const status=await f.worker().run(f.owner),rows=children(f);
 assert.equal(rows.length,2);assert.equal(new Set(rows.map(row=>row.bankReference)).size,2);
 assert.ok(rows.every(row=>row.payerReference==='0599'));assert.equal(status.counts.REVIEW,1);
 assert.ok(rows.some(row=>row.specificationStatus==='review'));conserved(f,initial);
});

test('joined durable429 survives worker restart and resumes retained intake without allocations',async t=>{
 const f=await joinedFixture(t),initial=f.read();let at=Date.now(),failed=false;
 const fetch=f.source.fetchReport.bind(f.source);f.source.fetchReport=async input=>{
  if(!failed){failed=true;f.source.calls.push('fetch429');throw Object.assign(Error('sensitive provider body must not escape'),{status:429,retryAfter:120});}
  return fetch(input);
 };
 const worker=()=>createBankgiroIngest({source:f.source,store:createBankgiroIngestStore(f.database,{now:()=>at}),sink:f.sink,now:()=>at,allowSynthetic:true});
 const held=await worker().run(f.owner);assert.equal(held.counts.RETRY,1);assert.equal(held.lastError,'RATE_LIMITED');
 assert.ok(Date.parse(held.nextPollAt)>=at+120000);assert.equal(children(f).length,0);
 const calls=f.source.calls.length;await worker().run(f.owner);assert.equal(f.source.calls.length,calls,'restart respects the persisted embargo');
 at+=120001;const done=await worker().run(f.owner);assert.equal(done.counts.IMPORTED,1);assert.equal(children(f).length,1);
 conserved(f,initial);const saved=f.read();await worker().run(f.owner);assert.deepEqual(f.read(),saved);
});

test('normalized HTTPS source joins real queue original parser preview and payment view without allocations',async t=>{
 const f=await joinedFixture(t),initial=f.read(),original=f.report,at=Date.now(),iso=offset=>new Date(at+offset).toISOString();
 const {resolveBankgiroSource}=await import('../lib/bankgiro-source-registry.js');
 const registration={id:'SYNTHETIC-HTTPS-SOURCE',owner:f.owner,companyId:'synthetic-company',bankgiro:'0599',scopeId:'synthetic-scope',generation:'synthetic-generation',mode:'production',enabled:true,transport:'https-v1',baseUrl:'https://reports.example.com/feed',tokenSecret:'SYNTHETIC_REPORT_TOKEN',profileId:'synthetic-camt054-profile',allowedFormats:['xml'],intervalMinutes:15,entitlement:{status:'VERIFIED',origin:'provider_authorization',evidenceId:'synthetic-contract',checkedAt:iso(-1000),validUntil:iso(3600000),capabilities:['bankgiro_reports:read']}};
 const receipt={status:'VERIFIED',owner:f.owner,sourceId:registration.id,companyId:registration.companyId,bankgiro:registration.bankgiro,scopeId:registration.scopeId,generation:registration.generation,profileId:registration.profileId,evidenceId:'synthetic-authenticated-delivery-proof',checkedAt:iso(-1000),validUntil:iso(300000),origin:'provider_authorization',capabilities:['bankgiro_reports:read']};
 const calls=[];const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 f.source=await resolveBankgiroSource(f.owner,{configuration:{version:1,revision:1,registrations:[registration]},secrets:{SYNTHETIC_REPORT_TOKEN:'synthetic-token'},fetchImpl:async(input,init)=>{
  const url=new URL(input);assert.equal(url.origin,'https://reports.example.com');assert.equal(init.headers.Authorization,'Bearer synthetic-token');assert.equal(init.redirect,'manual');calls.push(url.pathname);
  if(url.pathname==='/feed/v1/authorization')return json(receipt);
  if(url.pathname==='/feed/v1/reports'){assert.equal(url.searchParams.get('limit'),'50');return json({reports:[{reportId:original.reportId,filename:original.filename,sha256:original.sha256,byteLength:original.bytes.length}],nextCursor:'synthetic-complete'});}
  assert.equal(url.pathname,'/feed/v1/reports/'+original.reportId+'/content');return new Response(original.bytes,{headers:{'Content-Length':String(original.bytes.length)}});
 }});
 const result=await f.worker().run(f.owner);
 assert.equal(result.counts.IMPORTED,1,JSON.stringify(result));assert.equal(result.authorization.status,'VERIFIED');assert.ok(result.lastSuccessAt);
 const sourceHtml=f.renderSourceStatus(publicBankgiroStatus(result));assert.match(sourceHtml,/<dt>Behörighet<\/dt><dd>Verifierad<\/dd>/);assert.match(sourceHtml,/<dt>Inlästa rapporter<\/dt><dd>1<\/dd>/);assert.doesNotMatch(sourceHtml,/synthetic-token|reports\.example\.com|synthetic-contract/);
 const row=children(f)[0],view=f.presentation.bankPaymentView(f.read().state,row),proposal=await selected(f,row.id);
 assert.deepEqual(f.objects.get(f.owner+'/'+row.bankFileProof.documentId),original.bytes);
 assert.equal(row.party,'Synthetic customer AB');assert.equal(view.reference.value,'0599');assert.equal(view.reference.ocr,'');
 assert.equal(proposal.status,'VERIFIED',JSON.stringify(proposal.reasonCodes));assert.equal(view.verified,false);assert.match(f.render(),/Bank-OCR saknas/);conserved(f,initial);
 const saved=f.read(),callCount=calls.length;await f.worker().run(f.owner);assert.equal(calls.length,callCount,'configured idle polling never repeats a successful download early');assert.deepEqual(f.read(),saved);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM audit_events WHERE owner=?').get(f.owner).n,1);
});
