import {syntheticBankRow} from './helpers/bank-api-fixture.mjs';
import {applyCurrentMigrations} from './helpers/company-compat-fixture.mjs';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {extractPaymentReferences} from '../lib/payment-references.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';import ts from 'typescript';
import {applyCommand,paymentInvoiceAssessment,bankApiOriginalIssue,paymentOriginalIssue} from '../lib/domain.ts';
import {genericCompanyState as emptyState} from './helpers/reference-policy-fixture.mjs';
import {accountReadCooldown} from '../lib/banking/account-read-cooldown.ts';
const codeUrl=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
function compiled(path,imports){imports={'./account-read-cooldown':new URL('../lib/banking/account-read-cooldown.ts',import.meta.url).href,'../payer-evidence.js':new URL('../lib/payer-evidence.js',import.meta.url).href,...Object.fromEntries(['document-triage','economy-summary'].map(n=>['./'+n+'.js',new URL('../lib/'+n+'.js',import.meta.url).href])),...imports};let js=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;for(const [a,b]of Object.entries(imports))for(const q of ['"',"'"])js=js.replaceAll(q+a+q,JSON.stringify(b));return codeUrl(js);}
const domain=new URL('../lib/domain.ts',import.meta.url).href;
const evidenceModule=compiled('../lib/banking/detail-evidence.ts',{'../domain':domain,'../payment-references.js':new URL('../lib/payment-references.js',import.meta.url).href});
const {transactionDetailEvidence,enrichBankDetails}=await import(evidenceModule);
const raw=(extra={})=>({entry_reference:'ARCHIVE-625',transaction_id:'fresh-lookup',transaction_amount:{amount:'625.00',currency:'SEK'},status:'BOOK',booking_date:'2026-10-26',credit_debit_indicator:'CRDT',debtor:{name:'Synthetic Café Payer AB'},reference_number:'0599',reference_number_schema:'SEBG',...extra});
function state(){let s=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic Café Payer AB',number:'0599',ocr:'0599',total:62500,issued:'2026-10-01',due:'2026-10-28',reviewed:true}}).state;return applyCommand(s,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({date:'2026-10-26',amount:62500,account:'iban:SE4280000890119146168423',payerReference:'99990004',bankReference:'ARCHIVE-625',source:'Enable Banking · Swedbank',kind:'batch',description:'Bankgiro inbetalning'})]}).state;}
test('verified detailed payer and OCR are displayed while original batch and allocations stay unchanged',async()=>{const s=state(),t=s.transactions[0],e=transactionDetailEvidence(t,raw(),raw()),out=enrichBankDetails(s,t.id,e,'original-id');assert.equal(out.transactions[0].bankDetails.payerReference,'0599');assert.equal(out.transactions[0].bankDetails.party,'Synthetic Café Payer AB');assert.equal(out.transactions[0].kind,'batch');assert.equal(out.transactions[0].payerReference,'99990004');assert.equal(out.allocations.length,0);assert.equal(paymentInvoiceAssessment(out,out.transactions[0]).status,'possible');const overview=await import(compiled('../lib/payment-overview.ts',{'./domain':domain,'./reconciliation':codeUrl('export const analyze=()=>[];')}));assert.equal(overview.paymentPayerReference(out.transactions[0]),'0599');});
test('list remittance text never becomes OCR without individual structured evidence',()=>{const t=state().transactions[0],r=raw({debtor:null,reference_number:null,reference_number_schema:null,remittance_information:['99990004']});const e=transactionDetailEvidence(t,r,r);assert.equal(e.payerReference,'');assert.equal(e.party,'');assert.equal(e.status,'missing');});
test('detail responses expose nested OCR candidates and their source without modifying financial fields',()=>{const initial=state(),t=initial.transactions[0],r=raw({reference_number:null,details:{OCR:'1234567897'}}),e=transactionDetailEvidence(t,r,r);assert.equal(e.payerReference,'1234567897');assert.ok(e.referenceEvidence.candidates.some(c=>c.source==='$.detail.details.OCR'));const s=enrichBankDetails(initial,t.id,e,'doc');assert.equal(s.transactions[0].kind,'batch');assert.equal(s.allocations.length,0);});
test('wrong bank ID, amount, currency, date, direction or pending status cannot enrich a transaction',()=>{const t=state().transactions[0];for(const patch of [{entry_reference:'other'},{transaction_amount:{amount:'624.99',currency:'SEK'}},{transaction_amount:{amount:'625',currency:'EUR'}},{booking_date:'2026-10-25'},{credit_debit_indicator:'DBIT'},{status:'PDNG'}])assert.throws(()=>transactionDetailEvidence(t,raw(),raw(patch)));});

test('negative detail magnitude cannot cancel an opposite direction to counterfeit a matching payment',()=>{
 const t=state().transactions[0];
 for(const patch of [
  {transaction_amount:{amount:'-625.00',currency:'SEK'},credit_debit_indicator:'DBIT'},
  {transaction_amount:{amount:'625,00',currency:'SEK'}},
  {transaction_amount:{amount:625,currency:'SEK'}},
 ])assert.throws(()=>transactionDetailEvidence(t,raw(),raw(patch)));
});

const shared=codeUrl('export const env=new Proxy({}, {get:(_,k)=>globalThis.bankDetailsTest.env[k]});');
const auth=codeUrl('export async function getChatGPTUser(){return globalThis.bankDetailsTest.user;}');
const server=compiled('../lib/server.ts',{'./company-storage.js':new URL('../lib/company-storage.js',import.meta.url).href,'cloudflare:workers':shared,'@/app/chatgpt-auth':auth,'./domain':domain});
const store=codeUrl(`import {db} from ${JSON.stringify(server)};export async function application(){return globalThis.bankDetailsTest.app;}export async function connection(){const f=globalThis.bankDetailsTest;return {...f.conn,...f.sql.prepare('SELECT retry_after,account_evidence_retry FROM bank_connections').get()};}export async function accounts(){return globalThis.bankDetailsTest.accounts;}export async function providerConfig(){return {};}export async function sessionId(){return 'session';}export async function withBankLock(owner,fn){const f=globalThis.bankDetailsTest,lease={assert:async()=>{if(f.leaseLost)throw Error('BANK_LEASE_LOST');},write:async items=>{await lease.assert();return db().batch(items);},run:async item=>(await lease.write([item]))[0]};return fn(lease);}`);
const provider=codeUrl(`export {ProviderError,providerCooldownDiagnostic} from ${JSON.stringify(new URL('../lib/banking/enable-banking.ts',import.meta.url).href)};export async function getSession(){const f=globalThis.bankDetailsTest;await f.onRead?.('session');if(f.sessionError)throw f.sessionError;return f.live;}export async function getTransactions(...args){const f=globalThis.bankDetailsTest;f.calls.push(['list',...args]);await f.onRead?.('list');if(f.listError)throw f.listError;return f.page;}export async function getTransactionDetails(...args){const f=globalThis.bankDetailsTest;f.calls.push(['details',...args]);await f.onRead?.('details');if(f.detailError)throw f.detailError;return f.detail;}`);
const normalizer=compiled('../lib/banking/transactions.ts',{'../domain':domain,'../payment-references.js':new URL('../lib/payment-references.js',import.meta.url).href});
const {normalizeTransactions}=await import(normalizer);
const readGuard=compiled('../lib/banking/account-read-guard.ts',{'../server':server,'./store':store,'./enable-banking':provider});
const {fetchBankDetails}=await import(compiled('../lib/banking/details-service.ts',{'cloudflare:workers':shared,'../server':server,'../domain':domain,'./store':store,'./enable-banking':provider,'./transactions':normalizer,'./detail-evidence':evidenceModule,'./account-read-guard':readGuard}));
function fixture(t){const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());applyCurrentMigrations(sql);sql.prepare("INSERT INTO bank_connections(id,owner,app_generation,environment,bank_name,country,encrypted_session,encrypted_accounts,valid_until,date_from,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run('conn','owner','one','PRODUCTION','Swedbank','SE','session','[]',new Date(Date.now()+86400_000).toISOString(),'2026-10-01','connected','at','at');const objects=new Map(),DB={prepare(sqlText){return {args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(sqlText).get(...this.args)||null;},async all(){return {results:sql.prepare(sqlText).all(...this.args)};},async run(){return {meta:{changes:sql.prepare(sqlText).run(...this.args).changes}};}};},async batch(stmts){sql.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};const s=state(),f={sql,user:{userId:'owner'},app:{generation:'one'},conn:{id:'conn',owner:'owner',encrypted_session:'session',status:'connected',app_generation:'one',environment:'PRODUCTION',bank_name:'Swedbank',country:'SE',selected_accounts:'["account-uid"]',valid_until:new Date(Date.now()+86400_000).toISOString()},accounts:[{uid:'account-uid',currency:'SEK',account_id:{iban:'SE4280000890119146168423'}}],live:{status:'AUTHORIZED',access:{valid_until:new Date(Date.now()+86400000).toISOString()},accounts:['account-uid'],psu_type:'business',aspsp:{name:'Swedbank',country:'SE'}},calls:[],page:{transactions:[raw()]},detail:raw(),env:{DB,BUCKET:{async put(k,b){objects.set(k,b);}}},objects,id:s.transactions[0].id};sql.prepare('INSERT INTO workspaces VALUES(?,?,?,?)').run('owner',1,JSON.stringify(s),'at');globalThis.bankDetailsTest=f;return f;}
const request=(id,body={})=>new Request('https://mg.test/api/bank/details',{method:'POST',headers:{Origin:'https://mg.test','Content-Type':'application/json'},body:JSON.stringify({transactionId:id,...body})});
test('real detail service refreshes lookup ID, retains original and caches without creating payments',async t=>{const f=fixture(t),r=await fetchBankDetails(request(f.id)),o=await r.json();assert.equal(o.details.payerReference,'0599');assert.equal(f.calls[1][3],'fresh-lookup');assert.equal(o.state.allocations.length,0);assert.equal(o.state.transactions.length,1);assert.equal(o.state.transactions[0].kind,'batch');assert.equal(f.objects.size,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,1);assert.equal(f.sql.prepare('SELECT action FROM audit_events').get().action,'bank.details');await fetchBankDetails(request(f.id));assert.equal(f.calls.length,2);});
test('missing detail ID records a factual missing result rather than making up OCR',async t=>{const f=fixture(t);f.page={transactions:[raw({transaction_id:null,reference_number:null,reference_number_schema:null,debtor:null})]};const out=await (await fetchBankDetails(request(f.id))).json();assert.equal(out.details.payerReference,'');assert.equal(f.calls.length,1);assert.match(out.details.reason,/inga ytterligare/);assert.equal(out.state.allocations.length,0);});
test('detail lookup is denied for another owner, expired session, wrong origin or supplied account IDs',async t=>{const f=fixture(t);f.user={userId:'other'};await assert.rejects(()=>fetchBankDetails(request(f.id)));f.user=null;await assert.rejects(()=>fetchBankDetails(request(f.id)),/AUTH_REQUIRED/);f.user={userId:'owner'};const req=request(f.id);req.headers.set('Origin','https://evil.test');await assert.rejects(()=>fetchBankDetails(req),/ORIGIN_DENIED/);await assert.rejects(()=>fetchBankDetails(request(f.id,{accountId:'arbitrary'})));assert.equal(f.calls.length,0);});
test('wrong selected account and changed financial detail are rejected without updating workspace',async t=>{const f=fixture(t);f.accounts[0].account_id.iban='SE4280000890119146168424';await assert.rejects(()=>fetchBankDetails(request(f.id)),/konto/);f.accounts[0].account_id.iban='SE4280000890119146168423';f.detail=raw({transaction_amount:{amount:'600.00',currency:'SEK'}});await assert.rejects(()=>fetchBankDetails(request(f.id)));assert.equal(f.objects.size,0);assert.equal(f.sql.prepare('SELECT revision FROM workspaces').get().revision,1);});
const candidatesPresentation=compiled('../lib/payment-presentation.ts',{'./domain':domain,'./reconciliation-engine.js':new URL('../lib/reconciliation-engine.js',import.meta.url).href,'./payment-references.js':new URL('../lib/payment-references.js',import.meta.url).href});
const candidatesModule=compiled('../lib/banking/invoice-candidates.ts',{'../domain':domain,'../reconciliation-engine.js':new URL('../lib/reconciliation-engine.js',import.meta.url).href,'../payment-presentation':candidatesPresentation});
const candidatesApi=await import(compiled('../app/api/bank/invoice-candidates/route.ts',{'@/lib/server':server,'@/lib/banking/invoice-candidates':candidatesModule}));
test('candidate API reads wrapped Gmail fields only for the authenticated owner without saving',async t=>{const f=fixture(t);const document=(number,party)=>JSON.stringify({fields:Object.fromEntries(Object.entries({invoice_number:number,party,total_cents:62500,issued_at:'2026-10-10',direction:'customer',kind:'invoice',currency:'SEK'}).map(([k,value])=>[k,{value}]))});f.sql.prepare('INSERT INTO gmail_sources(owner,source_id,metadata,document_id,status,extraction,created_at) VALUES(?,?,?, ?,?,?,?)').run('owner','source-0599','{}','doc-0599','needs_review',document('0599','Synthetic Customer AB'),'at');f.sql.prepare('INSERT INTO gmail_sources(owner,source_id,metadata,document_id,status,extraction,created_at) VALUES(?,?,?, ?,?,?,?)').run('other','source-other','{}','private-other','needs_review',document('PRIVATE','Other customer'),'at');const r=await candidatesApi.GET(),out=await r.json();assert.equal(r.status,200);assert.equal(out.candidates[f.id].length,2);assert.equal(out.candidates[f.id].find(c=>c.documentId==='doc-0599').number,'0599');assert.doesNotMatch(JSON.stringify(out),/PRIVATE|Other customer/);assert.equal(f.sql.prepare('SELECT revision FROM workspaces').get().revision,1);assert.equal(f.objects.size,0);assert.equal(f.calls.length,0);});
test('candidate API denies an expired session',async t=>{const f=fixture(t);f.user=null;assert.equal((await candidatesApi.GET()).status,401);});


test('detail fetching persists bank Retry-After and denies early follow-up without more bank calls',async t=>{
 const f=fixture(t),{ProviderError}=await import('../lib/banking/enable-banking.ts');f.detailError=Object.assign(new ProviderError('BANK_RATE_LIMIT','Vänta',429,true),{retryAfter:172800});
 await assert.rejects(fetchBankDetails(request(f.id)),e=>e.code==='BANK_RATE_LIMIT');
 assert.ok(Date.parse(f.sql.prepare('SELECT retry_after,account_evidence_retry FROM bank_connections').get().retry_after)>Date.now()+172799000);
 const calls=f.calls.length;await assert.rejects(fetchBankDetails(request(f.id)),e=>e.code==='BANK_RATE_LIMIT');assert.equal(f.calls.length,calls);assert.equal(f.objects.size,0);assert.equal(f.sql.prepare('SELECT revision FROM workspaces').get().revision,1);
});

test('detail fetching rejects an authorized-looking but expired live bank consent',async t=>{
 const f=fixture(t);f.live.access.valid_until='2000-01-01';await assert.rejects(fetchBankDetails(request(f.id)),/medgivande/);assert.equal(f.calls.length,0);assert.equal(f.objects.size,0);
});

// A missing adoption call must fail this integration test: only the fresh list
// response is eligible, never the separately fetched detail or archived JSON.
async function legacyFixture(t,{retained=true,unsupported=false}={}){
 const f=fixture(t),received=raw({debtor:{name:''},reference_number:'99990004',bank_transaction_code:{description:'Bankgiro inbetalning'},...(unsupported?{transaction_id:null}:{})});
 const {rows}=await normalizeTransactions([received],{accountKey:'iban:SE4280000890119146168423',accountLabel:'Synthetic account',bankName:'Swedbank',dateFrom:'2026-10-26',dateTo:'2026-10-26'});
 const s=applyCommand(emptyState(),{type:'transactions.import',trustedBankImport:true,rows}).state;
 const transaction=s.transactions[0];delete transaction.bankDataVersion;delete transaction.bankDataSha256;if(!retained)delete transaction.bankData;
 s.allocations.push({id:'old-allocation',invoiceId:'old-invoice',transactionId:transaction.id,amount:100,effect:'payment',active:true,note:'Synthetic preserved allocation',createdAt:'2026-10-26'});
 f.id=transaction.id;f.page={transactions:[received]};f.detail=received;saveFixture(f,s);return {f,s,transaction};
}
function saveFixture(f,s){f.sql.prepare('UPDATE workspaces SET payload=?').run(JSON.stringify(s));}
function financialSnapshot(s){return {...s,transactions:s.transactions.map(({bankDetails,bankDataSha256,bankDataVersion,bankData,referenceEvidence,...rest})=>rest)};}
for(const retained of [true,false])test(`fresh authenticated list adopts a missing legacy receipt (retained raw: ${retained})`,async t=>{
 const {f,s}=await legacyFixture(t,{retained}),before=financialSnapshot(s),out=await(await fetchBankDetails(request(f.id))).json(),row=out.state.transactions[0];
 assert.equal(row.bankDataVersion,'bank-api-original-v1');assert.match(row.bankDataSha256,/^[a-f0-9]{64}$/);assert.equal(bankApiOriginalIssue(row),'');assert.deepEqual(row.bankData,f.page.transactions[0]);assert.deepEqual(financialSnapshot(out.state),before);
 assert.equal(JSON.parse(f.sql.prepare('SELECT detail FROM audit_events').get().detail).receiptAdopted,true);
});
test('unsupported detail endpoint still allows the authenticated list receipt',async t=>{
 const {f}=await legacyFixture(t,{unsupported:true}),out=await(await fetchBankDetails(request(f.id))).json();assert.equal(out.state.transactions[0].bankDataVersion,'bank-api-original-v1');assert.equal(bankApiOriginalIssue(out.state.transactions[0]),'');assert.equal(f.calls.length,1);
});
for(const [name,mutate]of [
 ['changed retained raw',({transaction})=>transaction.bankData.transaction_id='older-lookup'],
 ['missing external identity',({transaction})=>transaction.externalId=''],
 ['changed original amount',({transaction})=>transaction.original.amount=62499],
 ['empty retained raw',({transaction})=>transaction.bankData={}],
 ['changed external identity',({transaction})=>transaction.externalId='enable-banking:other'],
 ['changed original account',({transaction})=>transaction.original.account='other-account'],
 ['evidence conflict',({transaction})=>transaction.bankEvidenceConflicts=[{at:'2026-10-26',fields:['party'],incoming:{}}]],
 ['workspace evidence hold',({s})=>s.bankEvidenceHold={at:'2026-10-26',auditEventId:'hold',fingerprint:'hold'}],
 ['changed original party',({transaction})=>transaction.original.party='Different AB'],
 ['null retained raw',({transaction})=>transaction.bankData=null],
 ...['bankDataVersion','bankDataSha256'].flatMap(key=>[null,'','invalid'].map(value=>[`${key}: ${String(value)}`,({transaction})=>transaction[key]=value]))
])test(`fresh detail lookup does not repair ${name}`,async t=>{
 const x=await legacyFixture(t);mutate(x);saveFixture(x.f,x.s);const before=structuredClone(x.transaction),out=await(await fetchBankDetails(request(x.f.id))).json(),{bankDetails,...actual}=out.state.transactions[0];assert.deepEqual(actual,before);assert.equal(JSON.parse(x.f.sql.prepare('SELECT detail FROM audit_events').get().detail).receiptAdopted,false);
});
test('recent cached legacy details trigger a fresh authenticated list rather than sealing the cache',async t=>{
 const {f,s,transaction}=await legacyFixture(t);transaction.bankDetails={checkedAt:new Date().toISOString(),status:'missing',party:'',payerReference:'',referenceSchema:'',reason:'cached',documentId:'prior-document',bankReferenceText:''};saveFixture(f,s);
 const out=await(await fetchBankDetails(request(f.id))).json();assert.equal(out.cached,undefined);assert.equal(out.state.transactions[0].bankDataVersion,'bank-api-original-v1');assert.equal(f.calls.length,2);assert.equal(f.objects.size,1);
});
test('recent legacy detail cache retries a genuine fresh list after a prior nonmatching raw response',async t=>{
 const {f}=await legacyFixture(t);const original=structuredClone(f.page.transactions[0]);f.page.transactions[0].transaction_id='changed-response';f.detail=f.page.transactions[0];
 const first=await(await fetchBankDetails(request(f.id))).json();assert.equal(first.state.transactions[0].bankDataVersion,undefined);assert.equal(f.calls.length,2);
 f.page={transactions:[original]};f.detail=original;const second=await(await fetchBankDetails(request(f.id))).json();assert.equal(second.cached,undefined);assert.equal(second.state.transactions[0].bankDataVersion,'bank-api-original-v1');assert.equal(f.calls.length,4);assert.equal(bankApiOriginalIssue(second.state.transactions[0]),'');
});
for(const value of [null,'','invalid'])test(`recent details with a present invalid receipt stay cached and unrepaired (${String(value)})`,async t=>{
 const {f,s,transaction}=await legacyFixture(t);transaction.bankDataSha256=value;transaction.bankDetails={checkedAt:new Date().toISOString(),status:'missing',party:'',payerReference:'',referenceSchema:'',reason:'cached',documentId:'prior-document',bankReferenceText:''};saveFixture(f,s);
 const out=await(await fetchBankDetails(request(f.id))).json();assert.equal(out.cached,true);assert.equal(out.state.transactions[0].bankDataSha256,value);assert.equal(out.state.transactions[0].bankDataVersion,undefined);assert.equal(f.calls.length,0);assert.equal(f.objects.size,0);
});
test('legacy detail cache bypass still enforces the saved bank retry deadline',async t=>{
 const {f,s,transaction}=await legacyFixture(t);transaction.bankDetails={checkedAt:new Date().toISOString(),status:'missing',party:'',payerReference:'',referenceSchema:'',reason:'cached',documentId:'prior-document',bankReferenceText:''};saveFixture(f,s);f.sql.prepare('UPDATE bank_connections SET retry_after=?').run(new Date(Date.now()+3600000).toISOString());
 await assert.rejects(fetchBankDetails(request(f.id)),e=>e.code==='BANK_RATE_LIMIT');assert.equal(f.calls.length,0);assert.equal(f.objects.size,0);assert.equal(f.sql.prepare('SELECT revision FROM workspaces').get().revision,1);
});
test('fresh receipt retains manual verification and comes from the list rather than enriched details',async t=>{
 const {f,s,transaction}=await legacyFixture(t);transaction.party='Synthetic verified payer AB';transaction.payerReference='1234567897';transaction.verification={party:transaction.party,payerReference:transaction.payerReference,note:'Synthetic original review',at:'2026-10-26T00:00:00.000Z'};transaction.verified=true;
 f.detail={...f.detail,note:'Separate detail metadata',debtor:{name:'Synthetic verified payer AB'},reference_number:'1234567897'};saveFixture(f,s);
 const out=await(await fetchBankDetails(request(f.id))).json(),row=out.state.transactions[0];assert.equal(bankApiOriginalIssue(row),'');assert.equal(row.bankData.note,undefined);assert.deepEqual(row.bankData,f.page.transactions[0]);assert.deepEqual(financialSnapshot(out.state),financialSnapshot(s));
});
test('an existing valid receipt and retained original remain byte-for-byte unchanged',async t=>{
 const {f,s,transaction}=await legacyFixture(t);const {rows}=await normalizeTransactions(f.page.transactions,{accountKey:transaction.account,accountLabel:'Synthetic account',bankName:'Swedbank',dateFrom:transaction.date,dateTo:transaction.date});transaction.bankDataVersion=rows[0].bankDataVersion;transaction.bankDataSha256=rows[0].bankDataSha256;saveFixture(f,s);
 const before=structuredClone(transaction),out=await(await fetchBankDetails(request(f.id))).json(),{bankDetails,...row}=out.state.transactions[0];assert.deepEqual(row,before);assert.equal(bankApiOriginalIssue(row),'');assert.equal(JSON.parse(f.sql.prepare('SELECT detail FROM audit_events').get().detail).receiptAdopted,false);
});
for(const patch of [{psu_type:'personal'},{accounts:['different-account']},{status:'EXPIRED'},{aspsp:{name:'Other bank',country:'SE'}}])test(`fresh receipt requires exact live business consent: ${JSON.stringify(patch)}`,async t=>{
 const {f}=await legacyFixture(t);Object.assign(f.live,patch);await assert.rejects(fetchBankDetails(request(f.id)),/medgivande/);assert.equal(f.sql.prepare('SELECT revision FROM workspaces').get().revision,1);assert.equal(f.objects.size,0);assert.equal(f.calls.length,0);
});

for(const retained of [true,false])test(`fresh matching legacy row gains a fresh original projection only when absent (retained raw: ${retained})`,async t=>{
 const {f,s,transaction}=await legacyFixture(t,{retained});delete transaction.original;delete transaction.evidence;saveFixture(f,s);
 const before=structuredClone(s),out=await(await fetchBankDetails(request(f.id))).json(),row=out.state.transactions[0];
 assert.equal(row.bankDataVersion,'bank-api-original-v1');assert.equal(bankApiOriginalIssue(row),'');assert.deepEqual(row.original,{party:'',payerReference:'99990004',description:transaction.description,amount:62500,date:'2026-10-26',account:'iban:SE4280000890119146168423',bankReference:'ARCHIVE-625'});
 const {bankDetails,bankDataSha256,bankDataVersion,bankData,original,referenceEvidence,...preserved}=row;
 const {bankData:oldRaw,referenceEvidence:oldReferences,...expected}=before.transactions[0];assert.deepEqual(preserved,expected);assert.deepEqual(out.state.allocations,before.allocations);
});
for(const [name,mutate]of [
 ['changed party',t=>t.party='Different legacy payer AB'],
 ['changed reference',t=>t.payerReference='1234567897'],
 ['changed description',t=>t.description='Different legacy description'],
 ['manual verification',t=>t.verification={party:t.party,payerReference:t.payerReference,note:'Synthetic review',at:'2026-10-26T00:00:00.000Z'}],
 ['null original',t=>t.original=null],
 ['empty original',t=>t.original={}],
 ['invalid original',t=>t.original='invalid']
])test(`fresh lookup cannot create a missing historical tuple from ${name}`,async t=>{
 const {f,s,transaction}=await legacyFixture(t);delete transaction.original;delete transaction.evidence;mutate(transaction);saveFixture(f,s);const before=structuredClone(transaction),out=await(await fetchBankDetails(request(f.id))).json(),{bankDetails,...row}=out.state.transactions[0];assert.deepEqual(row,before);assert.equal(JSON.parse(f.sql.prepare('SELECT detail FROM audit_events').get().detail).receiptAdopted,false);
});

const reorderedKeys=value=>Array.isArray(value)?value.map(reorderedKeys):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reorderedKeys(item)])):value;
test('a fresh structurally identical provider response refreshes serialization while retaining the previous raw in R2',async t=>{
 const {f,s,transaction}=await legacyFixture(t);const previous=transaction.bankData;transaction.bankData=reorderedKeys(previous);saveFixture(f,s);const oldSerialization=JSON.stringify(transaction.bankData),freshSerialization=JSON.stringify(f.page.transactions[0]);assert.notEqual(oldSerialization,freshSerialization);
 const before=financialSnapshot(s),out=await(await fetchBankDetails(request(f.id))).json(),row=out.state.transactions[0];assert.equal(row.bankDataVersion,'bank-api-original-v1');assert.equal(row.bankDataSha256,createHash('sha256').update(freshSerialization).digest('hex'));assert.equal(JSON.stringify(row.bankData),freshSerialization);assert.equal(bankApiOriginalIssue(row),'');assert.deepEqual(financialSnapshot(out.state),before);
 const retained=JSON.parse(new TextDecoder().decode([...f.objects.values()][0]));assert.equal(JSON.stringify(retained.previousBankData),oldSerialization);assert.equal(JSON.stringify(retained.listed),freshSerialization);const audit=JSON.parse(f.sql.prepare('SELECT detail FROM audit_events').get().detail);assert.equal(audit.receiptAdopted,true);assert.equal(audit.originalSerializationRefreshed,true);
});
for(const [name,alter]of [
 ['changed nested value',raw=>raw.transaction_amount.amount='624.99'],
 ['reordered array',raw=>raw.additional_metadata=['Second message','First message']],
 ['changed JSON type',raw=>raw.transaction_amount.amount=625]
])test(`structural receipt adoption rejects ${name} and retains the previous representation`,async t=>{
 const {f,s,transaction}=await legacyFixture(t);f.page.transactions[0].additional_metadata=['First message','Second message'];f.detail=f.page.transactions[0];transaction.bankData=reorderedKeys(f.page.transactions[0]);alter(transaction.bankData);saveFixture(f,s);const before=structuredClone(transaction),out=await(await fetchBankDetails(request(f.id))).json(),{bankDetails,...row}=out.state.transactions[0];assert.deepEqual(row,before);const retained=JSON.parse(new TextDecoder().decode([...f.objects.values()][0]));assert.equal(JSON.stringify(retained.previousBankData),JSON.stringify(before.bankData));assert.equal(JSON.parse(f.sql.prepare('SELECT detail FROM audit_events').get().detail).receiptAdopted,false);
});
test('a valid existing receipt never refreshes its raw serialization on a differently ordered fresh response',async t=>{
 const {f,s,transaction}=await legacyFixture(t);const {rows}=await normalizeTransactions(f.page.transactions,{accountKey:transaction.account,accountLabel:'Synthetic account',bankName:'Swedbank',dateFrom:transaction.date,dateTo:transaction.date});transaction.bankDataVersion=rows[0].bankDataVersion;transaction.bankDataSha256=rows[0].bankDataSha256;const oldSerialization=JSON.stringify(transaction.bankData);f.page.transactions[0]=reorderedKeys(f.page.transactions[0]);f.detail=f.page.transactions[0];saveFixture(f,s);const out=await(await fetchBankDetails(request(f.id))).json();assert.equal(JSON.stringify(out.state.transactions[0].bankData),oldSerialization);assert.equal(out.state.transactions[0].bankDataSha256,transaction.bankDataSha256);assert.equal(JSON.parse(f.sql.prepare('SELECT detail FROM audit_events').get().detail).receiptAdopted,false);
});

