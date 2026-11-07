import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as clientModule from '../sites/lib/company-client.js';

const context=(id='a',version=1)=>({version:'company-context-v1',companyId:id,storageOwner:'storage-'+id,actorId:'synthetic-user',role:'owner',membershipVersion:1,companyVersion:1,contextVersion:version});
const directory=()=>({version:'company-context-v1',companies:[{id:'a',name:'Synthetic A',role:'owner',membershipVersion:1},{id:'b',name:'Synthetic B',role:'owner',membershipVersion:1}],context:context(),activeCompanyId:'a',contextVersion:1});
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(t,{legacy=false,directoryOverride}={}){
  const elements=new Map(),listeners=new Map(),calls=[];let document;
  function el(key){if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',hidden:false,inert:false,isConnected:true,disabled:false,value:'',dataset:{},focus(){document.activeElement=this;},getClientRects:()=>[{}],setAttribute(){},hasAttribute:()=>false,addEventListener:(name,callback)=>listeners.set(key+':'+name,callback),removeEventListener(){},querySelector:el,querySelectorAll:()=>[],contains:()=>false});return elements.get(key);}
  document=Object.assign(new EventTarget(),{querySelector:el,getElementById:id=>el('#'+id),querySelectorAll:()=>[],body:{classList:{add(){},remove(){}}},activeElement:null});
  const browser=Object.assign(new EventTarget(),{document,location:{search:'?tab=customers',href:'https://synthetic.example/?tab=customers',assign:value=>browser.target=value,replace:value=>browser.target=value,reload:()=>browser.reloaded=true},scrollTo(){}});
  const raw=(input,init)=>{const call={input,init};calls.push(call);if(input==='/api/companies')return Promise.resolve(Response.json(directoryOverride??(legacy?{version:'company-context-v1',companies:[],activeCompanyId:null,contextVersion:1,legacy:true}:directory())));return new Promise((resolve,reject)=>Object.assign(call,{resolve,reject}));};browser.fetch=raw;
  const sandbox={window:browser,document,location:browser.location,history:{pushState(){},replaceState(){}},URL,URLSearchParams,Headers,Response,Request,AbortController,AbortSignal,Intl,Date,clientModule,matchMedia:()=>({matches:false,addEventListener(){}}),setTimeout:()=>1,clearTimeout(){}};
  Object.defineProperty(sandbox,'fetch',{get:()=>browser.fetch,configurable:true});const runtime=vm.createContext(sandbox);
  for(const name of ['workspace-search','app','review','messages','payment-control'])vm.runInContext(readFileSync(new URL(`../public/${name}.js`,import.meta.url),'utf8'),runtime,{filename:`public/${name}.js`});
  const run=source=>vm.runInContext(source,runtime);run('loadCompanyClient=async()=>clientModule;state.me={authenticated:true,login_required:true};state.control={counts:{review:0},totals:{},queue:[],run:null}');
  t.after(()=>{try{run('resetCompanyClient()');}catch{/* A red test may predate the new boundary. */}});
  return {run,window:browser,calls,html:()=>el('#app').innerHTML,set:(name,value)=>runtime[name]=value};
}

test('Node company selector uses verified membership names without replacing the legacy register',async t=>{
  const f=fixture(t);await f.run('initializeCompanyClient()');f.run('render()');assert.match(f.html(),/Aktivt företag/);assert.match(f.html(),/Synthetic A/);assert.match(f.html(),/Synthetic B/);
  assert.equal(f.run('companyClient.snapshot.context.companyId'),'a');assert.notEqual(f.window.fetch,undefined);
});

test('Node startup resolves and installs company context before requesting any private register',async t=>{
  const f=fixture(t);f.calls.find(call=>call.input==='/api/me').resolve(Response.json({authenticated:true,login_required:true}));await flush();
  const reads=f.calls.filter(call=>!['/api/me','/api/companies'].includes(call.input));assert.ok(reads.length>=10);
  for(const call of reads){assert.equal(new Headers(call.init.headers).get('X-Company-Id'),'a',call.input);assert.equal(new Headers(call.init.headers).get('X-Company-Context-Version'),'1',call.input);}
});

test('Node company switch immediately clears private data, closes dialogs and rejects a late API response',async t=>{
  const f=fixture(t);await f.run('initializeCompanyClient()');f.run("state.invoices=[{id:'same',party:'PRIVATE A'}];state.settings={company_name:'PRIVATE COMPANY A'};state.preview={content_base64:'PRIVATE ORIGINAL'};modal('PRIVATE DIALOG','PRIVATE CONTENT',null,null)");
  const pending=f.run("api('/invoices')"),rejected=assert.rejects(pending,/COMPANY_CONTEXT_STALE/);const switched=f.run("changeCompany('b')");await flush();
  assert.equal(f.run('state.invoices.length'),0);assert.equal(f.run('state.preview'),null);assert.doesNotMatch(f.html(),/PRIVATE/);
  f.calls.find(call=>call.input==='/api/invoices').resolve(Response.json({items:[{id:'same',party:'PRIVATE LATE'}]}));await rejected;
  f.calls.find(call=>call.input==='/api/companies/active').resolve(Response.json({context:context('b',2)}));await switched;assert.equal(f.window.target,'/');
  f.run("state.settings.company_name='PRIVATE LATE';render();modal('PRIVATE LATE','PRIVATE LATE',null,null)");assert.doesNotMatch(f.html(),/PRIVATE LATE/);
});

test('Node denied membership blanks cached records and does not restore them through a late render',async t=>{
  const f=fixture(t);await f.run('initializeCompanyClient()');f.run("state.invoices=[{party:'PRIVATE A'}];state.settings.company_name='PRIVATE A'");const pending=f.run("api('/invoices')"),rejected=assert.rejects(pending,error=>error.status===403);
  f.calls.find(call=>call.input==='/api/invoices').resolve(Response.json({error:'revoked'},{status:403}));await rejected;f.run('render()');assert.equal(f.run('state.invoices.length'),0);assert.doesNotMatch(f.html(),/PRIVATE A/);assert.match(f.html(),/Läs in sidan igen/);
});

test('Node explicit legacy mode keeps the existing screen and sends no invented company selectors',async t=>{
  const f=fixture(t,{legacy:true});await f.run('initializeCompanyClient()');f.run('render()');assert.doesNotMatch(f.html(),/data-company-selector/);const pending=f.run("api('/invoices')"),call=f.calls.find(call=>call.input==='/api/invoices');assert.equal(new Headers(call.init.headers).has('X-Company-Id'),false);call.resolve(Response.json({items:[]}));await pending;
});

test('Node offers remaining memberships after active revocation while keeping financial registers blank',async t=>{
  const f=fixture(t,{directoryOverride:{version:'company-context-v1',companies:[{id:'b',name:'Synthetic B',role:'owner',membershipVersion:1}],activeCompanyId:null,actorId:'synthetic-user',contextVersion:3,selectionRequired:true}});
  await f.run('initializeCompanyClient()');assert.match(f.html(),/Välj företag/);assert.match(f.html(),/Synthetic B/);assert.equal(f.run('state.invoices.length'),0);
  const switched=f.run("changeCompany('b')");await flush();const call=f.calls.find(call=>call.input==='/api/companies/active');assert.ok(call);
  call.resolve(Response.json({context:context('b',4)}));await switched;assert.equal(f.window.target,'/');
});


test('Node AI diagnostics are offered only to the current integration administrator',async t=>{
 for(const role of ['owner','admin','accountant','viewer']){
  const value=directory();value.context.role=role;value.companies[0].role=role;
  const f=fixture(t,{directoryOverride:value});await f.run('initializeCompanyClient()');
  f.run("state.tab='settings';state.me.role='owner';render()");
  assert.equal(f.html().includes('data-action="ai-status"'),['owner','admin'].includes(role));
 }
});
