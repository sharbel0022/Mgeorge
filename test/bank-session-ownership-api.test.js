import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {generateKeyPairSync} from 'node:crypto';
import {digest,encryptObject} from '../src/security.js';
import {storeDocument} from '../src/db.js';

const folder=mkdtempSync(join(tmpdir(),'mg-bank-session-ownership-')),origin='https://ownership.example.test';
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:origin,MG_ADMIN_PASSWORD:'synthetic-ownership-password',DB_PATH:join(folder,'legacy.sqlite'),SESSION_SECRET:'4'.repeat(64),BANK_DATA_KEY:'5'.repeat(64),MG_SAAS_ONBOARDING_ENABLED:'true',ENABLE_BANKING_APPLICATION_ID:'synthetic-app',ENABLE_BANKING_ENVIRONMENT:'SANDBOX',ENABLE_BANKING_PRIVATE_KEY:generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey});
const {server,db,companyRuntime:runtime}=await import('../src/server.js');
const port=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port))),originalFetch=globalThis.fetch;
const verification={status:'verified',evidenceId:'synthetic-proof',verifiedBy:'synthetic-operator'},future=hours=>new Date(Date.now()+hours*3600000).toISOString();
const account={uid:'synthetic-account',name:'Synthetic company account',currency:'SEK',usage:'ORGA',account_id:{iban:'SE4550000000058398257466'}};
let serial=0,current;
globalThis.fetch=async(url,init={})=>{
 const path=new URL(url).pathname;assert.equal(new URL(url).origin,'https://api.enablebanking.com');current.calls.push({path,method:init.method});
 if(path==='/application')return Response.json({kid:'synthetic-app',environment:'SANDBOX',active:true,countries:['SE'],services:['AIS'],redirect_urls:[origin+'/api/bank/callback']});
 if(path==='/aspsps')return Response.json({aspsps:[{name:'Swedbank',country:'SE',psu_types:['business'],maximum_consent_validity:86400}]});
 if(path==='/auth'){current.authorization=JSON.parse(init.body);return Response.json({url:'https://auth.enablebanking.com/ais/start?synthetic=1'});}
 if(path==='/sessions'&&init.method==='POST')return Response.json({session_id:current.newSession,accounts:[account],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:future(48),transactions:true}});
 if(path.startsWith('/sessions/')){
  if(init.method==='DELETE'){current.deletes.push(path);current.onDelete?.();return new Response(null,{status:204});}
  return Response.json({status:'AUTHORIZED',accounts:[account.uid],accounts_data:[{uid:account.uid}],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:future(36),transactions:true}});
 }
 throw Error('Unexpected synthetic bank operation');
};
after(async()=>{globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));db.close();rmSync(folder,{recursive:true,force:true});});

function fixture({shared=true}={}){
 const index=++serial,a=runtime.provisionCompany({companyId:'ownership-a-'+index,name:'Synthetic A',actorId:'alice-'+index,verification}),b=runtime.provisionCompany({companyId:'ownership-b-'+index,name:'Synthetic B',actorId:'ben-'+index,verification});
 const f={a,b,calls:[],deletes:[],oldSession:'synthetic-session-b-'+index,newSession:'synthetic-new-session-'+index};current=f;
 for(const context of [a,b])runtime.run(context,()=>{
  const remote=context===a&& !shared?'synthetic-session-a-'+index:f.oldSession;
  db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,status,selected_account_uid) VALUES(?,?,?,?,?,?,?,?,?)').run('same-connection-id','enablebanking','Swedbank',encryptObject({session_id:remote}),encryptObject([account]),future(48),context.storageOwner,'connected',account.uid);
  db.prepare("INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES('invoice','customer','00031','Synthetic retained company',62500)").run();
  db.prepare("INSERT INTO bank_transactions(id,fingerprint,account,booked_at,amount_cents) VALUES('payment','synthetic-payment','synthetic-account','2026-11-04',62500)").run();
  db.prepare("INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES('allocation','invoice','payment',12500)").run();
  storeDocument(db,{name:'synthetic.txt',mime_type:'text/plain',bytes:Buffer.from('SYNTHETIC RETAINED ORIGINAL'),invoice_id:'invoice'});
 });
 const names=['invoices','bank_transactions','allocations','documents','bank_provider_connections','bank_provider_grant_claims'];
 f.financial=context=>runtime.run(context,()=>Object.fromEntries(names.map(name=>[name,db.prepare('SELECT * FROM '+name).all()])));
 f.rows=context=>runtime.run(context,()=>db.prepare('SELECT * FROM bank_connections').all());
 f.beforeA=f.rows(a);f.beforeB=f.rows(b);f.financialA=f.financial(a);f.financialB=f.financial(b);
 f.call=(path,method='GET',body)=>new Promise((resolve,reject)=>{
  const session='synthetic-ownership-'+index;runtime.controlDb.prepare('INSERT OR REPLACE INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)').run(digest(session),Date.now()+600000,b.actorId);
  const bytes=body===undefined?undefined:JSON.stringify(body),req=request('http://127.0.0.1:'+port+path,{method,headers:{Host:'ownership.example.test',Cookie:'mg_session='+session,'X-Company-Id':b.companyId,'X-Company-Context-Version':String(b.contextVersion),...(bytes?{Origin:origin,'Content-Type':'application/json','Content-Length':Buffer.byteLength(bytes)}:{})}},res=>{const chunks=[];res.on('data',part=>chunks.push(part));res.on('end',()=>{let body;try{body=JSON.parse(Buffer.concat(chunks));}catch{}resolve({status:res.statusCode,body,headers:res.headers});});});req.on('error',reject);req.end(bytes);
 });
 f.assertFinancial=()=>{assert.deepEqual(f.financial(a),f.financialA);assert.deepEqual(f.financial(b),f.financialB);};
 return f;
}

