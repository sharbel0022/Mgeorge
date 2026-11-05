import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {digest,encryptObject} from '../src/security.js';
import {storeDocument} from '../src/db.js';

// Real loopback HTTP and SQLite; every provider response is synthetic.
const folder=mkdtempSync(join(tmpdir(),'mg-session-fence-'));
const origin='https://mg.session.test',password='synthetic-session-test-password';
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:origin,DB_PATH:join(folder,'db.sqlite'),SESSION_SECRET:'6'.repeat(64),BANK_DATA_KEY:'7'.repeat(64),MG_ADMIN_PASSWORD:password,GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',GMAIL_ACCOUNT:'synthetic@example.test',ENABLE_BANKING_APPLICATION_ID:'session-test',ENABLE_BANKING_ENVIRONMENT:'SANDBOX'});
for(const key of ['ENCRYPTION_KEY','ENABLEBANKING_APP_ID','ENABLEBANKING_PRIVATE_KEY_FILE','ENABLEBANKING_ENVIRONMENT','ENABLE_BANKING_PRIVATE_KEY_FILE'])delete process.env[key];
process.env.ENABLE_BANKING_PRIVATE_KEY=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
const {server,db}=await import('../src/server.js');
const base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const realFetch=globalThis.fetch;
const barriers=new Map();
server.on('request',req=>{
  const reached=barriers.get(req.headers['x-test-body-barrier']);
  if(reached)req.once('data',reached);
});
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function startRequest(path,method,session,headers={}){
  let req;
  const response=new Promise((resolve,reject)=>{
    req=request(base+path,{method,headers:{Host:'mg.session.test',Origin:origin,'Content-Type':'application/json',...(session?{Cookie:session}:{}),...headers}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{
        const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,body:text?JSON.parse(text):null,cookie:res.headers['set-cookie']?.[0].split(';')[0]});
      });
    });req.on('error',reject);
  });
  return {req,response};
}
async function call(path,method='POST',body={},session=''){
  const serialized=JSON.stringify(body);
  const {req,response}=startRequest(path,method,session,{'Content-Length':Buffer.byteLength(serialized)});req.end(serialized);return response;
}
async function login(){const result=await call('/api/login','POST',{password});assert.equal(result.status,200);return result.cookie;}
async function pendingBody(path,method,body,session){
  const id=randomUUID(),reached=deferred();barriers.set(id,reached.resolve);
  const pending=startRequest(path,method,session,{'x-test-body-barrier':id,'Transfer-Encoding':'chunked'});
  pending.req.write('{');await reached.promise;barriers.delete(id);
  return {response:pending.response,finish:()=>pending.req.end(JSON.stringify(body).slice(1))};
}
const tables=['invoices','bank_transactions','allocations','documents','document_sources','import_jobs','app_settings','audit_events','bank_connections','gmail_connections','verified_contacts','payer_links','customer_messages','message_reviews','message_approvals','message_deliveries','gmail_rejected_sources'];
function snapshot(){return Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));}
function seed(){
  db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('invoice','customer','SESSION-1','Synthetic AB',10000);
  db.prepare('INSERT INTO bank_transactions(id,fingerprint,account,booked_at,amount_cents,payer) VALUES(?,?,?,?,?,?)').run('transaction','synthetic-fingerprint','synthetic-account','2026-10-26',10000,'Synthetic AB');
  db.prepare('INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES(?,?,?,?)').run('allocation','invoice','transaction',100);
  const doc=storeDocument(db,{name:'synthetic.pdf',mime_type:'application/pdf',bytes:Buffer.from('%PDF-synthetic')});
  db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,selected_account_uid) VALUES(?,?,?,?,?,?,?,?)').run('bank','enablebanking','Swedbank',encryptObject({session_id:'synthetic-consent'}),encryptObject([{uid:'account',currency:'SEK',usage:'ORGA',account_id:{iban:'SE0000000000000000000000'}}]),'2099-01-01T00:00:00Z','administrator','account');
  db.prepare('INSERT INTO gmail_connections(id,email,encrypted_tokens) VALUES(?,?,?)').run('gmail',process.env.GMAIL_ACCOUNT,encryptObject({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Date.now()+3600000,scope:'https://www.googleapis.com/auth/gmail.readonly'}));
  return doc.id;
}
const documentId=seed();
let providerHandler;
globalThis.fetch=async(url,options)=>{
  assert.ok(providerHandler,'Unexpected external request');return providerHandler(new URL(url),options);
};
after(async()=>{globalThis.fetch=realFetch;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(folder,{recursive:true,force:true});});

