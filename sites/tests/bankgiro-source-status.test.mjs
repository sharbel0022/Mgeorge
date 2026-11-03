import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

async function component(react){
 let source;
 try{source=readFileSync(new URL('../components/bankgiro-source-status.tsx',import.meta.url),'utf8');}
 catch(error){if(error.code==='ENOENT')assert.fail('Bankgiro source status must expose disabled, waiting and report outcomes');throw error;}
 let code=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 for(const name of ['react','react/jsx-runtime'])for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(name==='react'&&react?react:import.meta.resolve(name)));
 return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}
const emptyCounts=()=>({PENDING:0,RETRY:0,IMPORTED:0,REVIEW:0,DUPLICATE:0,BLOCKED:0});
const status=changes=>({enabled:true,sourceId:'synthetic-test-source',mode:'production',state:'IDLE',reason:null,cursor:null,nextPollAt:null,missingReportIds:[],counts:emptyCounts(),jobs:[],lastError:null,...changes});
const render=async props=>renderToStaticMarkup(React.createElement((await component()).BankgiroSourceView,props));
const value=(html,label)=>{const match=html.match(new RegExp('<dt>'+label+'</dt><dd>([\\s\\S]*?)</dd>'));assert.ok(match,`Missing status field: ${label}`);return match[1];};
const verified=()=>({status:'VERIFIED',verifiedAt:'2026-11-03T08:00:00Z',validUntil:'2099-11-03T08:00:00Z'});

async function runtime(t,initial){
 const key='__bankgiro_source_'+crypto.randomUUID().replaceAll('-','');
 const f={slots:[],effects:[],cursor:0,closed:false,requests:[],body:initial,httpStatus:200,listeners:{}};globalThis[key]=f;
 f.state=initial=>{const index=f.cursor++;f.slots[index]??={value:initial};return[f.slots[index].value,value=>{f.slots[index].value=value;queueMicrotask(()=>{if(!f.closed)f.render();});}];};
 f.effect=(callback,deps)=>{const index=f.cursor++;if(!f.slots[index]||!deps.every((value,i)=>Object.is(value,f.slots[index].deps[i])))f.effects.push(()=>{f.slots[index]?.cleanup?.();f.slots[index]={deps,cleanup:callback()};});};
 const react='data:text/javascript;base64,'+Buffer.from(`const f=globalThis[${JSON.stringify(key)}];export const useState=(...args)=>f.state(...args),useEffect=(...args)=>f.effect(...args);`).toString('base64');
 const Component=(await component(react)).default;
 const priorWindow=globalThis.window,priorDocument=globalThis.document;
 globalThis.window={addEventListener:(name,fn)=>{f.listeners[name]=fn;},removeEventListener:(name,fn)=>{if(f.listeners[name]===fn)delete f.listeners[name];}};
 globalThis.document={visibilityState:'visible'};
 t.mock.method(globalThis,'setInterval',(fn,delay)=>{f.poll=fn;assert.equal(delay,60_000);return 1;});
 t.mock.method(globalThis,'clearInterval',()=>{});
 t.mock.method(globalThis,'fetch',async(path,options)=>{f.requests.push({path,options});return Response.json(f.body,{status:f.httpStatus});});
 f.render=(demo=false)=>{f.cursor=0;f.tree=Component({demo});for(const effect of f.effects.splice(0))effect();};
 f.flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));return renderToStaticMarkup(f.tree);};
 t.after(()=>{f.closed=true;for(const slot of f.slots)slot?.cleanup?.();delete globalThis[key];if(priorWindow===undefined)delete globalThis.window;else globalThis.window=priorWindow;if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument;});
 f.render();return f;
}

test('runtime accepts legacy and additive receipts through read-only polling and clears stale data after failure',async t=>{
 const f=await runtime(t,status({}));
 assert.match(await f.flush(),/Inte verifierad/);
 f.body=status({authorization:verified(),lastSuccessAt:'2026-11-03T08:05:00Z',jobs:[{id:'a',reportId:'PREVIOUS_REPORT',status:'IMPORTED'}]});
 await f.listeners.focus();assert.match(await f.flush(),/PREVIOUS_REPORT/);
 f.httpStatus=503;f.poll();const html=await f.flush();
 assert.match(html,/kunde inte läsas/);assert.doesNotMatch(html,/PREVIOUS_REPORT|09:05|Behörighetskvitto/);
 assert.equal(f.requests.length,3);
 for(const request of f.requests){assert.equal(request.path,'/api/bankgiro/source/status');assert.equal(request.options.method??'GET','GET');assert.equal(request.options.cache,'no-store');assert.equal(request.options.credentials,'same-origin');}
});
test('runtime rejects malformed additive receipts instead of presenting an operational snapshot',async t=>{
 const f=await runtime(t,status({authorization:{status:'VERIFIED',verifiedAt:{private:'SECRET'},validUntil:'2099-11-03T08:00:00Z'}}));
 assert.match(await f.flush(),/kunde inte läsas/);
 assert.equal(f.requests.length,1);
});
test('switching runtime into demo hides earlier receipts and stops status polling',async t=>{
 const f=await runtime(t,status({authorization:verified(),jobs:[{id:'a',reportId:'PREVIOUS_REPORT',status:'IMPORTED'}]}));
 assert.match(await f.flush(),/PREVIOUS_REPORT/);
 f.render(true);const html=await f.flush();assert.match(html,/Demoläge/);assert.doesNotMatch(html,/PREVIOUS_REPORT/);
 assert.equal(f.listeners.focus,undefined);assert.equal(f.requests.length,1);assert.ok(f.requests[0].options.signal.aborted);
});

