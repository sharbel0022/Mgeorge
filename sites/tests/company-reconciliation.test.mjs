import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {stripTypeScriptTypes} from 'node:module';
import {applyCommand,balance,emptyState,economicTransactions} from '../lib/domain.ts';
import {createCompanyBankSyncStore,companySyncError} from '../lib/company-bank-sync-store.js';
import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';
import {parseSpecificationBytes} from '../lib/bankgiro-parser.js';
import {makeBankgiroXLSX} from './helpers/bankgiro-xlsx-fixture.mjs';

const ACCOUNT='iban:SE4280000890119146168423',OTHER_ACCOUNT='iban:SE4550000000058398257466';
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const local=name=>new URL('../lib/'+name,import.meta.url).href;
function compiled(name,imports={}){
 const file=new URL('../lib/'+name,import.meta.url);
 let source=existsSync(file)?stripTypeScriptTypes(readFileSync(file,'utf8'),{mode:'transform'}):'export {};';
 for(const [name,url]of Object.entries(imports))for(const q of ["'",'"'])source=source.replaceAll(q+name+q,JSON.stringify(url));
 return data(source);
}
const domain=local('domain.ts');
const reconciliation=compiled('reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':local('reconciliation-engine.js'),'./company-reconciliation-policy.js':local('company-reconciliation-policy.js')});
const d1=sql=>({
 prepare(query){return {bind(...args){return {async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return this.execute();},execute(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}};}};},
 async batch(statements){sql.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.execute());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}},
});

async function fixture(t,{company='A',mode='invoice_number',number='0599',reference='',payment=reference||number,amount=10000,payer='Synthetic customer AB',account=ACCOUNT,selectedAccount=ACCOUNT,original=true,originalReference=reference}={}){
 const sql=new DatabaseSync(':memory:'),DB=d1(sql),owner='scope-'+company,companyId='company-'+company,connectionId='connection-'+company,companyName='Synthetic company '+company+' AB';
 sql.exec(readFileSync(new URL('../drizzle/0023_saas_bank_sync.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../drizzle/0017_bankgiro_auto_ingest.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../drizzle/0018_bankgiro_source_readiness.sql',import.meta.url),'utf8'));
 sql.exec('CREATE TABLE documents(id TEXT PRIMARY KEY,owner TEXT,filename TEXT,mime TEXT,size INTEGER,sha256 TEXT)');
 const bytes=Buffer.from('Synthetic invoice '+company+' '+number+' '+originalReference),sha256=createHash('sha256').update(bytes).digest('hex');
 sql.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?)').run('invoice-original',owner,'synthetic.txt','text/plain',bytes.length,sha256);
 const objects=new Map(original?[[owner+'/invoice-original',bytes]]:[]),key='__company_reconciliation_'+crypto.randomUUID().replaceAll('-','');
 let originalRead=()=>{};
 globalThis[key]={env:{DB,BUCKET:{async get(id){await originalRead(id);const value=objects.get(id);return value?{size:value.length,arrayBuffer:async()=>value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength)}:null;}}}};
 t.after(()=>{sql.close();delete globalThis[key];});
 const store=createCompanyBankSyncStore(DB);
 await store.bindScope({companyId,owner,evidenceId:'synthetic-scope'});
 await store.setReferencePolicy({companyId,owner,revision:1,companyName,mode,evidenceId:'synthetic-policy'});
 const context={companyId,owner,connectionId,provider:'synthetic-bank-'+company,accountKey:'stable-account-'+company,reconciliationAccount:selectedAccount,accountUid:'uid-'+company,consentId:'consent-'+company,generation:'generation-1',revision:1,validUntil:'2099-01-01T00:00:00Z',authorizationStatus:'VERIFIED',ratePolicy:{verified:true,evidenceId:'synthetic-quota',maxRequests:3,windowMs:60000},bankgiroEnabled:false};
 const request={companyId,connectionId,expectedGeneration:'generation-1',expectedRevision:1};
 let state=emptyState();state.company.name='Synthetic unrelated legacy settings AB';
 state=applyCommand(state,{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',number,ocr:reference,total:10000,issued:'2026-10-01',due:'2026-10-31',reviewed:true,documentId:'invoice-original'}}).state;
 state.invoices[0].referenceOriginal={invoice_number:number,reference:originalReference,issuer_name:companyName};
 if(amount!==null)state.transactions=[syntheticBankTransaction({account,date:'2026-10-26',amount,party:payer,payerReference:payment,bankReference:'SYNTHETIC-SAME-BANK-POST',kind:'payment',verified:true})];
 const server=compiled('server.ts',{'cloudflare:workers':data(`export const env=globalThis[${JSON.stringify(key)}].env;`),'@/app/chatgpt-auth':data('export async function getChatGPTUser(){throw Error("No authentication request expected");}'),'./domain':domain});
 const evidence=compiled('reconciliation-evidence.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-engine.js':local('reconciliation-engine.js'),'./bankgiro-service':data('export async function bankgiroAutomaticAccountIssue(){return "";}')});
 const implementation=await import(compiled('company-reconciliation.ts',{'./domain':domain,'./reconciliation-evidence':evidence,'./company-reconciliation-policy.js':local('company-reconciliation-policy.js'),'./company-bank-sync-store.js':local('company-bank-sync-store.js')}));
 const resolveContext=async()=>({...context,scope:await store.scope(context),referencePolicy:await store.referencePolicy(context)});
 const assertCurrent=async snapshot=>{
  const current=await resolveContext();
  if(current.generation!==snapshot.generation||current.revision!==snapshot.revision)throw companySyncError('AUTHORIZATION_CHANGED');
  if(JSON.stringify(current.referencePolicy)!==JSON.stringify(snapshot.referencePolicy))throw companySyncError('REFERENCE_POLICY_CHANGED');
 };
 return {state,sql,DB,owner,context,request,objects,store,resolveContext,assertCurrent,onOriginalRead(fn){originalRead=fn;},reconciler(options={}){
  assert.equal(typeof implementation.createCompanyReconciler,'function','Sites requires a company gate around retained-original verification');
  return implementation.createCompanyReconciler({owner,resolveContext,assertCurrent,...options});
 }};
}