test('logout while a protected JSON body is pending blocks every body-consuming route',async t=>{
  const invoice={direction:'customer',invoice_number:'SESSION-NEW',party:'Synthetic New AB',total_cents:1000};
  const cases=[
    ['settings','PATCH','/api/settings',{company_name:'Unauthorized change'}],
    ['create invoice','POST','/api/invoices',invoice],
    ['patch invoice','PATCH','/api/invoices',{id:'invoice',note:'Unauthorized change'}],
    ['create bank transaction','POST','/api/bank-transactions',{account:'other',booked_at:'2026-10-26',amount_cents:1000,payer:'Synthetic AB'}],
    ['patch bank transaction','PATCH','/api/bank-transactions',{id:'transaction',excluded:false}],
    ['import preview','POST','/api/import/preview',{}],
    ['import commit','POST','/api/import/commit',{confirm:true,name:'synthetic.csv',content_base64:Buffer.from('Datum;Belopp;Referens\n2026-10-26;10,00;synthetic').toString('base64')}],
    ['upload original','POST','/api/documents',{name:'new.pdf',content_base64:Buffer.from('%PDF-new-synthetic').toString('base64'),invoice_id:'invoice'}],
    ['patch original','PATCH','/api/documents',{id:documentId,status:'dismissed',reason:'Synthetic reason'}],
    ['analyze original','POST',`/api/documents/${documentId}/analyze`,{}],
    ['register original','POST',`/api/documents/${documentId}/approve`,{confirm:true}],
    ['create allocation','POST','/api/allocations',{confirm:true,invoice_id:'invoice',transaction_id:'transaction',amount_cents:100}],
    ['delete allocation','DELETE','/api/allocations',{id:'allocation'}],
    ['verify contact','POST','/api/customer-contacts',{}],
    ['verify payer','POST','/api/payer-links',{}],
    ['review message','POST','/api/customer-messages/unknown/review',{}],
    ['start control','POST','/api/payment-control/run',{request_id:'session_pending_body_001'}],
    ['link specification','POST','/api/bank-specification-links',{}],
    ['revoke specification','POST','/api/bank-specification-links/unknown/revoke',{}],
    ['start bank consent','POST','/api/bank/connect',{}],
    ['select bank account','POST','/api/bank/accounts',{connection_id:'bank',account_uid:'account'}],
    ['sync bank','POST','/api/bank/sync',{connection_id:'bank'}],
    ['disconnect bank','DELETE','/api/bank/connections',{id:'bank'}],
    ['start Gmail consent','POST','/api/gmail/connect',{}]
  ];
  for(const [name,method,path,body] of cases)await t.test(name,async()=>{
    const cookie=await login(),before=snapshot();let calls=0;
    providerHandler=async()=>{calls++;throw Error('Provider must not be reached after logout');};
    const pending=await pendingBody(path,method,body,cookie);
    assert.equal((await call('/api/logout','POST',{},cookie)).status,200);
    pending.finish();const result=await pending.response;
    assert.equal(result.status,401,JSON.stringify(result.body));
    assert.equal(calls,0);assert.deepEqual(snapshot(),before);
  });
});

