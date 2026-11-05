import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.js';
import {encryptObject} from '../src/security.js';
import {createNodeCompanyBankSyncRuntime,nodeCompanyBankAccountKey,registerCompanyBankSyncRuntime,runScheduledCompanyBankSync} from '../src/company-bank-sync.js';

test('successive bounded scheduler ticks fairly reach 101 companies despite one failed discovery',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'mg-company-fairness-'));
 process.env.BANK_DATA_KEY='7'.repeat(64);delete process.env.ENCRYPTION_KEY;
 const templatePath=join(directory,'template.sqlite'),template=openDatabase(templatePath);template.close();
 const databases=[],healthy=[],registrations=[];let time=Date.parse('2026-11-04T12:00:00Z');
 const expires='2026-11-06T12:00:00Z';
 async function company(index,{discoveryFails=false,hasUnresolvableJob=false}={}){
  const companyId=`synthetic-company-${String(index).padStart(3,'0')}`,owner='owner-'+index,filename=join(directory,index+'.sqlite');
  copyFileSync(templatePath,filename);
  const db=new DatabaseSync(filename);databases.push(db);db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
  const account={uid:'provider-uid',currency:'SEK',account_id:{other:{identification:'SYNTHETIC-ACCOUNT-'+index}}};
  const selector={companyId,connectionId:'connection',accountKey:nodeCompanyBankAccountKey({account,bank:'Swedbank'})};
  db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,selected_account_uid) VALUES(?,?,?,?,?,?,?,?)').run('connection','enablebanking','Swedbank',encryptObject({session_id:'consent'}),encryptObject([account]),expires,owner,account.uid);
  const context={...selector,owner,provider:'enablebanking',accountUid:account.uid,consentId:'consent',generation:'generation-1',revision:1,validUntil:expires,authorizationStatus:'VERIFIED',ratePolicy:{verified:true,evidenceId:'synthetic-quota',maxRequests:1000,windowMs:86400000},bankgiroEnabled:false};
  const runtime=await createNodeCompanyBankSyncRuntime({db,companyId,owner,evidenceId:'synthetic-binding',now:()=>time,
   resolveContext:async request=>{if(request.connectionId==='unresolvable')throw Object.assign(new Error('sensitive resolver failure'),{code:'AUTHORIZATION_UNVERIFIED'});return context;},assertCurrent:()=>true,
   listJobs:async()=>{if(discoveryFails)throw new Error('sensitive discovery failure');return hasUnresolvableJob?[{...selector,connectionId:'unresolvable'},selector]:[selector];},
   providerRequest:async path=>path.startsWith('/sessions/')?{status:'AUTHORIZED',accounts:[account.uid],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:expires,transactions:true}}:{transactions:[{status:'BOOK',entry_reference:'same-bank-id',booking_date:'2026-11-04',transaction_amount:{amount:((index+1)/100).toFixed(2),currency:'SEK'},credit_debit_indicator:'CRDT',debtor:{name:'Synthetic payer'}}]},
  });
  await runtime.store.setReferencePolicy({companyId,owner,revision:1,companyName:'Synthetic Company '+index,mode:'invoice_number',evidenceId:'synthetic-reference-policy'});
  return {db,runtime,selector,context};
 }
 const register=runtime=>registrations.push(registerCompanyBankSyncRuntime(runtime));
 const unregisterAll=()=>{while(registrations.length)registrations.pop()();};
 try{
  const failed=await company(999,{discoveryFails:true});
  for(let index=0;index<101;index++)healthy.push(await company(index,{hasUnresolvableJob:index===0}));
  register(failed.runtime);for(const item of [...healthy].reverse())register(item.runtime);
  const first=await runScheduledCompanyBankSync();
  const firstDispatched=first.results.filter(result=>result.stage!=='discovery');
  assert.equal(firstDispatched.length,100);assert.equal(first.remaining,1);
  assert.equal(firstDispatched[0].companyId,'synthetic-company-000');
  assert.equal(firstDispatched.at(-1).companyId,'synthetic-company-099');
  assert.ok(firstDispatched.every(result=>result.status==='success'));
  const failure=first.results.find(result=>result.companyId==='synthetic-company-999');
  assert.equal(failure.status,'retry');assert.equal(failure.stage,'discovery');assert.equal(failure.code,'COMPANY_DISCOVERY_UNAVAILABLE');
  assert.ok(!JSON.stringify(failure).includes('sensitive discovery failure'));
  const unresolved=first.results.find(result=>result.connectionId==='unresolvable');
  assert.equal(unresolved.status,'blocked');assert.equal(unresolved.stage,'discovery');assert.equal(unresolved.code,'AUTHORIZATION_UNVERIFIED');
  assert.ok(!JSON.stringify(unresolved).includes('sensitive resolver failure'));
  assert.equal(healthy[100].db.prepare('SELECT last_attempt_at FROM company_bank_sync_jobs').get().last_attempt_at,null);
  assert.equal(healthy[100].db.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n,0);
  assert.equal(failed.db.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n,0);

  // Registration order is deliberately changed. Persisted attempt history,
  // rather than a process-local insertion order, must determine the next tick.
  unregisterAll();register(failed.runtime);for(const item of healthy)register(item.runtime);
  time+=60000;
  const second=await runScheduledCompanyBankSync(),secondDispatched=second.results.filter(result=>result.stage!=='discovery');
  assert.equal(secondDispatched.length,100);assert.equal(second.remaining,1);
  assert.equal(secondDispatched[0].companyId,'synthetic-company-100');
  for(let index=0;index<healthy.length;index++){
   const {db}=healthy[index],state=db.prepare('SELECT last_attempt_at FROM company_bank_sync_jobs').get();
   assert.ok(state.last_attempt_at>0);
   const bank=db.prepare('SELECT amount_cents FROM bank_transactions').all();
   assert.equal(bank.length,1);assert.equal(bank[0].amount_cents,index+1);
   assert.equal(db.prepare('SELECT count(*) n FROM allocations').get().n,0);
  }
  time+=60000;
  const third=await runScheduledCompanyBankSync(),thirdDispatched=third.results.filter(result=>result.stage!=='discovery');
  assert.equal(thirdDispatched.length,100);
  assert.equal(thirdDispatched[0].companyId,'synthetic-company-099');
  assert.ok(thirdDispatched.every(result=>result.status==='success'&&result.imported===0));

  // A long-lived embargo or held generation must not monopolize all 100
  // dispatch slots while another company's account is ready to run.
  for(let index=0;index<98;index++)healthy[index].db.prepare("UPDATE company_bank_sync_jobs SET status='retry',next_attempt_at=?,last_attempt_at=?").run(time+86400000,time-120000);
  healthy[98].db.prepare("UPDATE company_bank_sync_jobs SET status='running',lease_token='synthetic-other-worker',lease_until=?,lease_deadline=?").run(time+240000,time+240000);
  healthy[99].db.prepare("UPDATE company_bank_sync_jobs SET status='blocked',retry_blocked=1,error_code='AUTHORIZATION_CHANGED',last_attempt_at=?").run(time-120000);
  const unknownBefore=healthy[97].db.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n;
  healthy[97].db.prepare("UPDATE company_bank_sync_jobs SET status='blocked',retry_blocked=2,error_code='RETRY_AFTER_UNKNOWN',next_attempt_at=0").run();
  healthy[97].context.revision=2;healthy[97].context.generation='generation-2';
  time+=60000;
  const readyOnly=(await runScheduledCompanyBankSync()).results.filter(result=>result.stage!=='discovery');
  assert.equal(readyOnly.length,1);assert.equal(readyOnly[0].companyId,'synthetic-company-100');assert.equal(readyOnly[0].status,'success');
  assert.equal(healthy[97].db.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n,unknownBefore);
  assert.ok(healthy[97].db.prepare('SELECT retry_blocked FROM company_bank_sync_jobs').get().retry_blocked>0);
  healthy[99].context.revision=2;healthy[99].context.generation='generation-2';
  time+=60000;
  const renewed=(await runScheduledCompanyBankSync()).results.filter(result=>result.stage!=='discovery');
  assert.equal(renewed.length,2);assert.equal(renewed[0].companyId,'synthetic-company-099');
  assert.ok(renewed.every(result=>result.status==='success'&&result.imported===0));
 }finally{unregisterAll();for(const db of databases)db.close();rmSync(directory,{recursive:true,force:true});}
});
