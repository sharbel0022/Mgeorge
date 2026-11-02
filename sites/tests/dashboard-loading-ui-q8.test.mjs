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
 if(path==='../app/dashboard.tsx')imports={...imports,'@/components/list-pagination':compiled('../components/list-pagination.tsx',{react:import.meta.resolve('react')})};
 let source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const [name,url]of Object.entries({'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'lucide-react':import.meta.resolve('lucide-react'),'@/lib/domain':file('../lib/domain.ts'),'./domain':file('../lib/domain.ts'),'./reconciliation-engine.js':file('../lib/reconciliation-engine.js'),'./payment-references.js':file('../lib/payment-references.js'),...imports}))for(const quote of ['"',"'"])source=source.replaceAll(quote+name+quote,JSON.stringify(url));
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
 const key='__dashboard_loading_'+crypto.randomUUID().replaceAll('-',''),f={slots:[],cursor:0,effects:[],closed:false,scheduled:false,requests:[],reads:[],candidateReads:[],candidateFrames:[],postState:populatedState(),postStatus:200,suggestionCalls:0};globalThis[key]=f;
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
 const presentation=compiled('../lib/payment-presentation.ts'),bankUrl=compiled('../components/bank-payments.tsx',{'@/lib/payment-presentation':presentation,'./list-pagination':compiled('../components/list-pagination.tsx')}),bank=await import(bankUrl);
 const inert=data('export default function View(){return null;}');
 const aliases=Object.fromEntries(['economy-overview','payment-history','payment-verification','gmail-summary','invoice-evidence','customer-messages','gmail-workspace','bank-connection','bankgiro-link-review'].map(name=>['@/components/'+name,inert]));
 const noCalls=names=>data(names.map(name=>`export function ${name}(){throw Error('Unexpected unrelated ${name} call');}`).join('\n'));
 const control=data(`const f=${ref};export function usePaymentControl(enabled,revision,onComplete,onUnauthorized){f.complete=onComplete;f.unauthorized=onUnauthorized;return {data:enabled?{counts:{review:1},connections:{bank:{last_synced:'2026-10-01T12:00:00Z'}},run:null,queue:[]}:null,error:'',busy:false,refresh:async()=>{},start:async()=>{throw Error('No processing expected');}};}export const ControlButton=()=>null,ControlConnections=()=>null,ControlProgress=()=>null,ControlQueue=()=>null,ControlReview=()=>null,controlDate=()=>'';`);
 const domain=data(`export * from ${JSON.stringify(file('../lib/domain.ts'))};import {suggestions as realSuggestions} from ${JSON.stringify(file('../lib/domain.ts'))};export function suggestions(...args){${ref}.suggestionCalls++;return realSuggestions(...args);}`);
 const {default:Dashboard}=await import(compiled('../app/dashboard.tsx',{...aliases,react,'@/lib/domain':domain,'@/components/workspace-navigation':navigation,'@/components/use-workspace-navigation':hook,'@/lib/workspace-location':location,'@/components/bank-payments':bankUrl,'@/lib/payment-presentation':presentation,'@/components/payment-control':control,'@/components/payment-bank-filter':compiled('../components/payment-bank-filter.ts'),'@/lib/payment-overview':noCalls(['buildPaymentOverview','paymentGroup','paymentTitle']),'@/lib/reconciliation':noCalls(['analyze']),'@/lib/bankgiro-parser.js':noCalls(['parseSpecificationBytes']),'@/lib/imports':noCalls(['parseCSV','guessMapping','mapCSV','parseCAMT','sha256','readInvoiceFile','extractInvoiceText','downloadFile','csvCell'])}));
 t.mock.method(globalThis,'fetch',async(path,options={})=>{
  f.requests.push({path,method:options.method||'GET'});
  if(path==='/api/bank/invoice-candidates')return await new Promise((resolve,reject)=>f.candidateReads.push({resolve,reject,signal:options.signal}));
  if(path==='/api/export')return Response.json({error:'Synthetic export unavailable'},{status:503});
  assert.equal(path,'/api/state');
  if(options.method==='POST'){if(f.postGate)await f.postGate;if(f.postReply)return f.postReply();return Response.json(f.postStatus===200?{state:f.postState,revision:2,message:'Synthetic saved'}:{error:'Synthetic save unavailable'},{status:f.postStatus});}
  return await new Promise((resolve,reject)=>f.reads.push({resolve,reject}));
 });
 f.render=()=>{if(f.closed)return;f.cursor=0;f.tree=Dashboard({initialView:view});for(const node of elements(f.tree)){if(node.props?.className==='app-shell'&&node.props.ref)node.props.ref.current=shell;if(node.props?.id==='main-content'&&node.props.ref)node.props.ref.current={focus(){}};if(node.props?.candidates)f.candidateFrames.push({candidates:node.props.candidates,transactions:node.props.transactions.map(t=>t.id)});if(node.props?.invoiceCandidates)f.candidateFrames.push({candidates:node.props.invoiceCandidates,revision:node.props.historyRevision});}for(const effect of f.effects.splice(0))effect();};
 f.find=predicate=>elements(f.tree).find(predicate);
 f.listHtml=()=>renderToStaticMarkup(React.createElement(React.Fragment,null,...elements(f.tree).filter(node=>node.type===bank.BankPaymentSummary||node.type==='section'&&(node.props.className==='panel bank-payment-panel'||node.props.className==='panel'&&elements(node).some(child=>child.props?.className==='table-toolbar')))));
 f.respond=async(status=200,state=emptyState(),index=f.reads.length-1,revision=1)=>{assert.ok(f.reads[index],'The real /api/state request must be pending');f.reads[index].resolve(Response.json(status===200?{state,revision,audit:[]}:{error:'Synthetic state unavailable'},{status}));await flush();};
 f.respondCandidates=async(candidates={},index=f.candidateReads.length-1,status=200)=>{assert.ok(f.candidateReads[index],'The real candidate GET must be pending');f.candidateReads[index].resolve(Response.json(status===200?{candidates}:{error:'Synthetic candidate unavailable'},{status}));await flush();};
 f.navigate=async next=>{assert.equal(f.find(node=>node.props?.onNavigate&&node.props?.company).props.onNavigate(next),true);await flush();};
 f.refresh=()=>f.find(node=>node.props?.['aria-label']==='Uppdatera').props.onClick();
 t.after(()=>{f.closed=true;for(const read of [...f.reads,...f.candidateReads])read.resolve(Response.json({error:'Synthetic cleanup'},{status:401}));for(const slot of f.slots)slot?.cleanup?.();delete globalThis[key];if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
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

const candidateMap=number=>({'synthetic-transaction':[{number,documentId:'synthetic-doc-'+number,invoiceId:'',party:'Synthetic invoice customer',amount:123400,issued:'2026-10-01',needsReview:true,source:'gmail',reason:'Synthetic review proposal'}]});
for(const failure of ['pending','http','transport']){
 test(`dashboard candidates: revision change with ${failure} refresh hides old proposals from list, search and transaction detail`,async t=>{
  const f=await fixture(t),state=populatedState(),before=JSON.stringify(state);await f.respond(200,state);await f.respondCandidates(candidateMap('SYN-OLD'));
  const bank=()=>f.find(node=>node.props?.candidates),detail=()=>f.find(node=>node.props?.invoiceCandidates);
  f.find(node=>node.props?.['aria-label']==='Sök bankhändelser').props.onChange({target:{value:'SYN-OLD'}});await flush();assert.equal(bank().props.transactions.length,1);
  bank().props.open('synthetic-transaction');await flush();assert.equal(detail().props.invoiceCandidates['synthetic-transaction'][0].number,'SYN-OLD');
  const refresh=f.refresh();await flush();f.candidateFrames.length=0;await f.respond(200,state,undefined,2);await refresh;
  assert.equal(f.candidateReads.length,2);assert.deepEqual(bank().props.candidates,{});assert.deepEqual(detail().props.invoiceCandidates,{});assert.equal(bank().props.transactions.length,0);
  assert.ok(f.candidateFrames.length);for(const frame of f.candidateFrames)assert.deepEqual(frame.candidates,{},'No render may attach proposals from the previous workspace revision');
  if(failure==='http')await f.respondCandidates({},undefined,503);
  if(failure==='transport'){f.candidateReads.at(-1).reject(Error('Synthetic candidate transport failure'));await flush();}
  assert.deepEqual(bank().props.candidates,{});assert.deepEqual(detail().props.invoiceCandidates,{});assert.equal(bank().props.transactions.length,0);assert.equal(JSON.stringify(state),before);assert.equal(f.requests.some(request=>request.method!=='GET'),false);
 });
}
test('dashboard candidates: late old-revision response cannot replace the successful current proposals',async t=>{
 const f=await fixture(t),state=populatedState();await f.respond(200,state);
 const old=f.candidateReads[0],refresh=f.refresh();await flush();await f.respond(200,state,undefined,2);await refresh;assert.equal(old.signal.aborted,true);
 await f.respondCandidates(candidateMap('SYN-CURRENT'));old.resolve(Response.json({candidates:candidateMap('SYN-LATE')}));await flush();
 const bank=f.find(node=>node.props?.candidates);assert.equal(bank.props.candidates['synthetic-transaction'][0].number,'SYN-CURRENT');bank.props.open('synthetic-transaction');await flush();assert.equal(f.find(node=>node.props?.invoiceCandidates).props.invoiceCandidates['synthetic-transaction'][0].number,'SYN-CURRENT');
 f.find(node=>node.props?.['aria-label']==='Sök bankhändelser').props.onChange({target:{value:'SYN-CURRENT'}});await flush();assert.equal(f.find(node=>node.props?.candidates).props.transactions.length,1);
});
for(const invalidate of ['demo','signed_out']){
 test(`dashboard candidates: ${invalidate} invalidation cannot revive proposals from an aborted request`,async t=>{
  const f=await fixture(t),state=populatedState();await f.respond(200,state);const old=f.candidateReads[0];
  if(invalidate==='demo'){await f.navigate('settings');f.find(node=>node.props?.toggleDemo).props.toggleDemo();await flush();await f.navigate('bank');assert.deepEqual(f.find(node=>node.props?.candidates).props.candidates,{});f.find(node=>node.type==='button'&&text(node).startsWith('Avsluta demo')).props.onClick();await flush();}
  else{f.unauthorized();await flush();f.refresh();await flush();}
  assert.equal(old.signal.aborted,true);await f.respond(200,state);await f.navigate('bank');await f.respondCandidates(candidateMap('SYN-CURRENT'));
  old.resolve(Response.json({candidates:candidateMap('SYN-INVALIDATED')}));await flush();assert.equal(f.find(node=>node.props?.candidates).props.candidates['synthetic-transaction'][0].number,'SYN-CURRENT');assert.equal(f.requests.some(request=>request.method!=='GET'),false);
 });
}
for(const response of ['success','http','transport']){
 test(`dashboard candidates: a document change invalidates same-revision proposals during a ${response} evidence refresh`,async t=>{
  const f=await fixture(t),state=populatedState(),before=JSON.stringify(state);await f.respond(200,state);await f.respondCandidates(candidateMap('SYN-REJECTED'));
  f.find(node=>node.props?.['aria-label']==='Sök bankhändelser').props.onChange({target:{value:'SYN-REJECTED'}});await flush();f.find(node=>node.props?.candidates).props.open('synthetic-transaction');await flush();await f.navigate('documents');f.candidateFrames.length=0;
  const changed=f.find(node=>node.props?.initialDocumentId!==undefined&&node.props?.embedded).props.onChanged();await flush();
  assert.equal(f.candidateReads.length,1,'Candidate reads must wait until the financial workspace read has settled');assert.deepEqual(f.find(node=>node.props?.invoiceCandidates).props.invoiceCandidates,{});for(const frame of f.candidateFrames)assert.deepEqual(frame.candidates,{},'Invalidation must apply on the first render before effect cleanup');
  await f.respond(200,state,undefined,1);await changed;assert.equal(f.candidateReads.length,2,'Document evidence must refetch even when financial revision stays unchanged');await f.navigate('bank');assert.equal(f.find(node=>node.props?.candidates).props.transactions.length,0);
  if(response==='transport'){f.candidateReads.at(-1).reject(Error('Synthetic evidence request unavailable'));await flush();}else await f.respondCandidates({},undefined,response==='http'?503:200);
  assert.deepEqual(f.find(node=>node.props?.candidates).props.candidates,{});assert.deepEqual(f.find(node=>node.props?.invoiceCandidates).props.invoiceCandidates,{});assert.equal(f.find(node=>node.props?.candidates).props.transactions.length,0);assert.equal(JSON.stringify(state),before);assert.equal(f.requests.some(request=>request.method!=='GET'),false);
 });
}
test('dashboard candidates: a late response from before a same-revision document change cannot replace new evidence',async t=>{
 const f=await fixture(t),state=populatedState();await f.respond(200,state);const old=f.candidateReads[0];await f.navigate('documents');
 const changed=f.find(node=>node.props?.initialDocumentId!==undefined&&node.props?.embedded).props.onChanged();await flush();await f.respond(200,state,undefined,1);await changed;assert.equal(old.signal.aborted,true);assert.equal(f.candidateReads.length,2);
 await f.respondCandidates(candidateMap('SYN-CURRENT'));old.resolve(Response.json({candidates:candidateMap('SYN-REJECTED')}));await flush();await f.navigate('bank');const bank=f.find(node=>node.props?.candidates);assert.equal(bank.props.candidates['synthetic-transaction'][0].number,'SYN-CURRENT');bank.props.open('synthetic-transaction');await flush();assert.equal(f.find(node=>node.props?.invoiceCandidates).props.invoiceCandidates['synthetic-transaction'][0].number,'SYN-CURRENT');
});
test('dashboard candidates: a failed parent refresh withholds document proposals until a successful workspace retry',async t=>{
 const f=await fixture(t),state=populatedState();await f.respond(200,state);await f.respondCandidates(candidateMap('SYN-REJECTED'));f.find(node=>node.props?.candidates).props.open('synthetic-transaction');await flush();await f.navigate('documents');
 const changed=f.find(node=>node.props?.initialDocumentId!==undefined&&node.props?.embedded).props.onChanged();await flush();assert.equal(f.candidateReads.length,1);assert.deepEqual(f.find(node=>node.props?.invoiceCandidates).props.invoiceCandidates,{});
 await f.respond(503);await changed;assert.equal(f.candidateReads.length,1,'Failed workspace data must not authorize candidates tagged with the retained old revision');assert.deepEqual(f.find(node=>node.props?.invoiceCandidates).props.invoiceCandidates,{});assert.match(text(f.tree),/Synthetic state unavailable/);
 const retry=f.refresh();await flush();await f.respond(200,state,undefined,1);await retry;assert.equal(f.candidateReads.length,2);assert.deepEqual(f.find(node=>node.props?.invoiceCandidates).props.invoiceCandidates,{});await f.respondCandidates(candidateMap('SYN-CURRENT'));assert.equal(f.find(node=>node.props?.invoiceCandidates).props.invoiceCandidates['synthetic-transaction'][0].number,'SYN-CURRENT');assert.doesNotMatch(text(f.tree),/Synthetic state unavailable/);
});
test('dashboard candidates: completed payment control invalidates document evidence even when financial revision stays unchanged',async t=>{
 const f=await fixture(t),state=populatedState();await f.respond(200,state);await f.respondCandidates(candidateMap('SYN-PRIOR-EXTRACTION'));f.find(node=>node.props?.candidates).props.open('synthetic-transaction');await flush();
 const completed=f.complete();await flush();assert.deepEqual(f.find(node=>node.props?.invoiceCandidates).props.invoiceCandidates,{},'Completed document processing must invalidate previous extraction proposals immediately');assert.equal(f.candidateReads.length,1);
 await f.respond(200,state,undefined,1);await completed;assert.equal(f.candidateReads.length,2);await f.respondCandidates(candidateMap('SYN-CURRENT-EXTRACTION'));
 assert.equal(f.find(node=>node.props?.candidates).props.candidates['synthetic-transaction'][0].number,'SYN-CURRENT-EXTRACTION');assert.equal(f.find(node=>node.props?.invoiceCandidates).props.invoiceCandidates['synthetic-transaction'][0].number,'SYN-CURRENT-EXTRACTION');assert.equal(f.requests.some(request=>request.method!=='GET'),false);
});

// Presentation must neither reconcile every payment nor claim empty/stale data.
test('final UI: loading and searching an invoice list does not compute unused payment suggestions',async t=>{
 const f=await fixture(t,'receivable'),state=populatedState(),before=JSON.stringify(state);
 await f.respond(200,state);
 f.find(node=>node.props?.['aria-label']==='Sök fakturor').props.onChange({target:{value:'  SYN-receivable  '}});await flush();
 assert.equal(f.suggestionCalls,0,'Typing in a list must not compute unused reconciliation proposals');
 assert.equal(JSON.stringify(state),before);assert.equal(f.requests.some(request=>request.method!=='GET'),false);
});
for(const [view,label] of [['contacts','kontakter'],['imports','importerade underlag'],['history','historik']]){
 test(`final UI: ${view} pending, failed and signed-out reads do not invent empty records`,async t=>{
  const f=await fixture(t,view);
  const status=()=>f.find(node=>node.type?.name==='WorkspaceListStatus');
  assert.ok(status(),`${view} must render an explicit read status`);assert.equal(status().props.status,'pending');assert.equal(status().props.label,label);
  await f.respond(503);assert.equal(status().props.status,'failed');
  const retry=f.refresh();await flush();await f.respond(401);await retry;assert.equal(status().props.status,'signed_out');
 });
}
test('final UI: global search becomes unavailable after a failed refresh instead of offering stale records',async t=>{
 const f=await fixture(t),state=populatedState();await f.respond(200,state);
 const search=()=>f.find(node=>node.type?.name==='WorkspaceSearch');assert.equal(search().props.available,true);
 const refresh=f.refresh();await flush();assert.equal(search().props.available,false);
 await f.respond(503);await refresh;assert.equal(search().props.available,false);
});
test('final UI: invoice search trims pasted whitespace and matches displayed source and amount',async t=>{
 const f=await fixture(t,'receivable'),state=populatedState();state.invoices[0].source='Synthetic original source';await f.respond(200,state);
 const search=f.find(node=>node.props?.['aria-label']==='Sök fakturor');
 for(const value of ['  SYN-receivable  ','synthetic original source','9 876']){
  search.props.onChange({target:{value}});await flush();assert.match(f.listHtml(),/Synthetic receivable/);
 }
});

for(const [name,change]of [
 ['missing transaction array',state=>({...state,transactions:null})],
 ['numeric bank reference',state=>({...state,transactions:state.transactions.map(row=>({...row,payerReference:599}))})],
 ['malformed bank reference evidence',state=>({...state,transactions:state.transactions.map(row=>({...row,referenceEvidence:{candidates:null}}))})],
 ['numeric invoice number',state=>({...state,invoices:state.invoices.map(row=>({...row,number:599}))})],
 ['numeric original reference',state=>({...state,transactions:state.transactions.map(row=>({...row,original:{...row.original,payerReference:599}}))})],
 ['malformed manual verification',state=>({...state,transactions:state.transactions.map(row=>({...row,verification:{party:{name:'Invalid'},payerReference:'0599',note:'Synthetic',at:'2026-11-02T00:00:00Z'}}))})],
 ['malformed invoice reconciliation note',state=>({...state,invoices:state.invoices.map(row=>({...row,reconciledAt:'2026-11-02T00:00:00Z',reconciliationNote:{text:'Synthetic malformed note'}}))})],
 ['missing reference warnings',state=>({...state,transactions:state.transactions.map(row=>({...row,referenceEvidence:{...row.referenceEvidence,warnings:undefined}}))})],
 ['structured reference warning',state=>({...state,transactions:state.transactions.map(row=>({...row,referenceEvidence:{...row.referenceEvidence,warnings:[{reason:'Synthetic invalid warning'}]}}))})],
 ['structured selected reference',state=>({...state,transactions:state.transactions.map(row=>({...row,referenceEvidence:{...row.referenceEvidence,selected:{value:{ref:'0599'}}}}))})],
 ['structured report identifier',state=>({...state,transactions:state.transactions.map(row=>({...row,reportEvidence:{reportId:{id:'Synthetic invalid report'}}}))})],
])test('payment UI rejects malformed workspace response: '+name,async t=>{
 const f=await fixture(t),state=populatedState();
 await f.respond(200,change(state));
 assert.match(f.listHtml(),/kunde inte hämtas/i);noEmptyClaims(f.listHtml());
 assert.doesNotMatch(f.listHtml(),/Synthetic bank payer|class="bank-summary"/);
 const retry=f.refresh();await flush();await f.respond(200,state);await retry;
 assert.match(f.listHtml(),/Synthetic bank payer/);
});

test('payment UI rejects a malformed audit entry before history renders it',async t=>{
 const f=await fixture(t,'history'),state=populatedState();
 f.reads[0].resolve(Response.json({state,revision:1,audit:[null]}));await flush();
 const status=f.find(node=>node.type?.name==='WorkspaceListStatus');assert.ok(status);assert.equal(status.props.status,'failed');
 const retry=f.refresh();await flush();await f.respond(200,state);await retry;
 assert.equal(f.find(node=>node.type?.name==='WorkspaceListStatus'),undefined);
});

for(const detail of ['null','{"message":{"invalid":"object"}}'])test('payment UI history renders a safe fallback for structured audit text: '+detail,async t=>{
 const f=await fixture(t,'history'),state=populatedState();
 f.reads[0].resolve(Response.json({state,revision:1,audit:[{id:'synthetic-event',revision:1,action:'Synthetic event',detail,created_at:'2026-11-02T00:00:00Z'}]}));await flush();
 assert.equal(f.find(node=>node.type?.name==='WorkspaceListStatus'),undefined);assert.match(text(f.tree),/Synthetic event/);
});

for(const [name,candidates]of [
 ['null collection',null],
 ['non-array transaction proposals',{'synthetic-transaction':'0599'}],
 ['null proposal',{'synthetic-transaction':[null]}],
 ['numeric invoice number',{'synthetic-transaction':[{...candidateMap('0599')['synthetic-transaction'][0],number:599}]}],
 ['malformed identifiers',{'synthetic-transaction':[{...candidateMap('0599')['synthetic-transaction'][0],identifiers:{value:'0599'}}]}],
 ['numeric nested reference',{'synthetic-transaction':[{...candidateMap('0599')['synthetic-transaction'][0],identifiers:[{field:'reference',value:599}]}]}],
 ['malformed reference fields',{'synthetic-transaction':[{...candidateMap('0599')['synthetic-transaction'][0],referenceFields:[null]}]}],
])test('payment UI rejects malformed candidate response and retries safely: '+name,async t=>{
 const f=await fixture(t),state=populatedState(),before=structuredClone(state);await f.respond(200,state);
 await f.respondCandidates(candidates);
 assert.deepEqual(f.find(node=>node.props?.candidates).props.candidates,{});
 assert.doesNotThrow(()=>f.listHtml());assert.match(text(f.tree),/Fakturaförslagen kunde inte hämtas/);
 const retry=f.find(node=>node.type==='button'&&text(node)==='Hämta fakturaförslag igen');assert.ok(retry);retry.props.onClick();await flush();
 assert.match(text(f.tree),/Hämtar fakturaförslag/);assert.equal(f.candidateReads.length,2);
 await f.respondCandidates(candidateMap('0000599'));
 assert.equal(f.find(node=>node.props?.candidates).props.candidates['synthetic-transaction'][0].number,'0000599');
 assert.doesNotMatch(text(f.tree),/Fakturaförslagen kunde inte hämtas/);
 assert.deepEqual(state,before);assert.equal(f.requests.some(request=>request.method!=='GET'),false);
});

for(const failure of ['http','transport'])test('payment UI identifies unavailable candidate evidence without hiding stored bank facts: '+failure,async t=>{
 const f=await fixture(t);await f.respond(200,populatedState());assert.match(text(f.tree),/Hämtar fakturaförslag/);
 if(failure==='http')await f.respondCandidates({},undefined,503);else{f.candidateReads.at(-1).reject(Error('Synthetic candidate network failure'));await flush();}
 assert.match(text(f.tree),/Fakturaförslagen kunde inte hämtas/);assert.match(f.listHtml(),/Synthetic bank payer/);
 assert.deepEqual(f.find(node=>node.props?.candidates).props.candidates,{});
});

for(const failure of ['malformed','json','transport','http400','http500'])test('payment UI requires a fresh read after an ambiguous save result: '+failure,async t=>{
 const f=await fixture(t,'receivable'),state=populatedState();await f.respond(200,state);await f.navigate('settings');
 const settings=()=>f.find(node=>node.props?.save&&node.props?.toggleDemo),command={type:'settings.save',name:'Synthetic workspace',email:'synthetic@example.test'};
 if(failure==='malformed')f.postState={...state,transactions:null};
 if(failure==='json')f.postReply=()=>new Response('{',{status:200,headers:{'Content-Type':'application/json'}});
 if(failure==='transport')f.postReply=()=>{throw Error('Synthetic lost commit response');};
 if(failure==='http400')f.postReply=()=>Response.json({error:'Synthetic original rejected after retaining its evidence',evidenceRetained:true,revision:2},{status:400});
 if(failure==='http500')f.postReply=()=>Response.json({error:'Synthetic follow-up failed after saving'},{status:500});
 const oldSave=settings().props.save;assert.equal(await oldSave(command),false);await flush();
 assert.equal(await oldSave(command),false,'Even the retained event handler cannot resubmit after an ambiguous commit');await flush();
 assert.equal(f.requests.filter(request=>request.method==='POST').length,1);
 await f.navigate('receivable');assert.match(f.listHtml(),/kunde inte hämtas/i);assert.doesNotMatch(f.listHtml(),/Synthetic receivable|class="table-footer"/);
 const retry=f.refresh();await flush();await f.respond(200,state,undefined,3);await retry;
 await f.navigate('settings');f.postState=state;f.postReply=null;assert.equal(await settings().props.save(command),true);await flush();
 assert.equal(f.requests.filter(request=>request.method==='POST').length,2);
});

test('payment UI requires reload for a failed save even when the response has no retention receipt',async t=>{
 const f=await fixture(t,'receivable'),state=populatedState();await f.respond(200,state);await f.navigate('settings');
 f.postStatus=400;assert.equal(await f.find(node=>node.props?.save&&node.props?.toggleDemo).props.save({type:'settings.save',name:'Synthetic workspace',email:'synthetic@example.test'}),false);await flush();
 await f.navigate('receivable');assert.doesNotMatch(f.listHtml(),/Synthetic receivable/);assert.match(f.listHtml(),/kunde inte hämtas/);
});

test('payment UI marks an already open payment detail unreadable after an ambiguous save',async t=>{
 const f=await fixture(t);await f.respond(200,populatedState());f.find(node=>node.props?.candidates).props.open('synthetic-transaction');await flush();
 const detail=()=>f.find(node=>node.props?.invoiceCandidates);assert.equal(detail().props.readable,true);
 f.postStatus=400;assert.equal(await detail().props.save({type:'settings.save',name:'Synthetic workspace',email:'synthetic@example.test'}),false);await flush();
 assert.equal(detail().props.readable,false);assert.deepEqual(detail().props.invoiceCandidates,{});
 const retry=f.refresh();await flush();await f.respond(200,populatedState(),undefined,2);await retry;assert.equal(detail().props.readable,true);
});