test('expiry while a protected body is pending blocks writes without a logout request',async()=>{
  const cookie=await login(),before=snapshot();
  const pending=await pendingBody('/api/invoices','POST',{direction:'customer',invoice_number:'EXPIRED',party:'Synthetic AB',total_cents:1000},cookie);
  db.prepare('UPDATE sessions SET expires_at=0 WHERE id_hash=?').run(digest(cookie.slice('mg_session='.length)));
  pending.finish();assert.equal((await pending.response).status,401);assert.deepEqual(snapshot(),before);
});

test('live sessions accept streamed mutations and successful login resets serial failures',async()=>{
  for(let i=0;i<4;i++)assert.equal((await call('/api/login','POST',{password:'wrong'})).status,401);
  const cookie=await login();
  const pending=await pendingBody('/api/settings','PATCH',{company_name:'Synthetic Session Company'},cookie);
  pending.finish();assert.equal((await pending.response).status,200);
  assert.equal((await call('/api/login','POST',{password:'wrong'})).status,401);
  await login();
});

test('logout while providers are pending blocks later writes and consent effects',async t=>{
  const cases=[
    ['bank application lookup','/api/bank/connect','POST',{},'/application',false],
    ['bank discovery','/api/bank/connect','POST',{},'/aspsps',false],
    ['bank verification','/api/bank/sync','POST',{connection_id:'bank'},'/sessions/synthetic-consent',false],
    ['bank verification failure','/api/bank/sync','POST',{connection_id:'bank'},'/sessions/synthetic-consent',true],
    ['bank fetch failure','/api/bank/sync','POST',{connection_id:'bank'},'/accounts/account/transactions',true],
    ['bank fetch success','/api/bank/sync','POST',{connection_id:'bank'},'/accounts/account/transactions',false],
    ['bank selection verification failure','/api/bank/accounts','POST',{connection_id:'bank',account_uid:'account'},'/sessions/synthetic-consent',true],
    ['bank selection initial fetch','/api/bank/accounts','POST',{connection_id:'bank',account_uid:'account'},'/accounts/account/transactions',false],
    ['bank disconnect','/api/bank/connections','DELETE',{id:'bank'},'/sessions/synthetic-consent',false],
    ['Gmail fetch success','/api/gmail/sync','POST',{},'/gmail/v1/users/me/messages',false],
    ['Gmail fetch failure','/api/gmail/sync','POST',{},'/gmail/v1/users/me/messages',true],
    ['Gmail disconnect','/api/gmail/connection','DELETE',{},'/revoke',false]
  ];
  for(const [name,path,method,body,pausePath,fail] of cases)await t.test(name,async()=>{
    const cookie=await login(),reached=deferred(),release=deferred(),calls=[];
    providerHandler=async(url,options)=>{
      calls.push([url.pathname,options.method]);
      if(url.pathname===pausePath){reached.resolve();await release.promise;if(fail)return Response.json({error:'SYNTHETIC_PROVIDER_FAILURE'},{status:502});}
      if(url.pathname==='/application')return Response.json({kid:'session-test',environment:'SANDBOX',active:true,countries:['SE'],services:['AIS'],redirect_urls:[origin+'/api/bank/callback']});
      if(url.pathname==='/aspsps')return Response.json({aspsps:[{name:'Swedbank',country:'SE',psu_types:['business'],maximum_consent_validity:86400}]});
      if(url.pathname==='/auth')return Response.json({url:'https://auth.enablebanking.com/ais/start?sessionid=synthetic'});
      if(url.pathname.startsWith('/sessions/'))return options.method==='DELETE'?new Response(null,{status:204}):Response.json({status:'AUTHORIZED',accounts:['account'],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:'2099-01-01T00:00:00Z'}});
      if(url.pathname.endsWith('/transactions'))return Response.json({transactions:[]});
      if(url.pathname.endsWith('/profile'))return Response.json({emailAddress:process.env.GMAIL_ACCOUNT});
      if(url.pathname.endsWith('/messages'))return Response.json({messages:[]});
      if(url.pathname==='/revoke')return new Response('');
      throw Error('Unexpected synthetic provider endpoint '+url.pathname);
    };
    const pending=call(path,method,body,cookie);await reached.promise;
    // Account selection may make its authorized, synchronous selection before
    // starting initial retrieval. Compare against the state at the actual wait.
    const before=snapshot();
    assert.equal((await call('/api/logout','POST',{},cookie)).status,200);
    release.resolve();const result=await pending;
    assert.equal(result.status,401,JSON.stringify(result.body));
    assert.deepEqual(snapshot(),before);
    if(path==='/api/bank/connect'){
      assert.equal(calls.some(([endpoint])=>endpoint==='/auth'),false);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_states').get().n,0);
      if(pausePath==='/application')assert.equal(calls.length,1);
    }
    if(name==='bank verification')assert.equal(calls.length,1);
  });
});

