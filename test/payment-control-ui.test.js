import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {paymentGroup} from '../src/payment-overview.js';
function view(){
 const elements=new Map();
 function el(key){if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',hidden:false,isConnected:true,value:'',inert:false,disabled:false,focus(){},setAttribute(){},addEventListener(){},querySelector:el,querySelectorAll(){return[];}});return elements.get(key);}
 const ctx=vm.createContext({document:{querySelector:el,getElementById:id=>el('#'+id),addEventListener(){},body:{classList:{add(){},remove(){}}},hidden:false},window:{addEventListener(){},scrollTo(){}},location:{search:'',assign(){}},history:{pushState(){},replaceState(){}},URL,URLSearchParams,Intl,Date,matchMedia:()=>({matches:false,addEventListener(){}}),fetch:()=>new Promise(()=>{}),crypto:{randomUUID:()=> 'test_request_000000000001'},setTimeout:()=>1,clearTimeout(){}});
 for(const name of ['app','review','messages','payment-control'])vm.runInContext(readFileSync(new URL(`../public/${name}.js`,import.meta.url),'utf8'),ctx);
 vm.runInContext("state.me={authenticated:true,login_required:true};state.control={counts:{review:0},totals:{},queue:[],run:null}",ctx);
 return {run:code=>vm.runInContext(code,ctx),set:(name,value)=>ctx[name]=value,html:()=>el('#app').innerHTML};
}
test('overview has one main action, five menu areas and explicit no-send explanation',()=>{
 const v=view();v.run('render()');const html=v.html();
 assert.equal((html.match(/data-control-start/g)||[]).length,1);
 for(const text of ['Kontrollera alla betalningar','Att granska','Fakturor','Bank & betalningar','Inställningar','Inga kundmejl skickas'])assert.ok(html.includes(text),text);
 assert.equal(v.run('nav.length'),5);assert.match(html,/inte bevis/);
});
test('untrusted customer text is escaped in the consolidated queue',()=>{
 const v=view();v.set('tasks',[{id:'x',type:'payment',entity_id:'test',title:'<img onerror=alert(1)>',reason:'<script>unsafe</script>',action:'Granska',amount_cents:10000}]);
 const html=v.run('controlQueue(tasks)');assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<img|<script/);
});
test('bank UI grouping and read-only server grouping agree',()=>{
 const v=view();for(const t of [{amount_cents:-500000,status:'unmatched'},{amount_cents:40538,description:'Kortköp återbetalning'},{amount_cents:10000,is_aggregate:true},{amount_cents:10000,available_cents:0},{excluded:true,amount_cents:1000}]){v.set('t',t);assert.equal(v.run('paymentGroupUI(t)'),paymentGroup(t));}
});
test('pending start prevents a second request and cannot send customer email',async()=>{
 const v=view();let release;const gate=new Promise(r=>release=r);v.set('gate',gate);
 v.run("globalThis.calls=[];render=()=>{};api=async(path,method,data)=>{calls.push({path,method,data});await gate;return {job:{id:'run',status:'running',steps:[]}}}");
 const first=v.run('startPaymentControl()');const second=v.run('startPaymentControl()');await second;
 assert.equal(v.run('calls.length'),1);assert.equal(v.run('calls[0].path'),'/payment-control/run');
 assert.equal(v.run('Object.keys(calls[0].data).join()'),'request_id');release();await first;
 assert.equal(v.run('state.control.run.id'),'run');assert.equal(v.run('controlBusy()'),true);
});
test('lost response retries with same idempotency key instead of a new job',async()=>{
 const v=view();v.run("globalThis.calls=[];render=()=>{};handleError=()=>{};api=async(path,method,data)=>{calls.push(data.request_id);throw Error('connection interrupted')}");
 await v.run('startPaymentControl()');await v.run('startPaymentControl()');
 assert.equal(v.run('calls.length'),2);assert.equal(v.run('calls[0]'),v.run('calls[1]'));
});
test('logout clears private job summary and ignores late start responses',async()=>{
 const v=view();let release;const gate=new Promise(r=>release=r);v.set('gate',gate);
 v.run("render=()=>{};api=async()=>{await gate;return {job:{id:'PRIVATE-RUN',status:'running',steps:[]}}}");
 const pending=v.run('startPaymentControl()');v.run("showLogin('Logga in igen')");release();await pending;
 assert.equal(v.run('state.control'),null);assert.equal(v.run('state.me.authenticated'),false);assert.doesNotMatch(v.html(),/PRIVATE-RUN/);
});
test('review queue preserves import and full customer-message history navigation',()=>{
 const v=view();const html=v.run('paymentControlReview()');assert.match(html,/data-nav="messages"/);assert.match(html,/data-nav="import"/);assert.doesNotMatch(html,/data-save-message|\/send|approve:/);
});

test('overview exposes checked and unconfirmed totals and financial queue has invoice actions',()=>{
 const v=view();v.run('render()');
 for(const label of ['Totalt fakturerat','Verifierat utestående','Förfallodatum passerat','Senaste fullständiga kontroll','Dokumenttolkning'])assert.ok(v.html().includes(label),label);
 v.set('tasks',[{id:'anomaly:i',type:'anomaly',entity_id:'i',title:'Test',reason:'Delbetalning',action:'Granska saldo',amount_cents:62500}]);
 assert.match(v.run('controlQueue(tasks)'),/data-invoice="i"/);
 assert.match(v.run('paymentControlReview()'),/Ekonomiska avvikelser/);
 assert.match(v.run('paymentBankPage()'),/Behöver identifieras/);
});

