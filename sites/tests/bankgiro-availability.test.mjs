import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const target=new URL('../components/bankgiro-availability.tsx',import.meta.url);
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
function compiled(react=import.meta.resolve('react')){
 let source=ts.transpileModule(readFileSync(target,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const [name,url]of Object.entries({'react':react,'react/jsx-runtime':import.meta.resolve('react/jsx-runtime')}))for(const q of ['"',"'"])source=source.replaceAll(q+name+q,JSON.stringify(url));
 return data(source);
}
const ui=await import(compiled());
const status=(patch={})=>({enabled:true,sourceId:'synthetic-registered-source',mode:'production',state:'REVIEW',reason:null,nextPollAt:'2026-11-02T12:00:00.000Z',missingReportIds:[],counts:{PENDING:0,RETRY:0,IMPORTED:2,REVIEW:1,DUPLICATE:1,BLOCKED:0},jobs:[{id:'synthetic-job',reportId:'synthetic-report',status:'IMPORTED',attempts:1,nextAttemptAt:null,updatedAt:'2026-11-02T10:00:00.000Z'}],lastError:null,...patch});
const state={transactions:[{specification:true,ignored:false,bankFileProof:{documentId:'synthetic-document'}},{specification:true,ignored:false,bankFileProof:{documentId:'synthetic-document'}}]};
const render=props=>{assert.equal(typeof ui.BankgiroAvailabilityView,'function');return renderToStaticMarkup(React.createElement(ui.BankgiroAvailabilityView,{state,status:status(),loading:false,error:'',...props}));};

test('registered C3 source status replaces the static missing-source claim without inventing a download receipt',()=>{
 const html=render({});
 for(const text of ['synthetic-registered-source','Behöver granskas','Senaste lyckade bankrapporthämtning','Inte bekräftad','1 sparade rapportunderlag','3','2 nov. 2026'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/Ingen källa för automatisk rapporthämtning är bekräftad|10:00|11:00|Automatiskt hämtad|Verifierad rapportbehörighet/);
});

test('null source stays disabled and legacy saved reports remain separate from acquired originals',()=>{
 const html=render({status:status({enabled:false,sourceId:null,mode:null,state:'DISABLED',reason:'SOURCE_NOT_CONFIGURED',nextPollAt:null,jobs:[],counts:{PENDING:0,RETRY:0,IMPORTED:0,REVIEW:0,DUPLICATE:0,BLOCKED:0}})});
 assert.match(html,/Avstängd/);assert.match(html,/auktoriserad rapportkälla/);assert.match(html,/Importerade underlag bekräftar inte automatisk hämtning/);assert.match(html,/Inte bekräftad/);
});

test('malformed status fails validation before counts, dates or statuses can reach the renderer',()=>{
 assert.equal(typeof ui.validBankgiroAvailability,'function');assert.equal(ui.validBankgiroAvailability(status()),true);
 for(const value of [null,[],status({enabled:'true'}),status({sourceId:12}),status({state:'succeeded'}),status({nextPollAt:'not-a-date'}),status({counts:{}}),status({counts:{...status().counts,IMPORTED:-1}}),status({missingReportIds:[null]}),status({jobs:[null]}),status({jobs:[{...status().jobs[0],status:{toString:null}}]}),status({jobs:[{...status().jobs[0],attempts:1.2}]}),status({jobs:[{...status().jobs[0],updatedAt:'invalid'}]})])assert.equal(ui.validBankgiroAvailability(value),false,JSON.stringify(value));
});

test('error, loading and demo states do not display an old successful status',()=>{
 for(const props of [{error:'Rapportstatus kunde inte läsas.'},{loading:true},{demo:true}]){const html=render(props);assert.doesNotMatch(html,/synthetic-registered-source|Behöver granskas|Nästa möjliga hämtning/);}
 assert.match(render({error:'Rapportstatus kunde inte läsas.'}),/role="alert"/);assert.match(render({loading:true}),/aria-busy="true"/);assert.match(render({demo:true}),/Demodata/);
});

const flush=async()=>{for(let n=0;n<10;n++)await Promise.resolve();};
async function fixture(t,{demo=false}={}){
 const key='__bankgiro_availability_'+crypto.randomUUID().replaceAll('-',''),f={cursor:0,slots:[],effects:[],requests:[],demo};globalThis[key]=f;
 f.state=initial=>{const n=f.cursor++;f.slots[n]??={value:typeof initial==='function'?initial():initial};return [f.slots[n].value,value=>{f.slots[n].value=typeof value==='function'?value(f.slots[n].value):value;}];};
 f.effect=(fn,deps)=>{const n=f.cursor++,old=f.slots[n];if(!old?.deps||deps.some((value,i)=>!Object.is(value,old.deps[i])))f.effects.push(()=>{old?.cleanup?.();f.slots[n]={deps,cleanup:fn()};});};
 const react=data(`const f=globalThis[${JSON.stringify(key)}];export const useState=(...args)=>f.state(...args),useEffect=(...args)=>f.effect(...args);`),module=await import(compiled(react));
 assert.equal(typeof module.useBankgiroAvailability,'function');
 const originalFetch=globalThis.fetch,originalWindow=globalThis.window;f.browser=new EventTarget();globalThis.window=f.browser;globalThis.fetch=(url,options)=>new Promise(resolve=>f.requests.push({url,options,respond:(body,code=200)=>resolve({ok:code>=200&&code<300,status:code,json:async()=>body})}));
 f.render=()=>{f.cursor=0;f.result=module.useBankgiroAvailability(f.demo);for(const effect of f.effects.splice(0))effect();return f.result;};
 f.close=()=>{for(const slot of f.slots)slot.cleanup?.();};
 f.restore=()=>{if(f.restored)return;f.restored=true;f.close();globalThis.fetch=originalFetch;globalThis.window=originalWindow;delete globalThis[key];};t.after(f.restore);f.render();return f;
}

test('report status reads the C3 endpoint with GET and same-origin credentials only',async t=>{
 const f=await fixture(t);assert.equal(f.requests.length,1);const request=f.requests[0];assert.equal(request.url,'/api/bankgiro/source/status');assert.equal(request.options.method??'GET','GET');assert.equal(request.options.credentials,'same-origin');assert.equal(request.options.cache,'no-store');assert.equal(request.options.body,undefined);
 request.respond(status());await flush();f.render();assert.equal(f.result.status.sourceId,'synthetic-registered-source');assert.equal(f.result.loading,false);assert.equal(f.result.error,'');
});

test('demo creates no request and malformed success or missing endpoint stays visibly unavailable',async t=>{
 const demo=await fixture(t,{demo:true});assert.equal(demo.requests.length,0);demo.restore();
 const f=await fixture(t);f.requests[0].respond(status({jobs:[null]}));await flush();f.render();assert.equal(f.result.status,null);assert.ok(f.result.error);
 f.result.retry();f.render();assert.equal(f.requests.length,2);f.requests[1].respond({},404);await flush();f.render();assert.equal(f.result.status,null);assert.match(f.result.error,/inte tillgänglig/);
});

test('a newer retry cancels and ignores late responses from the previous read',async t=>{
 const f=await fixture(t);const first=f.requests[0];f.result.retry();f.render();const second=f.requests[1];assert.equal(first.options.signal.aborted,true);
 second.respond(status({sourceId:'current-source'}));await flush();f.render();first.respond(status({sourceId:'old-source'}));await flush();f.render();assert.equal(f.result.status.sourceId,'current-source');
 f.close();assert.equal(second.options.signal.aborted,true);
});

test('returning to the window refreshes the read and cleanup stops further refreshes',async t=>{
 const f=await fixture(t);f.requests[0].respond(status());await flush();f.render();f.browser.dispatchEvent(new Event('focus'));f.render();assert.equal(f.requests.length,2);assert.equal(f.requests[0].options.signal.aborted,true);f.close();f.browser.dispatchEvent(new Event('focus'));f.render();assert.equal(f.requests.length,2);
});
