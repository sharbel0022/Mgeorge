import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Execute the shipped templates and event handlers; only the DOM and transport
// boundary are synthetic. Layout and native keyboard behavior need browser QA.
function view(intl=Intl){
  const elements=new Map(),listeners=new Map();
  let document;
  function element(key){
    if(!elements.has(key))elements.set(key,{
      innerHTML:'',textContent:'',hidden:false,inert:false,isConnected:true,disabled:false,value:'',dataset:{},visible:true,
      focus(){if(this.isConnected&&this.visible&&!this.disabled)document.activeElement=this;},
      getClientRects(){return this.visible?[{}]:[];},
      setAttribute(name,value){this[name]=value;},
      hasAttribute(name){return Object.hasOwn(this,name);},
      addEventListener(name,handler){listeners.set(key+':'+name,handler);},
      querySelector:element,querySelectorAll(){return[];},
      contains(node){return node===this;},
    });
    return elements.get(key);
  }
  document={querySelector:element,getElementById:id=>element('#'+id),activeElement:null,
    addEventListener(name,handler){listeners.set('document:'+name,handler);},
    body:{classList:{add(){},remove(){}}}};
  const context=vm.createContext({document,location:{search:'?tab=customers'},window:{addEventListener(){},scrollTo(){}},
    history:{pushState(){},replaceState(){}},URL,URLSearchParams,Intl:intl,Date,
    matchMedia:()=>({matches:false,addEventListener(){}}),fetch:()=>new Promise(()=>{}),setTimeout:()=>1,clearTimeout(){}});
  for(const file of ['workspace-search','app','review','messages','payment-control'])vm.runInContext(readFileSync(new URL(`../public/${file}.js`,import.meta.url),'utf8'),context,{filename:`public/${file}.js`});
  vm.runInContext('state.me={authenticated:true,login_required:true}',context);
  return {element,document,set:(key,value)=>context[key]=value,run:code=>vm.runInContext(code,context)};
}
const plain=value=>JSON.parse(JSON.stringify(value));
const invoice=(extra={})=>({id:'invoice-a',direction:'customer',kind:'invoice',invoice_number:'000018',party:'Åsa Syntetisk AB',reference:'REF/000018',issued_at:'2026-10-01',due_at:'2026-11-30',created_at:'2026-10-01',total_cents:12500,paid_cents:5000,remaining_cents:7500,status:'partial',reconciliation_state:'verified',payment_evidence_issue:'',...extra});
const transaction=(extra={})=>({id:'bank-a',source:'enablebanking',payer:'Different stored label',amount_cents:5000,raw_bank_data_sha256:'a'.repeat(64),raw_bank_data:{status:'BOOK',debtor:{name:'Verifierad <betalare>'}},...extra});
function fixture(v,rows=[invoice()]){
  v.set('rows',rows);v.set('payment',transaction());
  v.run("state.invoices=rows;state.transactions=[payment];state.allocations=[{id:'allocation-a',invoice_id:'invoice-a',transaction_id:'bank-a',amount_cents:5000}];state.documents=[{id:'doc-a',invoice_id:'invoice-a',source:'gmail',name:'Syntetisk faktura.pdf',status:'registered'}]");
}

test('invoice search trims pasted text, handles equivalent Unicode and searches evidenced payer',()=>{
  const v=view();fixture(v);
  for(const q of [' 000018 ', ' A\u030asa Syntetisk ', ' Verifierad <betalare> ']){
    v.set('query',q);v.run('state.filters.customers.q=query');
    assert.deepEqual(plain(v.run('filteredInvoices().map(i=>i.id)')),['invoice-a'],q);
  }
});

test('invoice rows show exact reference, bank evidenced payer, source and recorded amounts',()=>{
  const v=view();fixture(v);const before=v.run('JSON.stringify({invoices:state.invoices,transactions:state.transactions,allocations:state.allocations,documents:state.documents})');
  const html=v.run('invoiceResults()');
  for(const fact of ['REF/000018','Verifierad &lt;betalare&gt;','Gmail','Underlag kontrollerat','125\u00a0kr','Registrerat betalt 50\u00a0kr','Kvar 75\u00a0kr'])assert.ok(html.includes(fact),fact);
  assert.doesNotMatch(html,/<betalare>|Different stored label/);
  assert.equal(v.run('JSON.stringify({invoices:state.invoices,transactions:state.transactions,allocations:state.allocations,documents:state.documents})'),before);
});