test('financial queue filter keeps one action per item and identification excludes bank aggregates and card refunds',()=>{
 const v=view();
 v.set('tasks',[{id:'anomaly:i',type:'anomaly',category:'financial',entity_id:'i',title:'Invoice balance',reason:'Partial',action:'Open'},
   {id:'payment:p',type:'payment',category:'financial',entity_id:'p',title:'Possible excess',reason:'Review',action:'Check'},
   {id:'payment:u',type:'payment',category:'identification',entity_id:'u',title:'Unknown payer',reason:'Unknown',action:'Check'}]);
 v.run("state.control.queue=tasks;controlReviewFilter='financial'");const html=v.run('paymentControlReview()');
 assert.match(html,/Invoice balance/);assert.match(html,/Possible excess/);assert.doesNotMatch(html,/Unknown payer/);
 v.set('transactions',[{id:'incoming',amount_cents:10000,available_cents:10000,payer:'Test customer'},
   {id:'aggregate',amount_cents:10000,available_cents:10000,is_aggregate:true},
   {id:'refund',amount_cents:10000,available_cents:10000,description:'Card refund'}]);
 v.run("state.transactions=transactions;state.filters.bank.status='identify'");const rows=v.run('paymentBankResults()');
 assert.match(rows,/data-transaction="incoming"/);assert.doesNotMatch(rows,/Card refund|data-transaction="aggregate"/);
});

test('bank list exposes six facts and never promotes an invoice suggestion to bank OCR or payer',()=>{
 const v=view();v.set('rows',[{id:'bank',amount_cents:62500,booked_at:'2026-10-28',description:'Bankgiro collection description',payer:'Bankgirot',is_aggregate:true,status:'review'}]);
 v.run("state.suggestions=[{transaction_id:'bank',invoice_id:'i'}];state.invoices=[{id:'i',invoice_number:'0599',party:'Invoice customer'}]");
 const html=v.run('bankTable(rows)');assert.equal((html.match(/<th(?: |\>)/g)||[]).length,6);
 for(const label of ['Betalare','Faktura','OCR','Belopp','Datum','Status','Betalare okänd','Möjlig faktura: 0599','Saknas i bankunderlaget'])assert.ok(html.includes(label),label);
 assert.doesNotMatch(html,/Bankgiro collection description|Invoice customer|<strong>Bankgirot<\/strong>/);
});

test('numeric invoice references stay separate from typed bank OCR and manual payer completion',()=>{
 const v=view();v.set('rows',[{id:'bank',source:'manual',payer:'Typed customer',amount_cents:62500,booked_at:'2026-10-28',reference:'0599',status:'review',reference_evidence:{candidates:[{kind:'ocr',value:'0599'}]}}]);
 const html=v.run('bankTable(rows)');assert.match(html,/Betalare okänd/);assert.match(html,/Manuellt angivet: Typed customer/);assert.match(html,/Saknas i bankunderlaget/);
 v.set('rows',[{id:'bank',source:'enablebanking',payer:'Bank customer',raw_bank_data_sha256:'a'.repeat(64),raw_bank_data:{status:'BOOK',debtor:{name:'Bank customer'}},amount_cents:62500,booked_at:'2026-10-28',reference:'0599',status:'review',reference_evidence:{candidates:[{kind:'invoice',value:'0599'}]}}]);
 assert.match(v.run('bankTable(rows)'),/Saknas i bankunderlaget/);
});

test('bank supplied payer and explicit OCR preserve leading zeros and escape untrusted text',()=>{
 const v=view();v.set('rows',[{id:'bank',source:'enablebanking',payer:'Bank <customer>',raw_bank_data_sha256:'a'.repeat(64),raw_bank_data:{status:'BOOK',debtor:{name:'Bank <customer>'}},amount_cents:62500,booked_at:'2026-10-28',reference:'000018',status:'review',reference_evidence:{candidates:[{kind:'ocr',value:'000018'}]}}]);
 const html=v.run('bankTable(rows)');assert.match(html,/Bank &lt;customer&gt;/);assert.match(html,/data-label="OCR">000018/);assert.doesNotMatch(html,/<customer>/);
});

test('a bank aggregate completed from a retained individual file displays that file identity',()=>{
 const v=view();v.set('rows',[{id:'bank',source:'enablebanking',import_id:'file',payer:'Individual bank payer',raw_bank_data_sha256:'a'.repeat(64),raw_bank_data:{status:'BOOK',debtor:{name:'Bankgirot'}},amount_cents:62500,booked_at:'2026-10-28',reference:'000018',status:'unmatched',reference_evidence:{candidates:[{kind:'ocr',value:'000018'}]}}]);
 v.run("state.imports=[{id:'file',source:'bank_file',content_sha256:'"+'b'.repeat(64)+"'}]");
 const html=v.run('bankTable(rows)');assert.match(html,/Individual bank payer/);assert.match(html,/data-label="OCR">000018/);
});

test('bank status reflects the invoice remainder and excess even when the bank row is fully allocated',()=>{
 const v=view();v.set('rows',[{id:'bank',source:'manual',amount_cents:25000,available_cents:0,booked_at:'2026-10-28',status:'matched'}]);
 v.run("state.allocations=[{transaction_id:'bank',invoice_id:'i'}];state.invoices=[{id:'i',invoice_number:'0600',remaining_cents:75000}]");
 assert.match(v.run('bankTable(rows)'),/data-label="Status">[^]*Delbetalning/);
 v.run('state.invoices[0].remaining_cents=0;rows[0].available_cents=5000;rows[0].status="partial"');
 assert.match(v.run('bankTable(rows)'),/data-label="Status">[^]*Överbetalning/);
 v.run('rows[0].excluded=true;rows[0].status="excluded"');
 assert.doesNotMatch(v.run('bankTable(rows)'),/Överbetalning/);
});
