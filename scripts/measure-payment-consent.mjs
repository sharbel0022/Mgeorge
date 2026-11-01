// Identical synthetic corpus for the existing Node and Sites allocation boundaries.
// No server, .env, provider request, production database or customer original is used.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';

const runner=fileURLToPath(import.meta.url),root=resolve(dirname(runner),'..');
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const sourceRoot=resolve(option('--source-root')||root),output=resolve(option('--output')||join(root,'.codex-work/payment-verification/consent.json'));
const sha=value=>createHash('sha256').update(value).digest('hex');
const url=name=>pathToFileURL(join(sourceRoot,name)).href;
const load=name=>import(url(name));
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
function compiled(name,imports){
 let code=stripTypeScriptTypes(readFileSync(join(sourceRoot,name),'utf8'),{mode:'transform'});
 for(const [from,to]of Object.entries(imports))for(const quote of ['"',"\u0027"])code=code.replaceAll(quote+from+quote,JSON.stringify(to));
 return data(code);
}
const cases=[
 {id:'valid-current-account',expected:1},
 ...['missing','expired','disconnected','error','ownerless','deselected','wrong-account','wrong-currency','ambiguous'].map(id=>({id,expected:0})),
 {id:'missing-receipt',expected:0},
];
const iban='SE4280000890119146168423',owner='synthetic-owner';
process.env.BANK_DATA_KEY='3'.repeat(64);delete process.env.ENCRYPTION_KEY;
const [{openDatabase,storeTransactions,listInvoices},{normalizeBankApiTransaction},{runReconciliation,reconciliationData},{encryptObject}]=await Promise.all([load('src/db.js'),load('src/importers.js'),load('src/reconciliation.js'),load('src/security.js')]);
const folder=mkdtempSync(join(tmpdir(),'mg-consent-corpus-'));
const results=[];
function accountResources(id){return [{uid:'selected',currency:id==='wrong-currency'?'EUR':'SEK',account_id:{iban:id==='wrong-account'?'SE4550000000058398257466':iban}},...(id==='ambiguous'?[{uid:'selected',currency:'SEK',account_id:{iban}}]:[])];}
try{
 for(const scenario of cases){
  const db=openDatabase(join(folder,scenario.id+'.sqlite'));
  try{
   if(scenario.id!=='missing')db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,status,selected_account_uid) VALUES(?,?,?,?,?,?,?,?,?)').run('connection','enablebanking','Synthetic bank',encryptObject({session_id:'synthetic-session'}),encryptObject(accountResources(scenario.id)),scenario.id==='expired'?'2000-01-01T00:00:00Z':'2099-01-01T00:00:00Z',scenario.id==='ownerless'?'':owner,['disconnected','error'].includes(scenario.id)?scenario.id:'connected',scenario.id==='deselected'?'':'selected');
   db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,reference,issued_at) VALUES(?,?,?,?,?,?,?)').run('invoice','customer','0599','Synthetic customer AB',62500,'0599','2026-10-01');
   const raw={status:'BOOK',booking_date:'2026-10-26',credit_debit_indicator:'CRDT',transaction_amount:{amount:'625.00',currency:'SEK'},debtor:{name:'Synthetic customer AB'},reference_number:'0599',entry_reference:'SYNTHETIC-CONSENT-ENTRY'};
   storeTransactions(db,[normalizeBankApiTransaction(raw,iban)],'enablebanking');
   if(scenario.id==='missing-receipt')db.prepare("UPDATE bank_transactions SET raw_bank_data_sha256=''").run();
   const bankBefore=JSON.stringify(db.prepare('SELECT * FROM bank_transactions').all()),start=performance.now();
   const preview=reconciliationData(db);runReconciliation(db);
   const elapsedMs=performance.now()-start,allocations=db.prepare('SELECT COUNT(*) n FROM allocations').get().n,invoice=listInvoices(db)[0];
   results.push({engine:'node',id:scenario.id,expectedAllocations:scenario.expected,allocations,paidCents:invoice.paid_cents,remainingCents:invoice.remaining_cents,correct:allocations===scenario.expected,originalUnchanged:bankBefore===JSON.stringify(db.prepare('SELECT * FROM bank_transactions').all()),originalVerified:preview.transactions[0].original_verified??null,currentAccountIssue:!!preview.transactions[0].account_consent_issue,elapsedMs});
  }finally{db.close();}
 }
}finally{rmSync(folder,{recursive:true,force:true});}

