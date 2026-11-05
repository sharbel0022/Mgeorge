import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as trigger from '../scripts/verify-cloud-ocr-trigger.mjs';
const {reviewedCloudOcrTrigger}=trigger;

const sha='a'.repeat(40),repository='example/invoices';
const valid=()=>({eventName:'workflow_run',ref:'refs/heads/main',sha,repository,event:{action:'completed',workflow_run:{name:'Payment control checks',event:'push',head_branch:'main',head_sha:sha,head_repository:{full_name:repository},conclusion:'success'}}});
test('OCR resumes after exactly the checked main commit from the same repository',()=>{assert.equal(reviewedCloudOcrTrigger(valid()).allowed,true);});
for(const [label,mutate]of [
 ['pull request',x=>{x.event.workflow_run.event='pull_request';}],
 ['fork',x=>{x.event.workflow_run.head_repository.full_name='attacker/invoices';}],
 ['feature branch',x=>{x.event.workflow_run.head_branch='feature/change';}],
 ['failed checks',x=>{x.event.workflow_run.conclusion='failure';}],
 ['unfinished checks',x=>{x.event.action='in_progress';}],
 ['different checked SHA',x=>{x.event.workflow_run.head_sha='b'.repeat(40);}],
 ['other workflow',x=>{x.event.workflow_run.name='Untrusted checks';}],
 ['untrusted current ref',x=>{x.ref='refs/pull/123/merge';}],
 ['missing repository',x=>{delete x.event.workflow_run.head_repository;}],
 ['invalid SHA',x=>{x.sha='main';}],
])test('OCR never releases the credential after '+label,()=>{const x=valid();mutate(x);assert.equal(reviewedCloudOcrTrigger(x).allowed,false);});
for(const eventName of ['schedule','workflow_dispatch'])test('the existing '+eventName+' path remains limited to main',()=>{
 const x={...valid(),eventName,event:{}};assert.equal(reviewedCloudOcrTrigger(x).allowed,true);
 x.ref='refs/heads/feature';assert.equal(reviewedCloudOcrTrigger(x).allowed,false);
});

const token='synthetic-read-only-github-token';
const base='https://api.github.com/repos/'+repository;
const currentRef=()=>({ref:'refs/heads/main',url:base+'/git/refs/heads/main',object:{type:'commit',sha,url:base+'/git/commits/'+sha}});
function apiResponse(body=currentRef(),{status=200,url=base+'/git/ref/heads/main',redirected=false}={}){
 const response=new Response(typeof body==='string'?body:JSON.stringify(body),{status});
 Object.defineProperties(response,{url:{value:url},redirected:{value:redirected}});return response;
}
const preflight=(input=valid(),options={})=>trigger.verifyCurrentCloudOcrTrigger(input,{token,fetchImpl:async()=>apiResponse(),...options});

test('the current-main preflight uses only the exact GitHub repository with a read token and no redirects',async()=>{
 let calls=0;
 const result=await preflight(valid(),{fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,base+'/git/ref/heads/main');assert.equal(options.method,'GET');
  assert.equal(options.headers.Authorization,'Bearer '+token);assert.equal(options.redirect,'error');
  assert.equal(options.cache,'no-store');assert.ok(options.signal instanceof AbortSignal);
  return apiResponse();
 }});
 assert.equal(calls,1);assert.equal(result.allowed,true);assert.equal(result.mainSha,sha);
 assert.equal(new Date(result.mainVerifiedAt).toISOString(),result.mainVerifiedAt);
 assert.equal(JSON.stringify(result).includes(token),false);
});

for(const eventName of ['workflow_run','schedule','workflow_dispatch']){
 test('a fresh '+eventName+' may use only the current exact main commit',async()=>{
  assert.equal((await preflight({...valid(),eventName})).allowed,true);
 });
 for(const phase of ['queued','rerun'])test(phase+' '+eventName+' A is denied after main advances to B',async()=>{
  const input={...valid(),eventName},ref=currentRef();ref.object.sha='b'.repeat(40);ref.object.url=base+'/git/commits/'+ref.object.sha;
  assert.equal((await preflight(input,{fetchImpl:async()=>apiResponse(ref)})).allowed,false);
 });
}

