import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {applyCommand,emptyState as companyState} from '../lib/domain.ts';
import {genericCompanyState as emptyState} from './helpers/reference-policy-fixture.mjs';
import {parseSpecificationBytes} from '../lib/bankgiro-parser.js';
import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';
import {paymentFieldSourceFixture} from './helpers/payment-field-source-fixture.mjs';

const file=path=>new URL(path,import.meta.url).href;
function compiled(path,imports={}){
 let source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const [name,target] of Object.entries({'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'./domain':file('../lib/domain.ts'),'@/lib/domain':file('../lib/domain.ts'),'./reconciliation-engine.js':file('../lib/reconciliation-engine.js'),'./payment-references.js':file('../lib/payment-references.js'),...imports}))for(const q of ['"',"'"])source=source.replaceAll(q+name+q,JSON.stringify(target));
 return 'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
}
const presentation=compiled('../lib/payment-presentation.ts'),view=await import(presentation);
const ui=await import(compiled('../components/bank-payments.tsx',{'@/lib/payment-presentation':presentation,'./list-pagination':compiled('../components/list-pagination.tsx'),'./bankgiro-availability':compiled('../components/bankgiro-availability.tsx')}));
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
const invoice=(extra={})=>({id:'invoice-0599',direction:'receivable',party:'Synthetic invoiced customer',number:'0599',ocr:'0599',email:'',total:62500,currency:'SEK',issued:'2026-10-01',due:'2026-11-01',reviewed:true,voided:false,note:'',bankgiro:'',documentId:'synthetic-invoice-original',source:'Synthetic invoice',createdAt:'2026-10-01T00:00:00Z',...extra});
const payment=(extra={},raw={})=>syntheticBankTransaction({id:'payment-0599',date:'2026-10-26',amount:62500,party:'Synthetic bank payer',payerReference:'0599',bankReference:'SYNTHETIC-0599',account:'synthetic-account',kind:'payment',verified:true,...extra},raw);
const scenario=()=>{const state=emptyState(),transaction=payment();state.invoices=[invoice()];state.transactions=[transaction];return {state,transaction};};

test('invoice intended reference uses only the selected company policy and preserves supplier references',()=>{
 assert.equal(typeof view.invoiceIntendedReference,'function');
 const own=invoice({ocr:''}),before=structuredClone(own),state=companyState();
 assert.equal(view.invoiceIntendedReference(state,own),'0599');
 assert.equal(view.invoiceIntendedReference(state,invoice({number:'0001',ocr:''})),'0001');
 assert.equal(view.invoiceIntendedReference(emptyState(),invoice({ocr:'OTHER-EXPLICIT-REFERENCE'})),'OTHER-EXPLICIT-REFERENCE');
 assert.equal(view.invoiceIntendedReference(emptyState(),own),'');
 assert.equal(view.invoiceIntendedReference(state,invoice({direction:'payable',ocr:'000019'})),'000019');
 assert.equal(view.invoiceIntendedReference(state,invoice({direction:'payable',ocr:''})), '');
 assert.deepEqual(own,before);
});

test('M.George policy intention appears in the bank list without filling absent bank OCR',()=>{
 const state=companyState(),transaction=payment();state.transactions=[transaction];state.invoices=[invoice({ocr:''})];
 const before=structuredClone(state),actual=view.bankPaymentView(state,transaction);
 assert.equal(actual.intendedReferences[0].value,'0599');assert.equal(actual.intendedReferences[0].source,'Företagets fakturanummerregel');
 const html=render(ui.default,{state,transactions:[transaction],open(){}});
 assert.match(html,/Företagets fakturanummerregel/);assert.match(html,/Bank-OCR saknas/);assert.doesNotMatch(html,/Formell OCR/);
 assert.deepEqual(state,before);
});

test('a scoped invoice reference keeps separator differences visible as a conflict',()=>{
 const state=companyState(),transaction=payment({payerReference:'05-99'});state.transactions=[transaction];state.invoices=[invoice({ocr:''})];
 state.allocations=[{id:'synthetic-allocation',invoiceId:'invoice-0599',transactionId:transaction.id,amount:62500,effect:'payment',active:true}];
 const actual=view.bankPaymentView(state,transaction);
 assert.equal(actual.intendedReferences[0].value,'0599');assert.equal(actual.intendedReferences[0].conflict,true);assert.equal(actual.decision.code,'BLOCKED');
});

test('a company policy conflict exposes its original reason and cannot verify a historical payment',()=>{
 const state=companyState(),transaction=payment();state.transactions=[transaction];state.invoices=[invoice({ocr:'599'})];
 state.allocations=[{id:'synthetic-allocation',invoiceId:'invoice-0599',transactionId:transaction.id,amount:62500,effect:'payment',active:true}];
 const before=structuredClone(state),actual=view.bankPaymentView(state,transaction);
 assert.equal(actual.decision.code,'BLOCKED');assert.match(actual.decision.reason,/registrerade betalningsreferensen motsäger företagets regel/i);
 assert.equal(actual.intendedReferences[0].value,'0599');assert.match(actual.intendedReferences[0].issue,/referens/i);
 const html=render(ui.default,{state,transactions:[transaction],open(){}});assert.match(html,/Blockerad/);assert.ok(html.includes(actual.intendedReferences[0].issue));
 assert.deepEqual(state,before);
});

test('bank list distinguishes intended and reported references and names the real source for each layout',()=>{
 const {state,transaction}=scenario(),before=structuredClone(state),actual=view.bankPaymentView(state,transaction);
 assert.deepEqual(actual.intendedReferences,[{number:'0599',value:'0599',proposal:true,source:'Fakturans uttryckliga referens',conflict:false}]);
 assert.equal(actual.reference.value,'0599');assert.equal(actual.reference.ocr,'');
 const html=render(ui.default,{state,transactions:state.transactions,open(){}});
 assert.match(html,/Avsedd betalningsreferens/);assert.match(html,/Bankrapporterad referens/);
 assert.match(html,/0599/);assert.match(html,/Bankens transaktionsoriginal/);assert.match(html,/Synthetic bank payer/);
 assert.doesNotMatch(html,/Verifierad betalare: Synthetic invoiced customer|Formell OCR: 0599/);
 assert.deepEqual(state,before);
});

test('an explicit reference conflicting with the bank reference remains visible and under review after a historical allocation',()=>{
 const {state,transaction}=scenario();state.invoices[0].ocr='599';
 state.allocations=[{id:'synthetic-allocation',invoiceId:'invoice-0599',transactionId:transaction.id,amount:62500,effect:'payment',active:true}];
 const before=structuredClone(state),actual=view.bankPaymentView(state,transaction);
 assert.equal(actual.intendedReferences[0].value,'599');assert.equal(actual.reference.value,'0599');
 assert.equal(actual.decision.code,'REVIEW');assert.match(actual.decision.next,/uttryckliga.*referens|referens.*fakturanummer/i);
 const html=render(ui.default,{state,transactions:[transaction],open(){}});
 assert.match(html,/Fakturans uttryckliga referens/);assert.match(html,/Avviker från bankrapporterad referens 0599/);
 assert.deepEqual(state,before);
});

test('a distinct explicit reference matching the bank is not a conflict merely because the invoice number differs',()=>{
 const {state}=scenario(),transaction=payment({payerReference:'0000599'});state.transactions=[transaction];state.invoices[0].ocr='0000599';
 state.allocations=[{id:'synthetic-allocation',invoiceId:'invoice-0599',transactionId:transaction.id,amount:62500,effect:'payment',active:true}];
 const actual=view.bankPaymentView(state,transaction);
 assert.equal(actual.intendedReferences[0].value,'0000599');assert.equal(actual.intendedReferences[0].conflict,false);
 assert.equal(actual.decision.code,'VERIFIED');
});

for(const [name,extra,requiresSpecification,reason]of [
 ['individual Bankgiro details',{party:'',payerReference:'',description:'Bankgiro inbetalning',kind:'batch'},true,/Individuella Bankgirodetaljer saknas/],
 ['individual payer',{party:''},false,/individuell betalare eller mottagare/],
 ['bank reference',{payerReference:''},false,/Bankrapporterad betalningsreferens saknas/]
])test('missing '+name+' blocks before a historical invoice reference conflict',()=>{
 const state=emptyState(),transaction=payment(extra);state.transactions=[transaction];state.invoices=[invoice({ocr:'599'})];
 state.allocations=[{id:'synthetic-allocation',invoiceId:'invoice-0599',transactionId:transaction.id,amount:62500,effect:'payment',active:true}];
 const before=structuredClone(state),actual=view.bankPaymentView(state,transaction);
 assert.equal(actual.requiresSpecification,requiresSpecification);assert.equal(actual.intendedReferences[0].value,'599');
 assert.equal(actual.decision.code,'BLOCKED');assert.match(actual.decision.reason,reason);
 const html=render(ui.default,{state,transactions:[transaction],open(){}});assert.match(html,/Blockerad/);assert.match(html,reason);
 assert.deepEqual(state,before);
});

test('unregistered candidate invoice is never elevated into a known intended reference',()=>{
 const {state,transaction}=scenario();state.invoices=[];
 const actual=view.bankPaymentView(state,transaction,[{number:'0599',party:'Synthetic invoiced customer'}]);
 assert.deepEqual(actual.intendedReferences,[]);assert.equal(actual.verified,false);
 const html=render(ui.default,{state,transactions:[transaction],candidates:{[transaction.id]:[{number:'0599'}]},open(){}});
 assert.match(html,/Möjlig: 0599/);assert.match(html,/Avsedd betalningsreferens[^<]*|Avsedd betalningsreferens/);
 assert.match(html,/Inte fastställd/);
});

test('missing receiving account blocks a recorded payment badge without changing its allocation',()=>{
 const {state,transaction}=scenario();transaction.bankAccountIssue='Mottagarkontot saknar en uttrycklig bankidentifierare.';
 state.allocations=[{id:'synthetic-allocation',invoiceId:'invoice-0599',transactionId:transaction.id,amount:62500,effect:'payment',active:true,note:'Synthetic only',createdAt:'2026-10-26T00:00:00Z'}];
 const before=structuredClone(state),actual=view.bankPaymentView(state,transaction);
 assert.equal(actual.decision?.code,'BLOCKED');assert.match(actual.decision.next,/konto/i);
 const html=render(ui.default,{state,transactions:[transaction],open(){}});
 assert.match(html,/Blockerad/);assert.match(html,/Återstår/);assert.match(html,/Mottagarkontot saknar/);
 assert.deepEqual(state,before);
});

test('manual report association remains REVIEW even when an economic payment has a recorded allocation',()=>{
 const {state,target}=paymentFieldSourceFixture();
 state.invoices=[invoice()];state.allocations=[{id:'synthetic-allocation',invoiceId:'invoice-0599',transactionId:target.id,amount:62500,effect:'payment',active:true}];
 const actual=view.bankPaymentView(state,target);
 assert.equal(actual.requiresSpecification,true);assert.equal(actual.fieldSources.payer.kind,'report');assert.equal(actual.reference.value,'0599');
 assert.notEqual(actual.decision?.code,'VERIFIED');assert.equal(actual.decision?.code,'REVIEW');
 assert.match(actual.decision.next,/manuell|underlagsrelation|kundrelation/i);
 const html=render(ui.default,{state,transactions:[target],open(){}});
 assert.doesNotMatch(html,/<small>Verifierad<\/small>|data-verification-state="VERIFIED"/,'a legacy status may not contradict the current review decision');
});

for(const [name,party,reference,reason]of [
 ['payer','','0599',/individuell betalare eller mottagare/],
 ['reference','Synthetic report payer','',/Bankrapporterad betalningsreferens saknas/]
])test('a manual report relationship cannot hide a missing selected-original '+name,()=>{
 const transaction=payment({account:'iban:SE4280000890119146168423',party:'',payerReference:'',description:'Samlingsinsättning',kind:'batch'});
 let state=emptyState();state.transactions=[transaction];state.invoices=[invoice()];
 const csv='Betalningsdatum;Avsändare;Betalningsreferens;Belopp;Valuta;Mottagarkonto\n2026-10-26;'+party+';'+reference+';625,00;SEK;'+transaction.account.slice(5);
 state=applyCommand(state,{type:'bankgiro.import',documentId:'synthetic-incomplete-report',hash:'b'.repeat(64),name:'synthetic-incomplete.csv',rows:parseSpecificationBytes(new TextEncoder().encode(csv),'synthetic-incomplete.csv')}).state;
 state=applyCommand(state,{type:'bankgiro.link',transactionId:transaction.id,specificationId:state.transactions.find(row=>row.specification).id,note:'Synthetic metadata relation only',confirmOriginals:true,confirmAccount:true}).state;
 const target=state.transactions.find(row=>row.id===transaction.id),before=structuredClone(state),actual=view.bankPaymentView(state,target);
 assert.ok(actual.sourceLink);assert.equal(actual.requiresSpecification,true);
 assert.equal(actual.decision.code,'BLOCKED');assert.match(actual.decision.reason,reason);
 assert.equal(actual.fieldSources.payer.value,party);assert.equal(actual.reference.value,reference);
 assert.deepEqual(state,before);
});

test('chargeback review preserves the domain explanation and historical allocation in the bank list',()=>{
 const state=emptyState(),transaction=payment({description:'Chargeback'});state.transactions=[transaction];state.invoices=[invoice()];
 state.allocations=[{id:'synthetic-allocation',invoiceId:'invoice-0599',transactionId:transaction.id,amount:62500,effect:'payment',active:true}];
 const before=structuredClone(state),actual=view.bankPaymentView(state,transaction);
 assert.equal(actual.decision.code,'REVIEW');assert.match(actual.decision.reason,/återbetalning eller återföring/);
 const html=render(ui.default,{state,transactions:[transaction],open(){}});assert.match(html,/Kontrollera den ursprungliga betalningen före avstämning/);
 assert.doesNotMatch(html,/data-verification-state="VERIFIED"/);assert.deepEqual(state,before);
});

for(const [name,change]of [['unreviewed',{reviewed:false}],['missing original',{documentId:''}]])test('a recorded allocation cannot verify a known '+name+' invoice',()=>{
 const {state,transaction}=scenario();Object.assign(state.invoices[0],change);
 state.allocations=[{id:'synthetic-allocation',invoiceId:'invoice-0599',transactionId:transaction.id,amount:62500,effect:'payment',active:true}];
 const before=structuredClone(state),actual=view.bankPaymentView(state,transaction);
 assert.equal(actual.decision.code,'REVIEW');assert.match(actual.decision.next,/faktura|original/i);
 assert.equal(view.bankPaymentCounts(state).verified,0);assert.deepEqual(state,before);
});

test('complete saved invoice and bank evidence keeps a verified historical payment distinguishable',()=>{
 const {state,transaction}=scenario();state.allocations=[{id:'synthetic-allocation',invoiceId:'invoice-0599',transactionId:transaction.id,amount:62500,effect:'payment',active:true}];
 assert.equal(view.bankPaymentView(state,transaction).decision.code,'VERIFIED');assert.equal(view.bankPaymentCounts(state).verified,1);
});

test('a missing-account block suppresses a legacy verified subtitle in both layouts',()=>{
 const {state}=scenario(),transaction=payment({account:''});state.transactions=[transaction];
 state.allocations=[{id:'synthetic-allocation',invoiceId:'invoice-0599',transactionId:transaction.id,amount:62500,effect:'payment',active:true}];
 assert.equal(view.bankPaymentView(state,transaction).decision.code,'BLOCKED');
 const html=render(ui.default,{state,transactions:[transaction],open(){}});
 assert.doesNotMatch(html,/<small>Verifierad<\/small>|data-verification-state="VERIFIED"/);
});

// Render the real invoice-detail body. Only its unrelated original-fetch panel
// and outer dialog are inert; amount/status/source text comes from production.
async function invoiceDetail(){
 const source=readFileSync(new URL('../app/dashboard.tsx',import.meta.url),'utf8'),start=source.indexOf('function InvoiceDetail('),body=source.slice(start,source.indexOf('\nfunction ',start+1));
 const prefix=`import React from 'react';import {balance,paid,credited,invoiceStatus,invoicePaymentEvidenceIssue,invoiceReferenceDecision,paymentEvidenceIssue,suggestions,money} from '@/lib/domain';import {bankPaymentView,invoiceIntendedReference} from '@/lib/payment-presentation';import {Paperclip,Download,MoreHorizontal,FileText,Link2,ReceiptText} from 'lucide-react';const init=(s)=>s.slice(0,2);const DetailSurface=({children})=><section>{children}</section>;const Pill=({children,tone})=><span data-tone={tone}>{children}</span>;const InvoiceEvidence=()=>null;`;
 let code=ts.transpileModule(prefix+source.slice(source.indexOf('function invoiceListEvidence('),source.indexOf('function InvoiceTable('))+body+'\nexport default InvoiceDetail;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const [name,target]of Object.entries({'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'lucide-react':import.meta.resolve('lucide-react'),'@/lib/domain':file('../lib/domain.ts'),'@/lib/payment-presentation':presentation}))for(const q of ['"',"'"])code=code.replaceAll(q+name+q,JSON.stringify(target));
 return (await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).default;
}

