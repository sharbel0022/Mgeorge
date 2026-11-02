import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {renderToStaticMarkup} from 'react-dom/server';
import {emptyState} from '../lib/domain.ts';

const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const file=path=>new URL(path,import.meta.url).href;
function compiled(path,imports={}){
  let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  for(const [name,url]of Object.entries({'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'lucide-react':import.meta.resolve('lucide-react'),'@/lib/domain':file('../lib/domain.ts'),'./domain':file('../lib/domain.ts'),'./reconciliation-engine.js':file('../lib/reconciliation-engine.js'),'./payment-references.js':file('../lib/payment-references.js'),...imports}))for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(url));
  return data(code);
}
const nodes=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
const text=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(' '):typeof node==='object'?text(node.props?.children):String(node);
const flush=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setImmediate(resolve));};
const invoice=(id='invoice-a',documentId='')=>({id,direction:'receivable',party:'Synthetic customer '+id,email:'synthetic@example.test',number:id,ocr:'',total:10000,currency:'SEK',issued:'2026-10-01',due:'2026-11-01',reviewed:true,voided:false,note:'',bankgiro:'',documentId,source:'Synthetic fixture',createdAt:'2026-10-01'});
const message=(id='message-a',invoiceId='invoice-a')=>({id,status:'draft',version:1,kind:'partial',invoice:{id:invoiceId,party:'Synthetic customer',number:invoiceId},facts:{total_cents:10000,paid_cents:0,remaining_cents:10000},payments:[],findings:[],subject:'Synthetic subject '+id,body:'Synthetic body '+id,recipient:'synthetic@example.test',review_id:'synthetic-review'});

// Exercise the real TSX with controlled network responses. The hook runner follows
// the existing UI race-test pattern and can inspect the render before effects run.
async function fixture(t,{component='evidence',props={}}={}){
  const key='__evidence_loading_'+crypto.randomUUID().replaceAll('-','');
  const f={slots:[],cursor:0,effects:[],closed:false,scheduled:false,requests:[],analyses:0,revoked:[],props};globalThis[key]=f;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,n)=>Object.is(value,b[n]));
  f.schedule=()=>{if(f.closed||f.scheduled)return;f.scheduled=true;queueMicrotask(()=>{f.scheduled=false;f.render();});};
  f.state=initial=>{const n=f.cursor++;f.slots[n]??={value:typeof initial==='function'?initial():initial};return [f.slots[n].value,value=>{f.slots[n].value=typeof value==='function'?value(f.slots[n].value):value;f.schedule();}];};
  f.ref=initial=>{const n=f.cursor++;f.slots[n]??={current:initial};return f.slots[n];};
  f.memo=(fn,deps)=>{const n=f.cursor++;if(!same(f.slots[n]?.deps,deps))f.slots[n]={value:fn(),deps};return f.slots[n].value;};
  f.effect=(fn,deps)=>{const n=f.cursor++;if(!same(f.slots[n]?.deps,deps))f.effects.push(()=>{f.slots[n]?.cleanup?.();f.slots[n]={deps,cleanup:fn()};});};
  const ref=`globalThis[${JSON.stringify(key)}]`,react=data(`const f=${ref};export const useState=(...a)=>f.state(...a),useRef=(...a)=>f.ref(...a),useMemo=(...a)=>f.memo(...a),useEffect=(...a)=>f.effect(...a);`);
  const reconciliation=compiled('../lib/reconciliation.ts');
  const measured=data(`import {analyze as realAnalyze} from ${JSON.stringify(reconciliation)};export function analyze(state){${ref}.analyses++;return realAnalyze(state);}`);
  const {default:Component}=await import(compiled(component==='messages'?'../components/customer-messages.tsx':'../components/invoice-evidence.tsx',{react,'@/lib/reconciliation':measured,'@/lib/payment-presentation':compiled('../lib/payment-presentation.ts')}));
  const originalRevoke=URL.revokeObjectURL;t.mock.method(URL,'revokeObjectURL',url=>{f.revoked.push(url);originalRevoke.call(URL,url);});
  t.mock.method(globalThis,'fetch',(path,options={})=>new Promise((resolve,reject)=>{f.requests.push({path,options,resolve,reject});}));
  f.commit=()=>{for(const effect of f.effects.splice(0))effect();};
  f.render=(commit=true)=>{if(f.closed)return;f.cursor=0;f.tree=Component(f.props);if(commit)f.commit();};
  f.html=()=>renderToStaticMarkup(f.tree);f.find=predicate=>nodes(f.tree).find(predicate);
  f.pending=(path)=>f.requests.find(request=>request.path===path&&!request.done);
  f.reply=(path,body,status=200)=>{const request=f.pending(path);assert.ok(request,'Expected pending '+path);request.done=true;request.resolve(Response.json(body,{status}));};
  f.image=path=>{const request=f.pending(path);assert.ok(request,'Expected pending '+path);request.done=true;request.resolve(new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}}));};
  f.change=next=>{f.props={...f.props,...next};f.render(false);};
  t.after(()=>{f.closed=true;for(const slot of f.slots)slot?.cleanup?.();for(const request of f.requests)if(!request.done)request.reject(new DOMException('Closed fixture','AbortError'));delete globalThis[key];});
  if(component==='evidence'){
    const i=props.invoice||invoice(),state=props.state||emptyState();if(!state.invoices.length)state.invoices.push(i);
    f.props={invoice:i,state,demo:false,onMessage(){},openTransaction(){},...props};
  }else f.props={embedded:true,...props};
  f.render();await flush();return f;
}
const emptyMessages=html=>assert.match(html,/Inget aktuellt mejlutkast/);
const notEmptyMessages=html=>assert.doesNotMatch(html,/Inget aktuellt mejlutkast/);

