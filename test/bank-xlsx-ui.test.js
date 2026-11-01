import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function view(){
  const elements=new Map();const element=key=>{if(!elements.has(key))elements.set(key,{innerHTML:'',value:'',isConnected:true,focus(){},addEventListener(){},setAttribute(){},querySelector:selector=>element(key+' '+selector),querySelectorAll:()=>[]});return elements.get(key);};
  const context=vm.createContext({document:{querySelector:element,getElementById:id=>element('#'+id),addEventListener(){},body:{classList:{add(){},remove(){}}}},location:{search:''},window:{addEventListener(){},scrollTo(){}},history:{pushState(){},replaceState(){}},URL,URLSearchParams,Intl,Date,matchMedia:()=>({matches:false,addEventListener(){}}),fetch:()=>new Promise(()=>{}),setTimeout:()=>1,clearTimeout(){}});
  vm.runInContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),context);
  vm.runInContext(readFileSync(new URL('../public/payment-control.js',import.meta.url),'utf8'),context);
  return code=>vm.runInContext(code,context);
}

test('Node Bankgiro picker includes XLSX and review preview describes saving an original without bank events',()=>{
  const run=view();run('globalThis.selectedAccept="";closeModal=()=>{};filePicker=accept=>{selectedAccept=accept};bankFilePicker()');assert.match(run('selectedAccept'),/\.xlsx/);
  run('state.preview={name:"synthetic.xlsx",count:1,review:1,review_only:true,items:[],warnings:["Kontokoppling behöver verifieras."]}');
  const html=run('previewPanel()');assert.match(html,/Spara original för granskning/);assert.match(html,/Inga bankhändelser skapas/);assert.doesNotMatch(html,/Bekräfta import av/);
});

test('Node review-only confirmation reports the retained original without claiming a financial import',async()=>{
  const run=view();run('state.preview={name:"synthetic.xlsx",account:"Syntetiskt konto",content_base64:"test",review_only:true};globalThis.message="";api=async()=>({imported:0,duplicate:0,review:1,review_only:true});refresh=async()=>true;toast=text=>{message=text};navigate=()=>{}');
  await run('commitImport()');assert.match(run('message'),/Originalet.*granskning/);assert.doesNotMatch(run('message'),/bankhändelser importerade/);assert.equal(run('state.preview'),null);
});

test('Node XLSX preview shows the observed sender and generic reference without requiring a saved economic bank row',()=>{
  const run=view();run('state.preview={name:"synthetic.xlsx",count:1,review:1,review_only:true,warnings:[],items:[{payer:"Testbageriet AB",reference:"0017",amount_cents:12345,booked_at:"2026-10-20",bankgiro:"1234-5678",payer_bankgiro:"987-6543",review_only:true,account_evidence:{report:{sequence:"41"},cells:{reference:"C19"}}}]}');
  const html=run('previewPanel()');assert.match(html,/Testbageriet AB/);assert.match(html,/>0017</);assert.match(html,/Betalningsreferens/);assert.match(html,/1234-5678/);assert.match(html,/<details/);assert.match(html,/C19/);assert.doesNotMatch(html,/<th>OCR<|Betalare okänd|Betalt/);
});

test('linked bank main row shows Bankgiro name and reference with explicit manual source relation',()=>{
 const run=view();run('state.transactions=[{id:"bank",source:"enablebanking",amount_cents:62500,booked_at:"2026-10-26",is_aggregate:true,payer:"",reference:"",status:"review",specification_link:{verification:"manual",payer:"Syntetiskt Bistro AB",reference:"0599",payments:[{payer:"Syntetiskt Bistro AB",reference:"0599"}],id:"link"}}]');
 const html=run('bankTable(state.transactions)');assert.match(html,/Syntetiskt Bistro AB/);assert.match(html,/0599/);assert.match(html,/Swedbank \+ Bankgiro Excel/);assert.match(html,/Manuellt verifierad källkoppling/);assert.doesNotMatch(html,/Specifikation saknas/);assert.equal(run('bankOCRUI(state.transactions[0])'),'');
 run('globalThis.dialogHtml="";modal=(title,html)=>{dialogHtml=html;};transactionDialog("bank")');assert.match(run('dialogHtml'),/data-bank-specifications="bank"/);assert.doesNotMatch(run('dialogHtml'),/Godkänn matchning/);
});

