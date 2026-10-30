import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {renderToStaticMarkup} from 'react-dom/server';

const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
function compile(path,imports={}){
  let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  for(const [name,url] of Object.entries({'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'@/lib/domain':new URL('../lib/domain.ts',import.meta.url).href,...imports}))for(const q of [String.fromCharCode(34),String.fromCharCode(39)])code=code.replaceAll(q+name+q,JSON.stringify(url));
  return data(code);
}
const emptyStatus=()=>({email:'synthetic@example.test',configured:true,connection:{status:'connected'},candidates:[],runs:[],last_successful_fetch:'',processing:{enabled:true,registered:0,counts:{},last_processed:''}});
const text=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(' '):typeof node==='object'?text(node.props?.children):String(node);
const elements=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(elements):[node,...elements(node.props?.children)];
async function fixture(t,{pending=false,status=200,body=emptyStatus()}={}){
  const key='__gmail_loading_'+crypto.randomUUID().replaceAll('-',''),f={slots:[],cursor:0,effects:[],requests:[],closed:false,scheduled:false,status,body};globalThis[key]=f;
  const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((value,n)=>Object.is(value,b[n]));
  f.state=initial=>{const n=f.cursor++;f.slots[n]??={value:typeof initial==='function'?initial():initial};return [f.slots[n].value,value=>{f.slots[n].value=typeof value==='function'?value(f.slots[n].value):value;f.schedule();}];};
  f.ref=initial=>{const n=f.cursor++;f.slots[n]??={current:initial};return f.slots[n];};
  f.effect=(fn,deps)=>{const n=f.cursor++;if(!equal(f.slots[n]?.deps,deps))f.effects.push(()=>{f.slots[n]?.cleanup?.();f.slots[n]={deps,cleanup:fn()};});};
  f.schedule=()=>{if(f.closed||f.scheduled)return;f.scheduled=true;queueMicrotask(()=>{f.scheduled=false;f.render();});};
  const ref=`globalThis[${JSON.stringify(key)}]`,react=data(`const f=${ref};export const useState=(...a)=>f.state(...a),useRef=(...a)=>f.ref(...a),useEffect=(...a)=>f.effect(...a);`);
  const noRead=data('export async function readInvoiceFile(){throw Error("No original read expected");}export async function pdfPreview(){throw Error("No original read expected");}export function interpretInvoice(){throw Error("No interpretation expected");}');
  const {default:Workspace}=await import(compile('../components/gmail-workspace.tsx',{react,'@/lib/document-triage.js':new URL('../lib/document-triage.js',import.meta.url).href,'@/lib/local-ocr':noRead,'@/lib/imports':noRead,'@/lib/invoice-fields.js':noRead,'./document-ocr-status':compile('../components/document-ocr-status.tsx'),'./sync-recovery-notice':compile('../components/sync-recovery-notice.tsx')}));
  let release;const gate=pending?new Promise(resolve=>{release=resolve;}):Promise.resolve();
  t.mock.method(globalThis,'fetch',async(path,options={})=>{f.requests.push({path,method:options.method||'GET'});assert.equal(path,'/api/gmail/status');assert.equal(options.method||'GET','GET');await gate;return Response.json(f.body,{status:f.status});});
  f.render=()=>{if(f.closed)return;f.cursor=0;f.tree=Workspace({embedded:true});for(const effect of f.effects.splice(0))effect();};
  f.flush=async()=>{for(let n=0;n<10;n++)await new Promise(resolve=>setImmediate(resolve));};
  f.html=()=>renderToStaticMarkup(f.tree);f.find=predicate=>elements(f.tree).find(predicate);
  t.after(()=>{f.closed=true;release?.();for(const slot of f.slots)slot?.cleanup?.();delete globalThis[key];});f.render();await f.flush();return f;
}
const noInventedEmptyState=html=>{
  assert.doesNotMatch(html,/Registrerade underlag: 0|Misslyckade jobb: 0|0 behöver granskning|0 bearbetas eller väntar/);
  assert.doesNotMatch(html,/Hämta fakturabilagor eller koppla Gmail för att börja|Ingen hämtning ännu|Senaste bearbetning: Ingen ännu/);
};
test('Q8 UI status: pending Gmail status does not invent zero counts or an empty queue',async t=>{
  const f=await fixture(t,{pending:true});noInventedEmptyState(f.html());assert.match(f.html(),/Hämtar status/);assert.equal(f.requests.length,1);
});
test('Q8 UI status: failed initial Gmail status is unavailable rather than empty or still loading',async t=>{
  const f=await fixture(t,{status:503,body:{error:'Synthetic status unavailable'}});noInventedEmptyState(f.html());assert.match(f.html(),/Synthetic status unavailable/);assert.match(f.html(),/Status kunde inte hämtas/);assert.doesNotMatch(f.html(),/Gmail – Hämtar status/);
});
test('Q8 UI status: a successful loaded empty response can honestly show zero counts and empty-queue guidance',async t=>{
  const f=await fixture(t);assert.match(f.html(),/Registrerade underlag: 0/);assert.match(f.html(),/Misslyckade jobb: 0/);assert.match(f.html(),/0 behöver granskning/);assert.match(f.html(),/Hämta fakturabilagor eller koppla Gmail för att börja/);assert.match(f.html(),/Ingen hämtning ännu/);
});
test('Q8 UI status: retrying unavailable status performs reads and reveals real loaded counts',async t=>{
  const f=await fixture(t,{status:503,body:{error:'Synthetic status unavailable'}});f.status=200;f.body=emptyStatus();
  const retry=f.find(node=>node.type==='button'&&text(node)==='Hämta status igen');assert.ok(retry);await retry.props.onClick();await f.flush();assert.match(f.html(),/Registrerade underlag: 0/);assert.deepEqual(f.requests,[{path:'/api/gmail/status',method:'GET'},{path:'/api/gmail/status',method:'GET'}]);
});