test('missing legacy projection and reordered retained JSON can adopt the same freshly received original together',async t=>{
 const {f,s,transaction}=await legacyFixture(t);delete transaction.original;delete transaction.evidence;transaction.bankData=reorderedKeys(transaction.bankData);saveFixture(f,s);const previous=JSON.stringify(transaction.bankData),out=await(await fetchBankDetails(request(f.id))).json(),row=out.state.transactions[0];assert.equal(bankApiOriginalIssue(row),'');assert.equal(JSON.stringify(row.bankData),JSON.stringify(f.page.transactions[0]));assert.equal(row.original.amount,62500);assert.equal(row.original.payerReference,'99990004');assert.equal(JSON.stringify(JSON.parse(new TextDecoder().decode([...f.objects.values()][0])).previousBankData),previous);assert.deepEqual(out.state.allocations,s.allocations);
});

test('successful fresh receipt adoption clears its exact stale derived missing-receipt issue',async t=>{
 const {f,s,transaction}=await legacyFixture(t);transaction.bankOriginalIssue='Bankoriginalet saknar ett verifierbart ankomstkvitto. Hämta bankuppgifterna igen eller granska originalunderlaget.';assert.equal(bankApiOriginalIssue(transaction),transaction.bankOriginalIssue);saveFixture(f,s);
 const out=await(await fetchBankDetails(request(f.id))).json(),row=out.state.transactions[0];assert.equal(bankApiOriginalIssue(row),'');assert.equal(row.bankOriginalIssue,undefined);assert.equal(paymentOriginalIssue(out.state,row),'');
});
test('fresh receipt adoption preserves an unrelated original availability issue',async t=>{
 const {f,s,transaction}=await legacyFixture(t);transaction.bankOriginalIssue='Synthetic retained document unavailable';saveFixture(f,s);const out=await(await fetchBankDetails(request(f.id))).json(),row=out.state.transactions[0];assert.equal(bankApiOriginalIssue(row),'');assert.equal(row.bankOriginalIssue,'Synthetic retained document unavailable');assert.equal(paymentOriginalIssue(out.state,row),'Synthetic retained document unavailable');
});
test('a failed fresh receipt adoption preserves its stale issue and all evidence holds',async t=>{
 const {f,s,transaction}=await legacyFixture(t);transaction.bankOriginalIssue='Bankoriginalet saknar ett verifierbart ankomstkvitto. Hämta bankuppgifterna igen eller granska originalunderlaget.';transaction.bankEvidenceConflicts=[{at:'2026-10-26',fields:['party'],incoming:{}}];saveFixture(f,s);const before=structuredClone(transaction),out=await(await fetchBankDetails(request(f.id))).json(),{bankDetails,...row}=out.state.transactions[0];assert.deepEqual(row,before);
});

