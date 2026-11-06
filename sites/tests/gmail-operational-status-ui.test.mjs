import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
function compile(path,imports={}){
  let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  for(const [name,url]of Object.entries({'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'@/lib/domain':new URL('../lib/domain.ts',import.meta.url).href,...imports}))for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(url));
  return moduleUrl(code);
}
const status=()=>({
  configured:true,email:'synthetic-owner@example.test',connection:{status:'connected',blocked:false},
  sync_health:{state:'recent',reason:'En lyckad Gmail-hämtning har verifierats nyligen.',schedule_verified:false},
  last_successful_fetch:'2026-11-02T08:00:00Z',candidates:[],runs:[],
  schedule_observation:{last_invoked_at:'2026-10-29T05:00:00Z',last_completed_at:'2026-10-29T05:01:00Z',last_outcome:'completed',source:'system_entrypoint',external_schedule_verified:false},
  attachment_rejections:{total:0,reasons:[]},
  processing:{enabled:true,scheduler_configured:true,last_processed:'2026-11-01T07:00:00Z',registered:7,messages_waiting:3,cloud_ocr_configured:true,cloud_worker_recent:true,cloud_last_completed:'2026-10-31T06:00:00Z',worker_online:false,aftercheck_pending:0,counts:{queued:2,waiting_ocr:3,processing:1,ready:4,needs_review:5,duplicate:2,failed:6,registered:7}},
});
const row=(html,label)=>{
  const found=(html.match(/<(?:p|small)\b[^>]*>[\s\S]*?<\/(?:p|small)>/g)||[]).find(part=>part.includes(label));
  assert.ok(found,`Missing visible status row: ${label}`);return found;
};
const elements=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(elements):[node,...elements(node.props?.children)];
const text=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(' '):typeof node==='object'?text(node.props?.children):String(node);
async function renderFixture(t,surface,body,{httpStatus=200,pending=false,interactive=false}={}){
  const key='__gmail_operations_'+crypto.randomUUID().replaceAll('-',''),f={slots:[],cursor:0,effects:[],closed:false,scheduled:false,requests:[]};globalThis[key]=f;
  const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  f.state=initial=>{const index=f.cursor++;f.slots[index]??={value:typeof initial==='function'?initial():initial};return[f.slots[index].value,value=>{f.slots[index].value=typeof value==='function'?value(f.slots[index].value):value;f.schedule();}];};
  f.ref=initial=>{const index=f.cursor++;f.slots[index]??={current:initial};return f.slots[index];};
  f.effect=(fn,deps)=>{const index=f.cursor++;if(!equal(f.slots[index]?.deps,deps))f.effects.push(()=>{f.slots[index]?.cleanup?.();f.slots[index]={deps,cleanup:fn()};});};
  f.schedule=()=>{if(f.closed||f.scheduled)return;f.scheduled=true;queueMicrotask(()=>{f.scheduled=false;f.render();});};
  const react=moduleUrl(`const f=globalThis[${JSON.stringify(key)}];export const useState=(...args)=>f.state(...args),useRef=(...args)=>f.ref(...args),useEffect=(...args)=>f.effect(...args);`);
  const noOriginal=moduleUrl('export function readInvoiceFile(){throw Error("Unexpected original read");}export function pdfPreview(){throw Error("Unexpected PDF rendering");}export function interpretInvoice(){throw Error("Unexpected interpretation");}');
  const {default:Component}=await import(compile(`../components/gmail-${surface}.tsx`,{react,'@/lib/document-triage.js':new URL('../lib/document-triage.js',import.meta.url).href,'@/lib/local-ocr':noOriginal,'@/lib/imports':noOriginal,'@/lib/invoice-fields.js':noOriginal,'./document-ocr-status':compile('../components/document-ocr-status.tsx'),'./sync-recovery-notice':compile('../components/sync-recovery-notice.tsx')}));
  let release;const gate=pending?new Promise(resolve=>{release=resolve;}):Promise.resolve();
  t.mock.method(globalThis,'fetch',async(path,options={})=>{
    f.requests.push({path,method:options.method||'GET'});
    if(interactive&&options.method==='POST')return Response.json({error:'Synthetic action recorded'},{status:409});
    assert.equal(path,surface==='summary'?'/api/gmail/status?summary=1':'/api/gmail/status');assert.equal(options.method||'GET','GET');
    await gate;return Response.json(body,{status:httpStatus});
  });
  f.render=()=>{if(f.closed)return;f.cursor=0;f.tree=Component({embedded:true});for(const effect of f.effects.splice(0))effect();};
  t.after(()=>{f.closed=true;release?.();for(const slot of f.slots)slot?.cleanup?.();delete globalThis[key];});
  f.render();for(let iteration=0;iteration<10;iteration++)await new Promise(resolve=>setImmediate(resolve));
  const html=renderToStaticMarkup(f.tree);return interactive?{...f,html}:html;
}

for(const surface of ['summary','workspace']){
  test(`Gmail ${surface}: manual fetch, automatic invocation and document processing retain their own evidence`,async t=>{
    const body=status(),html=await renderFixture(t,surface,body);
    assert.match(html,/Gmail(?::| –) Ansluten/);
    assert.ok(row(html,'Senaste lyckade hämtning:').includes(body.last_successful_fetch));
    assert.ok(row(html,'Senaste automatiska anrop:').includes(body.schedule_observation.last_invoked_at));
    assert.doesNotMatch(row(html,'Senaste automatiska anrop:'),/2026-11-02/);
    assert.ok(row(html,'Senaste slutförda automatikanrop:').includes(body.schedule_observation.last_completed_at));
    assert.ok(row(html,'Senaste bearbetning:').includes(body.processing.last_processed));
    assert.match(html,/Externt schema: Inte verifierat/);
    assert.match(html,/I kö: 5/);assert.match(html,/Bearbetas: 1/);assert.match(html,/Klara för registrering: 4/);
    assert.match(html,/Att granska: 7/);assert.match(html,/Registrerade underlag: 7/);assert.match(html,/Misslyckade jobb: 6/);
  });
  test(`Gmail ${surface}: a recent fetch and configured automation do not invent a scheduler run`,async t=>{
    const body=status();body.schedule_observation={last_invoked_at:null,last_completed_at:null,last_outcome:null,source:'system_entrypoint',external_schedule_verified:false};
    const html=await renderFixture(t,surface,body);
    assert.match(row(html,'Senaste automatiska anrop:'),/Inget anrop observerat/);
    assert.match(row(html,'Senaste slutförda automatikanrop:'),/Ingen slutförd körning observerad/);
    assert.match(html,/Externt schema: Inte verifierat/);assert.doesNotMatch(html,/Molnschema konfigurerat|Schema verifierat/);
  });
  test(`Gmail ${surface}: a waiting invocation does not reuse an older successful outcome`,async t=>{
    const body=status();body.schedule_observation.last_invoked_at='2026-11-02T10:00:00Z';body.schedule_observation.last_outcome='not_due';
    const html=await renderFixture(t,surface,body);
    assert.match(row(html,'Senaste anropets resultat:'),/Väntar till nästa tillåtna hämtning/);
    assert.ok(row(html,'Senaste slutförda automatikanrop:').includes('2026-10-29T05:01:00Z'));
  });
  test(`Gmail ${surface}: missing operational data remains unknown instead of zero or verified`,async t=>{
    const body=status();delete body.schedule_observation;body.processing={enabled:true,scheduler_configured:true};
    const html=await renderFixture(t,surface,body);
    assert.match(row(html,'Senaste automatiska anrop:'),/Status saknas/);
    assert.match(row(html,'Senaste bearbetning:'),/Status inte hämtad/);
    assert.match(html,/Registrerade underlag: Okänt/);assert.match(html,/Misslyckade jobb: Okänt/);
    assert.doesNotMatch(html,/I kö: 0|Klara för registrering: 0|Invalid Date/);
  });
  test(`Gmail ${surface}: rejected imports remain visible outside the empty document list`,async t=>{
    const body=status();body.attachment_rejections={total:4,reasons:[{code:'attachment_too_large',count:1},{code:'attachment_format_invalid',count:2},{code:'unclassified',count:1}]};
    const html=await renderFixture(t,surface,body);
    assert.match(html,/Bilagor avvisade före import: 4/);assert.match(html,/Misslyckade jobb: 6/);
    if(surface==='workspace'){assert.match(html,/För stor bilaga: 1/);assert.match(html,/Ogiltigt filformat: 2/);assert.match(html,/Orsak saknas i äldre uppgift: 1/);}
  });
}

test('Gmail summary: a stale fetch is shown separately from the connected account',async t=>{
  const body=status();body.sync_health={state:'stale',reason:'Ingen färsk lyckad hämtning.',schedule_verified:false};
  const html=await renderFixture(t,'summary',body);assert.match(html,/Gmail: Ansluten/);assert.match(html,/Hämtningen behöver kontrolleras/);assert.match(html,/Ingen färsk lyckad hämtning/);
});
test('Gmail workspace: an unfinished invocation is not reported as a completed or definitely active run',async t=>{
  const body=status();body.schedule_observation.last_outcome='running_or_interrupted';body.schedule_observation.last_completed_at=null;
  const html=await renderFixture(t,'workspace',body);assert.match(row(html,'Senaste anropets resultat:'),/Slutresultat saknas.*pågår eller avbröts/);assert.match(row(html,'Senaste slutförda automatikanrop:'),/Ingen slutförd körning observerad/);
});
test('Gmail workspace: completed fetching with a pending after-check does not claim completed registration',async t=>{
  const body=status();body.schedule_observation.last_outcome='completed_pending';body.processing.aftercheck_pending=2;
  const html=await renderFixture(t,'workspace',body);assert.match(row(html,'Senaste anropets resultat:'),/Hämtning slutförd.*efterkontroll återstår/);assert.match(html,/2 registrerade underlag väntar på efterkontroll/);assert.match(html,/Registrerade underlag: 7/);
});
test('Gmail document status: enabled processing does not certify the external schedule',async()=>{
  const {DocumentOcrStatus}=await import(compile('../components/document-ocr-status.tsx'));
  const html=renderToStaticMarkup(React.createElement(DocumentOcrStatus,{processing:status().processing}));
  assert.match(html,/Dokumentautomatik: Aktiverad/);assert.doesNotMatch(html,/Molnschema konfigurerat|Schema verifierat/);
});
for(const options of [{pending:true},{httpStatus:503}]){
  test(`Gmail summary: ${options.pending?'loading':'unavailable'} status does not fabricate operational facts`,async t=>{
    const html=await renderFixture(t,'summary',{error:'Synthetic unavailable'},options);
    assert.match(html,options.pending?/Hämtar status/:/Status kunde inte hämtas/);
    assert.doesNotMatch(html,/Ansluten|Registrerade underlag: 0|I kö: 0|Ingen slutförd körning observerad|Inget anrop observerat/);
  });
}
for(const connectionStatus of ['renewal_required','missing_scope','access_denied','invalid_client','account_mismatch','invalid_tokens']){
  test(`Gmail summary: ${connectionStatus} requires renewed authorization`,async t=>{
    const body=status();body.connection.status=connectionStatus;body.sync_health={state:'disconnected',reason:'Gmail behöver anslutas igen.'};
    const html=await renderFixture(t,'summary',body);assert.match(html,/Gmail: Behöver anslutas igen/);assert.doesNotMatch(html,/Gmail: Ansluten/);
  });
  test(`Gmail workspace: ${connectionStatus} starts reconnection instead of another fetch`,async t=>{
    const body=status();body.connection.status=connectionStatus;body.sync_health={state:'disconnected',reason:'Gmail behöver anslutas igen.'};
    const f=await renderFixture(t,'workspace',body,{interactive:true});assert.match(f.html,/Gmail – Behöver anslutas igen/);
    const button=elements(f.tree).find(node=>node.type==='button'&&text(node)==='Koppla Gmail');assert.ok(button,'Permanent authorization failure needs a reconnect action');assert.equal(button.props.disabled,false);
    await button.props.onClick();assert.deepEqual(f.requests,[{path:'/api/gmail/status',method:'GET'},{path:'/api/gmail/connect',method:'POST'}]);
  });
}

test('document status shows actionable worker inactivity and separate queue recovery counts',async()=>{
  const {DocumentOcrStatus}=await import(compile('../components/document-ocr-status.tsx'));
  const processing={...status().processing,cloud_worker_recent:false,worker_online:false,
    queue_health:{basis:'current_jobs',observed_at:'2026-11-05T12:00:00Z',pending:8,ready_pdf:2,ready_ocr:3,deferred:1,active:1,expired_leases:1,exhausted:2,failed:2,oldest_pending_at:'2026-11-05T10:00:00Z',next_retry_at:'2026-11-05T12:05:00Z',ocr_worker_unavailable:true},
    throughput:{basis:'accepted_extractions_with_terminal_job',window_start:'2026-11-04T12:00:00Z',window_end:'2026-11-05T12:00:00Z',completed_documents:7}};
  const html=renderToStaticMarkup(React.createElement(DocumentOcrStatus,{processing}));
  assert.match(html,/OCR-kön väntar: ingen OCR-arbetare har nyligen kontaktat tjänsten/);
  assert.match(html,/Redo för texttolkning: 2/);assert.match(html,/Redo för OCR: 3/);assert.match(html,/Väntar på nytt försök: 1/);
  assert.match(html,/Avbrutna jobb att återuppta: 1/);assert.match(html,/Förbrukade försök: 2/);
  assert.match(html,/Unika underlag med sparad tolkning senaste dygnet: 7/);
  assert.ok(row(html,'Äldsta väntande underlag:').includes('2026-11-05T10:00:00Z'));
  assert.doesNotMatch(html,/Schema verifierat|7 verifierade fakturor/);
});

test('document queue observations remain unknown when metrics are malformed or unavailable',async()=>{
  const {DocumentQueueStatus}=await import(compile('../components/document-ocr-status.tsx'));
  const html=renderToStaticMarkup(React.createElement(DocumentQueueStatus,{processing:{queue_health:{ready_pdf:-1,ready_ocr:NaN,deferred:0.5},throughput:{completed_documents:-1}}}));
  assert.match(html,/Redo för texttolkning: Okänt/);assert.match(html,/Redo för OCR: Okänt/);assert.match(html,/Väntar på nytt försök: Okänt/);
  assert.match(html,/Unika underlag med sparad tolkning senaste dygnet: Okänt/);
});