test('physical company B cannot disconnect a legacy session still retained by A with the same connection id',async()=>{
 const f=fixture(),r=await f.call('/api/bank/connections','DELETE',{id:'same-connection-id'});
 assert.equal(r.status,409);assert.equal(r.body.code,'BANK_SESSION_REVIEW_REQUIRED');assert.deepEqual(f.deletes,[]);
 assert.deepEqual(f.rows(f.a),f.beforeA);const row=f.rows(f.b)[0];assert.equal(row.status,'revocation_pending');assert.equal(row.encrypted_session,f.beforeB[0].encrypted_session);assert.equal(row.accounts_json,f.beforeB[0].accounts_json);f.assertFinancial();
});

test('owned renewal cannot delete a previous session retained by another physical company',async()=>{
 const f=fixture();process.env.BANK_COMPANY_AUTHORIZATIONS=JSON.stringify({version:1,bindings:[{companyId:f.b.companyId,storageOwnerId:f.b.storageOwner,provider:'enablebanking',bankName:'Swedbank',country:'SE',accountKeys:['iban:'+account.account_id.iban],status:'active',origin:'bank',evidenceId:'synthetic-bank-proof',checkedAt:new Date(Date.now()-1000).toISOString(),validUntil:future(72)}]});
 const started=await f.call('/api/bank/connect','POST',{renew_connection_id:'same-connection-id'});assert.equal(started.status,200,JSON.stringify(started.body));
 const result=await f.call('/api/bank/callback?'+new URLSearchParams({state:f.authorization.state,code:'synthetic-code'}));
 assert.equal(result.status,409);assert.equal(result.body.code,'BANK_SESSION_REVIEW_REQUIRED');assert.deepEqual(f.deletes,[]);assert.deepEqual(f.rows(f.a),f.beforeA);
 const row=f.rows(f.b)[0];assert.equal(row.status,'revocation_pending');assert.equal(row.encrypted_session,f.beforeB[0].encrypted_session);assert.equal(row.accounts_json,f.beforeB[0].accounts_json);f.assertFinancial();
});

test('intentional distinct-session disconnect retains its owned row during DELETE and preserves other companies',async()=>{
 const f=fixture({shared:false});let retained=false;f.onDelete=()=>{retained=db.prepare('SELECT encrypted_session FROM bank_connections WHERE id=?').get('same-connection-id')?.encrypted_session===f.beforeB[0].encrypted_session;};
 const result=await f.call('/api/bank/connections','DELETE',{id:'same-connection-id'});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(retained,true);assert.deepEqual(f.deletes,['/sessions/'+f.oldSession]);assert.equal(f.rows(f.b).length,0);assert.deepEqual(f.rows(f.a),f.beforeA);f.assertFinancial();
});

test('current-row exception is exact, authenticated and cannot exclude another namespace or unknown session',()=>{
 const f=fixture({shared:false});
 runtime.run(f.b,()=>{
  assert.equal(runtime.retainedBankSessionInUse(f.oldSession),true);
  assert.equal(runtime.retainedBankSessionInUse(f.oldSession,'same-connection-id'),false);
  for(const exception of ['unknown',{id:'same-connection-id',owner:f.a.storageOwner,companyId:f.a.companyId}])assert.equal(runtime.retainedBankSessionInUse(f.oldSession,exception),true);
  assert.equal(runtime.retainedBankSessionInUse('different-remote-session','same-connection-id'),true);
 });
 assert.throws(()=>runtime.retainedBankSessionInUse(f.oldSession,'same-connection-id'),{code:'company_access_denied'});
 runtime.setMembership({companyId:f.b.companyId,actorId:'synthetic-review-viewer',role:'viewer'});
 const viewer=runtime.resolve({actorId:'synthetic-review-viewer'});runtime.run(viewer,()=>assert.throws(()=>runtime.retainedBankSessionInUse(f.oldSession,'same-connection-id'),{code:'company_permission_denied'}));
});

test('corrupt foreign ownership and suspended retained companies cannot authorize a session DELETE',async()=>{
 for(const damage of ['suspended','foreign owner','ciphertext']){
  const f=fixture({shared:damage==='suspended'});
  if(damage==='foreign owner')runtime.run(f.a,()=>db.prepare('UPDATE bank_connections SET owner=?').run('synthetic-foreign-owner'));
  else if(damage==='ciphertext')runtime.run(f.a,()=>db.prepare('UPDATE bank_connections SET encrypted_session=?').run('synthetic-corrupt-ciphertext'));
  else runtime.controlDb.prepare('UPDATE companies SET status=? WHERE company_id=?').run('suspended',f.a.companyId);
  const retained=f.rows(f.b)[0],result=await f.call('/api/bank/connections','DELETE',{id:'same-connection-id'});assert.equal(result.status,409);assert.deepEqual(f.deletes,[]);assert.equal(f.rows(f.b)[0].encrypted_session,retained.encrypted_session);
  // Each independent damage must be the reason for denial; a prior corrupt
  // fixture must not mask a later ciphertext case in the global probe.
  if(damage!=='suspended')runtime.run(f.a,()=>db.prepare('UPDATE bank_connections SET owner=?,encrypted_session=?').run(f.beforeA[0].owner,f.beforeA[0].encrypted_session));
 }
});
