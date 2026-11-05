import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.js';
import {encryptObject} from '../src/security.js';
import {createNodeCompanyBankSyncRuntime,registerCompanyBankSyncRuntime,nodeCompanyBankAccountKey} from '../src/company-bank-sync.js';

test('existing Node scheduler reaches explicit company registration while legacy intervals are disabled',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'mg-company-scheduler-'));
 process.env.NODE_ENV='test';process.env.DB_PATH=join(directory,'legacy.sqlite');process.env.SESSION_SECRET='6'.repeat(64);process.env.BANK_DATA_KEY='7'.repeat(64);delete process.env.ENCRYPTION_KEY;
 const {server,db,runScheduledSync}=await import('../src/server.js');
 const companyDb=openDatabase(join(directory,'company.sqlite'));let unregister=()=>{};
 try{
  db.prepare('UPDATE app_settings SET data=? WHERE id=1').run(JSON.stringify({sync_interval_minutes:0,gmail_sync_interval_minutes:0}));
  const at=Date.now(),expires=new Date(at+86400000).toISOString(),selector={companyId:'scheduler-company',connectionId:'scheduler-connection',accountKey:nodeCompanyBankAccountKey({bank:'Swedbank',account:{account_id:{other:{identification:'SYNTHETIC-SCHEDULER-ACCOUNT'}}}})};
  companyDb.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,selected_account_uid) VALUES(?,?,?,?,?,?,?,?)').run(selector.connectionId,'enablebanking','Swedbank',encryptObject({session_id:'scheduler-consent'}),encryptObject([{uid:'scheduler-uid',currency:'SEK',account_id:{other:{identification:'SYNTHETIC-SCHEDULER-ACCOUNT'}}}]),expires,'scheduler-owner','scheduler-uid');
  const runtime=await createNodeCompanyBankSyncRuntime({db:companyDb,companyId:selector.companyId,owner:'scheduler-owner',evidenceId:'synthetic-storage-binding',
   resolveContext:async()=>({...selector,owner:'scheduler-owner',provider:'enablebanking',accountUid:'scheduler-uid',consentId:'scheduler-consent',generation:'1',revision:1,validUntil:expires,authorizationStatus:'VERIFIED',ratePolicy:{verified:true,evidenceId:'synthetic-policy',maxRequests:4,windowMs:86400000},bankgiroEnabled:false}),
   assertCurrent:()=>true,listJobs:async()=>[selector],
   providerRequest:async path=>path.startsWith('/sessions/')?{status:'AUTHORIZED',accounts:['scheduler-uid'],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:expires}}:{transactions:[{status:'BOOK',entry_reference:'scheduler-entry',booking_date:new Date(at).toISOString().slice(0,10),transaction_amount:{amount:'1.00',currency:'SEK'},credit_debit_indicator:'CRDT',debtor:{name:'Synthetic payer'}}]},
  });
  await runtime.store.setReferencePolicy({companyId:selector.companyId,owner:'scheduler-owner',revision:1,companyName:'Synthetic Scheduler AB',mode:'invoice_number',evidenceId:'synthetic-reference-policy'});
  await runScheduledSync();assert.equal(companyDb.prepare('SELECT count(*) n FROM bank_transactions').get().n,0);
  unregister=registerCompanyBankSyncRuntime(runtime);
  await runScheduledSync();
  assert.equal(companyDb.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);
  assert.equal(companyDb.prepare('SELECT status FROM company_bank_sync_jobs').get().status,'success');
  assert.equal(db.prepare('SELECT count(*) n FROM bank_transactions').get().n,0);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='company_bank_sync_scopes'").get().n,0);
 }finally{unregister();server.close();companyDb.close();db.close();rmSync(directory,{recursive:true,force:true});}
});
