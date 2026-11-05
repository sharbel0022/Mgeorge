import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {emptyState} from '../lib/domain.ts';
import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';

const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const file=path=>new URL(path,import.meta.url).href;
const elements=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(elements):[node,...elements(node.props?.children)];
const text=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(' '):typeof node==='object'?text(node.props?.children):String(node);
function compile(source,aliases={}){
 let code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const [name,target]of Object.entries({'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'@/lib/domain':file('../lib/domain.ts'),'./domain':file('../lib/domain.ts'),'./reconciliation-engine.js':file('../lib/reconciliation-engine.js'),'./payment-references.js':file('../lib/payment-references.js'),...aliases}))for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(target));
 return data(code);
}

// Extract the production component and its actual normalization helper. Only
// hooks and focusable DOM boundaries are local fakes; result matching, domain
// evidence labels and every keyboard/click handler remain production code.
const dashboard=readFileSync(new URL('../app/dashboard.tsx',import.meta.url),'utf8');
const start=dashboard.indexOf('function WorkspaceSearch('),end=dashboard.indexOf('\nfunction InvoiceDetail(',start);
const normalizeStart=dashboard.indexOf('const normalizeSearch='),normalizeEnd=dashboard.indexOf('\nconst shortDate=',normalizeStart);
assert.ok(start>=0&&end>start&&normalizeStart>=0&&normalizeEnd>normalizeStart,'Production search and normalization boundaries must be available');
const presentation=compile(readFileSync(new URL('../lib/payment-presentation.ts',import.meta.url),'utf8'));
const prefix=`import {money,needsPaymentSpecification} from '@/lib/domain';import {payerLabel,bankPaymentReference} from 'presentation';import {createWorkspaceSearchIndex,searchWorkspaceIndex} from 'search';export function createSearch({useState,useRef,useMemo}){const Search=()=>null,X=()=>null,FileText=()=>null,Landmark=()=>null;\n`;
const {createSearch}=await import(compile(prefix+dashboard.slice(normalizeStart,normalizeEnd)+'\n'+dashboard.slice(start,end)+'\nreturn WorkspaceSearch;}',{presentation,search:file('../lib/workspace-search.js')}));

function syntheticState(){
 const state=emptyState();
 state.invoices=Array.from({length:6},(_,index)=>({id:`invoice-${index+1}`,number:`INV-${String(index+1).padStart(4,'0')}`,party:`Synthetic customer ${index+1}`,direction:'receivable',total:12300+index,ocr:`OCR-${index+1}`,issued:'2026-11-01',due:'2026-12-01',currency:'SEK',reviewed:true,voided:false}));
 state.transactions=Array.from({length:6},(_,index)=>syntheticBankTransaction({id:`bank-${index+1}`,party:`Synthetic bank payer ${index+1}`,date:'2026-10-26',amount:12300+index,bankReference:`BANK-${index+1}`,payerReference:`REF-${index+1}`,kind:'payment'}));
 return state;
}

function fixture(t,{state=syntheticState(),available=true}={}){
 const before=JSON.stringify(state),f={slots:[],cursor:0,opened:[],active:null,resultNodes:[]};
 const equal=(left,right)=>left&&right&&left.length===right.length&&left.every((value,index)=>Object.is(value,right[index]));
 const Search=createSearch({
  useState(initial){const index=f.cursor++;f.slots[index]??={value:typeof initial==='function'?initial():initial};return [f.slots[index].value,next=>{f.slots[index].value=typeof next==='function'?next(f.slots[index].value):next;}];},
  useRef(initial){const index=f.cursor++;return f.slots[index]??={current:initial};},
  useMemo(fn,deps){const index=f.cursor++;if(!equal(f.slots[index]?.deps,deps))f.slots[index]={value:fn(),deps};return f.slots[index].value;}
 });
 const focusable=name=>({name,focus(){f.active=this;}});
 f.inputNode=focusable('input');
 const shell={querySelector(selector){assert.equal(selector,'input');return f.inputNode;},querySelectorAll(selector){assert.equal(selector,'[data-search-result]');return f.resultNodes;}};
 f.props={state,available,open:modal=>{f.focusAtOpen=f.active;f.opened.push(modal);}};
 f.render=(changes={})=>{
  f.props={...f.props,...changes};f.cursor=0;f.tree=Search(f.props);f.tree.props.ref.current=shell;
  f.input=elements(f.tree).find(node=>node.type==='input');
  f.results=elements(f.tree).filter(node=>node.type==='button'&&Object.hasOwn(node.props,'data-search-result'));
  const prior=new Map(f.resultNodes.map(node=>[node.name,node]));
  f.resultNodes=f.results.map(element=>{const node=prior.get(element.key)||focusable(element.key);node.element=element;return node;});
  return f.tree;
 };
 f.type=value=>{f.input.props.onChange({target:{value}});f.render();};
 f.press=(key,target=f.active||f.inputNode)=>{const event={key,target,prevented:false,preventDefault(){this.prevented=true;}};f.tree.props.onKeyDown(event);f.render();return event;};
 f.click=index=>{assert.ok(f.results[index],'The selected production result must exist');f.results[index].props.onClick();f.render();};
 f.region=()=>elements(f.tree).find(node=>node.props?.id==='workspace-search-results');
 f.status=()=>elements(f.tree).find(node=>node.props?.role==='status');
 f.render();f.inputNode.focus();t.after(()=>assert.equal(JSON.stringify(state),before,'Search interaction must not mutate invoice or bank evidence'));return f;
}

test('ArrowDown enters results and arrow navigation traverses invoice and bank results without wrapping',t=>{
 const f=fixture(t);f.type('synthetic');
 assert.deepEqual(f.results.map(result=>result.key),['invoice-1','invoice-2','invoice-3','invoice-4','bank-1','bank-2','bank-3','bank-4']);
 for(let index=0;index<8;index++){assert.equal(f.press('ArrowDown').prevented,true);assert.equal(f.active,f.resultNodes[index]);}
 assert.equal(f.press('ArrowDown').prevented,true);assert.equal(f.active,f.resultNodes[7],'The last result must remain focused');
 for(let index=6;index>=0;index--){assert.equal(f.press('ArrowUp').prevented,true);assert.equal(f.active,f.resultNodes[index]);}
 assert.equal(f.press('ArrowUp').prevented,true);assert.equal(f.active,f.inputNode);assert.deepEqual(f.opened,[]);
});

test('Home and End move between result boundaries while input editing keys remain native',t=>{
 const f=fixture(t);f.type('synthetic');
 for(const key of ['Home','End','ArrowUp']){assert.equal(f.press(key).prevented,false);assert.equal(f.active,f.inputNode);}
 f.press('ArrowDown');f.press('ArrowDown');
 assert.equal(f.press('End').prevented,true);assert.equal(f.active,f.resultNodes[7]);
 assert.equal(f.press('Home').prevented,true);assert.equal(f.active,f.resultNodes[0]);assert.deepEqual(f.opened,[]);
});

test('Escape clears an active search and returns focus from a result to the input',t=>{
 const f=fixture(t);f.type('synthetic');f.press('ArrowDown');f.press('ArrowDown');
 assert.equal(f.press('Escape').prevented,true);assert.equal(f.active,f.inputNode);
 assert.equal(f.input.props.value,'');assert.equal(f.input.props['aria-expanded'],false);assert.equal(f.input.props['aria-controls'],undefined);
 assert.equal(f.region(),undefined);assert.equal(f.results.length,0);assert.deepEqual(f.opened,[]);
});

test('the close-results control clears the query and restores input focus',t=>{
 const f=fixture(t);f.type('synthetic');f.press('ArrowDown');
 const close=elements(f.tree).find(node=>node.type==='button'&&node.props['aria-label']==='Stäng sökresultat');
 assert.ok(close);close.props.onClick();f.render();assert.equal(f.input.props.value,'');assert.equal(f.active,f.inputNode);assert.equal(f.region(),undefined);
});

test('result activation uses native buttons and leaves Enter, Space and Tab unhandled',t=>{
 const f=fixture(t);f.type('synthetic');f.press('ArrowDown');
 for(const result of f.results){assert.equal(result.type,'button');assert.equal(result.props.type,'button');assert.equal(typeof result.props.onClick,'function');}
 for(const key of ['Enter',' ','Tab']){assert.equal(f.press(key).prevented,false);assert.equal(f.active,f.resultNodes[0]);assert.deepEqual(f.opened,[]);}
 // Browser-native Enter/Space dispatch the button click; this harness deliberately
 // does not recreate that behavior or claim a browser keyboard acceptance test.
});

test('95 UI activating a search result leaves a stable input as the dialog return target',t=>{
 const f=fixture(t);f.type('synthetic');f.press('ArrowDown');
 assert.equal(f.active,f.resultNodes[0]);f.click(0);
 assert.equal(f.focusAtOpen,f.inputNode,'The soon-to-be-removed result must not be the dialog return target');
 assert.equal(f.active,f.inputNode);assert.equal(f.region(),undefined);
});

for(const [kind,index,id]of [['detail',2,'invoice-3'],['tx',5,'bank-2']])test(`selecting a ${kind} result opens only its exact modal and clears the search`,t=>{
 const f=fixture(t);f.type('synthetic');f.click(index);
 assert.deepEqual(f.opened,[{kind,id}]);assert.equal(f.input.props.value,'');assert.equal(f.input.props['aria-expanded'],false);assert.equal(f.region(),undefined);
});

test('normalized matching bounds the result list to four invoices and four bank payments',t=>{
 const f=fixture(t);f.type(' \u00a0ＳＹＮＴＨＥＴＩＣ\t ');
 assert.equal(f.results.length,8);assert.match(text(f.status()),/8\s+resultat visas/);
 assert.equal(f.input.props['aria-controls'],'workspace-search-results');assert.equal(f.input.props['aria-expanded'],true);
 assert.deepEqual(f.results.map(result=>result.key),['invoice-1','invoice-2','invoice-3','invoice-4','bank-1','bank-2','bank-3','bank-4']);
 assert.doesNotMatch(text(f.region()),/customer [56]|payer [56]/);
});

test('unavailable data disables the input and hides an already active search',t=>{
 const f=fixture(t);f.type('synthetic');assert.equal(f.results.length,8);
 f.render({available:false});assert.equal(f.input.props.disabled,true);assert.equal(f.input.props.value,'');assert.equal(f.input.props['aria-expanded'],false);
 assert.equal(f.region(),undefined);assert.equal(f.status(),undefined);assert.equal(f.results.length,0);assert.match(f.input.props.placeholder,/uppgifterna hämtats/);
 assert.equal(f.press('ArrowDown').prevented,false);assert.deepEqual(f.opened,[]);
 f.render({available:true,state:emptyState()});assert.equal(f.results.length,0);assert.match(text(f.region()),/Inga sparade uppgifter matchar sökningen/);
});

test('empty and whitespace queries stay closed, while a nonempty unmatched query exposes a zero-result state',t=>{
 const f=fixture(t);assert.equal(f.region(),undefined);assert.equal(f.status(),undefined);assert.equal(f.input.props['aria-expanded'],false);
 f.type(' \t\u00a0 ');assert.equal(f.region(),undefined);assert.equal(f.status(),undefined);
 f.type('no-synthetic-match-9384');assert.ok(f.region());assert.match(text(f.region()),/Inga sparade uppgifter matchar sökningen/);assert.match(text(f.status()),/0\s+resultat visas/);
 assert.equal(f.results.length,0);assert.equal(f.press('ArrowDown').prevented,false);assert.equal(f.active,f.inputNode);
 f.press('Escape');assert.equal(f.region(),undefined);assert.equal(f.input.props.value,'');assert.deepEqual(f.opened,[]);
});

test('combined Swedish amount, date and reference finds the exact production bank result', t=>{
 const f=fixture(t);f.type('123,00 26/10/2026 REF-1');
 assert.deepEqual(f.results.map(result=>result.key),['bank-1']);
 f.click(0);assert.deepEqual(f.opened,[{kind:'tx',id:'bank-1'}]);
});

test('an exact reference beyond the first four rows ranks first in the production search', t=>{
 const state=syntheticState();state.invoices.forEach((invoice,index)=>{invoice.number='0599'+(index+1);});state.invoices[5].number='0599';
 const f=fixture(t,{state});f.type('0599');
 assert.equal(f.results.length,4);assert.equal(f.results[0].key,'invoice-6');
});

test('production search keeps a manually completed reference separate from the bank original', t=>{
 const state=syntheticState();state.transactions=[syntheticBankTransaction({id:'bank-original',party:'Manual payer label',payerReference:'MANUAL-OVERLAY-001',amount:12300,date:'2026-10-26',bankReference:'SYNTHETIC-ORIGINAL-SEARCH',kind:'payment',original:{party:'Original synthetic payer',payerReference:'BANK-REFERENCE-001'},verification:{party:'Manual payer label',payerReference:'MANUAL-OVERLAY-001',note:'Synthetic manual review',at:'2026-11-05T10:00:00.000Z'}})];
 const f=fixture(t,{state});f.type('MANUAL-OVERLAY-001');assert.equal(f.results.length,0);
 f.type('BANK-REFERENCE-001 123,00');assert.deepEqual(f.results.map(result=>result.key),['bank-original']);
 assert.match(text(f.results[0]),/BANK-REFERENCE-001/);assert.doesNotMatch(text(f.results[0]),/MANUAL-OVERLAY/);
});

test('production search displays both interpretations of an ambiguous amount and requires explicit result activation',t=>{
 const state=syntheticState(),invoice=state.invoices[0];
 state.invoices=[{...invoice,id:'large-amount',number:'OTHER',party:'Synthetic large AB',total:12345600},{...invoice,id:'short-number',number:'123',party:'Synthetic invoice AB',total:45600}];state.transactions=[];
 const f=fixture(t,{state});f.type('123 456,00');
 assert.deepEqual(f.results.map(result=>result.key),['short-number','large-amount']);
 assert.match(text(f.results[0]),/123/);assert.match(text(f.results[0]),/456,00/);
 assert.match(text(f.results[1]),/OTHER/);assert.match(text(f.results[1]),/123\s456,00/);
 assert.deepEqual(f.opened,[]);f.press('Enter');assert.deepEqual(f.opened,[]);
 f.click(0);assert.deepEqual(f.opened,[{kind:'detail',id:'short-number'}]);
});
