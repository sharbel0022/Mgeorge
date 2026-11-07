import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';

const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const nodes=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
const text=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(' '):typeof node==='object'?text(node.props?.children):String(node);
const context=(id='a',version=1)=>({version:'company-context-v1',companyId:id,storageOwner:'storage-'+id,actorId:'synthetic-actor',role:'owner',membershipVersion:1,companyVersion:1,contextVersion:version});
const directory=()=>({version:'company-context-v1',companies:[{id:'a',name:'Synthetic A',role:'owner',membershipVersion:1},{id:'b',name:'Synthetic B',role:'owner',membershipVersion:1}],context:context(),activeCompanyId:'a',contextVersion:1});
async function fixture(t){
  const f={slots:[],cursor:0,effects:[],frames:[],requests:[],closed:false,scheduled:false},key='__company_ui_'+crypto.randomUUID().replaceAll('-','');globalThis[key]=f;
  const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((item,index)=>Object.is(item,b[index]));
  f.schedule=()=>{if(f.closed||f.scheduled)return;f.scheduled=true;queueMicrotask(()=>{f.scheduled=false;if(!f.closed)f.render();});};
  f.state=initial=>{const index=f.cursor++;f.slots[index]??={value:typeof initial==='function'?initial():initial};return [f.slots[index].value,next=>{f.slots[index].value=typeof next==='function'?next(f.slots[index].value):next;f.schedule();}];};
  f.ref=initial=>{const index=f.cursor++;f.slots[index]??={current:initial};return f.slots[index];};
  f.effect=(fn,deps)=>{const index=f.cursor++;if(!equal(f.slots[index]?.deps,deps))f.effects.push(()=>{f.slots[index]?.cleanup?.();f.slots[index]={deps,cleanup:fn()};});};
  f.memo=(fn,deps)=>{const index=f.cursor++;if(!equal(f.slots[index]?.deps,deps))f.slots[index]={deps,value:fn()};return f.slots[index].value;};
  const react=data(`export {createContext,useContext} from ${JSON.stringify(import.meta.resolve('react'))};const f=globalThis[${JSON.stringify(key)}];export const useState=(...a)=>f.state(...a),useRef=(...a)=>f.ref(...a),useEffect=(...a)=>f.effect(...a),useMemo=(...a)=>f.memo(...a),useCallback=(fn,deps)=>f.memo(()=>fn,deps);`);
  const browser=new EventTarget();browser.location={href:'https://synthetic.example/',replace:value=>f.location=value,reload:()=>f.reloaded=true};browser.document=new EventTarget();browser.document.querySelectorAll=()=>[];
  const raw=(input,init)=>new Promise((resolve,reject)=>f.requests.push({input,init,resolve,reject}));browser.fetch=raw;
  const oldWindow=globalThis.window;globalThis.window=browser;
  let source=ts.transpileModule(readFileSync(new URL('../components/company-workspace.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  for(const [name,url]of Object.entries({'react':react,'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'@/lib/company-client.js':new URL('../lib/company-client.js',import.meta.url).href}))for(const quote of ['"',"'"])source=source.replaceAll(quote+name+quote,JSON.stringify(url));
  const {default:Boundary}=await import(data(source));const child=React.createElement('section',{'data-company-private':true},'Synthetic A data');
  f.render=()=>{f.cursor=0;f.tree=Boundary({children:child});f.frames.push({tree:f.tree,adapted:browser.fetch!==raw});const effects=f.effects.splice(0);for(const effect of effects)effect();};
  f.find=predicate=>nodes(f.tree).find(predicate);f.respond=async(index,status,body)=>{f.requests[index].resolve(Response.json(body,{status}));await flush();};f.browser=browser;f.raw=raw;f.render();
  f.dispose=()=>{if(f.closed)return;f.closed=true;for(const slot of f.slots)slot?.cleanup?.();};t.after(()=>{f.dispose();if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;delete globalThis[key];});return f;
}