test('Sites company A allocates with exact invoice policy and leaves settings and originals unchanged',async t=>{
 const f=await fixture(t),before=structuredClone(f.state),run=f.reconciler(),first=await run(f.request,f.state),again=await run(f.request,first.state);
 assert.equal(first.status,'completed');assert.equal(first.applied,1);assert.equal(again.applied,0);assert.equal(balance(first.state,first.state.invoices[0]),0);
 assert.deepEqual(first.state.company,before.company);assert.deepEqual(first.state.transactions,before.transactions);assert.deepEqual(f.state,before);
});

test('Sites company B uses only its explicit original OCR',async t=>{
 const f=await fixture(t,{company:'B',mode:'ocr',number:'B-42',reference:'000018'}),result=await f.reconciler()(f.request,f.state);
 assert.equal(result.status,'completed');assert.equal(result.applied,1);assert.equal(balance(result.state,result.state.invoices[0]),0);
});

test('Sites company C reconciles independently with its other bank and selected account',async t=>{
 const f=await fixture(t,{company:'C',number:'C-42',account:OTHER_ACCOUNT,selectedAccount:OTHER_ACCOUNT}),result=await f.reconciler()(f.request,f.state);
 assert.equal(result.applied,1);assert.equal(result.state.transactions[0].account,OTHER_ACCOUNT);assert.equal(balance(result.state,result.state.invoices[0]),0);
});

test('Sites same reference and bank ID in two owned company workspaces do not share allocations',async t=>{
 const a=await fixture(t,{company:'A',number:'000018'}),b=await fixture(t,{company:'B',mode:'ocr',number:'B-42',reference:'000018'}),before=structuredClone(b.state);
 const first=await a.reconciler()(a.request,a.state);assert.equal(first.applied,1);assert.deepEqual(b.state,before);
 const foreign=await a.reconciler()({...a.request,companyId:'company-B',owner:b.owner},a.state);assert.equal(foreign.status,'held');assert.deepEqual(foreign.state,a.state);
 const second=await b.reconciler()(b.request,b.state);assert.equal(second.applied,1);assert.notEqual(first.state.allocations[0].id,second.state.allocations[0].id);
});

for(const [name,options]of [
 ['invoice number fallback under OCR policy',{company:'B',mode:'ocr',number:'0599',reference:'000018',payment:'0599'}],
 ['missing OCR',{company:'B',mode:'ocr',number:'0599',reference:''}],
 ['missing original OCR',{company:'B',mode:'ocr',number:'B-42',reference:'000018',originalReference:''}],
 ['OCR with changed leading zeros',{company:'B',mode:'ocr',number:'B-42',reference:'000018',payment:'18'}],
 ['invalid OCR checksum',{company:'B',mode:'ocr',number:'B-42',reference:'000019'}],
 ['wrong customer',{payer:'Another synthetic customer AB'}],
 ['another active account',{account:OTHER_ACCOUNT}],
 ['partial payment',{amount:4000}],
 ['overpayment',{amount:12000}],
 ['missing retained original',{original:false}],
])test('Sites '+name+' leaves invoice balances and allocations unchanged',async t=>{
 const f=await fixture(t,options),before=structuredClone(f.state),result=await f.reconciler()(f.request,f.state);
 assert.equal(result.applied,0);assert.deepEqual(result.state.allocations,before.allocations);assert.deepEqual(result.state.invoices,before.invoices);assert.equal(balance(result.state,result.state.invoices[0]),10000);assert.deepEqual(f.state,before);
});

