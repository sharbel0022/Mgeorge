import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {emptyState,applyCommand,balance} from '../lib/domain.ts';
import {syntheticBankRow} from './helpers/bank-api-fixture.mjs';
import {makeBankgiroXLSX} from './helpers/bankgiro-xlsx-fixture.mjs';
import {parseSpecificationBytes} from '../lib/bankgiro-parser.js';
import {paymentFieldSourceFixture,paymentFieldInvoiceFixture} from './helpers/payment-field-source-fixture.mjs';

const url=p=>new URL(p,import.meta.url).href,data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
function compiled(path,imports){let code=stripTypeScriptTypes(readFileSync(new URL(path,import.meta.url),'utf8'),{mode:'transform'});for(const [name,value]of Object.entries({'./payment-references.js':url('../lib/payment-references.js'),'./bank-api-original.js':url('../lib/bank-api-original.js'),...imports}))for(const q of ['"',"'"])code=code.replaceAll(q+name+q,JSON.stringify(value));return data(code);}
const domain=url('../lib/domain.ts'),engine=url('../lib/reconciliation-engine.js');
const presentation=compiled('../lib/payment-presentation.ts',{'./domain':domain,'./reconciliation-engine.js':engine,'./payment-references.js':url('../lib/payment-references.js')});
const reconciliation=compiled('../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':engine});
const candidates=compiled('../lib/banking/invoice-candidates.ts',{'../domain':domain,'../reconciliation-engine.js':new URL('../lib/reconciliation-engine.js',import.meta.url).href,'../payment-presentation':presentation});
const detailEvidence=compiled('../lib/banking/detail-evidence.ts',{'../domain':domain,'../payment-references.js':url('../lib/payment-references.js'),'../payer-evidence.js':url('../lib/payer-evidence.js')});
const {transactionDetailEvidence}=await import(detailEvidence);
const ctx={checkedAt:'2026-11-01T21:00:00.000Z',originalIssue:'',accountIssue:'',reportIssue:'',invoiceOriginalIssue:'',invoiceOriginalChecked:true,documents:[],findings:[]};
const file=new URL('../lib/payment-verification.ts',import.meta.url),implemented=existsSync(file);
const moduleUrl=implemented?compiled('../lib/payment-verification.ts',{'./account-evidence-presentation':compiled('../lib/account-evidence-presentation.ts',{'./domain':domain}),'./domain':domain,'./payment-presentation':presentation,'./reconciliation-engine.js':engine,'./reconciliation-evidence':data('export async function paymentOriginalAvailabilityIssue(){return "";} export async function reconciliationPreviewWithOriginals(){return {findings:[]};}'),'./bankgiro-service':data('export async function bankgiroAutomaticAccountIssue(){return "";}export async function bankgiroRetainedPreview(){throw Error("Not used in pure projection");}'),'./banking/invoice-candidates':candidates,'./banking/detail-evidence':detailEvidence,'./server':data('export function db(){throw Error("No database reads during pure projection");}'),'cloudflare:workers':data('export const env={};')}):null;
const api=moduleUrl?await import(moduleUrl):{};
const build=(s,id,extra={})=>api.buildPaymentVerification(s,id,{...ctx,...extra});
function fixture({invoice=true,batch=false,reference='0599',party='Synthetic customer AB'}={}){
 let state=emptyState();
 if(invoice)state=applyCommand(state,{type:'invoice.save',invoice:{direction:'receivable',party,number:'0599',ocr:'',total:62500,issued:'2026-10-01',due:'2026-10-30',reviewed:true,documentId:'synthetic-invoice-original'}}).state;
 state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({date:'2026-10-26',amount:62500,party:batch?'':party,payerReference:batch?'':reference,bankReference:'SYNTHETIC-PAYMENT',account:'iban:SE4280000890119146168423',kind:batch?'batch':'payment',description:batch?'Bankgiro inbetalning':'',verified:!batch})]}).state;
 return state;
}
const step=(report,id)=>report.steps.find(s=>s.id===id);

test('read-only payment verification exposes an implemented explanation projection',()=>assert.equal(typeof api.buildPaymentVerification,'function'));

test('eleven explainable stages keep source, rule, reason, timestamp and next action without changing input',{skip:!implemented},()=>{
 const state=fixture(),before=structuredClone(state),report=build(state,state.transactions[0].id);
 assert.equal(report.mode,'preview');assert.equal(report.changed,false);assert.equal(report.steps.length,11);
 for(const item of report.steps){for(const field of ['id','label','status','statusLabel','source','rule','reason','checkedAt','next'])assert.equal(typeof item[field],'string',field);assert.ok(item.reason);assert.ok(item.next);assert.equal(item.checkedAt,ctx.checkedAt);assert.ok(Array.isArray(item.facts));}
 assert.equal(step(report,'original').status,'passed');assert.equal(step(report,'account').status,'passed');assert.equal(step(report,'reference').facts.find(f=>f.label==='Referens').value,'0599');
 assert.equal(step(report,'reference').statusLabel,'Betalningsreferens');assert.equal(step(report,'invoice').statusLabel,'Registrerad · original intakt');
 assert.deepEqual(state,before);assert.equal(balance(state,state.invoices[0]),62500);assert.equal(state.allocations.length,0);
});

test('original integrity can pass while current receiving-account consent is blocked',{skip:!implemented},()=>{
 const s=fixture(),r=build(s,s.transactions[0].id,{accountIssue:'Mottagarkontot finns inte i det aktiva medgivandet.'});
 assert.equal(step(r,'original').status,'passed');assert.equal(step(r,'account').status,'blocked');assert.equal(r.automaticEligible,false);assert.equal(step(r,'reconciliation').status,'blocked');
});

test('missing receipt and malformed original block the control and preserve recorded money',{skip:!implemented},()=>{
 let s=fixture(),t=s.transactions[0];s=applyCommand(s,{type:'match.create',invoiceId:s.invoices[0].id,transactionId:t.id,amount:62500,note:'Synthetic prior administrator decision'}).state;
 const before=structuredClone(s),r=build(s,t.id,{originalIssue:'Bankens ankomstkvitto saknas.'});
 assert.equal(step(r,'original').status,'blocked');assert.equal(step(r,'reconciliation').status,'blocked');assert.match(step(r,'reconciliation').reason,/bevar|registrerad/i);assert.equal(balance(s,s.invoices[0]),0);assert.deepEqual(s,before);
});

