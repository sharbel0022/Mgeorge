import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {request} from 'node:http';
import {encryptObject} from '../src/security.js';
import {createNodeCompanyBankSyncRuntime,registerCompanyBankSyncRuntime,nodeCompanyBankAccountKey} from '../src/company-bank-sync.js';

test('durably company-bound main ledger holds legacy automatic and manual bank/reconciliation paths',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'mg-company-bound-legacy-'));
 process.env.NODE_ENV='test';process.env.APP_ORIGIN='http://localhost:3000';process.env.DB_PATH=join(directory,'bound.sqlite');process.env.SESSION_SECRET='6'.repeat(64);process.env.BANK_DATA_KEY='7'.repeat(64);
 for(const name of ['ENCRYPTION_KEY','ENABLEBANKING_APP_ID','ENABLEBANKING_PRIVATE_KEY_FILE','ENABLEBANKING_ENVIRONMENT','ENABLE_BANKING_PRIVATE_KEY_FILE'])delete process.env[name];
 process.env.ENABLE_BANKING_ENVIRONMENT='SANDBOX';process.env.ENABLE_BANKING_APPLICATION_ID='synthetic-company-binding';
 process.env.ENABLE_BANKING_PRIVATE_KEY=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
 const {server,db,runScheduledSync}=await import('../src/server.js');
 const address=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address())));
 const originalFetch=globalThis.fetch;let legacyCalls=0,companyCalls=0,unregister=()=>{};
 try{
  const at=Date.now(),expires=new Date(at+86400000).toISOString(),selector={companyId:'bound-company',connectionId:'bound-connection',accountKey:nodeCompanyBankAccountKey({bank:'Swedbank',account:{account_id:{other:{identification:'SYNTHETIC-BOUND-ACCOUNT'}}}})};
  const session={status:'AUTHORIZED',accounts:['bound-uid'],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:expires,transactions:true}};
  const page={transactions:[{status:'BOOK',entry_reference:'bound-entry',booking_date:new Date(at).toISOString().slice(0,10),transaction_amount:{amount:'1.00',currency:'SEK'},credit_debit_indicator:'CRDT',debtor:{name:'Synthetic payer'}}]};
  globalThis.fetch=async url=>{legacyCalls++;return Response.json(new URL(url).pathname.startsWith('/sessions/')?session:page);};
  db.prepare('UPDATE app_settings SET data=? WHERE id=1').run(JSON.stringify({sync_interval_minutes:15,gmail_sync_interval_minutes:0}));
  db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,selected_account_uid) VALUES(?,?,?,?,?,?,?,?)').run(selector.connectionId,'enablebanking','Swedbank',encryptObject({session_id:'bound-consent'}),encryptObject([{uid:'bound-uid',currency:'SEK',account_id:{other:{identification:'SYNTHETIC-BOUND-ACCOUNT'}}}]),expires,'local-admin','bound-uid');
  const runtime=await createNodeCompanyBankSyncRuntime({db,companyId:selector.companyId,owner:'local-admin',evidenceId:'explicit-synthetic-binding',
   resolveContext:async()=>({...selector,owner:'local-admin',provider:'enablebanking',accountUid:'bound-uid',consentId:'bound-consent',generation:'1',revision:1,validUntil:expires,authorizationStatus:'VERIFIED',ratePolicy:{verified:true,evidenceId:'synthetic-policy',maxRequests:10,windowMs:86400000},bankgiroEnabled:false}),
   assertCurrent:()=>true,listJobs:async()=>[selector],providerRequest:async path=>{companyCalls++;return path.startsWith('/sessions/')?session:page;},
  });
  await runtime.store.setReferencePolicy({companyId:selector.companyId,owner:'local-admin',revision:1,companyName:'Synthetic Bound AB',mode:'invoice_number',evidenceId:'synthetic-reference-policy'});
  await runScheduledSync();assert.equal(legacyCalls,0);assert.equal(companyCalls,0);
  unregister=registerCompanyBankSyncRuntime(runtime);await runScheduledSync();
  assert.equal(companyCalls,4);assert.equal(legacyCalls,0);assert.equal(db.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);
  unregister();await runScheduledSync();assert.equal(legacyCalls,0);assert.equal(companyCalls,4);
  const post=(path,body={})=>new Promise((resolve,reject)=>{
   const data=JSON.stringify(body),req=request({hostname:'127.0.0.1',port:address.port,path,method:'POST',headers:{Host:'localhost:3000',Origin:'http://localhost:3000','Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));});req.on('error',reject);req.end(data);
  });
  for(const [path,body] of [['/api/bank/sync',{connection_id:selector.connectionId}],['/api/bank/accounts',{connection_id:selector.connectionId,account_uid:'bound-uid'}],['/api/reconciliation',{}],['/api/bankgiro/source/run',{}]]){
   const result=await post(path,body);assert.equal(result.status,409);assert.equal(result.body.code,'company_sync_required');
  }
  assert.equal(legacyCalls,0);assert.equal(db.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);
 }finally{unregister();globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));db.close();rmSync(directory,{recursive:true,force:true});}
});