test('invoice evidence keeps a pending message read distinct from a successful empty result',async t=>{
  const f=await fixture(t);notEmptyMessages(f.html());assert.match(f.html(),/Hämtar.*mejlutkast/s);
  f.reply('/api/customer-messages/list',{items:[]});await flush();emptyMessages(f.html());
  assert.deepEqual(f.requests.map(r=>[r.path,r.options.method||'GET']),[['/api/customer-messages/list','GET']]);
});
test('a failed message read does not claim no draft and does not hide a successful original preview',async t=>{
  const f=await fixture(t,{props:{invoice:invoice('invoice-a','original-a')}});
  f.reply('/api/customer-messages/list',{error:'Synthetic message unavailable'},503);f.image('/api/files?id=original-a');await flush();
  notEmptyMessages(f.html());assert.match(f.html(),/Mejlutkasten kunde inte hämtas/);assert.ok(f.find(n=>n.type==='img'));
  assert.match(f.html(),/Öppna hela originalet/);
});
test('malformed draft data is unavailable instead of rendered as trusted message text',async t=>{
  const f=await fixture(t);f.reply('/api/customer-messages/list',{items:[{...message(),subject:42}]});await flush();
  assert.match(f.html(),/Mejlutkasten kunde inte hämtas/);notEmptyMessages(f.html());assert.doesNotMatch(f.html(),/Synthetic body message-a/);
});
test('changing invoice identity hides the prior draft and preview before the next effect runs',async t=>{
  const f=await fixture(t,{props:{invoice:invoice('invoice-a','original-a')}});
  f.reply('/api/customer-messages/list',{items:[message()]});f.image('/api/files?id=original-a');await flush();
  const oldPreview=f.find(n=>n.type==='img').props.src;assert.match(f.html(),/Synthetic subject message-a/);
  f.change({invoice:invoice('invoice-b','original-b')});
  assert.doesNotMatch(f.html(),/Synthetic subject message-a/);assert.equal(f.find(n=>n.type==='img'),undefined);notEmptyMessages(f.html());
  f.commit();await flush();assert.ok(f.revoked.includes(oldPreview));
  f.reply('/api/customer-messages/list',{items:[message('message-b','invoice-b')]});f.image('/api/files?id=original-b');await flush();
  assert.match(f.html(),/Synthetic subject message-b/);assert.notEqual(f.find(n=>n.type==='img').props.src,oldPreview);
});
test('returning to a loaded invoice through a pending invoice starts a new evidence visit',async t=>{
  const a=invoice('invoice-a','original-a'),f=await fixture(t,{props:{invoice:a}});
  f.reply('/api/customer-messages/list',{items:[message()]});f.image('/api/files?id=original-a');await flush();
  const oldPreview=f.find(n=>n.type==='img').props.src;
  f.change({invoice:invoice('invoice-b','original-b')});f.commit();await flush();
  const bMessages=f.pending('/api/customer-messages/list'),bOriginal=f.pending('/api/files?id=original-b');assert.ok(f.revoked.includes(oldPreview));
  f.change({invoice:a});
  assert.doesNotMatch(f.html(),/Synthetic subject message-a/);assert.equal(f.find(n=>n.type==='img'),undefined);assert.match(f.html(),/Hämtar aktuella mejlutkast/);assert.match(f.html(),/Hämtar originalförhandsvisningen/);
  f.commit();await flush();bMessages.done=true;bOriginal.done=true;
  f.reply('/api/customer-messages/list',{items:[message('message-a-new')]});f.image('/api/files?id=original-a');await flush();
  assert.match(f.html(),/Synthetic subject message-a-new/);assert.notEqual(f.find(n=>n.type==='img').props.src,oldPreview);
  const current=f.html();bMessages.resolve(Response.json({items:[message('late-b','invoice-b')]}));bOriginal.resolve(new Response(new Uint8Array([1]),{headers:{'Content-Type':'image/png'}}));await flush();assert.equal(f.html(),current);
  // A second round trip is inspected before either queued effect runs.
  f.change({invoice:invoice('invoice-b','original-b')});f.change({invoice:a});
  assert.doesNotMatch(f.html(),/Synthetic subject message-a-new/);assert.equal(f.find(n=>n.type==='img'),undefined);assert.match(f.html(),/Hämtar aktuella mejlutkast/);
});
for(const mode of ['demo','originalOnly'])test(`leaving ${mode} does not revive an earlier draft or revoked preview`,async t=>{
  const f=await fixture(t,{props:{invoice:invoice('invoice-a','original-a')}});
  f.reply('/api/customer-messages/list',{items:[message()]});f.image('/api/files?id=original-a');await flush();
  const oldPreview=f.find(n=>n.type==='img').props.src;
  f.change({[mode]:true});f.commit();await flush();const intermediate=f.pending('/api/files?id=original-a');
  f.change({[mode]:false});assert.equal(f.find(n=>n.type==='img'),undefined);assert.doesNotMatch(f.html(),/Synthetic subject message-a/);assert.match(f.html(),/Hämtar aktuella mejlutkast/);
  f.commit();await flush();if(intermediate)intermediate.done=true;
  f.reply('/api/customer-messages/list',{items:[message('message-a-refreshed')]});f.image('/api/files?id=original-a');await flush();
  assert.match(f.html(),/Synthetic subject message-a-refreshed/);assert.notEqual(f.find(n=>n.type==='img').props.src,oldPreview);assert.ok(f.revoked.includes(oldPreview));
  if(intermediate){const current=f.html();intermediate.resolve(new Response(new Uint8Array([1]),{headers:{'Content-Type':'image/png'}}));await flush();assert.equal(f.html(),current);}
});
test('retry hides an earlier successful preview until new evidence reads finish',async t=>{
  const f=await fixture(t,{props:{invoice:invoice('invoice-a','original-a')}});
  f.reply('/api/customer-messages/list',{error:'Synthetic unavailable'},503);f.image('/api/files?id=original-a');await flush();
  const oldPreview=f.find(n=>n.type==='img').props.src;
  f.find(n=>n.type==='button'&&text(n)==='Hämta underlag igen').props.onClick();await flush();
  assert.equal(f.find(n=>n.type==='img'),undefined);assert.match(f.html(),/Hämtar aktuella mejlutkast/);assert.ok(f.revoked.includes(oldPreview));
  f.reply('/api/customer-messages/list',{items:[message('message-a-retried')]});f.image('/api/files?id=original-a');await flush();
  assert.match(f.html(),/Synthetic subject message-a-retried/);assert.notEqual(f.find(n=>n.type==='img').props.src,oldPreview);assert.ok(f.requests.every(r=>(r.options.method||'GET')==='GET'));
});
test('late responses for a previous invoice cannot replace current evidence even if transport ignores abort',async t=>{
  const f=await fixture(t,{props:{invoice:invoice('invoice-a','original-a')}}),oldMessages=f.pending('/api/customer-messages/list'),oldOriginal=f.pending('/api/files?id=original-a');
  f.change({invoice:invoice('invoice-b','original-b')});f.commit();await flush();
  oldMessages.done=true;oldOriginal.done=true;
  f.reply('/api/customer-messages/list',{items:[message('message-b','invoice-b')]});f.image('/api/files?id=original-b');await flush();
  const current=f.html();oldMessages.resolve(Response.json({items:[message()]}));oldOriginal.resolve(new Response(new Uint8Array([1]),{headers:{'Content-Type':'image/png'}}));await flush();
  assert.equal(f.html(),current);assert.doesNotMatch(f.html(),/Synthetic subject message-a/);
});
test('an error for a previous original is not presented as an error for the newly selected invoice',async t=>{
  const f=await fixture(t,{props:{invoice:invoice('invoice-a','original-a')}});
  f.reply('/api/customer-messages/list',{items:[]});f.reply('/api/files?id=original-a',{error:'Synthetic unavailable'},503);await flush();assert.match(f.html(),/Originalförhandsvisningen kunde inte hämtas/);
  f.change({invoice:invoice('invoice-b','original-b')});assert.doesNotMatch(f.html(),/Originalförhandsvisningen kunde inte hämtas/);assert.match(f.html(),/Förbereder.*original|Hämtar.*original/s);
});
test('original-only evidence does not run reconciliation or fetch customer drafts',async t=>{
  const f=await fixture(t,{props:{invoice:invoice('invoice-a','original-a'),originalOnly:true}});
  assert.equal(f.analyses,0);assert.deepEqual(f.requests.map(r=>r.path),['/api/files?id=original-a']);
  f.image('/api/files?id=original-a');await flush();assert.equal(f.analyses,0);assert.ok(f.find(n=>n.type==='img'));
});
test('preview and draft completion reuse unchanged analysis while a new state recomputes it',async t=>{
  const f=await fixture(t,{props:{invoice:invoice('invoice-a','original-a')}}),snapshot=JSON.stringify(f.props.state);
  assert.equal(f.analyses,1);f.reply('/api/customer-messages/list',{items:[message()]});f.image('/api/files?id=original-a');await flush();assert.equal(f.analyses,1);
  f.change({state:structuredClone(f.props.state)});f.commit();await flush();assert.equal(f.analyses,2);assert.equal(JSON.stringify(f.props.state),snapshot);
});
test('demo evidence does not claim a live draft read or expose real draft results',async t=>{
  const f=await fixture(t,{props:{demo:true}});assert.equal(f.requests.length,0);assert.match(f.html(),/Demoläget.*mejlutkast/s);notEmptyMessages(f.html());
});