test('manual payer, unmatched suggestion and held payment never become a verified invoice payer',()=>{
  const v=view();fixture(v);
  v.run("state.transactions[0].source='manual';state.transactions[0].payer='Invented manual payer';state.suggestions=[{invoice_id:'invoice-a',transaction_id:'bank-a'}]");
  assert.match(v.run('invoiceResults()'),/Betalare ej verifierad/);
  assert.doesNotMatch(v.run('invoiceResults()'),/Invented manual payer|Verifierad &lt;betalare&gt;/);
  v.run("state.transactions[0].source='enablebanking';state.allocations=[]");
  assert.doesNotMatch(v.run('invoiceResults()'),/Verifierad &lt;betalare&gt;/);
  v.run("state.allocations=[{invoice_id:'invoice-a',transaction_id:'bank-a',amount_cents:5000}];state.invoices[0].payment_evidence_issue='Kontomedgivandet behöver granskas'");
  const html=v.run('invoiceResults()');
  assert.match(html,/Betalare ej verifierad|Betalningsunderlag behöver granskas/);
  assert.doesNotMatch(html,/Verifierad &lt;betalare&gt;|Underlag kontrollerat/);
  assert.equal(v.run('state.invoices[0].paid_cents'),5000);
});

for(const [direction,kind,amount,role,name] of [
  ['customer','invoice',5000,'Betalare','Bankens betalare'],
  ['customer','credit',-5000,'Mottagare','Bankens mottagare'],
  ['supplier','invoice',-5000,'Mottagare','Bankens mottagare'],
  ['supplier','credit',5000,'Betalare','Bankens betalare'],
])test(`${direction} ${kind} labels the bank party according to the payment direction`,()=>{
  const v=view();fixture(v,[invoice({direction,kind})]);
  v.set('bankPayment',transaction({amount_cents:amount,raw_bank_data:{status:'BOOK',debtor:{name:'Bankens betalare'},creditor:{name:'Bankens mottagare'}}}));
  v.set('tab',direction==='customer'?'customers':'suppliers');v.run('state.transactions=[bankPayment];state.tab=tab');
  const html=v.run('invoiceResults()');
  assert.ok(html.includes(`data-label="${role}"><strong>${name}</strong>`));
});

test('unknown monetary values stay distinct from a known zero',()=>{
  const v=view();
  for(const value of [null,undefined,'',NaN,Infinity]){v.set('value',value);assert.equal(v.run('money(value)'),'Ej tillgängligt');}
  assert.match(v.run('money(0)'),/^0\s*kr$/);
  assert.match(v.run('money(12501)'),/^125,01\s*kr$/);
});

test('date-filtered empty invoices explain the filter and tolerate a missing date',()=>{
  const v=view();fixture(v,[invoice({due_at:null})]);
  v.run("state.filters.customers.date='month'");
  assert.deepEqual(plain(v.run('filteredInvoices().map(i=>i.id)')),[]);
  assert.match(v.run('invoiceResults()'),/Inga fakturor matchar/);
});

test('large invoice lists render one bounded page, retain exact search and clamp a stale page',()=>{
  const v=view();fixture(v,Array.from({length:5001},(_,n)=>invoice({id:'invoice-'+n,invoice_number:String(n).padStart(6,'0'),party:'Syntetisk kund '+n,reference:'REF/'+String(n).padStart(6,'0')})));
  v.run("state.filters.customers.size=50;state.filters.customers.page=101");
  let html=v.run('invoiceResults()');
  assert.equal((html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr/g)||[]).length,1);
  assert.match(html,/005000/);
  v.run("state.filters.customers.q='REF/000017';state.filters.customers.page=101");
  html=v.run('invoiceResults()');
  assert.equal(v.run('state.filters.customers.page'),1);
  assert.match(html,/000017/);
  assert.doesNotMatch(html,/005000/);
});