async function nullSchemaLegacyFixture(t){
 const x=await legacyFixture(t),r=x.f.page.transactions[0];r.reference_number_schema=null;x.f.detail=r;x.transaction.bankData=structuredClone(r);
 const withoutSchema=structuredClone(r);delete withoutSchema.reference_number_schema;const evidence=extractPaymentReferences(withoutSchema),oldCandidate=({rawValue,schema,...candidate})=>candidate;x.transaction.referenceEvidence={...evidence,version:'payment-references-2026-10-28.1',candidates:evidence.candidates.map(oldCandidate),selected:oldCandidate(evidence.selected)};saveFixture(x.f,x.s);return x;
}
test('fresh AIS null-schema receipt preserves all bank facts and archives the previous parser evidence',async t=>{
 const {f,s,transaction}=await nullSchemaLegacyFixture(t),before=financialSnapshot(s),previous=JSON.stringify(transaction.referenceEvidence),out=await(await fetchBankDetails(request(f.id))).json(),row=out.state.transactions[0];
 assert.equal(row.bankDataVersion,'bank-api-original-v1');assert.equal(bankApiOriginalIssue(row),'');assert.equal(row.payerReference,'99990004');assert.equal(row.referenceEvidence.version,'payment-references-ais-null-schema-v1');assert.equal(row.referenceEvidence.selected.kind,'structured');assert.equal(row.referenceEvidence.selected.validity,'unchecked');assert.deepEqual(financialSnapshot(out.state),before);const doc=JSON.parse(new TextDecoder().decode([...f.objects.values()][0]));assert.equal(JSON.stringify(doc.previousReferenceEvidence),previous);assert.equal(doc.listed.reference_number_schema,null);
});
for(const key of ['verification','bankFileProof'])test(`fresh AIS profile cannot replace retained reference evidence with existing ${key}`,async t=>{
 const {f,s,transaction}=await nullSchemaLegacyFixture(t);transaction[key]=key==='verification'?{party:transaction.party,payerReference:transaction.payerReference,note:'Synthetic manual proof',at:'2026-10-26T00:00:00.000Z'}:{version:'bank-file-original-v1',documentId:'synthetic-document',sha256:'a'.repeat(64)};saveFixture(f,s);const before=structuredClone(transaction),out=await(await fetchBankDetails(request(f.id))).json(),{bankDetails,...row}=out.state.transactions[0];assert.deepEqual(row,before);
});
test('an already valid legacy null-schema receipt retains its original parser interpretation',async t=>{
 const {f,s,transaction}=await nullSchemaLegacyFixture(t),raw=transaction.bankData;transaction.payerReference='';transaction.original.payerReference='';transaction.referenceEvidence=extractPaymentReferences(raw);transaction.bankDataVersion='bank-api-original-v1';transaction.bankDataSha256=createHash('sha256').update(JSON.stringify(raw)).digest('hex');assert.equal(bankApiOriginalIssue(transaction),'');saveFixture(f,s);const before=structuredClone(transaction),out=await(await fetchBankDetails(request(f.id))).json(),{bankDetails,...row}=out.state.transactions[0];assert.deepEqual(row,before);assert.equal(bankApiOriginalIssue(row),'');
});