test('Sites missing scope, policy, selected account or current guard cannot use defaults',async t=>{
 for(const field of ['scope','referencePolicy','reconciliationAccount']){
  const f=await fixture(t),run=f.reconciler({resolveContext:async()=>{const value=await f.resolveContext();delete value[field];return value;}}),result=await run(f.request,f.state);
  assert.equal(result.status,'held');assert.deepEqual(result.state,f.state);
 }
 const f=await fixture(t),result=await f.reconciler({assertCurrent:undefined})(f.request,f.state);assert.equal(result.status,'held');assert.deepEqual(result.state,f.state);
});

for(const change of ['generation','policy'])test('Sites '+change+' changes during original I/O discard all new allocations',async t=>{
 const f=await fixture(t);let changed=false;
 f.onOriginalRead(async()=>{if(changed)return;changed=true;if(change==='generation')f.context.generation='generation-2';else await f.store.setReferencePolicy({...f.context,revision:2,companyName:'Synthetic company A AB',mode:'ocr',evidenceId:'synthetic-new-policy'});});
 const result=await f.reconciler()(f.request,f.state);assert.equal(changed,true);assert.equal(result.status,'stale');assert.equal(result.applied,0);assert.deepEqual(result.state,f.state);assert.deepEqual(result.decisions,[]);
});

test('Sites policy in one workspace never teaches invoice-number fallback to another company',async t=>{
 const a=await fixture(t),b=await fixture(t,{company:'B',mode:'ocr',number:'0599',reference:'000018',payment:'0599'});
 assert.equal((await a.reconciler()(a.request,a.state)).applied,1);const result=await b.reconciler()(b.request,b.state);
 assert.equal(result.applied,0);assert.deepEqual(result.state.invoices,b.state.invoices);assert.deepEqual(result.state.allocations,[]);
});

test('Sites aggregate deposit and missing real Bankgiro reports remain review-only',async t=>{
 const f=await fixture(t,{amount:null});f.state.transactions=[syntheticBankTransaction({account:ACCOUNT,date:'2026-10-26',amount:10000,party:'Bankgiro',payerReference:'',bankReference:'SYNTHETIC-BATCH',description:'Bankgiro samlingspost',kind:'batch',verified:false})];
 const result=await f.reconciler()(f.request,f.state);assert.equal(result.applied,0);assert.deepEqual(result.state.allocations,[]);assert.deepEqual(result.state.invoices,f.state.invoices);
});

test('Sites two Bankgiro reports for the same bank post retain evidence without adding money',async t=>{
 const f=await fixture(t,{amount:null});f.state.transactions=[syntheticBankTransaction({account:ACCOUNT,date:'2026-10-26',amount:10000,party:'Bankgiro',payerReference:'',bankReference:'SYNTHETIC-BATCH',description:'Bankgiro samlingspost',kind:'batch',verified:false})];
 for(const n of [0,1]){
  const documentId='synthetic-report-'+n,name='synthetic-report-'+n+'.xlsx',bytes=makeBankgiroXLSX({currency:'SEK',account:ACCOUNT.slice(5),date:'2026-10-26',sequence:'41',shiftRows:n,payments:[{party:'Synthetic customer AB',reference:'0599',payerBankgiro:'987-6543',amount:10000}]}),hash=createHash('sha256').update(bytes).digest('hex');
  f.sql.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?)').run(documentId,f.owner,name,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes.length,hash);f.objects.set(f.owner+'/'+documentId,bytes);
  f.state=applyCommand(f.state,{type:'bankgiro.import',documentId,hash,name,rows:parseSpecificationBytes(bytes,name)}).state;
 }
 const before=structuredClone(f.state),result=await f.reconciler()(f.request,f.state);
 assert.equal(result.applied,0);assert.equal(economicTransactions(result.state).length,1);assert.equal(economicTransactions(result.state)[0].amount,10000);
 assert.equal(result.state.imports.length,2);assert.deepEqual(result.state.allocations,[]);assert.deepEqual(result.state.invoices,before.invoices);assert.equal(balance(result.state,result.state.invoices[0]),10000);
});

test('Sites a preserved manual partial and exact later remainder settle once',async t=>{
 const f=await fixture(t,{number:'000018',reference:'000018',amount:6000});
 const historical=syntheticBankTransaction({id:'synthetic-historical',account:ACCOUNT,date:'2026-10-25',amount:4000,party:'Synthetic customer AB',payerReference:'000018',bankReference:'SYNTHETIC-HISTORICAL',kind:'payment',verified:true});
 f.state.transactions.push(historical);f.state.allocations.push({id:'historical-allocation',invoiceId:f.state.invoices[0].id,transactionId:historical.id,amount:4000,effect:'payment',active:true,note:'Synthetic independently reviewed partial',createdAt:'2026-10-25T12:00:00Z'});
 const before=structuredClone(f.state.allocations[0]),run=f.reconciler(),result=await run(f.request,f.state),again=await run(f.request,result.state);
 assert.equal(result.applied,1);assert.equal(again.applied,0);assert.deepEqual(result.state.allocations[0],before);assert.equal(balance(result.state,result.state.invoices[0]),0);
});
