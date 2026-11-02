import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {emptyState} from '../lib/domain.ts';
import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';

const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const file=path=>new URL(path,import.meta.url).href;
const elements=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(elements):[node,...elements(node.props?.children)];
const text=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(' '):typeof node==='object'?text(node.props?.children):String(node);
function compiled(path,imports={}){
 let source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const [name,target]of Object.entries({'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'./domain':file('../lib/domain.ts'),'@/lib/domain':file('../lib/domain.ts'),'./reconciliation-engine.js':file('../lib/reconciliation-engine.js'),'./payment-references.js':file('../lib/payment-references.js'),...imports}))for(const quote of ['"',"'"])source=source.replaceAll(quote+name+quote,JSON.stringify(target));
 return data(source);
}
const presentation=compiled('../lib/payment-presentation.ts');
function stateWithRows(count=123){
 const state=emptyState();
 state.transactions=Array.from({length:count},(_,index)=>syntheticBankTransaction({id:`bank-${index+1}`,party:`Synthetic payer ${index+1}`,date:'2026-10-26',amount:10000+index,bankReference:`SYNTHETIC-${index+1}`,payerReference:`REF-${index+1}`,kind:'payment'}));
 return state;
}

// The real presentation functions run against synthetic bank evidence. Only the
// hook scheduler is replaced so navigation and unchanged rerenders are testable
// without a browser dependency; its dependency checks match React's Object.is.
async function fixture(t,state=stateWithRows(),candidates){
 const key='__bank_list_'+crypto.randomUUID().replaceAll('-',''),f={slots:[],cursor:0,calls:[],countCalls:0,opened:[],state};globalThis[key]=f;
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((value,n)=>Object.is(value,b[n]));
 f.stateHook=initial=>{const n=f.cursor++;f.slots[n]??={value:typeof initial==='function'?initial():initial};return [f.slots[n].value,value=>{f.slots[n].value=typeof value==='function'?value(f.slots[n].value):value;}];};
 f.memo=(fn,deps)=>{const n=f.cursor++;if(!equal(f.slots[n]?.deps,deps))f.slots[n]={value:fn(),deps};return f.slots[n].value;};
 const ref=`globalThis[${JSON.stringify(key)}]`,react=data(`const f=${ref};export const useState=(...a)=>f.stateHook(...a),useMemo=(...a)=>f.memo(...a);`);
 const observed=data(`import * as actual from ${JSON.stringify(presentation)};export * from ${JSON.stringify(presentation)};const f=${ref};export function bankPaymentView(...args){f.calls.push(args[1].id);return actual.bankPaymentView(...args);}export function bankPaymentCounts(...args){f.countCalls++;return actual.bankPaymentCounts(...args);}`);
 const aliases={react,'@/lib/payment-presentation':observed,'./list-pagination':compiled('../components/list-pagination.tsx'),'./bankgiro-availability':compiled('../components/bankgiro-availability.tsx')};
 const ui=await import(compiled('../components/bank-payments.tsx',aliases));
 f.props={state,transactions:state.transactions,open:id=>f.opened.push(id),...(candidates?{candidates}:{})};
 const expand=node=>!node||typeof node!=='object'?node:Array.isArray(node)?node.map(expand):typeof node.type==='function'?expand(node.type(node.props)):{...node,props:{...node.props,children:expand(node.props.children)}};
 f.render=(changes={})=>{f.props={...f.props,...changes};f.cursor=0;f.rawTree=ui.default(f.props);f.tree=expand(f.rawTree);return f.tree;};
 f.find=predicate=>elements(f.tree).find(predicate);
 f.rows=()=>elements(f.tree).filter(node=>node.type==='tr'&&node.key!=null);
 f.cards=()=>elements(f.tree).filter(node=>node.props?.className==='bank-payment-card');
 f.next=()=>{const button=f.find(node=>node.type==='button'&&text(node)==='Nästa sida');assert.ok(button,'Next-page control must remain available');button.props.onClick();f.render();};
 f.previous=()=>{const button=f.find(node=>node.type==='button'&&text(node)==='Föregående sida');assert.ok(button,'Previous-page control must remain available');button.props.onClick();f.render();};
 f.summary=()=>{f.cursor=0;return expand(ui.BankPaymentSummary({state:f.props.state}));};
 f.html=()=>renderToStaticMarkup(React.createElement(React.Fragment,null,f.rawTree));
 t.after(()=>delete globalThis[key]);f.render();return f;
}

test('long bank results render and derive evidence for only one 50-row page per layout',async t=>{
 const state=stateWithRows(),before=structuredClone(state),f=await fixture(t,state);
 assert.equal(f.rows().length,50);assert.equal(f.cards().length,50);
 assert.deepEqual(f.calls,Array.from({length:50},(_,index)=>`bank-${index+1}`),'Off-page evidence must not be computed by the list');
 assert.match(text(f.tree),/1–50 av 123/);assert.deepEqual(f.state,before);
});

test('unchanged list renders reuse evidence while changed candidates and state refresh it',async t=>{
 const f=await fixture(t,stateWithRows(2));f.calls=[];f.render();
 assert.deepEqual(f.calls,[],'An unrelated parent rerender must not recompute payment evidence');
 const candidates={'bank-1':[{number:'0712',identifiers:[{field:'reference',value:'REF-1'}]}]};
 f.render({candidates});assert.deepEqual(f.calls,['bank-1','bank-2']);assert.match(f.html(),/Möjlig: 0712/);
 f.calls=[];f.render({state:{...f.state,allocations:[...f.state.allocations]}});assert.deepEqual(f.calls,['bank-1','bank-2']);
 f.render({candidates:{}});assert.doesNotMatch(f.html(),/0712/,'Removed candidates must not survive in a cached page');
});

test('bank pagination reaches every row in order and keeps both boundary controls focusable',async t=>{
 const f=await fixture(t),seen=[];
 for(const [page,start,end]of [[1,1,50],[2,51,100],[3,101,123]]){
  assert.match(text(f.tree),new RegExp(`${start}–${end} av 123`));assert.match(text(f.tree),new RegExp(`Sida ${page} av 3`));
  seen.push(...f.rows().map(row=>row.key));
  const next=f.find(node=>node.type==='button'&&text(node)==='Nästa sida');
  assert.ok(next);assert.notEqual(next.props.disabled,true,'The focused next-page button must remain focusable on the last page');assert.equal(next.props['aria-disabled'],page===3);
  if(page<3)f.next();
 }
 assert.deepEqual(seen,Array.from({length:123},(_,index)=>`bank-${index+1}`));
 f.next();assert.equal(f.rows()[0].key,'bank-101','An aria-disabled next control cannot go beyond the last page');
 f.cards().at(-1).props.onClick();assert.deepEqual(f.opened,['bank-123']);
 f.previous();assert.equal(f.rows()[0].key,'bank-51');f.previous();f.previous();assert.equal(f.rows()[0].key,'bank-1');
 const previous=f.find(node=>node.type==='button'&&text(node)==='Föregående sida');assert.equal(previous.props['aria-disabled'],true);assert.notEqual(previous.props.disabled,true);
 const nav=f.find(node=>node.type==='nav');assert.match(nav.props['aria-label'],/Bankbetalningar/);
 const status=f.find(node=>node.props?.role==='status');assert.equal(status.props['aria-live'],'polite');assert.equal(String(status.props['aria-atomic']),'true');
});

test('a replacement filtered list resets the page immediately and empty results retain navigation',async t=>{
 const f=await fixture(t);f.next();f.next();
 const filtered=f.state.transactions.slice(80,83);f.render({transactions:filtered});
 assert.deepEqual(f.rows().map(row=>row.key),['bank-81','bank-82','bank-83']);assert.match(text(f.tree),/1–3 av 3/);assert.match(text(f.tree),/Sida 1 av 1/);
 f.render({transactions:[]});assert.equal(f.rows().length,0);assert.match(text(f.tree),/Inga bankhändelser matchar ditt filter/);assert.match(text(f.tree),/0–0 av 0/);
 assert.equal(elements(f.tree).filter(node=>node.type==='button').length,2);
 f.render({transactions:f.state.transactions});assert.equal(f.rows()[0].key,'bank-1');
});

test('the summary counts the full dataset and memoizes unchanged state independently of paging',async t=>{
 const state=stateWithRows(61);state.transactions=state.transactions.map((row,index)=>syntheticBankTransaction({id:row.id,bankReference:`SYNTHETIC-BATCH-${index}`,party:'',description:'Bankgiro inbetalning',kind:'batch',amount:62500}));
 const f=await fixture(t,state);f.slots=[];
 assert.match(text(f.summary()),/Behöver betalningsspecifikation 61/);assert.equal(f.countCalls,1);
 assert.match(text(f.summary()),/Behöver betalningsspecifikation 61/);assert.equal(f.countCalls,1,'Unchanged summary state must not repeat a complete evidence scan');
 f.props.state={...state,transactions:[...state.transactions,syntheticBankTransaction({id:'bank-62',bankReference:'SYNTHETIC-BATCH-62',party:'',description:'Bankgiro inbetalning',kind:'batch',amount:62500})]};
 assert.match(text(f.summary()),/Behöver betalningsspecifikation 62/);assert.equal(f.countCalls,2);
});
