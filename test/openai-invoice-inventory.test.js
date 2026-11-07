import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectOpenAiProject} from '../scripts/openai-invoices-inventory.mjs';
const now=new Date('2026-11-06T12:00:00Z');
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
test('inventory performs no network work without an explicit flag or usable key',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw Error('unexpected');};
  const disabled=await inspectOpenAiProject({apiKey:'synthetic-key',fetchImpl,now});
  const missing=await inspectOpenAiProject({allowNetwork:true,fetchImpl,now});
  assert.equal(calls,0);assert.equal(disabled.models.reason,'NETWORK_DISABLED');assert.equal(missing.models.reason,'API_KEY_MISSING');
  assert.equal(missing.models.lunaAvailable,null);assert.equal(missing.prepaidCredits.amount,null);
});
test('inventory reports only observed model IDs and no credential/provider metadata',async()=>{
  const report=await inspectOpenAiProject({apiKey:'synthetic-private-key',allowNetwork:true,project:'proj_synthetic',now,fetchImpl:async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/models');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    return json({object:'list',data:[{id:'gpt-6-luna',owned_by:'PRIVATE_OWNER'},{id:'gpt-6-luna'},{id:'another-model'}]});
  }});
  assert.deepEqual(report.models.ids,['another-model','gpt-6-luna']);assert.equal(report.models.lunaAvailable,true);assert.equal(report.models.solAvailable,false);
  assert.doesNotMatch(JSON.stringify(report),/synthetic-private-key|PRIVATE_OWNER/);assert.equal(report.providerBudget.amount,null);
});
test('unavailable API does not imply zero credit or an invalid documented model',async()=>{
  const report=await inspectOpenAiProject({apiKey:'synthetic',allowNetwork:true,now,fetchImpl:async()=>new Response('SECRET_PROVIDER_DETAIL',{status:401})});
  assert.equal(report.models.status,'NOT_VERIFIED');assert.equal(report.models.ids,null);assert.equal(report.models.lunaAvailable,null);
  assert.doesNotMatch(JSON.stringify(report),/SECRET_PROVIDER_DETAIL/);
});
test('billing probe requires explicit project scope and separate admin credentials',async()=>{
  let calls=0;
  const report=await inspectOpenAiProject({allowNetwork:true,includeCosts:true,adminKey:'synthetic-admin',now,fetchImpl:async()=>{calls++;}});
  assert.equal(report.usageCosts.reason,'PROJECT_SCOPE_REQUIRED');assert.equal(calls,0);
});
test('historical scoped cost totals remain distinct from credits and budgets',async()=>{
  const report=await inspectOpenAiProject({allowNetwork:true,includeCosts:true,project:'proj_synthetic',adminKey:'synthetic-admin',now,fetchImpl:async(url,options)=>{
    const parsed=new URL(url);assert.equal(parsed.pathname,'/v1/organization/costs');assert.equal(parsed.searchParams.get('project_ids'),'proj_synthetic');assert.equal(options.method,'GET');
    return json({object:'page',has_more:false,next_page:null,data:[{start_time:1793404800,end_time:1793491200,results:[{object:'organization.costs.result',amount:{currency:'usd',value:1.25}}]}]});
  }});
  assert.equal(report.usageCosts.status,'VERIFIED_USAGE_COSTS');assert.equal(report.usageCosts.amountUsd,1.25);
  assert.equal(report.prepaidCredits.status,'NOT_VERIFIED');assert.equal(report.providerBudget.status,'NOT_VERIFIED');
});
test('incomplete or malformed cost responses are never reported as a full measured total',async()=>{
  for(const data of [{object:'page',has_more:true,data:[]},{object:'page',has_more:false,data:[{start_time:0,end_time:1,results:[{object:'organization.costs.result',amount:{currency:'eur',value:1}}]}]}]){
    const report=await inspectOpenAiProject({allowNetwork:true,includeCosts:true,project:'proj_synthetic',adminKey:'synthetic',now,fetchImpl:async()=>json(data)});
    assert.equal(report.usageCosts.status,'NOT_VERIFIED');assert.equal(report.usageCosts.amountUsd,null);
  }
});
