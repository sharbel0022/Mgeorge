import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeDocument,storeTransactions,listInvoices,listTransactions,allocate} from '../src/db.js';
import {approveSyntheticBankAccount,withSyntheticBankOriginal} from './bank-fixtures.js';
import {createCompanyBankSyncStore,companySyncError} from '../sites/lib/company-bank-sync-store.js';
import {parseBankFile} from '../src/importers.js';

const moduleUrl=new URL('../src/company-reconciliation.js',import.meta.url);
const implementation=existsSync(moduleUrl)?await import(moduleUrl):{};
const ACCOUNT='SE4280000890119146168423',OTHER_ACCOUNT='SE4550000000058398257466';
const d1=sql=>({
 prepare(query){return {bind(...args){return {async first(){return sql.prepare(query).get(...args)||null;},async run(){return this.execute();},execute(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}};}};},
 async batch(statements){sql.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.execute());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}},
});

async function fixture(t,{company='A',mode='invoice_number',number='0599',reference='',amount=10000,payment=reference||number,payer='Synthetic customer AB',account=ACCOUNT,selectedAccount=ACCOUNT,original=true,originalReference=reference}={}){
 const folder=mkdtempSync(join(tmpdir(),'company-reconciliation-')),db=openDatabase(join(folder,'synthetic.sqlite'));
 t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
 db.exec(readFileSync(new URL('../sites/drizzle/0023_saas_bank_sync.sql',import.meta.url),'utf8'));
 const owner='scope-'+company,companyId='company-'+company,connectionId='connection-'+company,companyName='Synthetic company '+company+' AB';
 const context={companyId,owner,connectionId,provider:'enablebanking',accountKey:'iban:'+selectedAccount,accountUid:'synthetic-account',consentId:'consent-'+company,generation:'generation-1',revision:1,validUntil:'2099-01-01T00:00:00Z',authorizationStatus:'VERIFIED',ratePolicy:{verified:true,evidenceId:'synthetic-quota',maxRequests:3,windowMs:60000},bankgiroEnabled:false};
 const store=createCompanyBankSyncStore(d1(db));
 await store.bindScope({companyId,owner,evidenceId:'synthetic-company-binding'});
 await store.setReferencePolicy({companyId,owner,revision:1,companyName,mode,evidenceId:'synthetic-company-policy'});
 approveSyntheticBankAccount(db,selectedAccount,{id:connectionId});db.prepare('UPDATE bank_connections SET owner=?,bank_name=? WHERE id=?').run(owner,'Synthetic bank '+company,connectionId);
 db.prepare('INSERT INTO invoices(id,direction,invoice_number,reference,party,total_cents,issued_at) VALUES(?,?,?,?,?,?,?)').run('invoice','customer',number,reference,'Synthetic customer AB',10000,'2026-10-01');
 let document;
 if(original){
  document=storeDocument(db,{invoice_id:'invoice',name:'synthetic-invoice.txt',mime_type:'text/plain',bytes:Buffer.from('Synthetic original '+company+' '+number+' '+originalReference)});
  db.prepare('UPDATE documents SET extraction=? WHERE id=?').run(JSON.stringify({fields:{invoice_number:{value:number},reference:{value:originalReference}},details:{supplier:{name:companyName}}}),document.id);
 }
 if(amount!==null)storeTransactions(db,[withSyntheticBankOriginal({account,booked_at:'2026-10-26',amount_cents:amount,currency:'SEK',payer,reference:payment,bank_reference:'SYNTHETIC-SAME-BANK-POST'})],'enablebanking');
 const request={companyId,connectionId,expectedGeneration:'generation-1',expectedRevision:1};
 let hook=()=>{};
 const resolveContext=async()=>({...context,scope:await store.scope(context),referencePolicy:await store.referencePolicy(context)});
 const assertCurrent=snapshot=>{
  hook(snapshot);
  const scope=db.prepare('SELECT * FROM company_bank_sync_scopes WHERE company_id=? AND owner=?').get(companyId,owner);
  if(!scope||scope.revision!==snapshot.scopeBindingRevision)throw companySyncError('COMPANY_SCOPE_MISMATCH');
  if(scope.reference_policy!==JSON.stringify(snapshot.referencePolicy))throw companySyncError('REFERENCE_POLICY_CHANGED');
  if(context.generation!==snapshot.generation||context.revision!==snapshot.revision)throw companySyncError('AUTHORIZATION_CHANGED');
  const connection=db.prepare('SELECT * FROM bank_connections WHERE id=?').get(snapshot.connectionId);
  if(connection?.status!=='connected'||connection.owner!==owner||connection.selected_account_uid!==snapshot.accountUid)throw companySyncError('AUTHORIZATION_CHANGED');
 };
 return {db,store,owner,context,request,document,resolveContext,assertCurrent,setHook(value){hook=value;},reconciler(options={}){
  assert.equal(typeof implementation.createCompanyReconciler,'function','company reconciliation must wrap the actual financial engine');
  return implementation.createCompanyReconciler({db,owner,resolveContext,assertCurrent,...options});
 }};
}
const money=db=>Object.fromEntries(['invoices','bank_transactions','allocations','payer_links'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY id').all()]));

test('company A exact invoice-number policy reaches analysis and allocation without changing global settings',async t=>{
 const f=await fixture(t),settings=f.db.prepare('SELECT data FROM app_settings').get().data,bank=f.db.prepare('SELECT * FROM bank_transactions').get();
 const run=f.reconciler(),first=await run(f.request),again=await run(f.request);
 assert.equal(first.status,'completed');assert.equal(first.applied,1);assert.equal(again.applied,0);
 assert.equal(listInvoices(f.db)[0].paid_cents,10000);assert.equal(f.db.prepare('SELECT count(*) n FROM allocations').get().n,1);
 assert.equal(f.db.prepare("SELECT count(*) n FROM audit_events WHERE action='automatic_match'").get().n,1);
 assert.equal(f.db.prepare('SELECT data FROM app_settings').get().data,settings);assert.deepEqual(f.db.prepare('SELECT * FROM bank_transactions').get(),bank);
});

test('company B uses preserved explicit OCR even when global legacy settings would select another rule',async t=>{
 const f=await fixture(t,{company:'B',mode:'ocr',number:'B-42',reference:'000018'}),result=await f.reconciler()(f.request);
 assert.equal(result.status,'completed');assert.equal(result.applied,1);assert.equal(listInvoices(f.db)[0].paid_cents,10000);
});

test('company C independently reconciles its selected account at another bank',async t=>{
 const f=await fixture(t,{company:'C',number:'C-42',account:OTHER_ACCOUNT,selectedAccount:OTHER_ACCOUNT});
 const result=await f.reconciler()(f.request);assert.equal(result.applied,1);assert.equal(listInvoices(f.db)[0].paid_cents,10000);
 assert.equal(listTransactions(f.db)[0].account,OTHER_ACCOUNT);
});

test('identical invoice references in different bound databases settle only their own company',async t=>{
 const a=await fixture(t,{company:'A'}),b=await fixture(t,{company:'B',mode:'ocr',number:'B-42',reference:'000018',payment:'0599'}),before=money(b.db);
 await a.reconciler()(a.request);await b.reconciler()(b.request);
 assert.equal(listInvoices(a.db)[0].paid_cents,10000);assert.deepEqual(money(b.db),before);
 const foreign=await a.reconciler()({...a.request,companyId:b.context.companyId,owner:b.owner,referencePolicy:await b.store.referencePolicy(b.context)});
 assert.equal(foreign.status,'held');assert.equal(foreign.reason,'COMPANY_SCOPE_MISMATCH');assert.deepEqual(money(b.db),before);
});

test('same valid reference and same bank ID in two companies never shares payer links or allocations',async t=>{
 const a=await fixture(t,{company:'A',number:'000018'}),b=await fixture(t,{company:'B',mode:'ocr',number:'B-42',reference:'000018'});
 await a.reconciler()(a.request);assert.equal(listInvoices(b.db)[0].paid_cents,0);
 await b.reconciler()(b.request);assert.equal(listInvoices(a.db)[0].paid_cents,10000);assert.equal(listInvoices(b.db)[0].paid_cents,10000);
 assert.notEqual(a.db.prepare('SELECT id FROM allocations').get().id,b.db.prepare('SELECT id FROM allocations').get().id);
});

for(const [name,options]of [
 ['OCR policy never falls back to invoice number',{company:'B',mode:'ocr',number:'0599',reference:'000018',payment:'0599'}],
 ['missing OCR field',{company:'B',mode:'ocr',number:'0599',reference:''}],
 ['missing preserved original OCR',{company:'B',mode:'ocr',number:'B-42',reference:'000018',originalReference:''}],
 ['OCR leading zeros changed by payment',{company:'B',mode:'ocr',number:'B-42',reference:'000018',payment:'18'}],
 ['invalid OCR checksum',{company:'B',mode:'ocr',number:'B-42',reference:'000019'}],
 ['wrong customer',{payer:'Different synthetic customer AB'}],
 ['wrong account',{account:OTHER_ACCOUNT}],
 ['partial payment',{amount:4000}],
 ['overpayment',{amount:12000}],
 ['missing invoice original',{original:false}],
])test(name+' keeps all financial rows unchanged',async t=>{
 const f=await fixture(t,options),before=money(f.db),result=await f.reconciler()(f.request);
 assert.equal(result.applied,0);assert.deepEqual(money(f.db),before);assert.equal(listInvoices(f.db)[0].paid_cents,0);
});

test('another selected account in the same company cannot authorize the job account',async t=>{
 const f=await fixture(t,{account:OTHER_ACCOUNT});approveSyntheticBankAccount(f.db,OTHER_ACCOUNT,{id:'other-bank'});f.db.prepare('UPDATE bank_connections SET owner=? WHERE id=?').run(f.owner,'other-bank');
 const before=money(f.db),result=await f.reconciler()(f.request);assert.equal(result.applied,0);assert.deepEqual(money(f.db),before);
});

test('unbound storage or missing explicit policy leaves the legacy ledger untouched',async t=>{
 for(const field of ['scope','referencePolicy']){
  const f=await fixture(t),before=money(f.db),run=f.reconciler({resolveContext:async()=>{const value=await f.resolveContext();delete value[field];return value;}});
  const result=await run(f.request);assert.equal(result.status,'held');assert.deepEqual(money(f.db),before);
 }
});

test('policy change at allocation commit rolls back allocations, learned payer links and audit together',async t=>{
 const f=await fixture(t),before=money(f.db),audit=f.db.prepare('SELECT * FROM audit_events ORDER BY id').all();
 f.setHook(()=>{if(f.db.prepare('SELECT count(*) n FROM allocations').get().n)throw companySyncError('REFERENCE_POLICY_CHANGED');});
 const result=await f.reconciler()(f.request);
 assert.equal(result.status,'stale');assert.equal(result.applied,0);assert.deepEqual(money(f.db),before);assert.deepEqual(f.db.prepare('SELECT * FROM audit_events ORDER BY id').all(),audit);
});

test('generation changes and asynchronous commit guards cannot authorize writes',async t=>{
 const f=await fixture(t),before=money(f.db);f.context.generation='generation-2';
 assert.equal((await f.reconciler()(f.request)).status,'stale');assert.deepEqual(money(f.db),before);
 f.context.generation='generation-1';assert.equal((await f.reconciler({assertCurrent:async()=>true})(f.request)).status,'held');assert.deepEqual(money(f.db),before);
});

test('an earlier manual partial remains intact and a later exact remainder settles once',async t=>{
 const f=await fixture(t,{number:'000018',reference:'000018',amount:4000}),transaction=listTransactions(f.db)[0];
 allocate(f.db,'invoice',transaction.id,4000,{referenceContext:(await import('../sites/lib/company-reconciliation-policy.js')).companyReconciliationGate(f.request,await f.resolveContext(),{owner:f.owner}).referenceContext});
 const historical=f.db.prepare('SELECT * FROM allocations').get();
 storeTransactions(f.db,[withSyntheticBankOriginal({account:ACCOUNT,booked_at:'2026-10-27',amount_cents:6000,currency:'SEK',payer:'Synthetic customer AB',reference:'000018',bank_reference:'SYNTHETIC-REMAINDER'})],'enablebanking');
 assert.equal((await f.reconciler()(f.request)).applied,1);assert.deepEqual(f.db.prepare('SELECT * FROM allocations WHERE id=?').get(historical.id),historical);assert.equal(listInvoices(f.db)[0].paid_cents,10000);
});

test('unresolved batch and absent real Bankgiro coverage never become individual invoice payments',async t=>{
 const f=await fixture(t,{amount:null});
 storeTransactions(f.db,[withSyntheticBankOriginal({account:ACCOUNT,booked_at:'2026-10-26',amount_cents:10000,currency:'SEK',payer:'',reference:'',bank_reference:'SYNTHETIC-BATCH',is_aggregate:true})],'enablebanking');
 const before=money(f.db),result=await f.reconciler()(f.request);assert.equal(result.applied,0);assert.deepEqual(money(f.db),before);
});

test('two retained reports of the same bank post cannot create a second economic payment',async t=>{
 const f=await fixture(t,{amount:null});
 for(const name of ['first.csv','second.csv']){
  const content=Buffer.from(`Datum;Belopp;Betalare;Referens;Valuta;IBAN;Bankreferens\n2026-10-26;100.00;Synthetic customer AB;0599;SEK;${ACCOUNT};SYNTHETIC-REPORT-BANK-POST\n`);
  const rows=parseBankFile(name,content.toString('base64'),ACCOUNT);
  storeTransactions(f.db,rows,'file:'+name,{content,mime_type:'text/csv'});
 }
 await f.reconciler()(f.request);await f.reconciler()(f.request);
 assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions WHERE excluded=0').get().n,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM import_jobs WHERE content IS NOT NULL').get().n,2);
 assert.equal(f.db.prepare('SELECT count(*) n FROM allocations').get().n,1);assert.equal(listInvoices(f.db)[0].paid_cents,10000);
});