for(const [label,change]of [
 ['missing reference',ref=>{delete ref.ref;}],
 ['different branch',ref=>{ref.ref='refs/heads/feature';}],
 ['foreign repository reference',ref=>{ref.url=ref.url.replace(repository,'foreign/repository');}],
 ['foreign repository commit',ref=>{ref.object.url=ref.object.url.replace(repository,'foreign/repository');}],
 ['tag object',ref=>{ref.object.type='tag';}],
 ['missing commit',ref=>{delete ref.object;}],
 ['invalid commit SHA',ref=>{ref.object.sha='main';}],
])test('current-main preflight denies '+label,async()=>{
 const ref=currentRef();change(ref);assert.equal((await preflight(valid(),{fetchImpl:async()=>apiResponse(ref)})).allowed,false);
});
for(const [label,response]of [
 ['missing ref response',()=>apiResponse({}, {status:404})],
 ['provider failure',()=>apiResponse({}, {status:500})],
 ['redirect',()=>apiResponse({}, {status:302})],
 ['followed redirect',()=>apiResponse(currentRef(),{redirected:true})],
 ['foreign response URL',()=>apiResponse(currentRef(),{url:'https://api.github.com/repos/foreign/repository/git/ref/heads/main'})],
 ['invalid JSON',()=>apiResponse('{invalid')],
 ['array response',()=>apiResponse([currentRef()])],
 ['null response',()=>apiResponse(null)],
 ['oversized response',()=>apiResponse({...currentRef(),padding:'x'.repeat(65536)})],
])test('current-main preflight fails closed on '+label,async()=>{
 assert.equal((await preflight(valid(),{fetchImpl:async()=>response()})).allowed,false);
});

test('missing token and invalid trigger never make a GitHub request',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return apiResponse();};
 assert.equal((await preflight(valid(),{token:'',fetchImpl})).allowed,false);
 assert.equal((await preflight({...valid(),eventName:'pull_request'},{fetchImpl})).allowed,false);
 const fork=valid();fork.event.workflow_run.head_repository.full_name='foreign/repository';
 assert.equal((await preflight(fork,{fetchImpl})).allowed,false);assert.equal(calls,0);
});
test('network errors are denied without exposing the GitHub token or provider details',async()=>{
 const result=await preflight(valid(),{fetchImpl:async()=>{throw Error('private provider response '+token);}});
 assert.deepEqual(result,{allowed:false,reason:'UNVERIFIED_OCR_MAIN_REF'});
});
test('the main-reference read is bounded by an abortable timeout',async()=>{
 let aborted=false;
 const result=await preflight(valid(),{timeoutMs:10,fetchImpl:(_url,{signal})=>new Promise((resolve,reject)=>{
  signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true});
 })});
 assert.equal(aborted,true);assert.equal(result.allowed,false);
});

test('the workflow repeats current-main verification after dependencies immediately before exposing the OCR credential',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/sites-cloud-ocr.yml',import.meta.url),'utf8');
 const steps=workflow.split(/\n {6}- /).slice(1);
 const checks=steps.flatMap((step,index)=>step.includes('run: node scripts/verify-cloud-ocr-trigger.mjs')?[index]:[]);
 const install=steps.findIndex(step=>step.includes('run: npm ci --ignore-scripts'));
 const credential=steps.findIndex(step=>step.includes('MG_SITES_OCR_TOKEN:'));
 assert.equal(checks.length,2);assert.ok(checks[0]<install);assert.ok(checks[1]>install);assert.equal(checks[1]+1,credential);
 for(const index of checks){assert.ok(steps[index].includes('GITHUB_TOKEN: ${{ github.token }}'));assert.equal(steps[index].includes('MG_SITES_OCR_TOKEN'),false);}
 assert.match(workflow,/permissions:\s*\n  contents: read/);
 assert.equal(steps[credential].includes('GITHUB_TOKEN:'),false);
});