test('Gmail OAuth stops after code exchange when the initiating session logs out',async()=>{
  const cookie=await login();
  const start=await call('/api/gmail/connect','POST',{},cookie);assert.equal(start.status,200);
  const state=new URL(start.body.url).searchParams.get('state'),reached=deferred(),release=deferred(),calls=[];
  providerHandler=async(url)=>{
    calls.push(url.pathname);
    if(url.pathname==='/token'){reached.resolve();await release.promise;return Response.json({access_token:'synthetic-oauth',refresh_token:'synthetic-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.readonly'});}
    if(url.pathname.endsWith('/profile'))return Response.json({emailAddress:process.env.GMAIL_ACCOUNT});
    throw Error('Unexpected synthetic OAuth endpoint '+url.pathname);
  };
  const pending=call(`/api/gmail/callback?state=${state}&code=synthetic`,'GET',{},cookie);await reached.promise;
  const before=snapshot();assert.equal((await call('/api/logout','POST',{},cookie)).status,200);
  release.resolve();assert.equal((await pending).status,401);
  assert.deepEqual(calls,['/token']);assert.deepEqual(snapshot(),before);
});

test('logout stops provider refreshes, retries, pagination and attachment continuations',async t=>{
  const profile='/gmail/v1/users/me/profile',listing='/gmail/v1/users/me/messages',message=listing+'/message-1',attachment=message+'/attachments/part-1';
  const cases=[
    ['expired profile',profile,[profile]],
    ['expired access token','/token',['/token']],
    ['retried profile',profile,[profile,'/token',profile]],
    ['Gmail next page',listing,[profile,listing]],
    ['Gmail message',message,[profile,listing,message]],
    ['Gmail attachment',attachment,[profile,listing,message,attachment]],
    ['bank next page','/accounts/account/transactions',['/sessions/synthetic-consent','/accounts/account/transactions']]
  ];
  for(const [name,pausePath,expected] of cases)await t.test(name,async()=>{
    const cookie=await login(),reached=deferred(),release=deferred(),calls=[];let profileCalls=0;
    // The previous independent disconnect/logout case now correctly leaves a
    // durable revocation_pending fence. This pagination case starts with its
    // own authorized synthetic connection rather than bypassing that fence.
    if(name==='bank next page')db.prepare("UPDATE bank_connections SET status='connected',last_error='' WHERE id='bank'").run();
    db.prepare('UPDATE gmail_connections SET encrypted_tokens=? WHERE id=?').run(encryptObject({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:name==='expired access token'?0:Date.now()+3600000,scope:'https://www.googleapis.com/auth/gmail.readonly'}),'gmail');
    providerHandler=async(url)=>{
      calls.push(url.pathname);if(url.pathname===profile)profileCalls++;
      if(url.pathname===pausePath&&(name!=='retried profile'||profileCalls===2)){reached.resolve();await release.promise;}
      if(url.pathname===profile){
        if(name==='expired profile'||name==='retried profile'&&profileCalls===1)return Response.json({error:'expired'},{status:401});
        return Response.json({emailAddress:process.env.GMAIL_ACCOUNT});
      }
      if(url.pathname==='/token')return Response.json({access_token:'synthetic-refreshed',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.readonly'});
      if(url.pathname===listing)return Response.json(name==='Gmail next page'?url.searchParams.has('pageToken')?{messages:[]}:{messages:[],nextPageToken:'synthetic-next'}:{messages:[{id:'message-1'}]});
      if(url.pathname===message)return Response.json({id:'message-1',labelIds:[],internalDate:'0',payload:{headers:[],parts:[1,2].map(id=>({partId:String(id),filename:`synthetic-${id}.pdf`,mimeType:'application/pdf',body:{attachmentId:`part-${id}`,size:100}}))}});
      if(url.pathname.includes('/attachments/'))return Response.json({data:Buffer.from('%PDF-synthetic').toString('base64url')});
      if(url.pathname.startsWith('/sessions/'))return Response.json({status:'AUTHORIZED',accounts:['account'],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:'2099-01-01T00:00:00Z'}});
      if(url.pathname.endsWith('/transactions'))return Response.json(url.searchParams.has('continuation_key')?{transactions:[]}:{transactions:[],continuation_key:'synthetic-next'});
      throw Error('Unexpected synthetic continuation endpoint '+url.pathname);
    };
    const pending=call(name==='bank next page'?'/api/bank/sync':'/api/gmail/sync','POST',name==='bank next page'?{connection_id:'bank'}:{},cookie);await reached.promise;
    const before=snapshot();assert.equal((await call('/api/logout','POST',{},cookie)).status,200);
    release.resolve();assert.equal((await pending).status,401);assert.deepEqual(snapshot(),before);assert.deepEqual(calls,expected);
  });
});

test('logout during message preflight stops Gmail refresh before approval or sending',async()=>{
  const cookie=await login();db.prepare('UPDATE invoices SET due_at=? WHERE id=?').run('2000-01-01','invoice');
  assert.equal((await call('/api/customer-contacts','POST',{invoice_id:'invoice',email:'synthetic-customer@example.test',evidence:'Synthetic verified contact'},cookie)).status,200);
  assert.equal((await call('/api/reconciliation','POST',{},cookie)).status,200);
  const message=db.prepare("SELECT * FROM customer_messages WHERE status='draft' LIMIT 1").get();assert.ok(message);
  db.prepare('UPDATE gmail_connections SET encrypted_tokens=? WHERE id=?').run(encryptObject({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Date.now()+3600000,scope:'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'}),'gmail');
  const review=await call(`/api/customer-messages/${message.id}/review`,'POST',{version:message.version},cookie);assert.equal(review.status,200);
  const reached=deferred(),release=deferred(),calls=[];
  providerHandler=async(url)=>{
    calls.push(url.pathname);
    if(url.pathname.endsWith('/profile')){reached.resolve();await release.promise;return Response.json({error:'expired'},{status:401});}
    if(url.pathname==='/token')return Response.json({access_token:'synthetic-refreshed',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'});
    throw Error('Unexpected synthetic message provider endpoint '+url.pathname);
  };
  const pending=call(`/api/customer-messages/${message.id}/send`,'POST',{version:message.version,review_id:review.body.review_id,approve:true},cookie);await reached.promise;
  const before=snapshot();assert.equal((await call('/api/logout','POST',{},cookie)).status,200);
  release.resolve();assert.equal((await pending).status,401);assert.deepEqual(snapshot(),before);assert.deepEqual(calls,['/gmail/v1/users/me/profile']);
});

test('concurrent streamed wrong passwords share one atomic rate-limit counter',async()=>{
  await login();
  const requests=await Promise.all(Array.from({length:6},()=>pendingBody('/api/login','POST',{password:'wrong'},'')));
  for(const pending of requests)pending.finish();
  const statuses=(await Promise.all(requests.map(pending=>pending.response))).map(result=>result.status).sort();
  assert.deepEqual(statuses,[401,401,401,401,401,429]);
  assert.equal((await call('/api/login','POST',{password})).status,429);
});