const noInventedQueue=html=>{assert.doesNotMatch(html,/Inga kundmeddelanden att granska/);assert.doesNotMatch(html,/Nytt Google-medgivande behövs för utskick/);};
test('message workspace leaves queue size and Gmail permission unknown while initial reads are pending',async t=>{
  const f=await fixture(t,{component:'messages'});noInventedQueue(f.html());assert.match(f.html(),/Hämtar.*(?:kundmeddelanden|granskningskön)/s);
  const reconcile=f.find(n=>n.type==='button'&&text(n)==='Uppdatera avstämning och kö');assert.equal(reconcile.props.disabled,true);
  assert.ok(f.requests.every(r=>(r.options.method||'GET')==='GET'));
});
test('failed message status shows a read-only retry and never asserts no drafts or missing permission',async t=>{
  const f=await fixture(t,{component:'messages'});
  f.reply('/api/customer-messages/list',{error:'Synthetic queue unavailable'},503);f.reply('/api/gmail/status?summary=1',{send_enabled:true});await flush();noInventedQueue(f.html());assert.match(f.html(),/Synthetic queue unavailable/);
  const retry=f.find(n=>n.type==='button'&&text(n)==='Hämta status igen');assert.ok(retry);const retryPromise=retry.props.onClick();await flush();
  f.reply('/api/customer-messages/list',{items:[]});f.reply('/api/gmail/status?summary=1',{send_enabled:false});await retryPromise;await flush();
  assert.match(f.html(),/Inga kundmeddelanden att granska/);assert.match(f.html(),/Nytt Google-medgivande behövs för utskick/);assert.ok(f.requests.every(r=>(r.options.method||'GET')==='GET'));
});
test('loaded empty messages allow an empty result without inventing omitted Gmail permission',async t=>{
  const f=await fixture(t,{component:'messages'});f.reply('/api/customer-messages/list',{items:[]});f.reply('/api/gmail/status?summary=1',{});await flush();
  assert.match(f.html(),/Inga kundmeddelanden att granska/);assert.doesNotMatch(f.html(),/Nytt Google-medgivande behövs för utskick|Utskicksbehörighet finns/);assert.match(f.html(),/Utskicksbehörighet.*(?:okänd|inte bekräftad)/);
});
test('a failed Gmail permission read withholds the queue and its action buttons until a successful retry',async t=>{
  const f=await fixture(t,{component:'messages'});f.reply('/api/customer-messages/list',{items:[message()]});f.reply('/api/gmail/status?summary=1',{error:'Synthetic status unavailable'},503);await flush();
  noInventedQueue(f.html());assert.match(f.html(),/Gmail-status kunde inte hämtas/);assert.equal(f.find(n=>n.type==='button'&&text(n)==='Läs och granska'),undefined);
  assert.equal(f.find(n=>n.type==='button'&&text(n)==='Aktivera Gmail-utskick').props.disabled,true);
});
