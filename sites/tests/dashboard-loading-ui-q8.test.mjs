import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {emptyState,money} from '../lib/domain.ts';
import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';

const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const file=path=>new URL(path,import.meta.url).href;
const elements=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(elements):[node,...elements(node.props?.children)];
const text=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(' '):typeof node==='object'?text(node.props?.children):String(node);
const flush=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setImmediate(resolve));};
function compiled(path,imports={}){
 let source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const [name,url]of Object.entries({'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'lucide-react':import.meta.resolve('lucide-react'),'@/lib/domain':file('../lib/domain.ts'),'./domain':file('../lib/domain.ts'),'./reconciliation-engine.js':file('../lib/reconciliation-engine.js'),'./payment-references.js':file('../lib/payment-references.js'),...imports}))for(const quote of ['"',"'"])source=source.replaceAll(quote+name+quote,JSON.stringify(url));
 return data(source);
}
function populatedState(){
 const state=emptyState();
 state.company={name:'Synthetic workspace',email:'synthetic@example.test'};
 state.invoices=['receivable','payable'].map((direction,n)=>({id:'synthetic-invoice-'+direction,direction,party:'Synthetic '+direction,number:'SYN-'+direction,email:'synthetic@example.test',ocr:'',total:n?543200:987600,currency:'SEK',issued:'2026-10-01',due:'2027-01-01',reviewed:true,voided:false,source:'Synthetic invoice',createdAt:'2026-10-01T00:00:00Z'}));
 state.transactions=[syntheticBankTransaction({id:'synthetic-transaction',party:'Synthetic bank payer',amount:123400,kind:'payment',verified:false})];
 return state;
}

// Run the real Dashboard load handler against controlled HTTP responses. Child
// services are inert; bank/invoice list rendering and navigation stay real.
async function fixture(t,view='bank'){
 const key='__dashboard_loading_'+crypto.randomUUID().replaceAll('-',''),f={slots:[],cursor:0,effects:[],closed:false,scheduled:false,requests:[],reads:[],postState:populatedState(),postStatus:200};globalThis[key]=f;
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((value,n)=>Object.is(value,b[n]));
 f.schedule=()=>{if(f.closed||f.scheduled)return;f.scheduled=true;queueMicrotask(()=>{f.scheduled=false;f.render();});};
 f.state=initial=>{const n=f.cursor++;f.slots[n]??={value:typeof initial==='function'?initial():initial};return [f.slots[n].value,value=>{f.slots[n].value=typeof value==='function'?value(f.slots[n].value):value;f.schedule();}];};
 f.ref=initial=>{const n=f.cursor++;f.slots[n]??={current:initial};return f.slots[n];};
 f.memo=(fn,deps)=>{const n=f.cursor++;if(!equal(f.slots[n]?.deps,deps))f.slots[n]={value:fn(),deps};return f.slots[n].value;};
 f.effect=(fn,deps)=>{const n=f.cursor++;if(!equal(f.slots[n]?.deps,deps))f.effects.push(()=>{f.slots[n]?.cleanup?.();f.slots[n]={deps,cleanup:fn()};});};
 const ref=`globalThis[${JSON.stringify(key)}]`,react=data(`const f=${ref};export const useState=(...a)=>f.state(...a),useRef=(...a)=>f.ref(...a),useCallback=(fn,deps)=>f.memo(()=>fn,deps),useMemo=(...a)=>f.memo(...a),useEffect=(...a)=>f.effect(...a);`);
 const browser=new EventTarget();browser.location=new URL('https://synthetic.example/?view='+view);browser.confirm=()=>false;browser.history={state:null,replaceState(state,unused,url){this.state=state;browser.location=new URL(url,browser.location);},pushState(state,unused,url){this.replaceState(state,unused,url);},go(){throw Error('No browser history traversal expected');}};
 const previousWindow=globalThis.window,previousDocument=globalThis.document;globalThis.window=browser;globalThis.document={activeElement:null};
 const shell={ownerDocument:{defaultView:browser},contains:()=>false,addEventListener(){},removeEventListener(){}};
 const location=file('../lib/workspace-location.ts'),navigation=compiled('../components/workspace-navigation.tsx',{'react':import.meta.resolve('react'),'@/lib/workspace-location':location});
 const hook=compiled('../components/use-workspace-navigation.ts',{react,'@/lib/workspace-location':location,'@/lib/workspace-drafts':file('../lib/workspace-drafts.ts')});
 const presentation=compiled('../lib/payment-presentation.ts'),bankUrl=compiled('../components/bank-payments.tsx',{'@/lib/payment-presentation':presentation}),bank=await import(bankUrl);
 const inert=data('export default function View(){return null;}');
 const aliases=Object.fromEntries(['economy-overview','payment-history','gmail-summary','invoice-evidence','customer-messages','gmail-workspace','bank-connection'].map(name=>['@/components/'+name,inert]));
 const noCalls=names=>data(names.map(name=>`export function ${name}(){throw Error('Unexpected unrelated ${name} call');}`).join('\n'));
 const control=data(`const f=${ref};export function usePaymentControl(enabled,revision,onComplete,onUnauthorized){f.complete=onComplete;f.unauthorized=onUnauthorized;return {data:enabled?{counts:{review:1},connections:{bank:{last_synced:'2026-10-01T12:00:00Z'}},run:null,queue:[]}:null,error:'',busy:false,refresh:async()=>{},start:async()=>{throw Error('No processing expected');}};}export const ControlButton=()=>null,ControlConnections=()=>null,ControlProgress=()=>null,ControlQueue=()=>null,ControlReview=()=>null,controlDate=()=>'';`);
 const {default:Dashboard}=await import(compiled('../app/dashboard.tsx',{...aliases,react,'@/components/workspace-navigation':navigation,'@/components/use-workspace-navigation':hook,'@/lib/workspace-location':location,'@/components/bank-payments':bankUrl,'@/lib/payment-presentation':presentation,'@/components/payment-control':control,'@/components/payment-bank-filter':compiled('../components/payment-bank-filter.ts'),'@/lib/payment-overview':noCalls(['buildPaymentOverview','paymentGroup','paymentTitle']),'@/lib/reconciliation':noCalls(['analyze']),'@/lib/bankgiro-parser.js':noCalls(['parseSpecificationBytes']),'@/lib/imports':noCalls(['parseCSV','guessMapping','mapCSV','parseCAMT','sha256','readInvoiceFile','extractInvoiceText','downloadFile','csvCell'])}));
 t.mock.method(globalThis,'fetch',async(path,options={})=>{
  f.requests.push({path,method:options.method||'GET'});
  if(path==='/api/bank/invoice-candidates')return Response.json({candidates:{}});
  if(path==='/api/export')return Response.json({error:'Synthetic export unavailable'},{status:503});
  assert.equal(path,'/api/state');
  if(options.method==='POST'){if(f.postGate)await f.postGate;return Response.json(f.postStatus===200?{state:f.postState,revision:2,message:'Synthetic saved'}:{error:'Synthetic save unavailable'},{status:f.postStatus});}
  return await new Promise((resolve,reject)=>f.reads.push({resolve,reject}));
 });
 f.render=()=>{if(f.closed)return;f.cursor=0;f.tree=Dashboard({initialView:view});for(const node of elements(f.tree)){if(node.props?.className==='app-shell'&&node.props.ref)node.props.ref.current=shell;if(node.props?.id==='main-content'&&node.props.ref)node.props.ref.current={focus(){}};}for(const effect of f.effects.splice(0))effect();};
 f.find=predicate=>elements(f.tree).find(predicate);
 f.listHtml=()=>renderToStaticMarkup(React.createElement(React.Fragment,null,...elements(f.tree).filter(node=>node.type===bank.BankPaymentSummary||node.type==='section'&&(node.props.className==='panel bank-payment-panel'||node.props.className==='panel'&&elements(node).some(child=>child.props?.className==='table-toolbar')))));
 f.respond=async(status=200,state=emptyState(),index=f.reads.length-1)=>{assert.ok(f.reads[index],'The real /api/state request must be pending');f.reads[index].resolve(Response.json(status===200?{state,revision:1,audit:[]}:{error:'Synthetic state unavailable'},{status}));await flush();};
 f.navigate=async next=>{assert.equal(f.find(node=>node.props?.onNavigate&&node.props?.company).props.onNavigate(next),true);await flush();};
 f.refresh=()=>f.find(node=>node.props?.['aria-label']==='Uppdatera').props.onClick();
 t.after(()=>{f.closed=true;for(const read of f.reads)read.resolve(Response.json({error:'Synthetic cleanup'},{status:401}));for(const slot of f.slots)slot?.cleanup?.();delete globalThis[key];if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
 f.render();await flush();assert.equal(f.reads.length,1);return f;
}
const noEmptyClaims=html=>{assert.doesNotMatch(html,/<dd>0<\/dd>|>0 fakturor<|0,00|Lägg till din första faktura|Inga bankhändelser ännu|Inga fakturor matchar filtret|Inga bankhändelser matchar ditt filter/);};
const labels={bank:'bankhändelser',receivable:'kundfakturor',payable:'leverantörsfakturor'};
const syntheticRow={bank:'Synthetic bank payer',receivable:'Synthetic receivable',payable:'Synthetic payable'};
for(const view of Object.keys(labels)){
 test(`Q8 dashboard readiness: delayed ${view} GET shows loading without invented empty results`,async t=>{
  const f=await fixture(t,view);noEmptyClaims(f.listHtml());assert.match(f.listHtml(),new RegExp('Hämtar '+labels[view]));assert.equal(f.requests.some(request=>request.method!=='GET'),false);if(view!=='bank')assert.equal(f.find(node=>node.props?.['aria-label']==='Exportera fakturor som CSV').props.disabled,true);
 });
 test(`Q8 dashboard readiness: rejected ${view} GET is unavailable without an empty list`,async t=>{
  const f=await fixture(t,view);await f.respond(503);noEmptyClaims(f.listHtml());assert.match(f.listHtml(),/kunde inte hämtas/i);assert.doesNotMatch(f.listHtml(),new RegExp('Hämtar '+labels[view]));
  f.find(node=>node.props?.['aria-label']==='Stäng felmeddelande').props.onClick();await flush();noEmptyClaims(f.listHtml());assert.match(f.listHtml(),/kunde inte hämtas/i);
 });
 test(`Q8 dashboard readiness: signed-out ${view} GET asks for login without zero balances`,async t=>{
  const f=await fixture(t,view);await f.respond(401);noEmptyClaims(f.listHtml());assert.match(f.listHtml(),new RegExp('Logga in.*'+labels[view]));
 });
 test(`Q8 dashboard readiness: successful empty ${view} GET can show actual loaded zero`,async t=>{
  const f=await fixture(t,view);await f.respond();const html=f.listHtml();assert.doesNotMatch(html,/Hämtar|kunde inte hämtas|Logga in/);
  if(view==='bank'){assert.equal((html.match(/<dd>0<\/dd>/g)||[]).length,3);assert.match(html,/Inga bankhändelser ännu/);}else{assert.match(html,/>0 fakturor</);assert.match(html,/0,00/);assert.match(html,/Lägg till din första faktura/);}
 });
 test(`Q8 dashboard readiness: failed ${view} refresh hides retained list amounts until a successful retry`,async t=>{
  const f=await fixture(t,view),state=populatedState(),before=JSON.stringify(state);await f.respond(200,state);assert.match(f.listHtml(),new RegExp(syntheticRow[view]));
  const refresh=f.refresh();await flush();await f.respond(503);await refresh;noEmptyClaims(f.listHtml());assert.doesNotMatch(f.listHtml(),new RegExp(syntheticRow[view]));assert.doesNotMatch(f.listHtml(),/class="bank-summary"|class="table-footer"/);assert.match(f.listHtml(),/kunde inte hämtas/i);
  const retry=f.refresh();await flush();await f.respond(200,state);await retry;assert.match(f.listHtml(),new RegExp(syntheticRow[view]));assert.equal(JSON.stringify(state),before);assert.equal(f.requests.some(request=>request.method!=='GET'),false);
 });
}
test('Q8 dashboard readiness: a rejected transport and a failed silent refresh do not expose a zero or stale bank summary',async t=>{
 const f=await fixture(t);f.reads[0].reject(Error('Synthetic network failure'));await flush();noEmptyClaims(f.listHtml());assert.match(f.listHtml(),/kunde inte hämtas/i);
 const refresh=f.refresh();await flush();await f.respond(200,populatedState());await refresh;assert.match(f.listHtml(),/Synthetic bank payer/);
 f.complete();await flush();await f.respond(503);assert.doesNotMatch(f.listHtml(),/Synthetic bank payer|class="bank-summary"/);assert.match(f.listHtml(),/kunde inte hämtas/i);
});
test('Q8 dashboard readiness: unrelated action errors retain loaded lists and enabled review controls',async t=>{
 const f=await fixture(t,'receivable'),state=populatedState();await f.respond(200,state);await f.navigate('settings');
 await f.find(node=>node.props?.exportData&&node.props?.toggleDemo).props.exportData();await flush();assert.match(text(f.tree),/Synthetic export unavailable/);
 await f.navigate('overview');assert.equal(f.find(node=>node.props?.demoToggle&&node.props?.task).props.error,'','An export error must not make the overview disable its review control');
 await f.navigate('receivable');assert.match(f.listHtml(),/Synthetic receivable/);assert.match(f.listHtml(),new RegExp(money(state.invoices[0].total).replace(/\s/g,'\\s')));assert.doesNotMatch(f.listHtml(),/kunde inte hämtas/i);
 await f.navigate('review');const button=f.find(node=>node.type?.name==='ControlButton');assert.ok(button);assert.equal(button.props.disabled,false);assert.equal(f.requests.some(request=>request.method!=='GET'),false);
});
test('Q8 dashboard readiness: an accepted save wins over an older pending read and stays readable',async t=>{
 const f=await fixture(t,'receivable');await f.respond(200,populatedState());await f.navigate('settings');
 const pending=f.refresh();await flush();const read=f.reads.length-1;f.postState=populatedState();f.postState.invoices[0].party='Synthetic saved invoice';
 assert.equal(await f.find(node=>node.props?.save&&node.props?.toggleDemo).props.save({type:'settings.save',name:'Synthetic workspace',email:'synthetic@example.test'}),true);await flush();
 await f.respond(503,undefined,read);await pending;await f.navigate('receivable');assert.match(f.listHtml(),/Synthetic saved invoice/);assert.doesNotMatch(f.listHtml(),/kunde inte hämtas/i);
});
test('Q8 dashboard readiness: authorization loss clears loading and hides previously loaded bank facts',async t=>{
 const f=await fixture(t);await f.respond(200,populatedState());const pending=f.refresh();await flush();const read=f.reads.length-1;f.unauthorized();await flush();
 noEmptyClaims(f.listHtml());assert.match(f.listHtml(),/Logga in.*bankhändelser/);assert.doesNotMatch(f.listHtml(),/Synthetic bank payer|Hämtar bankhändelser/);
 await f.respond(200,populatedState(),read);await pending;assert.match(f.listHtml(),/Logga in.*bankhändelser/);assert.doesNotMatch(f.listHtml(),/Synthetic bank payer/);
});
test('Q8 dashboard readiness: demo stays available after a failed read without making a financial request',async t=>{
 const f=await fixture(t,'receivable');await f.respond(503);await f.navigate('settings');f.find(node=>node.props?.toggleDemo).props.toggleDemo();await flush();
 await f.navigate('receivable');assert.match(f.listHtml(),/Exempelkund/);assert.doesNotMatch(f.listHtml(),/kunde inte hämtas|Logga in/);
 await f.navigate('payable');assert.match(f.listHtml(),/Exempelleverantör/);await f.navigate('bank');assert.match(f.listHtml(),/bank-payments-table/);assert.equal(f.requests.some(request=>request.method!=='GET'),false);
 f.find(node=>node.type==='button'&&text(node).startsWith('Avsluta demo')).props.onClick();await flush();await f.navigate('receivable');noEmptyClaims(f.listHtml());assert.doesNotMatch(f.listHtml(),/Exempelkund/);assert.match(f.listHtml(),/kunde inte hämtas/i);
});
test('Q8 dashboard readiness: leaving demo restarts an initial read cancelled before authentication was known',async t=>{
 const f=await fixture(t);await f.navigate('settings');f.find(node=>node.props?.toggleDemo).props.toggleDemo();await flush();await f.navigate('bank');assert.match(f.listHtml(),/bank-payments-table/);
 f.find(node=>node.type==='button'&&text(node).startsWith('Avsluta demo')).props.onClick();await flush();await f.navigate('bank');assert.equal(f.reads.length,2);noEmptyClaims(f.listHtml());assert.match(f.listHtml(),/Hämtar bankhändelser/);
 await f.respond(200,populatedState(),0);assert.doesNotMatch(f.listHtml(),/Synthetic bank payer/);await f.respond(401);assert.match(f.listHtml(),/Logga in.*bankhändelser/);noEmptyClaims(f.listHtml());assert.equal(f.requests.some(request=>request.method!=='GET'),false);
});
test('Q8 dashboard readiness: a newer silent refresh completes the loading state of the foreground read it supersedes',async t=>{
 const f=await fixture(t);await f.respond(200,populatedState());const foreground=f.refresh();await flush();const oldRead=f.reads.length-1;
 f.complete();await flush();assert.equal(f.reads.length,3);await f.respond(200,populatedState());assert.match(f.listHtml(),/Synthetic bank payer/);assert.doesNotMatch(f.listHtml(),/Hämtar bankhändelser/);assert.equal(f.find(node=>node.props?.['aria-label']==='Uppdatera').props.disabled,false);
 await f.respond(503,undefined,oldRead);await foreground;assert.match(f.listHtml(),/Synthetic bank payer/);
});
test('Q8 dashboard readiness: a delayed save response cannot reveal list totals after authorization was lost',async t=>{
 const f=await fixture(t,'receivable');await f.respond(200,populatedState());await f.navigate('settings');let finish;f.postGate=new Promise(resolve=>{finish=resolve;});
 const pending=f.find(node=>node.props?.save&&node.props?.toggleDemo).props.save({type:'settings.save',name:'Synthetic workspace',email:'synthetic@example.test'});await flush();f.unauthorized();await flush();finish();assert.equal(await pending,true);await flush();
 await f.navigate('receivable');assert.doesNotMatch(f.listHtml(),/Synthetic receivable|class="table-footer"/);noEmptyClaims(f.listHtml());assert.match(f.listHtml(),/Logga in.*kundfakturor/);
});
