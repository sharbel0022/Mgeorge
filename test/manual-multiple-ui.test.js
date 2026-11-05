import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {candidates,quote,receipt,storage} from './helpers/manual-multiple-client-cases.mjs';
const flush=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(respond){
 const elements=new Map(),listeners=new Map(),calls=[],memory=storage();let document;
 function element(key){if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',hidden:false,inert:false,isConnected:true,disabled:false,value:'',dataset:{},focus(){document.activeElement=this;},getClientRects(){return[{}];},setAttribute(){},addEventListener(event,handler){listeners.set(key+':'+event,handler);},querySelector:element,querySelectorAll(){return[];}});return elements.get(key);}
 document={querySelector:element,getElementById:id=>element('#'+id),activeElement:null,addEventListener(event,handler){listeners.set('document:'+event,handler);},body:{classList:{add(){},remove(){}}}};
 const context=vm.createContext({document,location:{search:'?tab=bank'},window:{sessionStorage:memory,addEventListener(){},scrollTo(){}},history:{pushState(){},replaceState(){}},crypto:webcrypto,structuredClone,URL,URLSearchParams,Intl,Date,matchMedia:()=>({matches:false,addEventListener(){}}),setTimeout:()=>1,clearTimeout(){},fetch:async(path,options={})=>{if(!String(path).startsWith('/api/manual-allocations'))return new Promise(()=>{});const body=options.body&&JSON.parse(options.body);calls.push({path,body});if(respond)return respond(path,body);const value=path.includes('?transactionId=')?candidates():path.endsWith('/preview')?quote():receipt(body);return {ok:true,status:200,json:async()=>value};}});
 for(const file of ['workspace-search','manual-multiple-client','app','review','messages','payment-control'])vm.runInContext(readFileSync(new URL('../public/'+file+'.js',import.meta.url),'utf8'),context,{filename:file+'.js'});
 const run=code=>vm.runInContext(code,context);
 run("state.transactions=[{id:'synthetic-payment',source:'enablebanking',payer:'Synthetic payer',reference:'00042, 00043',amount_cents:73100,allocated_cents:0,available_cents:73100,status:'review',account:'synthetic-account',booked_at:'2026-11-05'}];state.invoices=[{id:'invoice-a',direction:'customer',kind:'invoice',invoice_number:'00042',party:'Synthetic customer',remaining_cents:30001},{id:'invoice-b',direction:'customer',kind:'invoice',invoice_number:'00043',party:'Synthetic customer',remaining_cents:43099}];state.allocations=[]");
 return {run,calls,memory,element,listeners,html:()=>element('.modal-body').innerHTML,action:async name=>{listeners.get('#dialog-form:click')({target:{closest:()=>({dataset:{manualAction:name},disabled:false})},preventDefault(){}});await flush();},input:(name,value,checked=false)=>listeners.get('#dialog-form:input')({target:{name,value,checked}})};
}

test('Node transaction detail replaces the failing repeat-one-invoice advice with the complete manual flow',()=>{
 const f=fixture();f.run("transactionDialog('synthetic-payment')");const html=f.element('#modal-layer').innerHTML;assert.match(html,/data-manual-multiple="synthetic-payment"/);assert.doesNotMatch(html,/Matcha ett delbelopp och öppna sedan händelsen igen/);
});
test('Node actual dialog reads all rows, reviews explicitly and commits only after the checkbox',async()=>{
 const f=fixture();f.run("manualMultipleDialog('synthetic-payment')");await flush();assert.equal(f.calls.length,1);for(const value of ['00042','00043','300,01','430,99','731,00'])assert.ok(f.html().includes(value),value);assert.match(f.html(),/&lt;payer&gt;/);assert.doesNotMatch(f.html(),/<payer>/);
 f.input('manual-note','Originalen är granskade.');f.input('manual-amount-invoice-a','300.01');await f.action('review');assert.equal(f.calls.length,2);assert.match(f.html(),/Fakturarest efter/);assert.match(f.html(),/Betalningsrest efter/);assert.match(f.html(),/data-manual-action="confirm" disabled/);
 await f.action('confirm');assert.equal(f.calls.length,2);f.input('manual-confirm','on',true);await f.action('confirm');assert.equal(f.calls.length,3);assert.equal(f.calls[2].body.confirm,true);assert.deepEqual(f.calls[2].body.allocations,[{invoiceId:'invoice-a',amountMinor:30001},{invoiceId:'invoice-b',amountMinor:43099}]);assert.match(f.html(),/Manuellt registrerad fördelning/);assert.doesNotMatch(f.html(),/VERIFIED|Automatiskt verifierad/);
});
test('Node three-row review and owned-original links preserve every explicit reference and ore amount',()=>{
 const f=fixture(),c=candidates();c.invoices[0].invoiceTotalMinor=c.invoices[0].invoiceRemainingBeforeMinor=10001;c.invoices[1].invoiceTotalMinor=c.invoices[1].invoiceRemainingBeforeMinor=20002;c.invoices.push({...c.invoices[1],invoiceId:'invoice-c',number:'00044',reference:'00044',invoiceTotalMinor:43097,invoiceRemainingBeforeMinor:43097});c.references.push('00044');
 const q=quote(c,{allocations:c.invoices.map(row=>({invoiceId:row.invoiceId,amountMinor:row.invoiceRemainingBeforeMinor})),note:'Alla tre original granskade.'});
 f.run("state.invoices.forEach((row,index)=>row.document_id='owned-original-'+index)");const html=f.run('manualMultipleContent('+JSON.stringify({phase:'review',quote:q,error:''})+','+JSON.stringify({amounts:{},note:q.note})+',false)');
 for(const value of ['00042','00043','00044','100,01','200,02','430,97'])assert.ok(html.includes(value),value);assert.equal((html.match(/Visa fakturaoriginal/g)||[]).length,2);assert.match(html,/href="\/api\/documents\/owned-original-0"/);assert.match(html,/data-manual-action="confirm" disabled/);
});
test('Node edit consumes the reviewed quote and closing prevents a late display update',async()=>{
 const f=fixture();f.run("manualMultipleDialog('synthetic-payment')");await flush();f.input('manual-note','Originalen är granskade.');await f.action('review');await f.action('edit');await f.action('confirm');assert.equal(f.calls.length,2);assert.equal(f.run('manualDialogClient.snapshot.quote'),null);f.run('closeModal()');assert.equal(f.run('manualDialogClient'),null);
});
test('Node unknown 400 and receipt 404 keep the same request for later historical replay',async()=>{
 let saved,attempt=0;const f=fixture(async(path,body)=>{if(path.includes('?transactionId='))return {ok:true,status:200,json:async()=>candidates()};if(path.endsWith('/preview'))return {ok:true,status:200,json:async()=>quote()};if(path.includes('?requestId='))return {ok:false,status:404,json:async()=>({error:'Temporarily absent',code:'MANUAL_RECEIPT_NOT_FOUND'})};if(!attempt++){saved=body;return {ok:false,status:400,json:async()=>({error:'Network connection lost'})};}assert.deepEqual(body,saved);return {ok:true,status:200,json:async()=>({...receipt(body),replayed:true,changed:false})};});
 f.run("manualMultipleDialog('synthetic-payment')");await flush();f.input('manual-note','Originalen är granskade.');await f.action('review');f.input('manual-confirm','on',true);await f.action('confirm');assert.match(f.html(),/Utfallet är ännu okänt/);assert.doesNotMatch(f.html(),/data-manual-action="review"/);assert.equal(f.memory.values.size,1);await f.action('retry');assert.match(f.html(),/Manuellt registrerad fördelning/);assert.equal(f.memory.values.size,0);
});
test('Node ships only the public client adapter before the UI, with JavaScript Content-Type',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');assert.ok(html.indexOf('src="/manual-multiple-client.js"')>=0);assert.ok(html.indexOf('src="/manual-multiple-client.js"')<html.indexOf('src="/app.js"'));
 const serve=source.slice(source.indexOf('function serveStatic('),source.indexOf('\nfunction addInvoice('));assert.match(serve,/\/manual-multiple-client\.js/);assert.match(serve,/'\.js':'text\/javascript; charset=utf-8'/);assert.doesNotMatch(serve,/manual-multiple-allocation(?:-service)?\.(?:js|ts)/);
});