test('fresh detail lookup repairs only evidence on a complete synthetic legacy shape with null AIS schema',async t=>{
 const {f,s,transaction}=await nullSchemaLegacyFixture(t);delete transaction.original;delete transaction.evidence;transaction.bankData=reorderedKeys(transaction.bankData);transaction.bankOriginalIssue='Bankoriginalet saknar ett verifierbart ankomstkvitto. Hämta bankuppgifterna igen eller granska originalunderlaget.';saveFixture(f,s);const oldMetadata=JSON.stringify(transaction.referenceEvidence),oldRaw=JSON.stringify(transaction.bankData),out=await(await fetchBankDetails(request(f.id))).json(),row=out.state.transactions[0];assert.equal(bankApiOriginalIssue(row),'');assert.equal(paymentOriginalIssue(out.state,row),'');assert.equal(row.payerReference,'99990004');assert.equal(row.original.payerReference,'99990004');assert.equal(row.referenceEvidence.version,'payment-references-ais-null-schema-v1');assert.equal(row.referenceEvidence.selected.kind,'structured');assert.equal(row.referenceEvidence.selected.validity,'unchecked');assert.equal(row.referenceEvidence.incomplete,false);assert.deepEqual(out.state.allocations,s.allocations);const document=JSON.parse(new TextDecoder().decode([...f.objects.values()][0]));assert.equal(JSON.stringify(document.previousReferenceEvidence),oldMetadata);assert.equal(JSON.stringify(document.previousBankData),oldRaw);assert.equal(document.listed.reference_number_schema,null);
});
test('AIS normalizer profile is explicit and cannot alter default import interpretation',async()=>{
 const raw={status:'BOOK',transaction_amount:{amount:'625.00',currency:'SEK'},credit_debit_indicator:'CRDT',booking_date:'2026-10-26',debtor:{name:'Synthetic payer AB'},reference_number:'000018',reference_number_schema:null,entry_reference:'SYNTHETIC-NULL-SCHEMA'},options={accountKey:'synthetic-account',accountLabel:'Synthetic account',bankName:'Synthetic bank',dateFrom:'2026-10-26',dateTo:'2026-10-26'},old=await normalizeTransactions([raw],options),fresh=await normalizeTransactions([raw],{...options,referenceProfile:'ais-null-schema-v1'});assert.equal(old.rows[0].payerReference,'');assert.equal(old.rows[0].referenceEvidence.version,'payment-references-2026-11-01.1');assert.equal(fresh.rows[0].payerReference,'000018');assert.equal(fresh.rows[0].referenceEvidence.version,'payment-references-ais-null-schema-v1');assert.deepEqual(fresh.rows[0].bankData,raw);assert.equal(fresh.rows[0].bankDataSha256,old.rows[0].bankDataSha256);
});

