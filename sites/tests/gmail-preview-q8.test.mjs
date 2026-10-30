import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const file=path=>new URL(path,import.meta.url).href;
function compiled(path,imports={}){
  let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  for(const [name,url] of Object.entries({'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'@/lib/domain':file('../lib/domain.ts'),'./domain':file('../lib/domain.ts'),'./document-triage.js':file('../lib/document-triage.js'),...imports}))for(const q of ['"',"'"])code=code.replaceAll(q+name+q,JSON.stringify(url));
  return data(code);
}
const fieldsUrl=compiled('../lib/invoice-fields.js'),fields=await import(fieldsUrl);
const originalText='Faktura\nFakturanummer: SYN-001\nLeverantör: Original supplier AB\nOrg.nr: 556016-0680\nFakturadatum: 24/10/2026\nFörfallodag: 07/11/2026\nBelopp före moms: 2 500,00 SEK\nTotal moms: 625,00 SEK\nSumma att betala: 3 125,00 SEK\nBankgiro: 123-4567';
const extraction=()=>fields.interpretInvoice(originalText,{direction:'supplier',direction_confident:true,method:'pdf',filename:'synthetic.png',subject:'Synthetic invoice'});
const elements=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(elements):[node,...elements(node.props?.children)];
const text=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(' '):typeof node==='object'?text(node.props?.children):String(node);

async function fixture(t,{stored=null,processing=null,pending=0,connected=false}={}){
  const key='__gmail_preview_'+crypto.randomUUID().replaceAll('-',''),f={slots:[],cursor:0,effects:[],scheduled:false,closed:false,requests:[]};globalThis[key]=f;
  const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((v,n)=>Object.is(v,b[n]));
  f.state=initial=>{const n=f.cursor++;f.slots[n]??={value:typeof initial==='function'?initial():initial};return[f.slots[n].value,value=>{f.slots[n].value=typeof value==='function'?value(f.slots[n].value):value;f.schedule();}];};
  f.ref=initial=>{const n=f.cursor++;f.slots[n]??={current:initial};return f.slots[n];};
  f.effect=(fn,deps)=>{const n=f.cursor++;if(!equal(f.slots[n]?.deps,deps))f.effects.push(()=>{f.slots[n]?.cleanup?.();f.slots[n]={deps,cleanup:fn()};});};
  f.schedule=()=>{if(f.closed||f.scheduled)return;f.scheduled=true;queueMicrotask(()=>{f.scheduled=false;f.render();});};
  const ref=`globalThis[${JSON.stringify(key)}]`,react=data(`const f=${ref};export const useState=(...a)=>f.state(...a),useRef=(...a)=>f.ref(...a),useEffect=(...a)=>f.effect(...a);`);
  const module=await import(compiled('../components/gmail-workspace.tsx',{
    react,'@/lib/document-triage.js':file('../lib/document-triage.js'),'@/lib/invoice-fields.js':fieldsUrl,
    '@/lib/imports':data(`export async function readInvoiceFile(){return {text:${JSON.stringify(originalText)}};}`),
    '@/lib/local-ocr':data("export async function pdfPreview(file){return file;}"),
    './document-ocr-status':compiled('../components/document-ocr-status.tsx'),
    './sync-recovery-notice':compiled('../components/sync-recovery-notice.tsx'),
  }));
  f.doc={document_id:'synthetic-doc',filename:'synthetic.png',mime:'image/png',metadata:JSON.stringify({direction:'supplier',direction_confident:true,subject:'Synthetic invoice',from:'supplier@example.test',to:'owner@example.test'}),status:'needs_review',processing_state:'needs_review',created_at:'2026-10-30T00:00:00Z',extraction:JSON.stringify(stored||{}),processing_extraction:JSON.stringify(processing||{})};
  f.response={registered:true};f.processResponse={processed:0};f.syncResponse={imported:0,duplicates:0};f.status={email:'owner@example.test',configured:true,candidates:[f.doc],runs:[],processing:{registered:0,aftercheck_pending:pending},...(connected?{connection:{status:'connected'}}:{})};
  t.mock.method(globalThis,'fetch',async(path,options={})=>{
    const request={path,method:options.method||'GET',...(options.body?{body:JSON.parse(options.body)}:{})};f.requests.push(request);
    if(path==='/api/gmail/status')return Response.json(f.status);
    if(path==='/api/files?id=synthetic-doc')return new Response('synthetic original bytes',{headers:{'Content-Type':'image/png'}});
    if(path==='/api/gmail/review'&&request.method==='POST')return Response.json(f.response);
    if(path==='/api/gmail/process'&&request.method==='POST')return Response.json(f.processResponse);
    if(path==='/api/gmail/sync'&&request.method==='POST')return Response.json(f.syncResponse);
    throw Error('Unexpected request '+path);
  });
  f.render=()=>{if(f.closed)return;f.cursor=0;f.tree=module.default({initialDocumentId:'synthetic-doc',embedded:true});for(const effect of f.effects.splice(0))effect();};
  f.flush=async()=>{for(let n=0;n<10;n++)await new Promise(r=>setImmediate(r));};
  f.find=predicate=>elements(f.tree).find(predicate);f.posts=()=>f.requests.filter(r=>r.method==='POST');
  t.after(()=>{f.closed=true;for(const slot of f.slots)slot?.cleanup?.();delete globalThis[key];});
  f.render();await f.flush();assert.ok(f.find(n=>n.type==='form'),'The synthetic document must open for review');return f;
}

test('Q8: selecting a Gmail document opens its original using reads only',async t=>{
  const f=await fixture(t);
  assert.deepEqual(f.requests.map(r=>[r.method,r.path]),[['GET','/api/gmail/status'],['GET','/api/files?id=synthetic-doc']]);
  assert.ok(f.find(n=>n.type==='img'&&n.props.alt==='Originalfaktura, första sidan'));
  f.find(n=>n.type==='button'&&text(n)==='Stäng').props.onClick();await f.flush();assert.equal(f.posts().length,0);
});
test('Q8: explicit approval sends original extraction with the separately corrected invoice fields',async t=>{
  const f=await fixture(t);
  f.find(n=>n.type==='input'&&n.props.value==='Original supplier AB').props.onChange({target:{value:'Corrected supplier AB'}});await f.flush();
  f.find(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.required).props.onChange({target:{checked:true}});await f.flush();
  await f.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await f.flush();
  assert.equal(f.posts().length,1);const request=f.posts()[0];assert.equal(request.body.confirm,true);assert.equal(request.body.invoice.party,'Corrected supplier AB');assert.equal(request.body.extraction.fields.party.value,'Original supplier AB');
});
test('Q8: explicit rejection sends the displayed original extraction once',async t=>{
  const f=await fixture(t);f.response={rejected:true};
  await f.find(n=>n.type==='button'&&text(n)==='Avvisa').props.onClick();await f.flush();
  assert.equal(f.posts().length,1);assert.equal(f.posts()[0].body.reject,true);assert.equal(f.posts()[0].body.extraction.fields.invoice_number.value,'SYN-001');
});
test('Q8: preview uses retained first extraction when no later worker extraction exists',async t=>{
  const stored=extraction();stored.fields.party.value='Retained first supplier';const f=await fixture(t,{stored});
  assert.ok(f.find(n=>n.type==='input'&&n.props.value==='Retained first supplier'));assert.equal(f.posts().length,0);
});
test('Q8: preview uses the latest worker extraction while retaining the prior source separately',async t=>{
  const stored=extraction(),processing=extraction();stored.fields.party.value='First supplier';processing.fields.party.value='Current worker supplier';const f=await fixture(t,{stored,processing});
  assert.ok(f.find(n=>n.type==='input'&&n.props.value==='Current worker supplier'));assert.equal(f.doc.extraction,JSON.stringify(stored));assert.equal(f.posts().length,0);
});
test('Q8: registration UI keeps the committed outcome and reports a pending after-check',async t=>{
  const f=await fixture(t);f.response={registered:true,aftercheck_pending:true,warning:'Fakturan är registrerad. Efterkontrollen behöver köras igen via betalningskontrollen.'};
  f.find(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.required).props.onChange({target:{checked:true}});await f.flush();
  await f.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await f.flush();
  const message=f.find(n=>n.type==='p'&&n.props.role==='status'&&text(n).includes('registrerad'));assert.ok(message);assert.match(text(message),/Efterkontrollen.*betalningskontrollen/);
});
test('Q8: a reloaded OCR status retains the registration after-check warning',async()=>{
  const {DocumentOcrStatus}=await import(compiled('../components/document-ocr-status.tsx'));
  const html=renderToStaticMarkup(React.createElement(DocumentOcrStatus,{processing:{enabled:true,aftercheck_pending:2}}));
  assert.match(html,/2 registrerade.*efterkontroll/i);assert.match(html,/betalningskontrollen/i);assert.doesNotMatch(html,/Tolka igen/);
});
test('Q8 review: processing UI reports a metadata warning while keeping the accepted work visible',async t=>{
  const f=await fixture(t);f.processResponse={processed:1,metadata_warning:'Underlaget är sparat. Körningens tidsstämpel kunde inte uppdateras.'};
  await f.find(n=>n.type==='button'&&text(n)==='Tolka väntande underlag').props.onClick();await f.flush();
  const message=f.find(n=>n.type==='p'&&n.props.role==='status'&&text(n).includes('sparat'));assert.ok(message);assert.match(text(message),/tidsstämpel kunde inte uppdateras/);assert.equal(f.posts().length,1);
});
test('Q8 finalizer: Gmail sync UI retains the accepted count and uncertain final-status warning',async t=>{
  const f=await fixture(t,{connected:true});
  f.syncResponse={imported:0,duplicates:1,processing:{processed:2,status_unknown:true},status_unknown:true,metadata_warning:'Bearbetningsresultatet är sparat. Gmail-körningens slutstatus kunde inte bekräftas.'};
  await f.find(n=>n.type==='button'&&text(n)==='Hämta fakturaunderlag').props.onClick();await f.flush();
  const message=f.find(n=>n.type==='p'&&n.props.role==='status'&&text(n).includes('slutstatus'));assert.ok(message);assert.match(text(message),/2 underlag.*bearbetade/);assert.match(text(message),/0 nya underlag/);assert.equal(f.posts().length,1);
});
test('Q8: review diagnostics explain overlap and coverage without presenting old extraction as a new verification',async()=>{
  const {DocumentOcrStatus}=await import(compiled('../components/document-ocr-status.tsx'));
  const html=renderToStaticMarkup(React.createElement(DocumentOcrStatus,{processing:{review_reasons:{basis:'stored_extraction',total:503,analyzed:500,limit:500,truncated:true,counts:{missing_dates:183,unverified_counterparty:175,possible_duplicate:2}}}}));
  assert.match(html,/500 av 503/);assert.match(html,/flera orsaker/);assert.match(html,/sparade tolkning/i);assert.match(html,/183/);assert.match(html,/datum/i);assert.match(html,/175/);assert.match(html,/motpart/i);assert.match(html,/2/);assert.match(html,/dubblett/i);
});