test('invoice detail preserves allocated money but cannot certify a manual report relationship',async()=>{
 const {state,target}=paymentFieldSourceFixture();state.invoices=[invoice()];state.allocations=[{id:'synthetic-allocation',invoiceId:'invoice-0599',transactionId:target.id,amount:62500,effect:'payment',active:true}];
 const before=structuredClone(state),html=render(await invoiceDetail(),{invoice:state.invoices[0],state,close(){},open(){},toast(){},onMessage(){},busy:false,demo:false});
 assert.match(html,/625,00/);assert.match(html,/Registrerat fördelat/);assert.match(html,/Registrerad koppling · granska underlag/);
 assert.doesNotMatch(html,/Verifierad koppling|Verifierat betalt/);assert.deepEqual(state,before);
});

test('invoice settlement names each source when payer and reference originate from different bank originals',async()=>{
 const {state,target}=paymentFieldSourceFixture({linked:false,detailReference:'',collective:false});state.invoices=[invoice({number:'0700'})];state.allocations=[{id:'synthetic-allocation',invoiceId:'invoice-0599',transactionId:target.id,amount:62500,effect:'payment',active:true}];
 const html=render(await invoiceDetail(),{invoice:state.invoices[0],state,close(){},open(){},toast(){},onMessage(){},busy:false,demo:false});
 assert.match(html,/Betalarkälla: Bankens separata detaljoriginal/);assert.match(html,/Referenskälla: Bankens transaktionsoriginal/);
});