test('invoice summary calculates its date boundary once for a large register',()=>{
  let created=0;const intl=Object.create(Intl);
  intl.DateTimeFormat=function(...args){created++;return new Intl.DateTimeFormat(...args);};
  const v=view(intl);fixture(v,Array.from({length:5001},(_,n)=>invoice({id:'invoice-'+n})));
  const html=v.run("invoiceSummary('customer')");
  assert.match(html,/375\s075\s*kr/);
  assert.ok(created<10,`Created ${created} date formatters for one summary`);
});

test('closing a dialog returns focus to main when the opener was removed or is hidden',()=>{
  for(const hidden of [false,true]){
    const v=view(),opener=v.element('opener'),main=v.element('#main');opener.focus();
    v.run("modal('Syntetisk dialog','<p>Innehåll</p>',null,null)");
    if(hidden)opener.visible=false;else opener.isConnected=false;
    v.run('closeModal()');
    assert.equal(v.document.activeElement,main,hidden?'hidden opener':'removed opener');
    assert.equal(v.element('#app').inert,false);
  }
});

test('a dialog opened from another dialog preserves the original page focus target',()=>{
  const v=view(),opener=v.element('opener');opener.focus();
  v.run("modal('Första dialogen','<p>Första</p>',null,null);modal('Andra dialogen','<p>Andra</p>',null,null);closeModal()");
  assert.equal(v.document.activeElement,opener);
});

test('changing the invoice page retains focus in the replaced pagination controls',()=>{
  const v=view();fixture(v,Array.from({length:30},(_,n)=>invoice({id:'invoice-'+n})));
  const opener=v.element('next-page');opener.dataset.page='2';
  v.element('#invoice-results').contains=node=>node===opener;opener.focus();
  v.run('state.filters.customers.page=2;rerenderResults()');
  assert.equal(v.document.activeElement,v.element('[data-page="2"][aria-current="page"]'));
});

test('changing invoice sorting keeps keyboard focus on the replacement sort control',()=>{
  const v=view();fixture(v);
  const opener=v.element('sort-control');opener['data-invoice-sort']='';
  v.element('#invoice-results').contains=node=>node===opener;opener.focus();
  v.run("state.filters.customers.sort='remaining_cents';rerenderResults()");
  assert.equal(v.document.activeElement,v.element('[data-invoice-sort]'));
});

test('home presents four primary decisions with existing totals and their scopes',()=>{
  const v=view();fixture(v);
  v.run("state.dashboard={supplier_open_cents:32000};state.control={counts:{review:3,messages:0,gmail_documents:0},totals:{verified_paid_cents:5000,remaining_cents:7500,billed_cents:12500,verified_outstanding_cents:0,overdue_count:0,overdue_cents:0},queue:[],run:null}");
  const before=v.run('JSON.stringify(state.control)'),html=v.run('paymentControlOverview()');
  const cards=html.match(/<div class="stat-grid control-stats">([\s\S]*?)<\/div><p class="control-accounting-note">/)?.[1]||'';
  assert.equal((cards.match(/class="stat /g)||[]).length,4);
  for(const label of ['Inbetalt','Kvar att få','Att betala','Behöver granskas'])assert.ok(cards.includes(label),label);
  assert.match(cards,/320\s*kr/);
  assert.match(cards,/hela registret/);
  assert.equal((html.match(/data-control-start/g)||[]).length,1);
  assert.equal(v.run('JSON.stringify(state.control)'),before);
});

test('combined Swedish amount date and reference filters the shipped invoice list',()=>{
 const v=view();fixture(v,[invoice(),invoice({id:'invoice-other',total_cents:12501})]);
 for(const q of ['000018 125,00 2026-10-01','30/11/2026 125,00 Åsa','REF/000018 125,00']){
  v.set('query',q);v.run('state.filters.customers.q=query');
  assert.deepEqual(plain(v.run('filteredInvoices().map(i=>i.id)')),['invoice-a'],q);
 }
});