const domain=url('sites/lib/domain.ts'),engine=url('sites/lib/reconciliation-engine.js');
const {emptyState,applyCommand,balance}=await load('sites/lib/domain.ts');
const {syntheticBankRow}=await load('sites/tests/helpers/bank-api-fixture.mjs');
const reconciliation=compiled('sites/lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':engine});
const transactions=compiled('sites/lib/banking/transactions.ts',{'../domain':domain,'../payment-references.js':url('sites/lib/payment-references.js'),'../payer-evidence.js':url('sites/lib/payer-evidence.js')});
for(const scenario of cases){
 const key='__synthetic_consent_measure_'+crypto.randomUUID().replaceAll('-','');
 const context={checks:0,connection:scenario.id==='missing'?null:{owner:scenario.id==='ownerless'?'':owner,status:['disconnected','error'].includes(scenario.id)?scenario.id:'connected',environment:'PRODUCTION',valid_until:scenario.id==='expired'?'2000-01-01T00:00:00Z':'2099-01-01T00:00:00Z',app_generation:'synthetic-generation',selected_accounts:JSON.stringify(scenario.id==='deselected'?[]:['selected']),bank_name:'Synthetic bank',country:'SE'},application:{owner,generation:'synthetic-generation'},accounts:accountResources(scenario.id)};
 globalThis[key]=context;
 try{
  const store=data(`const c=globalThis[${JSON.stringify(key)}];export async function connection(){c.checks++;return c.connection;}export async function application(){return c.application;}export async function accounts(){return c.accounts;}`);
  const server=data('export async function readBankOriginalBytes(){throw Error("No file in synthetic AIS corpus");}export async function readWorkspace(){throw Error("No persisted workspace in synthetic corpus");}');
  const service=compiled('sites/lib/bankgiro-service.ts',{'./domain':domain,'./server':server,'./bankgiro-parser.js':url('sites/lib/bankgiro-parser.js'),'./banking/store':store,'./banking/transactions':transactions});
  const evidence=await import(compiled('sites/lib/reconciliation-evidence.ts',{'./domain':domain,'./server':server,'./reconciliation':reconciliation,'./reconciliation-engine.js':engine,'./bankgiro-service':service}));
  let state=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',number:'0599',ocr:'',total:62500,issued:'2026-10-01',due:'2026-10-30',reviewed:true}}).state;
  state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account:'iban:'+iban,date:'2026-10-26',amount:62500,party:'Synthetic customer AB',payerReference:'0599',bankReference:'SYNTHETIC-CONSENT-ENTRY',kind:'payment',verified:true})]}).state;
  if(scenario.id==='missing-receipt')delete state.transactions[0].bankDataSha256;
  const before=JSON.stringify(state),start=performance.now(),preview=await evidence.reconciliationPreviewWithOriginals(owner,state),result=await evidence.reconcileWithOriginals(owner,state),elapsedMs=performance.now()-start;
  const allocations=result.state.allocations.length,remainingCents=balance(result.state,result.state.invoices[0]);
  results.push({engine:'sites',id:scenario.id,expectedAllocations:scenario.expected,allocations,paidCents:62500-remainingCents,remainingCents,correct:allocations===scenario.expected,originalUnchanged:JSON.stringify(state.transactions[0].bankData)===JSON.stringify(result.state.transactions[0].bankData),inputUnchanged:before===JSON.stringify(state),previewCandidates:preview.automatic_candidates,accountChecks:context.checks,elapsedMs});
 }finally{delete globalThis[key];}
}
assert.ok(results.every(r=>r.originalUnchanged&&r.inputUnchanged!==false),'Corpus must never alter original or input evidence');
const summarize=engine=>{const rows=results.filter(r=>r.engine===engine),negative=rows.filter(r=>!r.expectedAllocations);return {cases:rows.length,correct:rows.filter(r=>r.correct).length,falseAllocations:negative.reduce((sum,r)=>sum+r.allocations,0),safeMatches:rows.filter(r=>r.expectedAllocations&&r.correct).length,blockedOrReview:negative.filter(r=>!r.allocations).length,blockedBalancesUnchanged:negative.filter(r=>!r.allocations&&r.remainingCents===62500&&r.paidCents===0).length,totalElapsedMs:rows.reduce((sum,r)=>sum+r.elapsedMs,0)};};
const sourceFiles=['src/reconciliation.js','sites/lib/reconciliation-evidence.ts','sites/lib/reconciliation.ts','sites/lib/bankgiro-service.ts','sites/lib/banking/transactions.ts'];
const report={schema:'payment-consent-corpus-v1',sourceRevision:option('--source-revision')||'working-tree',scope:'Real Node SQLite and existing Sites original/account/allocation functions with synthetic in-memory provider account store. No network, HTTP authentication, production or latency SLA.',runnerSha256:sha(readFileSync(runner)),corpusSha256:sha(JSON.stringify(cases)),sourceHashes:Object.fromEntries(sourceFiles.map(name=>[name,sha(readFileSync(join(sourceRoot,name)))])),metrics:{node:summarize('node'),sites:summarize('sites')},results};
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({metrics:report.metrics,output},null,2));