test('an unknown stored reference parser version cannot validate a retained receipt',async t=>{
 const {s,transaction}=await nullSchemaLegacyFixture(t);transaction.payerReference='';transaction.original.payerReference='';transaction.referenceEvidence={...extractPaymentReferences(transaction.bankData),version:'unknown-future-parser'};transaction.bankDataVersion='bank-api-original-v1';transaction.bankDataSha256=createHash('sha256').update(JSON.stringify(transaction.bankData)).digest('hex');assert.notEqual(bankApiOriginalIssue(s.transactions[0]),'');
});

for(const status of [429,503])test('transaction-detail HTTP '+status+' retains account-read cooldown provenance',async t=>{
 const f=fixture(t),adapter=await import('../lib/banking/enable-banking.ts');
 const privateKeyPem=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
 t.mock.method(globalThis,'fetch',async()=>new Response('',{status,headers:status===503?{'Retry-After':'120'}:{}}));
 try{await adapter.providerRequest({applicationId:'11111111-1111-4111-8111-111111111111',privateKeyPem},'/application');}catch(error){f.detailError=error;}
 const original=f.sql.prepare('SELECT * FROM workspaces').get();
 await assert.rejects(fetchBankDetails(request(f.id)));
 const saved=f.sql.prepare('SELECT * FROM bank_connections').get();assert.ok(saved.account_evidence_retry,'actual provider retry provenance must survive a later request');
 assert.equal(JSON.parse(saved.account_evidence_retry).status,status===429?'unknown':'known');
 assert.ok(Date.parse(saved.retry_after)>Date.now());assert.deepEqual(f.sql.prepare('SELECT * FROM workspaces').get(),original);assert.equal(f.objects.size,0);
});

