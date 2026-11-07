import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createNodeAuditStore,createD1AuditStore,enrichInvoiceForReview,getInvoiceAiProfile} from '../packages/ai/index.js';
import {INVOICE_AI_SCHEMA,INVOICE_AI_INSTRUCTIONS} from '../sites/lib/openai-invoices/schema.js';
const owner='synthetic-model-replay-owner',sha='a'.repeat(64);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const baseline=()=>({level:'yellow',issues:[],fields:{direction:{value:'supplier'},invoice_number:{value:null}},details:{line_items:[]}});
const contract=()=>({model:'synthetic-reviewed-model',approvalId:'synthetic-review-v1',reviewedOn:'2026-11-07',source:'https://developers.openai.com/api/docs/models/synthetic-reviewed-model',capabilities:{responses:true,structuredOutputs:true,imageInput:true,pdfInput:true,inputTokenCounting:true,reasoningEffort:'low'},limits:{maxInputTokens:32000,maxOutputTokens:2000},pricing:{inputMicroUsdPerMillionTokens:1000000,outputMicroUsdPerMillionTokens:4000000}});
const environment=c=>({OPENAI_ENABLED:'true',OPENAI_MODEL:c.model,OPENAI_MODEL_CONTRACT:JSON.stringify(c),OPENAI_API_KEY:'synthetic-key',OPENAI_MAX_OUTPUT_TOKENS:'1200',OPENAI_INVOICES_PRIVACY_APPROVED:'true',OPENAI_INVOICES_SECURITY_APPROVED:'true',OPENAI_INVOICES_COST_APPROVED:'true',OPENAI_INVOICES_APPROVAL_ID:'synthetic-approval',OPENAI_INVOICES_ALLOWED_OWNERS:JSON.stringify([owner]),OPENAI_INVOICES_COMPANY_ORGANIZATIONS:JSON.stringify({[owner]:'5560160680'})});
function fixture(t,mode){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('CREATE TABLE audit_events(id TEXT PRIMARY KEY,owner TEXT,revision INTEGER,action TEXT,details TEXT,detail TEXT,created_at TEXT)');
 const d1={prepare(query){let values=[];return{bind(...v){values=v;return this;},async first(){return sql.prepare(query).get(...values)||null;},async run(){return{meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}};}};
 return{sql,open:(scopeOwner=owner)=>mode==='node'?createNodeAuditStore(sql,{owner:scopeOwner}):createD1AuditStore(d1,{owner:scopeOwner})};
}
const reservation=(key,aliasKey)=>({key,aliasKey,documentId:'synthetic-doc',sha256:sha,profileVersion:'test',reservedMicroUsd:250000,dailyBudgetMicroUsd:2000000,monthlyBudgetMicroUsd:50000000});
for(const mode of ['node','d1']){
 for(const completed of [false,true])test(mode+': custom '+(completed?'receipt replays':'unknown charge stays reserved')+' across review, pricing and limit changes after reopening',async t=>{
  const f=fixture(t,mode),original=contract();let calls=0;
  const input={baseline:baseline(),owner,documentId:'synthetic-doc',sha256:sha,mime:'image/png',loadOriginal:async()=>({bytes:new Uint8Array([1,2]),pageCount:1}),adapter:async()=>{calls++;return completed?{status:'review',candidate:{},issues:[],model:original.model}:{status:'fallback',issues:['api_network_error'],costUnknown:true};}};
  const run=async c=>{const store=f.open();return enrichInvoiceForReview({...input,store:completed?store:{...store,record:async()=>false},environment:environment(c)});};
  const first=await run(original);assert.equal(completed?first.ai.status:first.ai.code,completed?'review':'AI_RECEIPT_NOT_SAVED');
  for(const patch of [{},{reviewedOn:'2026-11-08'},{approvalId:'synthetic-review-v2'},{source:'https://openai.com/api/pricing/'},{pricing:{inputMicroUsdPerMillionTokens:2000000,outputMicroUsdPerMillionTokens:8000000}},{limits:{maxInputTokens:16000,maxOutputTokens:1500}}]){
   const result=await run({...original,...patch});assert.equal(completed?result.ai.replayed:result.ai.code,completed?true:'AI_REQUEST_ALREADY_RESERVED',JSON.stringify(patch));
  }
  assert.equal(calls,1);assert.equal(f.sql.prepare("SELECT count(*) n FROM audit_events WHERE action='invoice.ai.reserved'").get().n,1);
 });
 for(const completed of [false,true])test(mode+': historical built-in '+(completed?'receipt':'uncertain reservation')+' remains protected by exact model',async t=>{
  const f=fixture(t,mode),profile=getInvoiceAiProfile('luna-v1'),key=hash(['invoice-ai-integration-2026-11-06.v1',INVOICE_AI_SCHEMA,INVOICE_AI_INSTRUCTIONS,profile,owner,sha,'image/png','5560160680','recipient']);
  await f.open().reserve(reservation(key));if(completed)await f.open().record(key,{status:'review',candidate:{},issues:[],model:profile.model});let calls=0;
  const result=await enrichInvoiceForReview({baseline:baseline(),owner,documentId:'new-job',sha256:sha,mime:'image/png',environment:environment({...contract(),model:profile.model}),store:f.open(),loadOriginal:async()=>({bytes:new Uint8Array([1,2]),pageCount:1}),adapter:async()=>{calls++;return{status:'fallback'};}});
  assert.equal(calls,0);assert.equal(completed?result.ai.replayed:result.ai.code,completed?true:'AI_REQUEST_ALREADY_RESERVED');
 });
 test(mode+': opposite model representations atomically share the same reservation and reopened receipt',async t=>{
  const f=fixture(t,mode),stable=hash('exact-model-stable'),historical=hash('historical-built-in-profile');
  const results=await Promise.all([f.open().reserve(reservation(stable,historical)),f.open().reserve(reservation(historical,stable))]);assert.deepEqual(results.map(r=>r.status).sort(),['existing','reserved']);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM audit_events WHERE action='invoice.ai.reserved'").get().n,1);
  const winner=[stable,historical][results.findIndex(result=>result.status==='reserved')],receipt={status:'review',model:'synthetic-exact-model'};
  assert.equal(await f.open().record(winner,receipt),true);assert.deepEqual(await f.open().load(winner),receipt);
 });
}
test('d1: alternate reservation lookup remains scoped to the authenticated owner',async t=>{
 const f=fixture(t,'d1'),foreignKey=hash('foreign-original-model'),ownKey=hash('own-original-model');
 assert.equal((await f.open('synthetic-other-owner').reserve(reservation(foreignKey))).status,'reserved');
 assert.equal((await f.open().reserve(reservation(ownKey,foreignKey))).status,'reserved');
 assert.equal(await f.open().load(foreignKey),null);
});
