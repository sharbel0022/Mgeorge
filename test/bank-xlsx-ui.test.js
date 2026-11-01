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

test('linked report reference never borrows an invoice suggestion from a different AIS reference',()=>{
 const run=view();run(`state.invoices=[{id:'ais-invoice',invoice_number:'0600',reference:'0600',party:'AIS customer'},{id:'report-invoice',invoice_number:'0599',reference:'0599',party:'Report customer'}];state.suggestions=[{transaction_id:'bank',invoice_id:'ais-invoice',reason:'AIS reference'}];state.transactions=[{id:'bank',amount_cents:62500,booked_at:'2026-10-26',payer:'AIS payer',reference:'0600',status:'review',specification_link:{verification:'manual',payer:'Report customer',reference:'0599',payments:[{payer:'Report customer',reference:'0599'}]}}];`);
 const before=run('JSON.stringify(state)'),html=run('bankTable(state.transactions)');
 assert.match(html,/Report customer/);assert.match(html,/>0599</);assert.doesNotMatch(html,/Möjlig faktura: 0600/);assert.match(html,/referenser.*skiljer sig/i);
 assert.equal(run('JSON.stringify(state)'),before);
 run("state.suggestions.push({transaction_id:'bank',invoice_id:'report-invoice',reason:'Report reference'})");
 assert.match(run('bankTable(state.transactions)'),/Möjlig faktura: 0599/);
});

test('confirmed allocations remain visible when linked-report and AIS references differ',()=>{
 const run=view();run(`state.invoices=[{id:'allocated',invoice_number:'0600',reference:'0600',remaining_cents:0}];state.allocations=[{transaction_id:'bank',invoice_id:'allocated',amount_cents:62500}];state.suggestions=[];state.transactions=[{id:'bank',amount_cents:62500,booked_at:'2026-10-26',reference:'0600',status:'matched',available_cents:0,specification_link:{verification:'manual',payer:'Report customer',reference:'0599'}}];`);
 const before=run('JSON.stringify(state)'),html=run('bankTable(state.transactions)');assert.match(html,/<td data-label="Faktura">0600/);assert.match(html,/>0599</);assert.match(html,/referenser.*skiljer sig/i);assert.equal(run('JSON.stringify(state)'),before);
});

test('linked report detail renders retained raw evidence and uses the report booking date',()=>{
 const run=view();run(`globalThis.linked={id:'bank',booked_at:'2026-10-27',specification_link:{verification:'manual',import_id:'original',payments:[{payer:'Report customer',reference:'0599',amount_cents:62500,booked_at:'2026-10-26',bankgiro:'1234-5678',account_evidence:{reported_account:'8000000123456789',report:{sequence:'83'},cells:{reference:{sheet:'Insättningsuppgift',address:'C19',type:'s',rawValue:'0599'}}},payer_evidence:{name:{raw:' Report customer ',source:'$.xlsx["Insättningsuppgift"].A19'}},reference_evidence:{candidates:[{value:'0599',kind:'structured',raw:'0599',source:'$.xlsx["Insättningsuppgift"].C19'}]}}]}}`);
 const html=run('bankSpecificationLinkedPanel(linked)');assert.match(html,/Bankens originaluppgifter och celler/);assert.match(html,/C19/);assert.match(html,/structured/);assert.match(html,/rawValue/);assert.match(html,/reported_account/);assert.match(html,/1234-5678/);assert.match(html,/data-label="Datum">2026-10-26/);assert.doesNotMatch(html,/data-label="Datum">2026-10-27/);
});

test('linked suggestion filtering preserves leading zeros and does not invent a multi-payer main candidate',()=>{
 const run=view();run(`state.invoices=[{id:'different',invoice_number:'599',reference:'599'}];state.suggestions=[{transaction_id:'bank',invoice_id:'different'}];state.transactions=[{id:'bank',amount_cents:62500,booked_at:'2026-10-26',reference:'599',specification_link:{verification:'manual',payer:'Report customer',reference:'0599'}}]`);
 assert.doesNotMatch(run('bankTable(state.transactions)'),/Möjlig faktura: 599/);
 run("state.transactions[0].specification_link.reference=''");assert.doesNotMatch(run('bankTable(state.transactions)'),/Möjlig faktura/);
});

test('linked transaction dialog keeps all selectable invoices but does not label an unrelated AIS suggestion',()=>{
 const run=view();run(`state.invoices=[{id:'ais',invoice_number:'0600',reference:'0600',direction:'customer',remaining_cents:62500},{id:'report',invoice_number:'0599',reference:'0599',direction:'customer',remaining_cents:62500}];state.suggestions=[{transaction_id:'bank',invoice_id:'ais',reason:'UNRELATED AIS SUGGESTION'}];state.transactions=[{id:'bank',source:'enablebanking',amount_cents:62500,available_cents:62500,booked_at:'2026-10-26',reference:'0600',payer:'AIS payer',specification_link:{verification:'manual',reference:'0599',payer:'Report customer'}}];globalThis.dialogHtml='';modal=(title,html)=>{dialogHtml=html;};transactionDialog('bank')`);
 const html=run('dialogHtml');assert.match(html,/value="ais"/);assert.match(html,/value="report"/);assert.doesNotMatch(html,/UNRELATED AIS SUGGESTION/);
});