test('malformed local consent validity blocks transaction detail reads before the provider',async t=>{
 const f=fixture(t);f.conn.valid_until='not-a-date';await assert.rejects(fetchBankDetails(request(f.id)));assert.equal(f.calls.length,0);assert.equal(f.objects.size,0);
});

for(const stage of ['session','list','details'])for(const failure of ['result save','lease loss'])test(`transaction ${stage} retains a pending read guard after ${failure}`,async t=>{
 const f=fixture(t),adapter=await import('../lib/banking/enable-banking.ts');
 const privateKeyPem=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
 t.mock.method(globalThis,'fetch',async()=>new Response('',{status:429}));
 let throttle;try{await adapter.providerRequest({applicationId:'11111111-1111-4111-8111-111111111111',privateKeyPem},'/application');}catch(error){throttle=error;}
 assert.equal(throttle?.code,'BANK_RATE_LIMIT');
 f[stage==='session'?'sessionError':stage==='list'?'listError':'detailError']=throttle;
 const before=f.sql.prepare('SELECT * FROM workspaces').get();let pending='';
 f.onRead=readStage=>{
  if(readStage!==stage)return;
  pending=f.sql.prepare('SELECT account_evidence_retry FROM bank_connections').get().account_evidence_retry;
  if(failure==='lease loss')f.leaseLost=true;
  else f.sql.exec("CREATE TRIGGER reject_read_result BEFORE UPDATE OF account_evidence_retry ON bank_connections BEGIN SELECT RAISE(ABORT,'Synthetic result save failed'); END;");
 };
 await assert.rejects(fetchBankDetails(request(f.id)));
 const saved=f.sql.prepare('SELECT account_evidence_retry FROM bank_connections').get().account_evidence_retry;
 assert.ok(pending,'uncertainty must be durable before contacting the provider');assert.equal(JSON.parse(pending).status,'pending');assert.equal(saved,pending);
 assert.equal(accountReadCooldown(saved,Date.now()+86400000).blocked,true);
 assert.deepEqual(f.sql.prepare('SELECT * FROM workspaces').get(),before);assert.equal(f.objects.size,0);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
});

for(const status of ['unknown','manual_block'])test(`a successful transaction detail read preserves an existing ${status} account-read guard`,async t=>{
 const f=fixture(t),guard=JSON.stringify({status,checkedAt:new Date().toISOString(),provenance:status==='unknown'?'retry_after_missing':'retry_after_exceeds_limit'});
 f.sql.prepare('UPDATE bank_connections SET account_evidence_retry=?').run(guard);
 assert.equal((await fetchBankDetails(request(f.id))).status,200);
 assert.equal(f.sql.prepare('SELECT account_evidence_retry FROM bank_connections').get().account_evidence_retry,guard);
 assert.equal(accountReadCooldown(guard).blocked,true);
});
