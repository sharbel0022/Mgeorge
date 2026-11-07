import test from 'node:test';
import assert from 'node:assert/strict';
import * as integration from '../sites/lib/openai-invoices/integration.js';
import {DatabaseSync} from 'node:sqlite';
import {createNodeAuditStore,createD1AuditStore} from '../sites/lib/openai-invoices/audit-store.js';
const owner='synthetic-owner';
const env=()=>({OPENAI_ENABLED:'true',OPENAI_MODEL:'gpt-6-luna',OPENAI_API_KEY:'synthetic-key',OPENAI_INVOICES_PRIVACY_APPROVED:'true',OPENAI_INVOICES_SECURITY_APPROVED:'true',OPENAI_INVOICES_COST_APPROVED:'true',OPENAI_INVOICES_APPROVAL_ID:'synthetic-approval',OPENAI_INVOICES_ALLOWED_OWNERS:JSON.stringify([owner]),OPENAI_INVOICES_COMPANY_ORGANIZATIONS:JSON.stringify({[owner]:'5560160680'})});
const contract=()=>({model:'synthetic-reviewed-model',approvalId:'review-synthetic-v1',reviewedOn:'2026-11-07',source:'https://developers.openai.com/api/docs/models/synthetic-reviewed-model',capabilities:{responses:true,structuredOutputs:true,imageInput:true,pdfInput:true,inputTokenCounting:true,reasoningEffort:'low'},limits:{maxInputTokens:32000,maxOutputTokens:2000},pricing:{inputMicroUsdPerMillionTokens:1000000,outputMicroUsdPerMillionTokens:4000000}});
test('environment model selection uses the shared profile and explicit disable wins over legacy enable',()=>{
 const p=integration.invoiceAiPolicy({...env(),OPENAI_INVOICES_PROFILE:'sol-v1'},owner);assert.equal(p.status,'enabled');assert.equal(p.model,'gpt-6-luna');assert.equal(p.monthlyBudgetMicroUsd,50000000);
 assert.equal(integration.invoiceAiPolicy({...env(),OPENAI_ENABLED:'false',OPENAI_INVOICES_ENABLED:'true'},owner).status,'disabled');
});
test('missing, malformed, unknown or unpriced settings block safely without loading originals',()=>{
 for(const patch of [{OPENAI_MODEL:''},{OPENAI_MODEL:'unknown-model'},{OPENAI_API_KEY:''},{OPENAI_ENABLED:'yes'},{OPENAI_TIMEOUT_MS:'45001'},{OPENAI_MAX_OUTPUT_TOKENS:'8193'},{OPENAI_DAILY_BUDGET_USD:'NaN'},{OPENAI_MONTHLY_BUDGET_USD:'0'},{OPENAI_MONTHLY_BUDGET_USD:'1',OPENAI_DAILY_BUDGET_USD:'2'},{OPENAI_FALLBACK_MODEL:'unpriced-model'}])assert.equal(integration.invoiceAiPolicy({...env(),...patch},owner).status,'blocked',JSON.stringify(patch));
});
test('reviewed custom model contract allows a new environment model without unknown prices',()=>{
 const custom=contract();const config={...env(),OPENAI_MODEL:custom.model,OPENAI_MODEL_CONTRACT:JSON.stringify(custom),OPENAI_MAX_OUTPUT_TOKENS:'1200',OPENAI_TIMEOUT_MS:'10000',OPENAI_DAILY_BUDGET_USD:'1.000001',OPENAI_MONTHLY_BUDGET_USD:'30'};
 const p=integration.invoiceAiPolicy(config,owner);assert.equal(p.status,'enabled');assert.equal(p.model,custom.model);assert.equal(p.profile.limits.maxOutputTokens,1200);assert.equal(p.profile.limits.timeoutMs,10000);assert.equal(p.dailyBudgetMicroUsd,1000001);
 for(const patch of [{pricing:{}},{limits:{maxInputTokens:128001,maxOutputTokens:2000}},{capabilities:{...custom.capabilities,pdfInput:false}},{approvalId:''},{model:'another-model'}])assert.equal(integration.invoiceAiPolicy({...config,OPENAI_MODEL_CONTRACT:JSON.stringify({...custom,...patch})},owner).status,'blocked');
});
test('public Node and Sites entries expose identical secret-free local configuration status',async()=>{
 const sites=await import('../sites/lib/openai-invoices/index.js').catch(()=>({}));const node=await import('../packages/ai/index.js').catch(()=>({}));assert.equal(typeof sites.invoiceAiConfigurationStatus,'function');assert.equal(sites.invoiceAiConfigurationStatus,node.invoiceAiConfigurationStatus);
 const status=node.invoiceAiConfigurationStatus(env());assert.equal(status.status,'configured');assert.equal(status.liveVerified,false);assert.equal(status.model,'gpt-6-luna');assert.ok(!JSON.stringify(status).includes('synthetic-key'));assert.equal(node.invoiceAiConfigurationStatus({}).status,'disabled');
});
for(const mode of ['node','d1'])test(mode+': monthly reservation survives restart and daily rollover, then resets at UTC month boundary',async t=>{
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('CREATE TABLE audit_events(id TEXT PRIMARY KEY,owner TEXT,revision INTEGER,action TEXT,details TEXT,detail TEXT,created_at TEXT)');
 let at='2026-11-07T23:59:59.000Z';const d1={prepare(query){let values=[];return{bind(...v){values=v;return this;},async first(){return sql.prepare(query).get(...values)||null;},async run(){return{meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}};}};
 const store=()=> (mode==='node'?createNodeAuditStore(sql,{owner,now:()=>new Date(at)}):createD1AuditStore(d1,{owner,now:()=>new Date(at)}));
 const input=n=>({key:String(n).padStart(64,'a'),sha256:'b'.repeat(64),documentId:'doc-'+n,profileVersion:'test',reservedMicroUsd:600,dailyBudgetMicroUsd:1000,monthlyBudgetMicroUsd:1000});
 assert.equal((await store().reserve(input(1))).status,'reserved');at='2026-11-08T00:00:00.000Z';assert.equal((await store().reserve(input(2))).status,'budget_exhausted');at='2026-12-01T00:00:00.000Z';assert.equal((await store().reserve(input(3))).status,'reserved');
});
