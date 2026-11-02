import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import ts from 'typescript';
import {renderToStaticMarkup} from 'react-dom/server';
import {genericCompanyState as emptyState} from './helpers/reference-policy-fixture.mjs';
import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';

const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const file=p=>new URL(p,import.meta.url).href;
const elements=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(elements):[n,...elements(n.props?.children)];
function compile(source,aliases={}){
 let code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const [name,url] of Object.entries({'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'lucide-react':import.meta.resolve('lucide-react'),'@/lib/domain':file('../lib/domain.ts'),'./domain':file('../lib/domain.ts'),'./reconciliation-engine.js':file('../lib/reconciliation-engine.js'),'./payment-references.js':file('../lib/payment-references.js'),...aliases}))for(const q of ['"',"'"])code=code.replaceAll(q+name+q,JSON.stringify(url));
 return data(code);
}
function invoices(count){return Array.from({length:count},(_,n)=>({id:'synthetic-'+n,number:String(n+1).padStart(4,'0'),direction:'receivable',party:'Synthetic customer '+n,email:'synthetic@example.test',total:12500,currency:'SEK',ocr:String(n+1).padStart(4,'0'),issued:'2026-11-01',due:'2026-12-01',source:'Synthetic PDF original',documentId:'synthetic-invoice-original',reviewed:true,voided:false}));}
async function fixture(t,count=123){
 const key='__invoice_ui_'+crypto.randomUUID().replaceAll('-',''),f={cursor:0,slots:[],opened:[]};globalThis[key]=f;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 f.state=initial=>{const n=f.cursor++;f.slots[n]??={value:typeof initial==='function'?initial():initial};return [f.slots[n].value,next=>{f.slots[n].value=typeof next==='function'?next(f.slots[n].value):next;f.render();}];};
 f.memo=(fn,deps)=>{const n=f.cursor++;if(!same(f.slots[n]?.deps,deps))f.slots[n]={value:fn(),deps};return f.slots[n].value;};
 f.ref=initial=>{const n=f.cursor++;f.slots[n]??={current:initial};return f.slots[n];};
 const react=data(`const f=globalThis[${JSON.stringify(key)}];export const useState=(...a)=>f.state(...a),useMemo=(...a)=>f.memo(...a),useRef=(...a)=>f.ref(...a);`);
 const presentation=compile(readFileSync(new URL('../lib/payment-presentation.ts',import.meta.url),'utf8'));
 const pagerPath=new URL('../components/list-pagination.tsx',import.meta.url);
 const pager=existsSync(pagerPath)?compile(readFileSync(pagerPath,'utf8'),{react:import.meta.resolve('react')}):data('export default ()=>null;');
 const source=readFileSync(new URL('../app/dashboard.tsx',import.meta.url),'utf8');
 const start=source.includes('function invoiceListEvidence(')?source.indexOf('function invoiceListEvidence('):source.indexOf('function InvoiceTable(');
 const part=source.slice(start,source.indexOf('\nfunction Contacts('));
 const prefix=`import {useState,useMemo,useRef} from 'react';import {ChevronRight,Paperclip} from 'lucide-react';import {balance,invoiceStatus,paymentEvidenceIssue,invoicePaymentEvidenceIssue,invoiceReferenceDecision,money} from '@/lib/domain';import {bankPaymentView,invoiceIntendedReference} from 'presentation';import ListPagination from 'pager';const init=s=>s.slice(0,2),shortDate=s=>s||'Saknas';function Pill({children,tone}){return <span className={'pill '+tone}>{children}</span>;}\n`;
 const {default:Table}=await import(compile(prefix+part+'\nexport default InvoiceTable;',{react,presentation,pager}));
 f.stateData=emptyState();f.stateData.invoices=invoices(count);f.props={invoices:f.stateData.invoices,state:f.stateData,open:id=>f.opened.push(id)};
 f.render=()=>{f.cursor=0;f.tree=Table(f.props);};f.html=()=>renderToStaticMarkup(f.tree);f.page=()=>elements(f.tree).find(n=>n.props?.onPageChange);f.render();t.after(()=>delete globalThis[key]);return f;
}

test('invoice list bounds rendered rows, reaches every page and opens only the selected invoice',async t=>{
 const f=await fixture(t),before=JSON.stringify(f.stateData);
 assert.equal((f.html().match(/<tr/g)||[]).length-1,50);
 assert.equal(f.page().props.total,123);assert.equal(f.page().props.pageCount,3);
 f.page().props.onPageChange(3);assert.equal((f.html().match(/<tr/g)||[]).length-1,23);assert.match(f.html(),/0123/);assert.doesNotMatch(f.html(),/>0001</);
 const open=elements(f.tree).find(n=>n.type==='button'&&n.props?.['aria-label']==='Öppna faktura 0123');assert.ok(open);open.props.onClick({stopPropagation(){}});assert.deepEqual(f.opened,['synthetic-122']);
 assert.equal(JSON.stringify(f.stateData),before);
});

test('invoice list derives a scoped company intention and exposes an original reference conflict',async t=>{
 const f=await fixture(t,1);f.stateData.company.name='M.George Vitvaror AB';f.stateData.invoices[0].number='0599';f.stateData.invoices[0].ocr='';f.props={...f.props,invoices:[...f.props.invoices]};f.render();
 assert.match(f.html(),/Avsedd betalningsreferens: <span class="mono">0599/);assert.match(f.html(),/Företagets fakturanummerregel/);
 f.stateData.invoices[0].referenceOriginal={invoice_number:'0599',reference:'599'};f.props={...f.props,invoices:[...f.props.invoices]};f.render();
 assert.match(f.html(),/Blockerad referens/);assert.match(f.html(),/original.*referens|referens.*original/i);assert.equal(f.stateData.invoices[0].ocr,'');
});
test('a new filtered invoice result resets pagination before rendering its rows',async t=>{
 const f=await fixture(t);assert.ok(f.page(),'The list needs reachable page controls');f.page().props.onPageChange(3);
 f.props={...f.props,invoices:f.stateData.invoices.slice(0,2)};f.render();assert.equal(f.page().props.page,1);assert.equal((f.html().match(/<tr/g)||[]).length-1,2);assert.match(f.html(),/0001/);
});
test('invoice list shows explicit reference, original source and review status without inventing a payer',async t=>{
 const f=await fixture(t,1);f.stateData.invoices[0].ocr='0000599';f.props={...f.props,state:{...f.stateData}};f.render();const html=f.html();assert.match(html,/0000599/);assert.match(html,/Avsedd betalningsreferens/);assert.doesNotMatch(html,/OCR \/ fakturareferens/);assert.match(html,/Synthetic PDF original/);assert.match(html,/Granskad/);assert.match(html,/Ingen verifierad betalare/);
 assert.doesNotMatch(html,/Verifierad betalare: Synthetic customer/);
});
test('invoice list does not turn a suggested or an invalidated linked bank identity into a verified payer',async t=>{
 const f=await fixture(t,1),invoice=f.stateData.invoices[0];
 const tx=syntheticBankTransaction({id:'synthetic-payment',party:'Synthetic bank payer',amount:12500,kind:'payment',verified:false});
 f.stateData.transactions=[tx];f.stateData.allocations=[{id:'synthetic-link',invoiceId:invoice.id,transactionId:tx.id,amount:12500,active:true,effect:'payment'}];f.props={...f.props,state:{...f.stateData}};f.render();
 assert.match(f.html(),/Ingen verifierad betalare/);assert.doesNotMatch(f.html(),/Verifierad betalare: Synthetic bank payer/);
});

function linkedPayment(f,{direction='receivable',amount=12500}={}){
 const invoice={...f.stateData.invoices[0],direction};
 const transaction=syntheticBankTransaction({id:'synthetic-payment',party:'Original bank counterparty',amount,kind:'payment',verified:true,payerReference:invoice.number});
 f.stateData={...f.stateData,invoices:[invoice],transactions:[transaction],allocations:[{id:'synthetic-link',invoiceId:invoice.id,transactionId:transaction.id,amount:Math.abs(amount),active:true,effect:'payment'}]};
 f.props={...f.props,invoices:f.stateData.invoices,state:f.stateData};f.render();return transaction;
}
test('invoice list shows a verified original payer distinct from the invoiced customer and removes invalidated evidence',async t=>{
 const f=await fixture(t,1);linkedPayment(f);const before=JSON.stringify(f.stateData);
 assert.match(f.html(),/Verifierad betalare: Original bank counterparty/);assert.match(f.html(),/Synthetic customer 0/);
 assert.equal(JSON.stringify(f.stateData),before);
 f.stateData={...f.stateData,bankEvidenceHold:true};f.props={...f.props,state:f.stateData};f.render();assert.match(f.html(),/Ingen verifierad betalare/);
});
test('outgoing supplier payment names the verified recipient rather than calling that recipient the payer',async t=>{
 const f=await fixture(t,1);linkedPayment(f,{direction:'payable',amount:-12500});
 assert.match(f.html(),/Verifierad mottagare: Original bank counterparty/);assert.doesNotMatch(f.html(),/Verifierad betalare: Original bank counterparty/);
});
test('zero recorded allocation never presents a counterparty as a verified invoice payment',async t=>{
 const f=await fixture(t,1);linkedPayment(f);f.stateData={...f.stateData,allocations:f.stateData.allocations.map(a=>({...a,amount:0}))};f.props={...f.props,state:f.stateData};f.render();
 assert.match(f.html(),/Ingen verifierad betalare/);assert.doesNotMatch(f.html(),/Verifierad betalare: Original bank counterparty/);
});
test('a fully allocated invoice without its original stays under review in the invoice list without changing balances',async t=>{
 const f=await fixture(t,1);linkedPayment(f);
 f.stateData={...f.stateData,invoices:f.stateData.invoices.map(i=>({...i,documentId:''}))};
 f.props={...f.props,invoices:f.stateData.invoices,state:f.stateData};f.render();
 const before=JSON.stringify(f.stateData),html=f.html();
 assert.match(html,/Granska betalningsunderlag/);assert.doesNotMatch(html,/>Betald</);
 assert.match(html,/Ingen verifierad betalare/);assert.equal(JSON.stringify(f.stateData),before);
 assert.equal(f.stateData.allocations[0].amount,12500);
});
test('invoice list identifies the verified payer source separately from the invoice source',async t=>{
 const f=await fixture(t,1);linkedPayment(f);const html=f.html();
 assert.match(html,/Betalarkälla: Bankens transaktionsoriginal/);
 assert.match(html,/Fakturakälla: Synthetic PDF original/);
});

test('invoice list does not invent a company-policy conflict for a separate explicit reference',async t=>{
 const f=await fixture(t,1);f.stateData.invoices[0].ocr='0000599';f.props={...f.props,state:{...f.stateData}};f.render();
 assert.match(f.html(),/0000599/);assert.doesNotMatch(f.html(),/Avviker från fakturanumret/);
});