test('register entry without an inspected original is never called an original-verified invoice',{skip:!implemented},()=>{
 const s=fixture(),r=build(s,s.transactions[0].id,{invoiceOriginalChecked:false,invoiceOriginalIssue:'Originalfakturan har inte kunnat kontrolleras.'});
 assert.equal(step(r,'invoice').status,'review');assert.doesNotMatch(step(r,'invoice').statusLabel,/intakt|verifierad/i);assert.equal(r.automaticEligible,false);
});

test('missing invoice and leading-zero document candidate are explicit and create no invoice',{skip:!implemented},()=>{
 const s=fixture({invoice:false}),before=structuredClone(s),r=build(s,s.transactions[0].id,{documents:[{document_id:'synthetic-pdf',status:'needs_review',extraction:JSON.stringify({direction:'customer',kind:'invoice',currency:'SEK',invoice_number:'0599',party:'Synthetic customer AB',total_cents:62500,issued_at:'2026-10-01'})}]});
 assert.equal(step(r,'invoice').statusLabel,'Original hittat · ej registrerad');assert.match(step(r,'invoice').facts.map(f=>f.value).join(' '),/0599/);assert.equal(r.automaticEligible,false);assert.deepEqual(s,before);
});

test('same amount and date show a report candidate without declaring common bank identity or payer',{skip:!implemented},()=>{
 let s=fixture({batch:true});const t=s.transactions[0],bytes=makeBankgiroXLSX({currency:'SEK',account:t.account.slice(5),date:t.date,payments:[{party:'Report payer AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}]});
 s=applyCommand(s,{type:'bankgiro.import',documentId:'synthetic-report',hash:'a'.repeat(64),name:'synthetic.xlsx',rows:parseSpecificationBytes(bytes,'synthetic.xlsx')}).state;
 const r=build(s,t.id);assert.equal(step(r,'report').status,'review');assert.equal(step(r,'deposit').status,'missing');assert.equal(step(r,'payer').status,'missing');assert.equal(r.automaticEligible,false);assert.equal(s.allocations.length,0);
});

test('manual source relation stays separate from bank identity, invoice verification and allocation',{skip:!implemented},()=>{
 let s=fixture({batch:true});const t=s.transactions[0],bytes=makeBankgiroXLSX({currency:'SEK',account:t.account.slice(5),date:t.date,payments:[{party:'Report payer AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}]});
 s=applyCommand(s,{type:'bankgiro.import',documentId:'synthetic-report',hash:'a'.repeat(64),name:'synthetic.xlsx',rows:parseSpecificationBytes(bytes,'synthetic.xlsx')}).state;
 s=applyCommand(s,{type:'bankgiro.link',transactionId:t.id,specificationId:s.transactions.find(t=>t.specification).id,note:'Synthetic original relation only',confirmOriginals:true,confirmAccount:true}).state;
 const before=structuredClone(s),r=build(s,t.id);
 assert.equal(step(r,'deposit').status,'manual');assert.equal(step(r,'deposit').statusLabel,'Manuell relation');assert.match(step(r,'deposit').reason,/inte.*bank|bank.*inte/i);assert.equal(step(r,'customer').status,'review');assert.equal(r.automaticEligible,false);assert.equal(s.allocations.length,0);assert.deepEqual(s,before);
});

test('unknown or foreign payment id cannot expose another payment or start a control',{skip:!implemented},()=>{
 const s=fixture();assert.throws(()=>build(s,'foreign-id'),/finns inte|saknas/i);assert.equal(s.allocations.length,0);
});

test('an unavailable invoice document candidate is only a proposal, not a found original',{skip:!implemented},()=>{
 const s=fixture({invoice:false}),r=build(s,s.transactions[0].id,{invoiceOriginalChecked:false,invoiceOriginalIssue:'Originalet saknas i ägarens lagring.',documents:[{document_id:'missing-pdf',status:'needs_review',extraction:JSON.stringify({direction:'customer',kind:'invoice',currency:'SEK',invoice_number:'0599',party:'Synthetic customer AB',total_cents:62500,issued_at:'2026-10-01'})}]});
 assert.equal(step(r,'invoice').statusLabel,'Underlagsförslag · ej registrerad');assert.match(step(r,'invoice').reason,/inte.*kontroller|saknas/i);
});

async function serviceFixture(t,{invoiceMode='valid',candidate=false,accountIssue='',unauthenticated=false,report=false,reportAccountIssue='',detailMode='none',sourceInvoices=false,booked=false}={}){
 const key='__payment_verification_'+crypto.randomUUID().replaceAll('-',''),bytes=new TextEncoder().encode('Synthetic invoice original, no customer data'),hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 let state=fixture({invoice:!candidate,batch:report}),reportRows=[];
 if(report){const original=makeBankgiroXLSX({currency:'SEK',account:state.transactions[0].account.slice(5),date:'2026-10-26',payments:[{party:'Report payer AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}]});reportRows=parseSpecificationBytes(original,'synthetic.xlsx');state=applyCommand(state,{type:'bankgiro.import',documentId:'synthetic-report',hash:'a'.repeat(64),name:'synthetic.xlsx',rows:reportRows}).state;}
 if(sourceInvoices){const f=paymentFieldInvoiceFixture({booked});state=f.state;reportRows=f.reportRows;}
 let detailBytes=new Uint8Array(),detailHash='';
 if(detailMode!=='none'){
  const target=state.transactions[0],listed=structuredClone(target.bankData),detail={...structuredClone(listed),debtor:{name:'Synthetic detail payer AB'}},at='2026-10-29T12:00:00.000Z';
  if(detailMode==='organization')detail.debtor.organisation_id={identification:'556777-8899',scheme_name:'COID',issuer:'SE'};
  if(detailMode==='raw-reference')detail.reference_number=' 0599 ';
  if(detailMode==='raw-message'){delete detail.reference_number;detail.remittance_information=['Faktura 0599'];}
  target.bankDetails={...transactionDetailEvidence(target,listed,detail),checkedAt:at,documentId:'synthetic-detail-original',bankReferenceText:''};
  const envelope={source:'Enable Banking transaction details',account:detailMode==='envelope'?'iban:FOREIGN':target.account,bankReference:target.bankReference,checkedAt:at,listed,detail};
  detailBytes=new TextEncoder().encode(JSON.stringify(envelope));detailHash=Buffer.from(await crypto.subtle.digest('SHA-256',detailBytes)).toString('hex');
  if(detailMode==='projection')target.bankDetails.party='Altered displayed detail payer';
  if(detailMode==='reference')target.bankDetails.referenceEvidence={...target.bankDetails.referenceEvidence,incomplete:true};
  if(detailMode==='payer')target.bankDetails.payerEvidence={...target.bankDetails.payerEvidence,organizationNumber:'1234567890'};
  if(detailMode==='unused'){target.bankDetails.party='';target.bankDetails.payerReference='';delete target.bankDetails.referenceEvidence;delete target.bankDetails.payerEvidence;}
 }
 const f={owner:'synthetic-owner',state,queries:[],reads:[],accountChecks:[],originalChecks:[],reportChecks:[],reportRows,reportAccountIssue,previewChecks:0,revision:17,accountIssue,unauthenticated,invoiceMode,candidate,bytes,hash,detailMode};
 f.DB={prepare(sql){assert.match(sql,/^SELECT /);assert.match(sql,/owner\s*=/);return{bind(...args){f.queries.push({sql,args});return{async first(){assert.equal(args[1],f.owner);if(args[0]==='synthetic-detail-original')return detailMode==='foreign'?null:{mime:detailMode==='mime'?'text/plain':'application/json',size:detailBytes.length,sha256:detailHash};return invoiceMode==='foreign'?null:{size:bytes.length,sha256:hash};},async all(){assert.equal(args[0],f.owner);return{results:candidate?[{document_id:'synthetic-invoice-original',status:'needs_review',extraction:JSON.stringify({direction:'customer',kind:'invoice',currency:'SEK',invoice_number:'0599',party:'Synthetic customer AB',total_cents:62500,issued_at:'2026-10-01'})}]:[]};}};}};}};
 f.env={BUCKET:{async get(path){f.reads.push(path);assert.ok(['synthetic-invoice-original','synthetic-detail-original','synthetic-invoice-0599','synthetic-invoice-0800'].map(id=>f.owner+'/'+id).includes(path));const isDetail=path.endsWith('/synthetic-detail-original'),mode=isDetail?detailMode:invoiceMode;if(mode==='missing')return null;const contents=mode==='corrupt'?new TextEncoder().encode('Tampered synthetic data'):isDetail?detailBytes:bytes;return{size:contents.length,arrayBuffer:async()=>contents.buffer};}}};
 globalThis[key]=f;t.after(()=>delete globalThis[key]);
 const server=data(`const f=globalThis[${JSON.stringify(key)}];export function db(){return f.DB;}export async function identity(){if(f.unauthenticated)throw Error('AUTH_REQUIRED');return {userId:f.owner};}export async function readWorkspace(owner){if(owner!==f.owner)throw Error('Wrong owner');return {state:f.state,revision:f.revision};}export const response=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});export const failure=error=>response({error:error.message},error.message==='AUTH_REQUIRED'?401:400);`);
 const evidence=data(`import {paymentOriginalIssue} from ${JSON.stringify(domain)};const f=globalThis[${JSON.stringify(key)}];export async function paymentOriginalAvailabilityIssue(owner,state,id){if(owner!==f.owner||state!==f.state)throw Error('Wrong owner/state');f.originalChecks.push(id);const target=state.transactions.find(t=>t.id===id);return target?paymentOriginalIssue(state,target):'Original saknas';}export async function reconciliationPreviewWithOriginals(owner,state){if(owner!==f.owner||state!==f.state)throw Error('Wrong owner/state');f.previewChecks++;return {findings:[]};}`);
 const bankgiro=data(`const f=globalThis[${JSON.stringify(key)}];export async function bankgiroAutomaticAccountIssue(owner,account){f.accountChecks.push({owner,account});return f.accountIssue;}export async function bankgiroRetainedPreview(owner,documentId,targetId){if(owner!==f.owner)throw Error('Wrong owner');f.reportChecks.push({documentId,targetId});return {hash:'a'.repeat(64),rows:f.reportRows.map(row=>({...row,bankgiroAccountIssue:f.reportAccountIssue}))};}`);
 const service=compiled('../lib/payment-verification.ts',{'./account-evidence-presentation':compiled('../lib/account-evidence-presentation.ts',{'./domain':domain}),'./domain':domain,'./payment-presentation':presentation,'./reconciliation-engine.js':engine,'./reconciliation-evidence':evidence,'./bankgiro-service':bankgiro,'./banking/invoice-candidates':candidates,'./banking/detail-evidence':detailEvidence,'./server':server,'cloudflare:workers':data(`export const env=globalThis[${JSON.stringify(key)}].env;`)});
 const route=await import(compiled('../app/api/bank/verification/route.ts',{'@/lib/server':server,'@/lib/payment-verification':service}));
 return {...f,route,service:await import(service),control:f};
}

test('real GET reads only owned originals and current consent without provider calls, audit or state writes',{skip:!implemented},async t=>{
 const f=await serviceFixture(t),before=structuredClone(f.state),originalFetch=globalThis.fetch;
 globalThis.fetch=()=>{throw Error('Provider/network fetch is forbidden in a stored verification GET');};
 try{const response=await f.route.GET(new Request('https://mg.test/api/bank/verification?transactionId='+f.state.transactions[0].id)),report=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(report.revision,17);assert.equal(report.changed,false);assert.equal(report.steps.length,11);assert.equal(step(report,'invoice').statusLabel,'Registrerad · original intakt');assert.deepEqual(f.state,before);assert.equal(f.control.previewChecks,1);assert.equal(f.control.accountChecks.length,1);assert.equal(f.control.originalChecks.length,1);assert.deepEqual(f.control.reads,['synthetic-owner/synthetic-invoice-original']);for(const {sql}of f.control.queries)assert.match(sql,/^SELECT /);
 }finally{globalThis.fetch=originalFetch;}
});

for(const invoiceMode of ['missing','corrupt','foreign'])test(`GET ${invoiceMode} invoice original does not become a verified register invoice`,{skip:!implemented},async t=>{
 const f=await serviceFixture(t,{invoiceMode}),before=structuredClone(f.state),response=await f.route.GET(new Request('https://mg.test/api/bank/verification?transactionId='+f.state.transactions[0].id)),report=await response.json();
 assert.equal(response.status,200);assert.equal(step(report,'invoice').status,'review');assert.equal(report.automaticEligible,false);assert.deepEqual(f.state,before);
});

test('GET independently verifies an exact unregistered document candidate without registering it',{skip:!implemented},async t=>{
 const f=await serviceFixture(t,{candidate:true}),response=await f.route.GET(new Request('https://mg.test/api/bank/verification?transactionId='+f.state.transactions[0].id)),report=await response.json();
 assert.equal(response.status,200);assert.equal(step(report,'invoice').statusLabel,'Original hittat · ej registrerad');assert.equal(step(report,'invoice').facts.find(f=>f.label==='Original tillgängligt')?.value,'Ja');assert.equal(step(report,'invoice').facts.find(f=>f.label==='Fakturaregistrering')?.value,'Ej registrerad');assert.deepEqual(f.control.reads,['synthetic-owner/synthetic-invoice-original']);assert.equal(f.state.invoices.length,0);assert.equal(f.state.allocations.length,0);
});

test('GET denies unauthenticated, invalid and foreign ids before opening documents or checking bank access',{skip:!implemented},async t=>{
 for(const mode of ['unauthenticated','invalid','foreign']){const f=await serviceFixture(t,{unauthenticated:mode==='unauthenticated'}),id=mode==='invalid'?'bad/id':mode==='foreign'?'foreign-id':f.state.transactions[0].id,response=await f.route.GET(new Request('https://mg.test/api/bank/verification?transactionId='+encodeURIComponent(id)));
  assert.equal(response.status,mode==='unauthenticated'?401:mode==='invalid'?400:404);assert.equal(f.control.originalChecks.length,0);assert.equal(f.control.accountChecks.length,0);assert.equal(f.control.queries.length,0);assert.equal(f.control.reads.length,0);assert.equal(typeof f.route.POST,'undefined');
 }
});

test('the existing engine may propose a safe match but the detail still performs no allocation',{skip:!implemented},async()=>{
 const s=fixture(),before=structuredClone(s),{reconciliationPreview}=await import(reconciliation),preview=reconciliationPreview(s),r=build(s,s.transactions[0].id,{findings:preview.findings});
 assert.equal(r.automaticEligible,true);assert.equal(step(r,'customer').statusLabel,'Stämmer enligt matchningsregeln');assert.equal(step(r,'reconciliation').statusLabel,'Förslag · separat beslut krävs');assert.deepEqual(s,before);assert.equal(s.allocations.length,0);
});

test('a complete bank-identified report shows common identity and declared counts separately from a manual relation',{skip:!implemented},async()=>{
 let s=fixture({batch:true}),parent=s.transactions[0];
 const csv='Betalningsdatum;Avsändare;Betalningsreferens;Bankgironummer/Avinummer;Belopp;Valuta;Mottagarkonto;Bankreferens\n2026-10-26;Synthetic customer AB;0599;987-6543;625,00;SEK;'+parent.account.slice(5)+';'+parent.bankReference;
 s=applyCommand(s,{type:'bankgiro.import',documentId:'synthetic-report',hash:'a'.repeat(64),name:'synthetic.csv',rows:parseSpecificationBytes(new TextEncoder().encode(csv),'synthetic.csv')}).state;
 const child=s.transactions.find(t=>t.parentId),{reconciliationPreview}=await import(reconciliation),r=build(s,child.id,{findings:reconciliationPreview(s).findings});
 assert.equal(step(r,'deposit').status,'passed');assert.equal(step(r,'deposit').statusLabel,'Gemensamt bank-ID');assert.equal(step(r,'report').facts.find(f=>f.label==='Antal kopplade betalningar').value,'1');assert.equal(r.automaticEligible,true);assert.equal(s.allocations.length,0);
 child.specificationCount=2;const broken=build(s,child.id);assert.notEqual(step(broken,'deposit').status,'passed');
});

test('a valid AIS account cannot hide a missing exact account alias in the report original',{skip:!implemented},()=>{
 const s=fixture({batch:true}),r=build(s,s.transactions[0].id,{reportAccountIssue:'Rapportens mottagarkonto saknar ett uttryckligt kontoalias i bankresursen.'});
 assert.equal(step(r,'original').status,'passed');assert.equal(step(r,'account').status,'blocked');assert.match(step(r,'account').reason,/kontoalias/);assert.equal(r.automaticEligible,false);
});

test('GET rereads a possible owned report without linking it and explains its current account-alias failure',{skip:!implemented},async t=>{
 const f=await serviceFixture(t,{report:true,reportAccountIssue:'Rapportens mottagarkonto saknar ett uttryckligt kontoalias i bankresursen.'}),before=structuredClone(f.state),response=await f.route.GET(new Request('https://mg.test/api/bank/verification?transactionId='+f.state.transactions[0].id)),r=await response.json();
 assert.equal(response.status,200);assert.equal(step(r,'account').status,'blocked');assert.match(step(r,'account').reason,/kontoalias/);assert.deepEqual(f.control.reportChecks,[{documentId:'synthetic-report',targetId:f.state.transactions[0].id}]);assert.equal(r.changed,false);assert.deepEqual(f.state,before);assert.equal(f.state.allocations.length,0);
});

for(const incomplete of [false,true])test(`manually associated report uses its own ${incomplete?'incomplete reference':'invalid OCR'} evidence, never the AIS reference metadata`,{skip:!implemented},()=>{
 let s=fixture({batch:true});const t=s.transactions[0],csv='Betalningsdatum;Avsändare;OCR;Bankgironummer/Avinummer;Belopp;Valuta;Mottagarkonto\n2026-10-26;Synthetic customer AB;0599;987-6543;625,00;SEK;'+t.account.slice(5);
 s=applyCommand(s,{type:'bankgiro.import',documentId:'synthetic-report',hash:'a'.repeat(64),name:'synthetic.csv',rows:parseSpecificationBytes(new TextEncoder().encode(csv),'synthetic.csv')}).state;
 const row=s.transactions.find(t=>t.specification);assert.equal(row.referenceEvidence.candidates[0].validity,'checksum_invalid');if(incomplete)row.referenceEvidence.incomplete=true;
 s=applyCommand(s,{type:'bankgiro.link',transactionId:t.id,specificationId:row.id,note:'Synthetic relation between sources, no invoice approval',confirmOriginals:true,confirmAccount:true}).state;
 const r=build(s,t.id),reference=step(r,'reference');assert.equal(reference.status,'blocked');assert.equal(reference.statusLabel,'Ogiltig OCR');assert.equal(reference.facts.find(f=>f.label==='Referens').value,'0599');assert.equal(reference.facts.find(f=>f.label==='Formell bank-OCR').value,'Saknas');assert.equal(r.automaticEligible,false);assert.equal(s.allocations.length,0);
});

test('a bank-identified full report displays the same deposit identity from parent and child',{skip:!implemented},()=>{
 let s=fixture({batch:true});const parent=s.transactions[0],csv='Betalningsdatum;Avsändare;Betalningsreferens;Bankgironummer/Avinummer;Belopp;Valuta;Mottagarkonto;Bankreferens\n2026-10-26;Synthetic customer AB;0599;987-6543;625,00;SEK;'+parent.account.slice(5)+';'+parent.bankReference;
 s=applyCommand(s,{type:'bankgiro.import',documentId:'synthetic-report',hash:'a'.repeat(64),name:'synthetic.csv',rows:parseSpecificationBytes(new TextEncoder().encode(csv),'synthetic.csv')}).state;
 const child=s.transactions.find(t=>t.parentId),p=build(s,parent.id),c=build(s,child.id);assert.equal(step(p,'report').status,'passed');assert.equal(step(p,'deposit').status,'passed');assert.equal(step(p,'deposit').statusLabel,step(c,'deposit').statusLabel);assert.equal(s.allocations.length,0);
});

test('an outgoing payment cannot suggest registering a customer invoice document with the same number',{skip:!implemented},()=>{
 const s=applyCommand(emptyState(),{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({date:'2026-10-26',amount:-62500,party:'Synthetic supplier AB',payerReference:'0599',bankReference:'SYNTHETIC-OUTGOING',account:'iban:SE4280000890119146168423',kind:'payment',verified:true})]}).state;
 const r=build(s,s.transactions[0].id,{documents:[{document_id:'synthetic-customer-pdf',status:'needs_review',extraction:JSON.stringify({direction:'customer',kind:'invoice',currency:'SEK',invoice_number:'0599',party:'Synthetic customer AB',total_cents:62500,issued_at:'2026-10-01'})}]});
 assert.equal(step(r,'invoice').statusLabel,'Saknas');assert.equal(r.automaticEligible,false);assert.equal(s.invoices.length,0);
});

for(const detailMode of ['missing','corrupt','foreign','envelope','projection','reference','payer','mime'])test(`used ${detailMode} detail original cannot pass as checked bank payer or reference`,{skip:!implemented},async t=>{
 const f=await serviceFixture(t,{detailMode}),before=structuredClone(f.state),response=await f.route.GET(new Request('https://mg.test/api/bank/verification?transactionId='+f.state.transactions[0].id)),r=await response.json();
 assert.equal(response.status,200);assert.equal(step(r,'received').status,'passed');assert.equal(step(r,'original').status,'blocked');assert.equal(step(r,'payer').status,'blocked');assert.equal(step(r,'reference').status,'blocked');assert.equal(r.automaticEligible,false);assert.deepEqual(f.state,before);assert.equal(f.state.allocations.length,0);
});

test('used intact detail JSON is owner-, checksum- and projection-checked without any financial write',{skip:!implemented},async t=>{
 const f=await serviceFixture(t,{detailMode:'valid'}),before=structuredClone(f.state),response=await f.route.GET(new Request('https://mg.test/api/bank/verification?transactionId='+f.state.transactions[0].id)),r=await response.json();
 assert.equal(response.status,200);assert.equal(step(r,'original').status,'passed');assert.equal(step(r,'payer').status,'passed');assert.equal(step(r,'reference').status,'passed');assert.equal(step(r,'payer').source,'Bankens separata detaljoriginal');assert.ok(f.control.reads.includes('synthetic-owner/synthetic-detail-original'));assert.deepEqual(f.state,before);
});

test('unused empty detail metadata is not opened to validate direct first-hand AIS fields',{skip:!implemented},async t=>{
 const f=await serviceFixture(t,{detailMode:'unused'}),response=await f.route.GET(new Request('https://mg.test/api/bank/verification?transactionId='+f.state.transactions[0].id)),r=await response.json();
 assert.equal(response.status,200);assert.equal(step(r,'original').status,'passed');assert.ok(!f.control.reads.includes('synthetic-owner/synthetic-detail-original'));
});

for(const party of [' Altered metadata payer AB ',12345,{label:'Malformed metadata payer'}])test(`a displayed coerced detail payer ${JSON.stringify(party)} still requires its own original`,{skip:!implemented},async t=>{
 const f=await serviceFixture(t,{detailMode:'unused'});f.state.transactions[0].bankDetails.party=party;
 const get=f.control.env.BUCKET.get;f.control.env.BUCKET.get=async path=>{if(path.endsWith('/synthetic-detail-original')){f.control.reads.push(path);return null;}return get(path);};
 const before=structuredClone(f.state),response=await f.route.GET(new Request('https://mg.test/api/bank/verification?transactionId='+f.state.transactions[0].id)),r=await response.json();
 assert.equal(response.status,200);assert.equal(step(r,'original').status,'blocked');assert.equal(step(r,'payer').status,'blocked');assert.equal(step(r,'payer').source,'Bankens separata detaljoriginal');assert.equal(step(r,'payer').facts.find(f=>f.label==='Bankens avsändare').value,String(party).trim());assert.ok(f.control.reads.includes('synthetic-owner/synthetic-detail-original'));assert.deepEqual(f.state,before);assert.equal(f.state.allocations.length,0);
});

for(const [label,damage,expected]of [
 ['valid retained receipt',()=>{},'passed'],
 ['missing checksum',t=>{delete t.bankDataSha256;},'blocked'],
 ['malformed checksum',t=>{t.bankDataSha256='invalid-hash';},'blocked'],
 ['incorrect checksum',t=>{t.bankDataSha256='b'.repeat(64);},'blocked'],
 ['unknown receipt profile',t=>{t.bankDataVersion='unknown-profile-v99';},'blocked'],
 ['altered retained projection',t=>{t.original.party='Altered synthetic projection';},'blocked']
])test(`legacy AIS without evidence label: ${label} remains governed by the real original verifier`,{skip:!implemented},async t=>{
 const f=await serviceFixture(t),transaction=f.state.transactions[0];delete transaction.evidence;damage(transaction);
 const before=structuredClone(f.state),response=await f.route.GET(new Request('https://mg.test/api/bank/verification?transactionId='+transaction.id)),r=await response.json();
 assert.equal(response.status,200);assert.equal(step(r,'received').status,'passed');assert.equal(step(r,'original').status,expected);if(expected==='passed')assert.equal(step(r,'original').statusLabel,'Intakt i denna kontroll');else assert.equal(r.automaticEligible,false);
 assert.deepEqual(f.state,before);assert.equal(f.state.allocations.length,0);assert.equal(f.control.originalChecks.length,1);
});

test('a checked detail payer displays its own COID/SE value, raw identifier and source path',{skip:!implemented},async t=>{
 const f=await serviceFixture(t,{detailMode:'organization'}),before=structuredClone(f.state),response=await f.route.GET(new Request('https://mg.test/api/bank/verification?transactionId='+f.state.transactions[0].id)),r=await response.json(),payer=step(r,'payer'),facts=payer.facts.map(f=>f.label+': '+f.value).join('\n');
 assert.equal(response.status,200);assert.equal(payer.status,'passed');assert.equal(payer.source,'Bankens separata detaljoriginal');assert.match(facts,/Svenskt organisationsnummer/);assert.match(facts,/5567778899/);assert.match(facts,/556777-8899/);assert.match(facts,/COID/);assert.match(facts,/SE/);assert.match(facts,/\$\.debtor\.organisation_id\.identification/);assert.deepEqual(f.state,before);
});

test('a linked report payer and reference expose the report identifiers and paths, not AIS or detail metadata',{skip:!implemented},()=>{
 const {state,target}=paymentFieldSourceFixture(),before=structuredClone(state),r=build(state,target.id),payer=step(r,'payer'),reference=step(r,'reference'),facts=payer.facts.map(f=>f.label+': '+f.value).join('\n');
 assert.equal(payer.source,'Kopplat Bankgirooriginal');assert.equal(reference.source,'Kopplat Bankgirooriginal');assert.match(facts,/3333333333/);assert.match(facts,/333333-3333/);assert.match(facts,/COID/);assert.match(facts,/SE/);assert.match(facts,/\$\.columns\[7\]\.Organisationsnummer/);assert.doesNotMatch(facts,/111111|222222/);assert.equal(reference.facts.find(f=>f.label==='Referens').value,'0599');assert.deepEqual(state,before);assert.equal(state.allocations.length,0);
});

for(const [detailMode,raw]of [['raw-reference',' 0599 '],['raw-message','Faktura 0599']])test(`the ${detailMode} source keeps its complete raw reference while the selected reference stays normalized`,{skip:!implemented},async t=>{
 const f=await serviceFixture(t,{detailMode}),before=structuredClone(f.state),response=await f.route.GET(new Request('https://mg.test/api/bank/verification?transactionId='+f.state.transactions[0].id)),r=await response.json(),reference=step(r,'reference');
 assert.equal(response.status,200);assert.equal(reference.status,'passed');assert.equal(reference.facts.find(f=>f.label==='Referens').value,'0599');assert.equal(reference.facts.find(f=>f.label==='Ursprunglig referens 1').value,raw);assert.deepEqual(f.state,before);assert.equal(f.state.allocations.length,0);
});

for(const booked of [false,true])test(`GET selects and rereads the displayed report reference invoice with ${booked?'an intact conflicting booking':'no booking'}`,{skip:!implemented},async t=>{
 const f=await serviceFixture(t,{sourceInvoices:true,booked}),before=structuredClone(f.state),response=await f.route.GET(new Request('https://mg.test/api/bank/verification?transactionId='+f.state.transactions[0].id)),r=await response.json(),invoice=step(r,'invoice');
 assert.equal(response.status,200);assert.equal(step(r,'reference').facts.find(f=>f.label==='Referens').value,'0599');assert.equal(invoice.facts.find(f=>f.label==='Fakturanummer').value,'0599');assert.ok(f.control.reads.includes('synthetic-owner/synthetic-invoice-0599'));assert.ok(!f.control.reads.includes('synthetic-owner/synthetic-invoice-0800'));assert.equal(r.automaticEligible,false);assert.deepEqual(f.state,before);assert.equal(balance(f.state,f.state.invoices.find(i=>i.number==='0599')),62500);assert.equal(balance(f.state,f.state.invoices.find(i=>i.number==='0800')),booked?0:62500);
 if(booked){assert.equal(invoice.status,'blocked');assert.match(invoice.facts.map(f=>f.label+': '+f.value).join('\n'),/Bokade fakturor: 0800/);assert.equal(step(r,'reconciliation').status,'blocked');assert.equal(f.state.allocations.length,1);}else assert.equal(f.state.allocations.length,0);
});

const candidateRow=(id,fields={})=>({document_id:id,status:'needs_review',extraction:JSON.stringify({direction:'customer',kind:'invoice',currency:'SEK',invoice_number:'0606',reference:'0599',party:'Synthetic customer AB',total_cents:62500,issued_at:'2026-10-01',...fields})});
const invoiceFact=(report,label)=>step(report,'invoice').facts.find(f=>f.label===label)?.value;
test('intact unregistered reference candidate reports original availability independently from registration',()=>{
 const s=fixture({invoice:false}),before=structuredClone(s),r=build(s,s.transactions[0].id,{documents:[candidateRow('synthetic-source')]});
 assert.equal(step(r,'invoice').statusLabel,'Original hittat · ej registrerad');assert.equal(invoiceFact(r,'Fakturanummer'),'0606');assert.equal(invoiceFact(r,'Original tillgängligt'),'Ja');assert.equal(invoiceFact(r,'Fakturaregistrering'),'Ej registrerad');assert.match(invoiceFact(r,'Underlagens referensfält'),/reference: 0599/);assert.equal(r.automaticEligible,false);assert.deepEqual(s,before);
});
test('conflicting candidate reference fields cannot be labelled as a found verified invoice',()=>{
 const s=fixture({invoice:false}),before=structuredClone(s),r=build(s,s.transactions[0].id,{documents:[candidateRow('synthetic-conflict',{ocr:'000026'})]});
 assert.equal(step(r,'invoice').status,'blocked');assert.match(step(r,'invoice').reason,/motstridiga.*referens/i);assert.equal(invoiceFact(r,'Fakturaregistrering'),'Ej registrerad');assert.equal(r.automaticEligible,false);assert.deepEqual(s,before);
});
test('multiple originals matching a reference remain ambiguous without choosing or registering one',()=>{
 const s=fixture({invoice:false}),before=structuredClone(s),r=build(s,s.transactions[0].id,{documents:[candidateRow('synthetic-one'),candidateRow('synthetic-two',{invoice_number:'0607'})]});
 assert.equal(step(r,'invoice').status,'blocked');assert.equal(step(r,'invoice').statusLabel,'Konflikt');assert.notEqual(invoiceFact(r,'Original tillgängligt'),'Ja');assert.equal(r.automaticEligible,false);assert.deepEqual(s,before);
});
test('current job extraction takes precedence in panel candidate reference lookup without merging legacy fields',()=>{
 const s=fixture({invoice:false}),row={...candidateRow('synthetic-source'),job_extraction:JSON.stringify({fields:{direction:'customer',kind:'invoice',currency:'SEK',invoice_number:'0607',reference:'000026',party:'Current customer',total_cents:62500,issued_at:'2026-10-01'}})};
 const r=build(s,s.transactions[0].id,{documents:[row]});assert.equal(step(r,'invoice').status,'missing');
});
test('economic membership explains an AIS observation and separate review report without adding money',()=>{
 let s=fixture({batch:true});const target=s.transactions[0],bytes=makeBankgiroXLSX({currency:'SEK',account:target.account.slice(5),date:target.date,payments:[{party:'Report payer AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}]});
 s=applyCommand(s,{type:'bankgiro.import',documentId:'synthetic-report',hash:'a'.repeat(64),name:'synthetic.xlsx',rows:parseSpecificationBytes(bytes,'synthetic.xlsx')}).state;
 const before=structuredClone(s),review=s.transactions.find(t=>t.specification);
 assert.equal(s.transactions.length,2);assert.equal(build(s,target.id).countedEconomically,true);assert.equal(build(s,review.id).countedEconomically,false);assert.deepEqual(s,before);
});
test('economic membership excludes ignored, duplicate and parent summaries while retaining the child',()=>{
 const s=fixture(),base=s.transactions[0];s.transactions.push({...structuredClone(base),id:'ignored',ignored:true},{...structuredClone(base),id:'duplicate',duplicateOf:base.id},{...structuredClone(base),id:'parent',kind:'batch'},{...structuredClone(base),id:'child',parentId:'parent'});
 const before=structuredClone(s);for(const [id,want]of [[base.id,true],['ignored',false],['duplicate',false],['parent',false],['child',true]])assert.equal(build(s,id).countedEconomically,want,id);assert.deepEqual(s,before);
});

for(const mode of ['one-competing-original','multiple-originals','reference-conflict'])test('safe engine findings cannot bypass '+mode+' beside a reviewed register invoice',async()=>{
 const s=fixture(),before=structuredClone(s),{analyze}=await import(reconciliation),findings=analyze(s);
 assert.equal(findings.filter(f=>f.safe&&f.transaction_id===s.transactions[0].id&&f.invoice_id===s.invoices[0].id).length,1,'positive control uses the actual existing analysis');
 const documents=mode==='one-competing-original'?[candidateRow('unregistered-one',{party:'Another synthetic customer AB'})]:mode==='multiple-originals'?[candidateRow('unregistered-one'),candidateRow('unregistered-two')]:[candidateRow('unregistered-conflict',{ocr:'000026'})];
 const report=build(s,s.transactions[0].id,{documents,findings});
 assert.equal(step(report,'invoice').status,'blocked');assert.equal(step(report,'customer').status,'review');assert.notEqual(step(report,'customer').statusLabel,'Stämmer enligt matchningsregeln');assert.equal(report.automaticEligible,false);assert.equal(step(report,'reconciliation').status,'blocked');
 assert.equal(report.invoiceHint,undefined);assert.equal(step(report,'original').status,'passed');assert.equal(step(report,'reference').facts.find(f=>f.label==='Referens').value,'0599');assert.equal(invoiceFact(report,'Fakturanummer'),'0599');assert.equal(invoiceFact(report,'Registerkund'),'Synthetic customer AB');assert.equal(invoiceFact(report,'Original tillgängligt'),'Ja');assert.equal(balance(s,s.invoices[0]),62500);assert.deepEqual(s,before);
});
for(const mode of ['one-competing-original','multiple-originals','reference-conflict'])test('held '+mode+' preview preserves earlier bookings and their calculated saldo',async()=>{
 let s=fixture();s=applyCommand(s,{type:'match.create',invoiceId:s.invoices[0].id,transactionId:s.transactions[0].id,amount:20000,note:'Synthetic previously booked partial allocation'}).state;
 const before=structuredClone(s),{analyze}=await import(reconciliation),findings=analyze(s),documents=mode==='one-competing-original'?[candidateRow('unregistered-one',{party:'Another synthetic customer AB'})]:mode==='multiple-originals'?[candidateRow('unregistered-one'),candidateRow('unregistered-two')]:[candidateRow('unregistered-conflict',{ocr:'000026'})];
 const report=build(s,s.transactions[0].id,{documents,findings});assert.equal(step(report,'invoice').status,'blocked');assert.equal(step(report,'customer').status,'review');assert.equal(report.automaticEligible,false);assert.equal(report.bookedAllocationCount,1);assert.equal(step(report,'reconciliation').status,'blocked');assert.equal(step(report,'original').status,'passed');assert.equal(balance(s,s.invoices[0]),42500);assert.deepEqual(s,before);
 assert.equal(step(report,'amount').facts.find(f=>f.label==='Bokat återstående saldo').value,'425,00\u00a0kr');assert.equal(step(report,'amount').facts.find(f=>f.label==='Ofördelad bankbetalning').value,'425,00\u00a0kr');assert.equal(invoiceFact(report,'Original tillgängligt'),'Ja');assert.equal(invoiceFact(report,'Fakturanummer'),'0599');assert.equal(invoiceFact(report,'Registerkund'),'Synthetic customer AB');assert.equal(step(report,'reference').facts.find(f=>f.label==='Referens').value,'0599');
});

for(const candidate of [false,true])test('reviewed register original '+(candidate?'also found in Gmail':'alone')+' stays eligible with actual safe engine findings',async()=>{
 const s=fixture(),before=structuredClone(s),{analyze}=await import(reconciliation),findings=analyze(s),documents=candidate?[candidateRow('synthetic-invoice-original',{invoice_number:'0599'})]:[];
 assert.equal(findings.filter(f=>f.safe&&f.transaction_id===s.transactions[0].id&&f.invoice_id===s.invoices[0].id).length,1);
 const report=build(s,s.transactions[0].id,{documents,findings});
 assert.equal(step(report,'invoice').status,'passed');assert.equal(step(report,'customer').status,'passed');assert.equal(report.automaticEligible,true);assert.equal(step(report,'reconciliation').statusLabel,'Förslag · separat beslut krävs');assert.deepEqual(report.invoiceHint,{number:'0599',proposal:false});assert.equal(invoiceFact(report,'Original tillgängligt'),'Ja');assert.equal(report.bookedAllocationCount,0);assert.equal(balance(s,s.invoices[0]),62500);assert.deepEqual(s,before);
});

test('stored GET exposes only an unambiguous AIS/report action target and derives its actual invoice proposal title',async t=>{const f=await serviceFixture(t,{report:true,candidate:true});const response=await f.route.GET(new Request('https://mg.test/api/bank/verification?transactionId='+f.state.transactions[0].id)),r=await response.json();assert.deepEqual(r.accountEvidenceTarget,{transactionId:f.state.transactions[0].id,documentId:'synthetic-report'});assert.deepEqual(r.invoiceHint,{number:'0599',proposal:true});assert.equal(r.revision,17);assert.equal(f.state.allocations.length,0);});
test('stored report omits an action target for a direct AIS without a report and suppresses ambiguous invoice title',()=>{const s=fixture({invoice:false}),r=build(s,s.transactions[0].id,{documents:[candidateRow('one'),candidateRow('two',{invoice_number:'0712'})]});assert.equal(r.accountEvidenceTarget,undefined);assert.equal(r.invoiceHint,undefined);});

test('stored GET exposes the exact owned invoice byte proof after hashing R2 once, without making it payment authority',async t=>{const f=await serviceFixture(t,{candidate:true}),before=structuredClone(f.state),response=await f.route.GET(new Request('https://mg.test/api/bank/verification?transactionId='+f.state.transactions[0].id)),r=await response.json();assert.deepEqual(r.invoiceOriginal,{documentId:'synthetic-invoice-original',integrity:'passed',sha256:f.hash,sizeBytes:f.bytes.length});assert.deepEqual(f.control.reads,['synthetic-owner/synthetic-invoice-original']);assert.equal(r.automaticEligible,false);assert.deepEqual(f.state,before);});
for(const invoiceMode of ['missing','corrupt','foreign'])test('a '+invoiceMode+' invoice original never exposes a successful byte proof',async t=>{const f=await serviceFixture(t,{invoiceMode}),response=await f.route.GET(new Request('https://mg.test/api/bank/verification?transactionId='+f.state.transactions[0].id)),r=await response.json();assert.deepEqual(r.invoiceOriginal,{documentId:'synthetic-invoice-original',integrity:'blocked'});assert.equal(r.invoiceOriginal.sha256,undefined);assert.equal(r.invoiceOriginal.sizeBytes,undefined);});
test('pure explanation projection never invents invoice byte proof',()=>{const s=fixture(),r=build(s,s.transactions[0].id);assert.equal(r.invoiceOriginal,undefined);});


test('blocked deposit review names the exact bank evidence needed without registration or allocation',()=>{
 let state=fixture({invoice:false,batch:true}),target=state.transactions[0];
 const bytes=makeBankgiroXLSX({account:target.account.slice(5),date:target.date,sequence:'00041',payments:[{party:'Synthetic report sender AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}]});
 state=applyCommand(state,{type:'bankgiro.import',documentId:'synthetic-bank-evidence',hash:'d'.repeat(64),name:'evidence.xlsx',rows:parseSpecificationBytes(bytes,'evidence.xlsx')}).state;
 const before=structuredClone(state),report=build(state,target.id,{reportAccountIssue:'Rapportens kontoalias saknas.'});
 const accountStep=step(report,'account'),deposit=step(report,'deposit');
 for(const field of [/bankutfärdat/i,/mottagarkonto/i,/Bankgiro/i,/AIS-konto/i,/giltighetsdatum/i])assert.match(accountStep.next,field);
 for(const field of [/bank-ID/i,/insättningslöpnummer/i,/år/i,/valuta/i,/bokföringsdatum/i,/valutadatum/i])assert.match(deposit.next,field);
 assert.equal(deposit.facts.find(f=>f.label==='Rapportens insättningslöpnummer').value,'00041');
 assert.equal(deposit.facts.find(f=>f.label==='Rapportdatum').value,'2026-10-26');
 assert.equal(report.automaticEligible,false);assert.equal(report.countedEconomically,true);assert.equal(report.changed,false);
 assert.equal(state.invoices.length,0);assert.equal(state.allocations.length,0);assert.deepEqual(state,before);
});
