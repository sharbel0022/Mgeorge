import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const target=new URL('../components/reconciliation-proposal.tsx',import.meta.url),data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
function compiled(react=import.meta.resolve('react')){
 let source=ts.transpileModule(existsSync(target)?readFileSync(target,'utf8'):'export {};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const [name,url]of Object.entries({'react':react,'react/jsx-runtime':import.meta.resolve('react/jsx-runtime')}))for(const q of [String.fromCharCode(34),String.fromCharCode(39)])source=source.replaceAll(q+name+q,JSON.stringify(url));
 return data(source);
}
const ui=await import(compiled());
const decision=(patch={})=>({transactionId:'synthetic-payment',status:'VERIFIED',bankEvidenceStatus:'VERIFIED',reasonCodes:['EXACT_REFERENCE_AND_BANK_EVIDENCE'],payer:null,references:[],candidateInvoiceIds:['synthetic-invoice'],conflictingInvoiceIds:[],allocations:[{invoiceId:'synthetic-invoice',amountMinor:62500,currency:'SEK',invoiceRemainingBeforeMinor:62500,invoiceRemainingAfterMinor:0,settlement:'full'}],availableMinor:62500,unallocatedMinor:0,reportedAmountMinor:62500,economic:true,evidenceValidUntil:null,...patch});
const preview=(patch={})=>({contractVersion:'mgeorge-reconciliation-v1',mode:'preview',changed:false,writesAllowed:false,approvalRequired:true,ownerId:'synthetic-owner',companyId:'synthetic-company',checkedAt:'2026-11-02T12:00:00.000Z',status:'VERIFIED',reasonCodes:[],snapshot:{revision:7,sha256:'a'.repeat(64)},decisions:[decision()],transactionId:'synthetic-payment',selectedStatus:'VERIFIED',...patch});
const render=props=>{assert.equal(typeof ui.ReconciliationProposalView,'function');return renderToStaticMarkup(React.createElement(ui.ReconciliationProposalView,{transactionId:'synthetic-payment',revision:7,invoices:[{id:'synthetic-invoice',number:'0599'}],result:preview(),loading:false,error:'',...props}));};

test('a verified C4 decision is visibly a separate unapproved proposal without a financial write control',()=>{
 const value=preview(),before=structuredClone(value),html=render({result:value});
 assert.match(html,/Avstämningsförslag/);assert.match(html,/separat godkännande krävs/i);assert.match(html,/Faktura 0599/);assert.match(html,/625,00/);assert.match(html,/inga saldon ändras/i);
 assert.doesNotMatch(html,/Verifierad betalning|Betald|<form|<button|Godkänn|Registrera betalning/);assert.deepEqual(value,before);
});

test('manual or missing policy decisions show a concrete pending control, not a paid label',()=>{
 for(const [status,code,reason]of [['REVIEW','MANUAL_REPORT_RELATION',/manuell.*underlagsrelation/i],['BLOCKED','REFERENCE_POLICY_REQUIRED',/företagsregel.*referens/i]]){
  const html=render({result:preview({status,selectedStatus:status,decisions:[decision({status,reasonCodes:[code],allocations:[],unallocatedMinor:62500})]})});
  assert.match(html,status==='BLOCKED'?/Blockerat förslag/:/Behöver granskas/);assert.match(html,reason);assert.doesNotMatch(html,/Faktura 0599|Verifierad betalning/);
 }
});

test('C4 responses require the exact snapshot and unchanged read-only contract with valid selected allocations',()=>{
 assert.equal(typeof ui.validReconciliationProposal,'function');assert.equal(ui.validReconciliationProposal(preview(),'synthetic-payment',7),true);
 for(const value of [null,preview({writesAllowed:true}),preview({approvalRequired:false}),preview({changed:true}),preview({contractVersion:'invented'}),preview({snapshot:{revision:8,sha256:'a'.repeat(64)}}),preview({snapshot:{revision:7,sha256:'bad'}}),preview({transactionId:'another-payment'}),preview({selectedStatus:'BLOCKED'}),preview({reasonCodes:[{}]}),preview({decisions:[decision(),decision()]}),preview({decisions:[decision({allocations:[{...decision().allocations[0],amountMinor:0.5}]})]}),preview({decisions:[decision({allocations:[{...decision().allocations[0],currency:'EUR'}]})]}),preview({decisions:[decision({reasonCodes:[{toString:null}]})]})])assert.equal(ui.validReconciliationProposal(value,'synthetic-payment',7),false,JSON.stringify(value));
});

test('malformed, loading, unavailable and demo results never expose old proposals',()=>{
 for(const props of [{loading:true},{error:'Förslaget kunde inte läsas.'},{demo:true},{result:preview({writesAllowed:true})}]){
  const html=render(props);assert.doesNotMatch(html,/Faktura 0599|625,00|Underlaget stöder/);
 }
});

test('an expired evidence deadline blocks even a previously verified proposal',()=>{
 const html=render({result:preview({decisions:[decision({evidenceValidUntil:new Date(Date.now()-1000).toISOString()})]})});
 assert.match(html,/Blockerat förslag/);assert.match(html,/giltighet.*gått ut/i);assert.doesNotMatch(html,/Faktura 0599|Underlaget stöder/);
});

const flush=async()=>{for(let n=0;n<10;n++)await Promise.resolve();};
async function fixture(t,{demo=false}={}){
 const key='__reconciliation_proposal_'+crypto.randomUUID().replaceAll('-',''),f={cursor:0,slots:[],effects:[],requests:[],demo,id:'synthetic-payment',revision:7};globalThis[key]=f;
 f.state=initial=>{const n=f.cursor++;f.slots[n]??={value:typeof initial==='function'?initial():initial};return [f.slots[n].value,value=>{f.slots[n].value=typeof value==='function'?value(f.slots[n].value):value;}];};
 f.effect=(fn,deps)=>{const n=f.cursor++,old=f.slots[n];if(!old?.deps||deps.some((value,i)=>!Object.is(value,old.deps[i])))f.effects.push(()=>{old?.cleanup?.();f.slots[n]={deps,cleanup:fn()};});};
 const react=data(`const f=globalThis[${JSON.stringify(key)}];export const useState=(...args)=>f.state(...args),useEffect=(...args)=>f.effect(...args);`),module=await import(compiled(react));assert.equal(typeof module.useReconciliationProposal,'function');
 const oldFetch=globalThis.fetch;globalThis.fetch=(url,options)=>new Promise(resolve=>f.requests.push({url,options,respond:(body,code=200)=>resolve({ok:code>=200&&code<300,status:code,json:async()=>body})}));
 f.render=()=>{f.cursor=0;f.result=module.useReconciliationProposal(f.id,f.revision,f.demo);for(const effect of f.effects.splice(0))effect();return f.result;};
 f.close=()=>{for(const slot of f.slots)slot.cleanup?.();};t.after(()=>{f.close();globalThis.fetch=oldFetch;delete globalThis[key];});f.render();return f;
}

test('C4 panel requests only the selected preview with GET and never creates an approval',async t=>{
 const f=await fixture(t);assert.equal(f.requests.length,1);const request=f.requests[0];assert.equal(request.url,'/api/reconciliation/preview?transactionId=synthetic-payment');assert.equal(request.options.method,'GET');assert.equal(request.options.body,undefined);assert.equal(request.options.credentials,'same-origin');assert.equal(request.options.cache,'no-store');
 request.respond(preview());await flush();f.render();assert.equal(f.result.result.snapshot.revision,7);assert.equal(f.result.error,'');
});

test('revision changes hide old results immediately and cancel or ignore late selected-transaction replies',async t=>{
 const f=await fixture(t),old=f.requests[0];old.respond(preview());await flush();f.render();assert.ok(f.result.result);
 f.revision=8;f.render();assert.equal(f.result.result,null);assert.equal(old.options.signal.aborted,true);const second=f.requests[1];
 f.id='different-payment';f.render();assert.equal(second.options.signal.aborted,true);second.respond(preview({snapshot:{revision:8,sha256:'b'.repeat(64)}}));await flush();f.render();assert.equal(f.result.result,null);
 f.requests[2].respond(preview({transactionId:'different-payment',snapshot:{revision:8,sha256:'c'.repeat(64)},decisions:[decision({transactionId:'different-payment'})]}));await flush();f.render();assert.equal(f.result.result.transactionId,'different-payment');
});

test('missing or invalid C4 previews fail closed and retry stays read-only; demo starts no requests',async t=>{
 const f=await fixture(t);f.requests[0].respond({},404);await flush();f.render();assert.equal(f.result.result,null);assert.match(f.result.error,/inte tillgängligt/);
 f.result.retry();f.render();f.requests[1].respond(preview({writesAllowed:true}));await flush();f.render();assert.equal(f.result.result,null);assert.ok(f.result.error);
 f.demo=true;f.render();const count=f.requests.length;assert.equal(f.result.result,null);f.result.retry();f.render();assert.equal(f.requests.length,count);
});