test('registered configuration does not imply verified authorization or a successful retrieval',async()=>{
 const html=await render({status:status({})});
 assert.match(html,/Automatisk Bankgirohämtning/);
 assert.match(value(html,'Rapportkälla'),/Registrerad/);
 assert.match(value(html,'Behörighet'),/Inte verifierad/);
 assert.match(value(html,'Senaste lyckade hämtning'),/Ingen bekräftad/);
 assert.match(value(html,'Senaste misslyckade hämtning'),/Ingen bekräftad/);
 assert.doesNotMatch(html,/redo för nästa|Behörighet<\/dt><dd>Verifierad|Ansluten/);
});
test('invalid configured registry placeholder is blocked without claiming a registered source',async()=>{
 const html=await render({status:status({enabled:false,sourceId:'bankgiro-configuration-blocked',state:'BLOCKED',reason:'AUTHORIZATION_BLOCKED',authorization:{status:'BLOCKED',verifiedAt:null,validUntil:null},lastError:'AUTHORIZATION_BLOCKED'})});
 assert.equal(value(html,'Rapportkälla'),'Ingen registrerad rapportkälla');
 assert.equal(value(html,'Behörighet'),'Spärrad');
 assert.match(html,/avstängd/);assert.doesNotMatch(html,/bankgiro-configuration-blocked/);
});
test('valid registered source remains registered when its authorization is blocked',async()=>{
 const html=await render({status:status({enabled:true,state:'BLOCKED',authorization:{status:'BLOCKED',verifiedAt:null,validUntil:null}})});
 assert.equal(value(html,'Rapportkälla'),'Registrerad');
 assert.equal(value(html,'Behörighet'),'Spärrad');
});
test('authorization receipts and successful and failed attempts keep distinct timestamps',async()=>{
 const html=await render({status:status({authorization:verified(),lastSuccessAt:'2026-11-03T08:05:00Z',lastFailureAt:'2026-11-03T09:10:00Z',lastFailureCode:'RATE_LIMITED',state:'BACKOFF',nextPollAt:'2026-11-03T09:15:00Z'})});
 assert.match(value(html,'Behörighet'),/^Verifierad/);
 assert.match(value(html,'Verifierad'),/09:00/);
 assert.match(value(html,'Giltig till'),/2099/);
 assert.match(value(html,'Senaste lyckade hämtning'),/09:05/);
 assert.match(value(html,'Senaste misslyckade hämtning'),/10:10/);
 assert.match(value(html,'Nästa möjliga hämtning'),/10:15/);
 assert.match(html,/Källan begränsar antalet hämtningar/);
});
for(const [authorization,expected]of [
 [{status:'UNVERIFIED',verifiedAt:null,validUntil:null},/Inte verifierad/],
 [{status:'BLOCKED',verifiedAt:null,validUntil:null},/Spärrad/],
 [{status:'EXPIRED',verifiedAt:null,validUntil:null},/Utgången/],
 [{...verified(),validUntil:'2000-01-01T00:00:00Z'},/Utgången/],
 [{...verified(),validUntil:null},/Inte verifierad/],
 [{...verified(),verifiedAt:'2099-01-01T00:00:00Z'},/Inte verifierad/],
 [{status:'UNKNOWN',verifiedAt:null,validUntil:null},/Inte verifierad/],
])test(`authorization ${authorization.status} with ${authorization.validUntil} cannot claim current readiness`,async()=>{
 const html=await render({status:status({authorization})});
 assert.match(value(html,'Behörighet'),expected);
 assert.doesNotMatch(html,/redo för nästa|Ansluten rapportkälla/);
});
test('pending and retry work are separate from imported, review, errors and duplicate counts',async()=>{
 const html=await render({status:status({counts:{PENDING:2,RETRY:3,IMPORTED:5,REVIEW:7,BLOCKED:11,DUPLICATE:13}})});
 for(const [label,count]of [['Väntar på inläsning',2],['Väntar på nytt försök',3],['Inlästa rapporter',5],['Behöver granskning',7],['Spärrade rapporter',11],['Redan inlästa',13]])assert.equal(value(html,label),String(count));
 assert.match(html,/inläst rapport.*underlaget.*sparats/i);
});
test('last source and per-report errors are safe labels rather than upstream error bodies',async()=>{
 const secret='https://private.example.test/account/123?token=SECRET';
 const html=await render({status:status({lastError:secret,lastFailureCode:secret,reason:secret,jobs:[{id:'a',reportId:'0000599',status:'RETRY',lastError:'TIMEOUT'},{id:'b',reportId:'0000600',status:'BLOCKED',lastError:secret}]})});
 assert.match(html,/Hämtningen tog för lång tid/);assert.match(html,/Orsaken kunde inte visas/);
 assert.doesNotMatch(html,/private\.example|account\/123|SECRET/);
});
test('source-reported gaps are explicit and an empty report list does not fabricate a gap',async()=>{
 const html=await render({status:status({missingReportIds:['one','two']})});
 assert.match(html,/Källan rapporterar 2 saknade rapporter/);
 assert.match(html,/bevisar inte att en betalning saknas/);
 assert.doesNotMatch(await render({status:status({})}),/saknade rapporter|betalning saknas/);
});
test('failed status refresh hides previous receipts and job details',async()=>{
 const html=await render({error:true,status:status({authorization:verified(),lastSuccessAt:'2026-11-03T08:05:00Z',jobs:[{id:'a',reportId:'OLD_PRIVATE_REPORT',status:'IMPORTED'}]})});
 assert.match(html,/kunde inte läsas/);assert.doesNotMatch(html,/OLD_PRIVATE_REPORT|09:05|Verifierad/);
});

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