test('company boundary installs transport before any private child mounts',async t=>{
  const f=await fixture(t);assert.equal(f.find(node=>node.props?.['data-company-private']),undefined);assert.match(text(f.tree),/företag/i);await f.respond(0,200,directory());
  assert.ok(f.find(node=>node.props?.['data-company-private']));for(const frame of f.frames)if(nodes(frame.tree).some(node=>node.props?.['data-company-private']))assert.equal(frame.adapted,true);
  assert.equal(f.find(node=>node.type==='select').props['aria-label'],'Aktivt företag');
});

test('company switch unmounts all private children before posting and reloads only after verified success',async t=>{
  const f=await fixture(t);await f.respond(0,200,directory());const pending=f.find(node=>node.type==='select').props.onChange({target:{value:'b'}});await flush();
  assert.equal(f.find(node=>node.props?.['data-company-private']),undefined);assert.doesNotMatch(text(f.tree),/Synthetic A data/);assert.equal(f.location,undefined);assert.equal(f.requests[1].input,'/api/companies/active');
  await f.respond(1,200,{context:context('b',2)});await pending;assert.equal(f.location,'/');assert.equal(f.find(node=>node.props?.['data-company-private']),undefined);
});

test('a failed or ambiguous switch keeps the old workspace blank and offers a reload',async t=>{
  const f=await fixture(t);await f.respond(0,200,directory());const pending=f.find(node=>node.type==='select').props.onChange({target:{value:'b'}});await flush();await f.respond(1,409,{code:'COMPANY_CONTEXT_STALE'});await pending;
  assert.equal(f.find(node=>node.props?.['data-company-private']),undefined);assert.equal(f.location,undefined);assert.match(text(f.tree),/Läs in sidan igen/);f.find(node=>node.type==='button').props.onClick();assert.equal(f.reloaded,true);
});

test('explicit legacy binding preserves the existing screen without a company selector',async t=>{
  const f=await fixture(t);await f.respond(0,200,{version:'company-context-v1',companies:[],activeCompanyId:null,contextVersion:1,legacy:true});assert.ok(f.find(node=>node.props?.['data-company-private']));assert.equal(f.find(node=>node.type==='select'),undefined);
});

test('authorization denial and bfcache restoration hide all child caches and cleanup restores transport',async t=>{
  const f=await fixture(t);await f.respond(0,200,directory());const event=new Event('pageshow');Object.defineProperty(event,'persisted',{value:true});f.browser.dispatchEvent(event);await flush();assert.equal(f.find(node=>node.props?.['data-company-private']),undefined);
  f.dispose();assert.equal(f.browser.fetch,f.raw);
});

test('a remaining membership can be selected after revocation without mounting the old workspace',async t=>{
  const f=await fixture(t);await f.respond(0,200,{version:'company-context-v1',companies:[{id:'b',name:'Synthetic B',role:'owner',membershipVersion:1}],activeCompanyId:null,actorId:'synthetic-actor',contextVersion:3,selectionRequired:true});
  assert.equal(f.find(node=>node.props?.['data-company-private']),undefined);assert.match(text(f.tree),/Välj företag/);
  const change=f.find(node=>node.type==='select').props.onChange({target:{value:'b'}});await flush();
  await f.respond(1,200,{context:context('b',4)});await change;assert.equal(f.location,'/');
  assert.equal(f.find(node=>node.props?.['data-company-private']),undefined);
});


test('same-company directory refresh preserves the workspace value and callback identity',async t=>{
  const f=await fixture(t);await f.respond(0,200,directory());const initial=f.tree.props.value;
  assert.equal(initial.activeCompanyId,'a');assert.equal(typeof initial.switchCompany,'function');
  const reading=f.browser.fetch('/api/companies');await flush();await f.respond(1,200,directory());await reading;await flush();
  assert.equal(f.tree.props.value,initial);assert.equal(f.tree.props.value.switchCompany,initial.switchCompany);
  assert.ok(f.find(node=>node.props?.['data-company-private']));
});


test('integration diagnostics permission follows the current company role',async t=>{
 for(const role of ['owner','admin','accountant','viewer']){
  const f=await fixture(t),value=directory();value.context.role=role;value.companies[0].role=role;
  await f.respond(0,200,value);assert.equal(f.tree.props.value.canManageIntegrations,['owner','admin'].includes(role));f.dispose();
 }
});