test('the verified bank filter excludes a fully allocated manual source relationship',async()=>{
 const source=readFileSync(new URL('../app/dashboard.tsx',import.meta.url),'utf8'),start=source.indexOf('function bankPresentationGroup('),group=source.slice(start,source.indexOf('\n',start));
 const overview=readFileSync(new URL('../lib/payment-overview.ts',import.meta.url),'utf8'),a=overview.indexOf('export function paymentGroup('),b=overview.indexOf('export const paymentTitle',a);
 const prefix=`import {available,paymentEvidenceConflict,paymentOriginalIssue,needsBankFileValidation,needsPaymentSpecification} from ${JSON.stringify(file('../lib/domain.ts'))};import {bankPaymentView} from ${JSON.stringify(presentation)};`;
 const code=ts.transpileModule(prefix+overview.slice(a,b)+group+'\nexport {bankPresentationGroup};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const {bankPresentationGroup}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const {state,target}=paymentFieldSourceFixture();state.invoices=[invoice()];state.allocations=[{id:'synthetic-allocation',invoiceId:'invoice-0599',transactionId:target.id,amount:62500,effect:'payment',active:true}];
 assert.notEqual(bankPresentationGroup(state,target),'matched');
});

test('two observations cannot inflate economic payment counts or appear as two credited payments',()=>{
 const {state,transaction}=scenario();transaction.verified=false;
 const observation={...payment({id:'report-observation',bankReference:'SYNTHETIC-REPORT'}),evidence:'bank_file',specification:true,specificationStatus:'review',bankFileProof:{version:'bank-file-original-v1',documentId:'synthetic-report',sha256:'a'.repeat(64)}};
 state.transactions.push(observation);
 const before=structuredClone(state),counts=view.bankPaymentCounts(state);
 assert.equal(counts.review,1);assert.equal(counts.observations,1);
 const html=render(ui.default,{state,transactions:state.transactions,open(){}});
 assert.match(html,/Underlag · räknas inte som pengar/);assert.match(html,/Underlagsbelopp/);
 assert.equal((html.match(/data-economic="true"/g)||[]).length,2,'one economic row in each responsive layout');
 assert.equal((html.match(/data-economic="false"/g)||[]).length,2,'one evidence observation in each responsive layout');
 assert.deepEqual(state,before);
});

test('several individual payers retain separate names, references and amounts under one collection',()=>{
 const state=emptyState();const parent=payment({id:'batch',party:'',payerReference:'',kind:'batch',description:'Bankgiro inbetalning'});
 const first=payment({id:'payer-a',parentId:'batch',party:'Synthetic payer A',payerReference:'0599',amount:30000,bankReference:'SYNTHETIC-A'});
 const second=payment({id:'payer-b',parentId:'batch',party:'Synthetic payer B',payerReference:'0600',amount:32500,bankReference:'SYNTHETIC-B'});
 state.transactions=[parent,first,second];state.invoices=[invoice({total:30000}),invoice({id:'invoice-0600',number:'0600',total:32500})];
 const visible=view.bankVisibleTransactions(state);assert.deepEqual(visible.map(t=>t.id),['payer-a','payer-b']);
 const html=render(ui.default,{state,transactions:visible,open(){}});
 for(const token of ['Synthetic payer A','Synthetic payer B','0599','0600','300,00','325,00','Avsedd betalningsreferens'])assert.ok(html.includes(token),token);
 assert.doesNotMatch(html,/\+625,00/);
});

test('malformed date is displayed as unknown rather than crashing the bank overview',()=>{
 const {state,transaction}=scenario();transaction.date='not-a-date';
 const html=render(ui.default,{state,transactions:[transaction],open(){}});
 assert.match(html,/Datum saknas/);assert.doesNotMatch(html,/Invalid Date|dateTime="not-a-date"/);
});

test('AIS sync is not a Bankgiro download receipt or evidence of report permissions',()=>{
 assert.equal(typeof ui.BankReportAvailability,'function');
 const state=emptyState(),html=render(ui.BankReportAvailability,{state,lastSynced:'2026-11-02T21:00:00Z'});
 assert.match(html,/Läser rapportstatus/);
 assert.doesNotMatch(html,/2026-11-02|22:00|Automatiskt hämtad|Behörighet saknas hos banken/);
});

test('formal OCR requires the selected bank original to classify the actual value as OCR',()=>{
 const {state}=scenario(),typed=payment({payerReference:'000018'},{reference_number:undefined,ocr:'000018'});state.transactions=[typed];
 let html=render(ui.default,{state,transactions:[typed],open(){}});assert.match(html,/Formell OCR/);assert.match(html,/000018/);
 const generic=payment({payerReference:'000018'});state.transactions=[generic];html=render(ui.default,{state,transactions:[generic],open(){}});
 assert.doesNotMatch(html,/Formell OCR/);assert.match(html,/Bank-OCR saknas/);
});

for(const [name,raw] of [
 ['invalid checksum',{ocr:'12345'}],
 ['contradictory checksum-valid OCR fields',{ocr:'000018',ocr_reference:'000026'}],
])test('both bank layouts preserve reported OCR but withhold formal classification for '+name,()=>{
 const state=emptyState(),transaction=payment({payerReference:raw.ocr},{reference_number:undefined,...raw});state.transactions=[transaction];
 const before=structuredClone(state),html=render(ui.default,{state,transactions:[transaction],open(){}}),[desktop,mobile]=html.split('<div class="bank-mobile-list"');
 for(const layout of [desktop,mobile]){
  assert.ok(layout);assert.ok(layout.includes(raw.ocr));assert.match(layout,/Bankrapporterad OCR/);assert.doesNotMatch(layout,/Formell OCR/);
  assert.match(layout,/OCR.*(?:ogiltig|motstridig)|(?:ogiltig|motstridig).*OCR/i);
 }
 assert.equal(view.bankPaymentView(state,transaction).decision.code,'BLOCKED');assert.deepEqual(state,before);
});

test('complete selected-original checksum-valid OCR is formal in both bank layouts',()=>{
 const state=emptyState(),transaction=payment({payerReference:'000018'},{reference_number:undefined,ocr:'000018'});state.transactions=[transaction];
 const html=render(ui.default,{state,transactions:[transaction],open(){}}),layouts=html.split('<div class="bank-mobile-list"');
 assert.equal(layouts.length,2);for(const layout of layouts){assert.match(layout,/Formell OCR/);assert.match(layout,/000018/);}
});

test('an incomplete reference analysis with a checksum-valid OCR remains diagnostic in both layouts',()=>{
 const state=emptyState(),transaction=payment({payerReference:'000018'},{reference_number:undefined,ocr:'000018'});transaction.referenceEvidence.incomplete=true;state.transactions=[transaction];
 const html=render(ui.default,{state,transactions:[transaction],open(){}}),layouts=html.split('<div class="bank-mobile-list"');
 assert.equal(layouts.length,2);for(const layout of layouts){assert.match(layout,/000018/);assert.match(layout,/ofullständigt underlag/);assert.doesNotMatch(layout,/Formell OCR/);}
});