test('Node source review requires an explicit report selection and submits only a manual source decision',async()=>{
 const run=view();run(`state.me={authenticated:true};state.transactions=[{id:'bank',amount_cents:62500,booked_at:'2026-10-26'}];globalThis.calls=[];globalThis.formSubmit=null;globalThis.dialogHtml='';modal=(title,html,submit,handler)=>{dialogHtml=html;formSubmit=handler;};api=async(path,method,body)=>{calls.push({path,method,body});return {items:[{name:'synthetic.xlsx',import_id:'import',report_key:'report',can_link:true,reason:'Möjlig tillhörande Bankgirospecifikation – kontrollera.',amount_cents:62500,booked_at:'2026-10-26',account:'SYNTHETIC',rows:[{payer:'Syntetiskt Bistro AB',reference:'0599',amount_cents:62500}],matching_bank_count:2}]};};`);
 await run('bankSpecificationDialog("bank")');assert.match(run('dialogHtml'),/2 bankposter/);assert.match(run('dialogHtml'),/Öppna Swedbankoriginal/);assert.match(run('dialogHtml'),/Öppna Exceloriginal/);assert.match(run('dialogHtml'),/name="originals_checked" required/);
 await assert.rejects(run('formSubmit({get:()=>null})'),/Välj en tillgänglig rapport/);
 await run(`formSubmit({get:key=>({report:'0',originals_checked:'on',account_checked:'on',evidence:'Syntetisk kontroll',date_difference_note:''})[key]})`);
 assert.equal(run('calls.length'),2);assert.equal(run('calls[1].path'),'/bank-specification-links');assert.equal(run('calls[1].body.originals_checked'),true);assert.equal(run('calls[1].body.report_key'),'report');assert.doesNotMatch(run('JSON.stringify(calls)'),/allocations|reconciliation|payer-links/);
});

test('manual source labels preserve existing partial full and excess allocation status',()=>{
 const run=view();run(`state.invoices=[{id:'invoice',remaining_cents:25000}];state.allocations=[{transaction_id:'bank',invoice_id:'invoice'}];globalThis.linked={id:'bank',amount_cents:62500,available_cents:25000,status:'partial',specification_link:{verification:'manual'}};`);
 assert.equal(run('bankStatusLabelUI(linked)'),'Delbetalning');run('state.invoices[0].remaining_cents=0');assert.equal(run('bankStatusLabelUI(linked)'),'Överbetalning');run("linked.available_cents=0;linked.status='matched';linked.is_aggregate=true");assert.equal(run('bankStatusLabelUI(linked)'),undefined);
});

test('stale Node source relation exposes revoke controls without a valid display enrichment',async()=>{
 const run=view();run(`state.me={authenticated:true};state.transactions=[{id:'bank',amount_cents:62500,booked_at:'2026-10-26',specification_link:null}];globalThis.dialogHtml='';modal=(title,html)=>{dialogHtml=html;};api=async()=>({items:[],active_links:[{id:'stale-link',evidence:'Tidigare granskning',created_at:'2026-10-26T10:00:00Z',stale:true,reason:'Originalfilen saknas'}]});`);
 await run('bankSpecificationDialog("bank")');assert.match(run('dialogHtml'),/data-revoke-bank-specification="stale-link"/);assert.match(run('dialogHtml'),/Originalfilen saknas/);assert.doesNotMatch(run('dialogHtml'),/Bekräfta manuell källkoppling/);
});
