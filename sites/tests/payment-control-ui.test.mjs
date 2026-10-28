import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const url=path=>new URL(path,import.meta.url).href;
function compiled(path,imports={}){let source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;for(const [name,target] of Object.entries({'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'lucide-react':import.meta.resolve('lucide-react'),'@/lib/domain':url('../lib/domain.ts'),'@/lib/economy-summary.js':url('../lib/economy-summary.js'),...imports}))for(const q of ['"',"'"])source=source.replaceAll(q+name+q,JSON.stringify(target));return 'data:text/javascript;base64,'+Buffer.from(source).toString('base64');}
const ui=await import(compiled('../components/payment-control.tsx'));
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
test('manual control button is disabled while running and has explicit busy semantics',()=>{
 const html=render(ui.ControlButton,{busy:true,onClick(){throw Error('SSR must not run action');}});
 assert.match(html,/disabled/);assert.match(html,/aria-busy="true"/);assert.match(html,/Kontrollen pågår/);assert.doesNotMatch(html,/Godkänn och skicka/);
});
test('partial control renders every step, cooldown and no-send limitation',()=>{
 const html=render(ui.ControlProgress,{job:{id:'synthetic',status:'partial',started_at:'2026-10-28T10:00:00Z',steps:[{key:'gmail',title:'Gmail',state:'blocked',note:'Anslut Gmail'},{key:'bank',title:'Bank',state:'waiting',note:'Sparat underlag',next_at:'2026-10-28T12:00:00Z'},{key:'documents',title:'Dokument',state:'done',note:'Originalen bevaras'},{key:'reconcile',title:'Avstämning',state:'done',note:'Kontrollerat'},{key:'drafts',title:'Mejlutkast',state:'done',note:'1 utkast'}]}});
 assert.equal((html.match(/class="control-step /g)||[]).length,5);assert.match(html,/Delvis klart/);assert.match(html,/Behöver åtgärd/);assert.match(html,/Nästa möjliga försök/);assert.match(html,/bevisar inte/);assert.match(html,/Inga kundmejl skickas/);
});
test('queue renders one action per server task and escapes untrusted invoice text',()=>{
 const tasks=[{id:'one',type:'payment',entity_id:'tx',title:'<img src=x onerror=alert(1)>',reason:'<script>unsafe</script>',action:'Granska betalning',amount_cents:62500,priority:20}];
 const html=render(ui.ControlQueue,{items:tasks,open(){}});assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<img|<script/);assert.equal((html.match(/<button/g)||[]).length,1);assert.match(html,/625/);
});
test('empty queue never asserts paid status, and all risk categories remain available',()=>{
 const html=render(ui.ControlReview,{data:{queue:[]},open(){}});for(const label of ['Fakturauppgifter','Betalningar','Bankgiro','Ekonomiska avvikelser','Mejl att läsa'])assert.ok(html.includes(label),label);assert.match(html,/En tom kö är inte bevis på full betalning/);assert.match(html,/aria-pressed="true"/);
});

test('review keeps selected evidence beside the unresolved list without opening a dialog',()=>{
 const task={id:'batch',entity_id:'tx',type:'specification',title:'Samlingsbetalning',reason:'Specifikation saknas',action:'Lägg till underlag',amount_cents:62500,priority:15,date:'2026-10-26'};
 let detail;
 const html=render(ui.ControlReview,{data:{queue:[task]},open(){throw Error('Rendering must not perform an action');},renderDetail:item=>{detail=item;return React.createElement('p',null,'Bankreferens 58197013. Betalarens OCR saknas.');}});
 assert.equal(detail.id,'batch');assert.match(html,/aria-current="true"/);assert.match(html,/Bankreferens 58197013/);assert.match(html,/2026-10-26/);assert.doesNotMatch(html,/<dialog|Bekräfta matchning/);
});

test('loading review is distinguished from an empty successfully loaded queue',()=>{
 const loading=render(ui.ControlReview,{data:null,open(){}});
 assert.match(loading,/Hämtar granskningskön/);assert.doesNotMatch(loading,/Inget i den här kön/);
 const loaded=render(ui.ControlReview,{data:{queue:[]},open(){}});
 assert.match(loaded,/Inget i den här kön/);assert.doesNotMatch(loaded,/Hämtar granskningskön/);
});

test('finished control reports persisted counts without inventing a checked invoice count',()=>{
 const html=render(ui.ControlProgress,{job:{id:'synthetic',status:'complete',started_at:'2026-10-28T10:00:00Z',steps:[{key:'documents',title:'Dokument',state:'done',note:'Bearbetade',count:8},{key:'reconcile',title:'Avstämning',state:'done',note:'Verifierade',count:5}]},reviewCount:3});
 assert.match(html,/Kontroll färdig/);assert.match(html,/<strong>8<\/strong> underlag behandlade/);assert.match(html,/<strong>5<\/strong> betalningar verifierade/);assert.match(html,/<strong>3<\/strong> ärenden att granska/);assert.doesNotMatch(html,/fakturor kontrollerade|<details[^>]*open/);
});
test('connection overview explains offline OCR and retains pending/error counters',()=>{
 const html=render(ui.ControlConnections,{data:{connections:{gmail:{connected:true,new_documents:4},bank:{connected:false},ocr:{connected:false,enabled:false,waiting:3,processed:9,failed:2}}},open(){}});
 assert.match(html,/3 väntar/);assert.match(html,/2 misslyckade/);assert.match(html,/Pausad/);assert.match(html,/Automatisk hämtning inte verifierad eller pausad/);assert.match(html,/Text-PDF/);
});
test('customer-message mount only reads; reconciliation remains an explicit action',()=>{
 const source=readFileSync(new URL('../components/customer-messages.tsx',import.meta.url),'utf8');const load=source.slice(source.indexOf('async function load()'),source.indexOf('useEffect('));assert.doesNotMatch(load,/request\('reconcile'/);assert.match(source,/Uppdatera avstämning och kö/);
});

// Exercise the client coordinator independently of a browser, with controlled
// responses at the same network boundary as the real Worker API.
async function hookFixture(t){
 const key='__controlUI_'+crypto.randomUUID().replaceAll('-','');
 const f={slots:[],cursor:0,effects:[],scheduled:false,enabled:true,revision:0,closed:false,posts:[],requests:[],onPost:null};globalThis[key]=f;
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((v,n)=>Object.is(v,b[n]));
 f.state=initial=>{const n=f.cursor++;f.slots[n]??={value:typeof initial==='function'?initial():initial};return[f.slots[n].value,value=>{f.slots[n].value=typeof value==='function'?value(f.slots[n].value):value;f.schedule();}];};
 f.ref=initial=>{const n=f.cursor++;f.slots[n]??={current:initial};return f.slots[n];};
 f.callback=(fn,deps)=>{const n=f.cursor++;if(!equal(f.slots[n]?.deps,deps))f.slots[n]={value:fn,deps};return f.slots[n].value;};
 f.effect=(fn,deps)=>{const n=f.cursor++;if(!equal(f.slots[n]?.deps,deps))f.effects.push(()=>{f.slots[n]?.cleanup?.();f.slots[n]={deps,cleanup:fn()};});};
 f.schedule=()=>{if(f.closed||f.scheduled)return;f.scheduled=true;queueMicrotask(()=>{f.scheduled=false;f.render();});};
 const react='data:text/javascript;base64,'+Buffer.from(`const f=globalThis[${JSON.stringify(key)}];export const useState=(...a)=>f.state(...a),useRef=(...a)=>f.ref(...a),useCallback=(...a)=>f.callback(...a),useEffect=(...a)=>f.effect(...a);`).toString('base64');
 const module=await import(compiled('../components/payment-control.tsx',{react}));
 const overview={run:null,totals:{},counts:{},queue:[],connections:{gmail:{},bank:{},ocr:{}}};
 let initialRelease;const initial=new Promise(r=>initialRelease=r);f.initialRelease=()=>initialRelease();
 t.mock.method(globalThis,'fetch',async(path,options)=>{f.requests.push(path);if(path.endsWith('/overview')){await initial;if(f.onOverview)return f.onOverview();return Response.json(overview);}const body=JSON.parse(options.body);f.posts.push({path,body});if(f.onPost)return f.onPost(path,body);overview.run={id:'run',status:'partial',steps:[]};return Response.json({job:overview.run});});
 f.render=()=>{if(f.closed)return;f.cursor=0;f.value=module.usePaymentControl(f.enabled,f.revision,()=>{},()=>{});const effects=f.effects.splice(0);for(const effect of effects)effect();};
 f.flush=async()=>{for(let n=0;n<8;n++)await new Promise(r=>setImmediate(r));};
 // The visibility listener is not used by these focused request tests.
 const previous=globalThis.document;globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
 t.after(()=>{f.closed=true;for(const slot of f.slots)slot?.cleanup?.();delete globalThis[key];if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
 f.render();await f.flush();return f;
}
test('control cannot start until its initial owner-bound overview has loaded',async t=>{
 const f=await hookFixture(t);await f.value.start();assert.equal(f.posts.length,0);f.initialRelease();await f.flush();await f.value.start();await f.flush();assert.equal(f.posts.length,1);assert.equal(f.value.data.run.id,'run');
});
test('lost start response retries with the same idempotency key and never sends mail',async t=>{
 const f=await hookFixture(t);f.initialRelease();await f.flush();f.onPost=async()=>{throw Error('Network interrupted');};await f.value.start();await f.flush();await f.value.start();await f.flush();assert.equal(f.posts.length,2);assert.equal(f.posts[0].body.request_id,f.posts[1].body.request_id);assert.ok(f.posts.every(p=>p.path==='/api/payment-control/run'));assert.equal(f.value.starting,false);
});
test('a workspace revision refresh during pending start cannot leave the button locked',async t=>{
 const f=await hookFixture(t);f.initialRelease();await f.flush();let release;const gate=new Promise(r=>release=r);f.onPost=async()=>{await gate;return Response.json({job:{id:'revision-run',status:'partial',steps:[]}});};const first=f.value.start();await f.flush();await f.value.start();assert.equal(f.posts.length,1);f.revision++;f.render();await f.flush();release();await first;await f.flush();assert.equal(f.value.starting,false);assert.equal(f.value.busy,false);await f.value.start();assert.equal(f.posts.length,2);
});
test('identity loss clears private run state and ignores a late start response',async t=>{
 const f=await hookFixture(t);f.initialRelease();await f.flush();let release;const gate=new Promise(r=>release=r);f.onPost=async()=>{await gate;return Response.json({job:{id:'PRIVATE',status:'partial',steps:[]}});};const pending=f.value.start();await f.flush();f.enabled=false;f.render();await f.flush();release();await pending;await f.flush();assert.equal(f.value.data,null);assert.equal(f.value.starting,false);
});

test('an overview begun during start cannot erase the newly accepted running job',async t=>{
 const f=await hookFixture(t);f.initialRelease();await f.flush();let releaseStart,releaseRead;
 const startGate=new Promise(r=>releaseStart=r),readGate=new Promise(r=>releaseRead=r);
 f.onPost=async()=>{await startGate;return Response.json({job:{id:'new-running-job',status:'running',steps:[]}});};
 const pending=f.value.start();await f.flush();f.onOverview=async()=>{await readGate;return Response.json({run:null,totals:{},counts:{},queue:[],connections:{gmail:{},bank:{},ocr:{}}});};
 f.revision++;f.render();await f.flush();releaseStart();await pending;await f.flush();assert.equal(f.value.data.run.id,'new-running-job');
 releaseRead();await f.flush();assert.equal(f.value.data.run.id,'new-running-job');assert.equal(f.value.busy,true);
});
test('verified bank-source rows still need identification until their incoming amount is allocated',async()=>{
 const {needsPaymentIdentification}=await import('../components/payment-bank-filter.ts');
 const transaction={verified:true,ignored:false,duplicateOf:'',payerReference:'',party:''};
 assert.equal(needsPaymentIdentification(transaction,180000,'incoming'),true);
 assert.equal(needsPaymentIdentification(transaction,0,'matched'),false);
 assert.equal(needsPaymentIdentification(transaction,40538,'other'),false);
 assert.equal(needsPaymentIdentification({...transaction,ignored:true},180000,'excluded'),false);
});

const {default:EconomyOverview}=await import(compiled('../components/economy-overview.tsx',{'./payment-control':compiled('../components/payment-control.tsx')}));
const {emptyState:emptyEconomyState}=await import('../lib/domain.ts');
const {economySummary}=await import('../lib/economy-summary.js');
const noAction=()=>{throw Error('Rendering must not perform side effects');};
const economyProps=()=>({state:emptyEconomyState(),data:null,loading:false,error:'',demo:false,signedIn:true,busy:false,start:noAction,open:noAction,task:noAction,invoice:noAction,demoToggle:noAction});
test('economy cards render four unknown values until loaded and never show a false empty queue',()=>{const html=render(EconomyOverview,economyProps());assert.equal((html.match(/class="economy-card"/g)||[]).length,4);assert.equal((html.match(/<strong>—<\/strong>/g)||[]).length,4);assert.doesNotMatch(html,/Inget i den här kön|0,00/);assert.match(html,/Hämtar ekonomiöversikten/);});
test('economy error hides stale amounts instead of suggesting zero',()=>{const p=economyProps();p.data={economy:economySummary(p.state,'2026-10-28'),counts:{},queue:[],connections:{gmail:{},bank:{},ocr:{}}};p.error='network error';const html=render(EconomyOverview,p);assert.match(html,/role="alert"/);assert.match(html,/Beloppen visas inte som noll/);assert.doesNotMatch(html,/0,00/);assert.equal((html.match(/<strong>—<\/strong>/g)||[]).length,4);});
test('economy displays incomplete bank evidence and distinguishes verified payer from customer',()=>{const p=economyProps();p.state.invoices.push({id:'i',number:'0594',party:'<script>customer</script>',direction:'receivable',reviewed:true,total:10000,currency:'SEK',due:'2026-11-30'});p.state.transactions.push({id:'t',date:'2026-10-28',amount:10000,currency:'SEK',verified:true,kind:'payment',party:'Actual payer',payerReference:'0594'},{id:'batch',amount:20000,currency:'SEK',kind:'batch'});p.state.allocations.push({id:'a',invoiceId:'i',transactionId:'t',amount:10000,effect:'payment',active:true});p.data={economy:economySummary(p.state,'2026-10-28'),counts:{review:1,processing:2},queue:[],connections:{gmail:{history_incomplete:true},bank:{},ocr:{}}};const html=render(EconomyOverview,p);assert.match(html,/Översikten är preliminär/);assert.match(html,/saknar komplett betalningsspecifikation/);assert.match(html,/Fler Gmail-underlag/);assert.match(html,/0594/);assert.match(html,/Actual payer/);assert.match(html,/&lt;script&gt;customer/);assert.doesNotMatch(html,/<script/);assert.match(html,/Inga kundmejl skickas/);});
