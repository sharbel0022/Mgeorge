import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

async function component(){
 let source;
 try{source=readFileSync(new URL('../components/bankgiro-source-status.tsx',import.meta.url),'utf8');}
 catch(error){if(error.code==='ENOENT')assert.fail('Bankgiro source status must expose disabled, waiting and report outcomes');throw error;}
 let code=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 for(const name of ['react','react/jsx-runtime'])for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(import.meta.resolve(name)));
 return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}
const emptyCounts=()=>({PENDING:0,RETRY:0,IMPORTED:0,REVIEW:0,DUPLICATE:0,BLOCKED:0});
const status=changes=>({enabled:true,sourceId:'synthetic-test-source',mode:'production',state:'IDLE',reason:null,cursor:null,nextPollAt:null,missingReportIds:[],counts:emptyCounts(),jobs:[],lastError:null,...changes});
const render=async props=>renderToStaticMarkup(React.createElement((await component()).BankgiroSourceView,props));

test('unconfigured source is visibly disabled and never claims an automatic bank connection',async()=>{
 const html=await render({status:status({enabled:false,sourceId:null,state:'DISABLED'})});
 assert.match(html,/avstängd/i);assert.match(html,/rapportkälla.*verifieras/i);
 assert.doesNotMatch(html,/synkroniserad|alla betalningar.*kontrollerade/i);
 assert.match(html,/Excel.*reserv/i);
});
test('rate limit displays the next allowed attempt with review and blocked report outcomes',async()=>{
 const html=await render({status:status({state:'BACKOFF',nextPollAt:'2026-11-03T09:15:00.000Z',counts:{...emptyCounts(),REVIEW:2,BLOCKED:1},jobs:[{id:'job-1',reportId:'0000599',status:'REVIEW'},{id:'job-2',reportId:'0000600',status:'BLOCKED'}]})});
 assert.match(html,/10:15/);assert.match(html,/0000599/);assert.match(html,/0000600/);assert.match(html,/granskning/i);assert.match(html,/spärrad|blockerad/i);
 assert.doesNotMatch(html,/avstämd|betald/i);
});
test('explicit missing reports remain visible and empty discovery is not proof of no payments',async()=>{
 const html=await render({status:status({missingReportIds:['expected-report'],jobs:[]})});
 assert.match(html,/saknad|saknas/i);assert.match(html,/betalning.*saknas|betalningsfrånvaro/i);
 assert.doesNotMatch(html,/inga obetalda|alla betalningar.*kontrollerade/i);
});
test('status loading and status failure cannot appear as a successfully connected source',async()=>{
 assert.match(await render({status:null,loading:true}),/läser rapportstatus/i);
 const html=await render({status:null,error:true});assert.match(html,/kunde inte läsas/i);assert.doesNotMatch(html,/ansluten rapportkälla/i);
});
test('demo always hides a previous production source status',async()=>{
 const html=await render({demo:true,status:status({jobs:[{id:'private',reportId:'PRIVATE_REPORT',status:'IMPORTED'}]})});
 assert.match(html,/demoläge/i);assert.doesNotMatch(html,/PRIVATE_REPORT/);
});
