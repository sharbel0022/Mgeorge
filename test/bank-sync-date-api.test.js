import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {encryptObject,decryptObject} from '../src/security.js';

// Only a temporary SQLite database and generated credentials are used here.
const folder=mkdtempSync(join(tmpdir(),'mg-bank-sync-dates-'));
process.env.NODE_ENV='test';process.env.APP_ORIGIN='http://localhost:3000';
process.env.DB_PATH=join(folder,'db.sqlite');process.env.SESSION_SECRET='6'.repeat(64);process.env.BANK_DATA_KEY='7'.repeat(64);
for(const name of ['ENCRYPTION_KEY','ENABLEBANKING_APP_ID','ENABLEBANKING_PRIVATE_KEY_FILE','ENABLEBANKING_ENVIRONMENT','ENABLE_BANKING_PRIVATE_KEY_FILE'])delete process.env[name];
process.env.ENABLE_BANKING_ENVIRONMENT='SANDBOX';process.env.ENABLE_BANKING_APPLICATION_ID='synthetic-sync-dates';
process.env.ENABLE_BANKING_PRIVATE_KEY=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
const {server,db,runScheduledSync}=await import('../src/server.js');
const base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const originalFetch=globalThis.fetch;
const connectionId='synthetic-date-connection',accountNumber='SYNTHETIC-ACCOUNT-UTC';
const account={uid:'account',name:'Synthetic date account',currency:'SEK',usage:'ORGA',account_id:{other:{identification:accountNumber}}};
let provider,verifyProvider,requests,calls,cookie='';
const transaction=(id,date,extra={})=>({status:'BOOK',entry_reference:id,transaction_id:'lookup-'+id,booking_date:date,transaction_amount:{amount:'125.00',currency:'SEK'},credit_debit_indicator:'CRDT',debtor:{name:'Synthetic payer AB'},reference_number:'SYNTHETIC-REF',...extra});
const liveSession=(extra={})=>({status:'AUTHORIZED',accounts:['account'],accounts_data:[{uid:'account'}],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:'2099-01-01T00:00:00Z'},created:'2026-01-01T00:00:00Z',...extra});
globalThis.fetch=async(url,options)=>{
  const target=new URL(url);assert.equal(target.origin,'https://api.enablebanking.com');calls++;
  if(target.pathname.startsWith('/sessions/'))return verifyProvider?verifyProvider(target,options):Response.json(liveSession());
  assert.equal(target.pathname,'/accounts/account/transactions');
  requests.push([target.searchParams.get('date_from'),target.searchParams.get('date_to'),target.searchParams.get('continuation_key')]);
  return provider(target,options);
};
beforeEach(()=>{
  db.exec('DELETE FROM bank_transactions; DELETE FROM bank_connections; DELETE FROM integration_jobs; DELETE FROM import_jobs; DELETE FROM audit_events; DELETE FROM sessions;');
  db.prepare('UPDATE app_settings SET data=? WHERE id=1').run(JSON.stringify({sync_interval_minutes:15,gmail_sync_interval_minutes:0}));
  db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,status,selected_account_uid) VALUES(?,?,?,?,?,?,?,?,?)').run(connectionId,'enablebanking','Swedbank',encryptObject({session_id:'synthetic-private-session'}),encryptObject([account]),'2099-01-01T00:00:00Z','local-admin','connected','account');
  provider=async()=>Response.json({transactions:[]});verifyProvider=null;requests=[];calls=0;cookie='';
});
after(async()=>{globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));db.close();rmSync(folder,{recursive:true,force:true});});
async function call(path,body){
  return new Promise((resolve,reject)=>{
    const text=body===undefined?'':JSON.stringify(body);
    const req=request(base+path,{method:body===undefined?'GET':'POST',headers:{Host:'localhost:3000',...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{Origin:process.env.APP_ORIGIN,'Content-Type':'application/json','Content-Length':Buffer.byteLength(text)})}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString()),headers:res.headers});});
    });req.on('error',reject);req.end(text);
  });
}
const sync=body=>call('/api/bank/sync',{connection_id:connectionId,...body});
const stored=()=>db.prepare('SELECT * FROM bank_connections WHERE id=?').get(connectionId);
const freeze=(t,iso='2026-11-02T10:00:00Z')=>t.mock.timers.enable({apis:['Date'],now:new Date(iso)});
async function retainedHistory(){
  provider=async()=>Response.json({transactions:[transaction('retained-original','2026-10-15')]});
  const result=await sync({date_from:'2026-10-01',date_to:'2026-11-02'});
  assert.equal(result.status,200);assert.equal(result.body.imported,1);
  const before={connection:stored(),transactions:db.prepare('SELECT * FROM bank_transactions ORDER BY id').all()};
  requests=[];calls=0;
  return before;
}
function assertHistoryUnchanged(before){
  assert.equal(stored().encrypted_session,before.connection.encrypted_session);
  assert.equal(stored().last_synced,before.connection.last_synced);
  assert.equal(stored().selected_account_uid,before.connection.selected_account_uid);
  assert.deepEqual(db.prepare('SELECT * FROM bank_transactions ORDER BY id').all(),before.transactions);
}

for(const [name,patch] of [
  ['has expired',{access:{valid_until:'2026-11-02T09:59:00Z'}}],
  ['expires at this instant',{access:{valid_until:'2026-11-02T10:00:00Z'}}],
  ['has an invalid expiry',{access:{valid_until:'not-a-date'}}],
  ['has no access expiry',{access:undefined}],
  ['belongs to another bank',{aspsp:{name:'Another synthetic bank',country:'SE'}}],
  ['belongs to another country',{aspsp:{name:'Swedbank',country:'FI'}}],
  ['has no bank scope',{aspsp:undefined}],
  ['is personal',{psu_type:'personal'}],
  ['has no customer type',{psu_type:undefined}],
])test(`live consent that ${name} blocks transaction reads and preserves retained history`,async t=>{
  freeze(t);const before=await retainedHistory();
  verifyProvider=async()=>Response.json(liveSession(patch));
  provider=async()=>Response.json({transactions:[transaction('must-not-import','2026-11-01')]});
  const result=await sync({date_from:'2026-11-01',date_to:'2026-11-02'});
  assert.equal(result.status,409);assert.equal(requests.length,0);assert.equal(calls,1);
  assert.equal(stored().status,'renewal_required');assertHistoryUnchanged(before);
});

for(const paginated of [false,true])test(`earlier live consent expiry during the ${paginated?'first paginated':'final'} response preserves originals and coverage`,async t=>{
  freeze(t);const before=await retainedHistory();
  verifyProvider=async()=>Response.json(liveSession({access:{valid_until:'2026-11-02T10:00:01Z'}}));
  provider=async()=>{
    if(requests.length>1)return Response.json({transactions:[]});
    t.mock.timers.tick(2000);
    return Response.json({transactions:[transaction('after-live-expiry','2026-11-01')],...(paginated?{continuation_key:'must-not-fetch'}:{})});
  };
  const result=await sync({date_from:'2026-11-01',date_to:'2026-11-02'});
  assert.equal(result.status,409);assert.equal(requests.length,1);
  assert.equal(stored().status,'renewal_required');assertHistoryUnchanged(before);
});

test('account selection rejects an expired live consent before changing the selected account',async t=>{
  freeze(t);const before=await retainedHistory(),other={...account,uid:'other-account'};
  db.prepare('UPDATE bank_connections SET accounts_json=? WHERE id=?').run(encryptObject([account,other]),connectionId);
  verifyProvider=async()=>Response.json(liveSession({accounts:['account','other-account'],access:{valid_until:'2026-11-02T09:59:00Z'}}));
  const result=await call('/api/bank/accounts',{connection_id:connectionId,account_uid:'other-account'});
  assert.equal(result.status,409);assert.equal(requests.length,0);assert.equal(calls,1);
  assert.equal(stored().status,'renewal_required');assertHistoryUnchanged(before);
});

for(const [name,trigger] of [
  ['checkpoint write',"BEFORE UPDATE OF encrypted_session ON bank_connections"],
  ['sync audit write',"BEFORE INSERT ON audit_events WHEN NEW.action='bank_synced'"],
])test(`a failed ${name} rolls back the complete financial import and its originals`,async t=>{
  freeze(t);const before=await retainedHistory();
  const successfulAudits=()=>db.prepare("SELECT * FROM audit_events WHERE action IN ('bank_import','bank_synced') ORDER BY rowid").all(),auditBefore=successfulAudits();
  db.exec(`CREATE TRIGGER reject_bank_sync ${trigger} BEGIN SELECT RAISE(ABORT,'Synthetic sync storage failure'); END;`);
  t.after(()=>db.exec('DROP TRIGGER reject_bank_sync'));
  provider=async()=>Response.json({transactions:[transaction('must-roll-back','2026-11-01')]});
  const result=await sync({date_from:'2026-11-01',date_to:'2026-11-02'});
  assert.equal(result.status,502);assert.equal(requests.length,1);
  assertHistoryUnchanged(before);assert.deepEqual(successfulAudits(),auditBefore);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM import_jobs WHERE status='completed'").get().n,1);
});

test('live consent expiry while storing an original rolls back before committing the financial import',async t=>{
  freeze(t);const before=await retainedHistory();
  verifyProvider=async()=>Response.json(liveSession({access:{valid_until:'2026-11-02T10:00:01Z'}}));
  provider=async()=>Response.json({transactions:[transaction('expires-during-storage','2026-11-01')]});
  const prepare=db.prepare.bind(db);let advanced=false;
  t.mock.method(db,'prepare',sql=>{
    const statement=prepare(sql);
    if(sql==='UPDATE bank_transactions SET import_id=? WHERE id=?'){
      const run=statement.run.bind(statement);
      statement.run=(...args)=>{const result=run(...args);if(!advanced){advanced=true;t.mock.timers.tick(2000);}return result;};
    }
    return statement;
  });
  const result=await sync({date_from:'2026-11-01',date_to:'2026-11-02'});
  assert.equal(result.status,409);assert.equal(advanced,true);assertHistoryUnchanged(before);
  assert.equal(stored().status,'renewal_required');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='bank_synced'").get().n,1);
});

test('a committed bank import stays successful when its separate after-check fails',async t=>{
  freeze(t);await retainedHistory();
  provider=async()=>Response.json({transactions:[transaction('committed-with-warning','2026-11-01')]});
  const prepare=db.prepare.bind(db);let fail=true;
  t.mock.method(db,'prepare',sql=>{
    if(fail&&sql==='UPDATE reconciliation_findings SET active=0'){fail=false;throw Error('Synthetic after-check failure');}
    return prepare(sql);
  });
  const result=await sync({date_from:'2026-11-01',date_to:'2026-11-02'});
  assert.equal(result.status,200);assert.equal(result.body.imported,1);
  assert.equal(result.body.sync_coverage.complete,true);assert.match(result.body.warnings[0],/Efterkontrollen/);
  assert.equal(stored().status,'connected');assert.equal(stored().last_error,result.body.warnings[0]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,2);
  const job=db.prepare('SELECT * FROM integration_jobs WHERE name=?').get('bank:'+connectionId);
  assert.equal(job.failures,0);assert.equal(job.last_error,'');
  provider=async()=>Response.json({transactions:[]});
  assert.equal((await sync({date_from:'2026-11-01',date_to:'2026-11-02'})).status,200);
  assert.equal(stored().last_error,'');
});

test('a lease replaced after bank commit leaves a successful import and a durable after-check warning',async t=>{
  freeze(t);await retainedHistory();
  provider=async()=>Response.json({transactions:[transaction('committed-before-replacement','2026-11-01')]});
  const exec=db.exec.bind(db);let replaced=false;
  t.mock.method(db,'exec',sql=>{
    const result=exec(sql);
    if(!replaced&&sql==='COMMIT'&&db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='bank_synced'").get().n===2){
      replaced=true;db.prepare("UPDATE integration_jobs SET lease='synthetic-after-commit',lease_until=? WHERE name=?").run(db.prepare('SELECT lease_until FROM integration_jobs WHERE name=?').get('bank:'+connectionId).lease_until+60000,'bank:'+connectionId);
    }
    return result;
  });
  const result=await sync({date_from:'2026-11-01',date_to:'2026-11-02'});
  assert.equal(replaced,true);assert.equal(result.status,200);assert.equal(result.body.imported,1);
  assert.equal(result.body.sync_coverage.complete,true);assert.match(result.body.warnings[0],/Efterkontrollen/);
  assert.equal(stored().status,'connected');assert.equal(stored().last_error,result.body.warnings[0]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,2);
  assert.equal(db.prepare('SELECT lease FROM integration_jobs WHERE name=?').get('bank:'+connectionId).lease,'synthetic-after-commit');
});

test('bank defaults use UTC dates when Stockholm has already entered the following day',async t=>{
  freeze(t,'2026-06-01T22:30:00Z');
  const result=await sync({});assert.equal(result.status,200);
  assert.deepEqual(requests,[['2026-05-03','2026-06-01',null]]);
});

test('explicit malformed or future dates do not call the provider or advance a checkpoint',async t=>{
  freeze(t);
  const before=stored().encrypted_session;
  for(const range of [{date_from:'2026-02-30',date_to:'2026-03-01'},{date_from:'2026-11-02',date_to:'2026-11-01'},{date_from:'2026-11-01',date_to:'2026-11-03'},{date_from:false},{date_to:0}])assert.equal((await sync(range)).status,400);
  assert.equal(calls,0);assert.equal(stored().last_synced,'');assert.equal(stored().encrypted_session,before);
});

test('a historical fetch preserves the current-sync timestamp and schedules the unrequested gap',async t=>{
  freeze(t);
  db.prepare('UPDATE bank_connections SET last_synced=? WHERE id=?').run('2026-10-01T12:00:00Z',connectionId);
  assert.equal((await sync({date_from:'2026-08-01',date_to:'2026-08-31'})).status,200);
  assert.equal(stored().last_synced,'2026-10-01T12:00:00Z');
  requests=[];
  await runScheduledSync();
  assert.deepEqual(requests,[['2026-08-30','2026-11-02',null]]);
  const status=(await call('/api/bank/status')).body.connections[0];
  assert.deepEqual(status.sync_coverage,{date_from:'2026-08-01',date_to:'2026-11-02',pending_from:'',complete:true});
});

test('a long outage recovers every UTC date without clamping away old history',async t=>{
  freeze(t);db.prepare('UPDATE bank_connections SET last_synced=? WHERE id=?').run('2026-03-01T12:00:00Z',connectionId);
  await runScheduledSync();
  assert.deepEqual(requests,[['2026-02-28','2026-05-28',null],['2026-05-29','2026-08-26',null],['2026-08-27','2026-11-02',null]]);
  assert.equal((await call('/api/bank/status')).body.connections[0].sync_coverage.date_to,'2026-11-02');
});

test('a later-window rate limit preserves every transaction and the old coverage across restart',async t=>{
  freeze(t);db.prepare('UPDATE bank_connections SET last_synced=? WHERE id=?').run('2026-03-01T12:00:00Z',connectionId);
  const before=stored().encrypted_session;
  provider=async()=>requests.length===1?Response.json({transactions:[transaction('first-window','2026-04-01')]}):Response.json({error:'ASPSP_RATE_LIMIT_EXCEEDED'},{status:429,headers:{'Retry-After':'172800'}});
  const result=await sync({});assert.equal(result.status,429);assert.equal(result.headers['retry-after'],'172800');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bank_transactions').get().n,0);
  assert.equal(stored().encrypted_session,before);assert.equal(stored().last_synced,'2026-03-01T12:00:00Z');
  const count=calls;assert.equal((await sync({})).status,429);assert.equal(calls,count);
  const restarted=await import('../src/server.js?bank-date-retry-restart');
  try{await restarted.runScheduledSync();assert.equal(calls,count);}finally{restarted.db.close();}
});

test('complete historical coverage survives restart and resumes with an overlap',async t=>{
  freeze(t);
  assert.equal((await sync({date_from:'2026-10-01',date_to:'2026-10-10'})).status,200);
  const session=decryptObject(stored().encrypted_session);assert.equal(session.session_id,'synthetic-private-session');assert.ok(session.sync_coverage);
  const text=JSON.stringify((await call('/api/bank/status')).body);
  assert.ok(!text.includes('synthetic-private-session'));assert.ok(!text.includes('accounts":{'));assert.ok(!text.includes(accountNumber));
  requests=[];
  const restarted=await import('../src/server.js?bank-date-coverage-restart');
  try{await restarted.runScheduledSync();}finally{restarted.db.close();}
  assert.deepEqual(requests,[['2026-10-09','2026-11-02',null]]);
});

for(const [name,extra] of [
  ['zero-valued booked row',{transaction_amount:{amount:'0.00',currency:'SEK'}}],
  ['row outside the requested dates',{booking_date:'2026-10-31'}]
])test(`${name} cannot silently mark the requested interval complete`,async t=>{
  freeze(t);const before=stored().encrypted_session;
  provider=async()=>Response.json({transactions:[transaction('valid-row','2026-11-01'),transaction('skipped-row','2026-11-02',extra)]});
  assert.equal((await sync({date_from:'2026-11-01',date_to:'2026-11-02'})).status,502);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bank_transactions').get().n,0);
  assert.equal(stored().encrypted_session,before);assert.equal(stored().last_synced,'');
});

test('history without an immutable entry reference retains the original without inventing an ID',async t=>{
  freeze(t);provider=async()=>Response.json({transactions:[transaction('historical','2026-10-01',{entry_reference:undefined})]});
  const result=await sync({date_from:'2026-10-01',date_to:'2026-10-01'});assert.equal(result.status,200);assert.equal(result.body.imported,1);
  const row=db.prepare('SELECT bank_reference,provider_transaction_id,needs_review,raw_bank_data FROM bank_transactions').get();
  assert.equal(row.bank_reference,'');assert.equal(row.provider_transaction_id,'lookup-historical');assert.equal(row.needs_review,1);assert.equal(JSON.parse(row.raw_bank_data).transaction_id,'lookup-historical');
});

test('a replaced bank lease discards the pending response and preserves the replacement',async t=>{
  freeze(t);let reach,release;
  const reached=new Promise(resolve=>{reach=resolve;}),wait=new Promise(resolve=>{release=resolve;});
  provider=async()=>{reach();await wait;return Response.json({transactions:[transaction('delayed','2026-11-01')]});};
  const before=stored().encrypted_session,pending=sync({date_from:'2026-11-01',date_to:'2026-11-02'});
  await reached;
  db.prepare("UPDATE integration_jobs SET lease='synthetic-replacement',lease_until=? WHERE name=?").run(Date.now()+60000,'bank:'+connectionId);
  release();assert.equal((await pending).status,409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bank_transactions').get().n,0);assert.equal(stored().encrypted_session,before);
  assert.equal(db.prepare('SELECT lease FROM integration_jobs WHERE name=?').get('bank:'+connectionId).lease,'synthetic-replacement');
});

test('consent expiry between pages stops continuation and leaves the checkpoint unchanged',async t=>{
  freeze(t);db.prepare('UPDATE bank_connections SET valid_until=? WHERE id=?').run('2026-11-02T10:01:00Z',connectionId);
  const before=stored().encrypted_session;
  provider=async()=>{t.mock.timers.tick(61000);return Response.json({transactions:[transaction('before-expiry','2026-11-01')],continuation_key:'after-expiry'});};
  const result=await sync({date_from:'2026-11-01',date_to:'2026-11-02'});assert.equal(result.status,409);
  assert.equal(requests.length,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bank_transactions').get().n,0);assert.equal(stored().encrypted_session,before);
});

test('a service-unavailable Retry-After persists and blocks an early manual retry',async t=>{
  freeze(t);const before=stored().encrypted_session;
  provider=async()=>new Response('Synthetic unavailable body',{status:503,headers:{'Retry-After':'172800'}});
  const result=await sync({date_from:'2026-11-01',date_to:'2026-11-02'});
  assert.equal(result.status,503);assert.equal(result.headers['retry-after'],'172800');
  assert.equal(stored().retry_after,Date.now()+172800000);assert.equal(stored().encrypted_session,before);
  const count=calls;assert.equal((await sync({})).status,429);assert.equal(calls,count);
});

test('a response crossing UTC midnight does not certify the unrequested new day',async t=>{
  freeze(t,'2026-11-01T23:59:50Z');
  provider=async()=>{t.mock.timers.tick(11000);return Response.json({transactions:[]});};
  const result=await sync({});assert.equal(result.status,200);
  assert.deepEqual(requests,[['2026-10-03','2026-11-01',null]]);
  assert.equal(result.body.sync_coverage.complete,false);assert.equal(result.body.sync_coverage.pending_from,'2026-11-02');assert.equal(stored().last_synced,'');
});

for(const [name,mutation,status] of [
  ['a newer cooldown',()=>db.prepare('UPDATE bank_connections SET retry_after=? WHERE id=?').run(Date.now()+172800000,connectionId),429],
  ['a newer consent expiry',()=>db.prepare('UPDATE bank_connections SET valid_until=? WHERE id=?').run('2026-11-02T09:59:00Z',connectionId),409]
])test(`${name} acquired between reading the connection and its lease blocks provider calls`,async t=>{
  freeze(t);const prepare=db.prepare.bind(db);let first=true;
  t.mock.method(db,'prepare',sql=>{
    const statement=prepare(sql);
    if(sql==='SELECT * FROM bank_connections WHERE id=? AND owner=?'){
      const get=statement.get.bind(statement);
      statement.get=(...args)=>{const row=get(...args);if(first){first=false;mutation();}return row;};
    }
    return statement;
  });
  assert.equal((await sync({})).status,status);assert.equal(calls,0);assert.equal(stored().last_synced,'');
});

for(const status of [401,403,404,410])test(`provider HTTP ${status} without an expired-session code does not revoke the customer consent`,async t=>{
  freeze(t);const before=stored().encrypted_session;
  provider=async()=>Response.json({error:status===401||status===403?'ACCESS_DENIED':'UNKNOWN_RESOURCE',message:'synthetic-private-diagnostic'},{status});
  const result=await sync({date_from:'2026-11-01',date_to:'2026-11-02'});
  assert.equal(stored().status,'error');assert.equal(stored().encrypted_session,before);assert.equal(stored().last_synced,'');
  assert.ok(!JSON.stringify(result.body).includes('synthetic-private-diagnostic'));
  if(status===401||status===403){assert.equal(result.status,409);assert.equal(result.body.code,'application_access_denied');assert.match(result.body.error,/systemadministratören/);}
  else assert.equal(result.status,502);
});

test('application credentials failing account verification do not invalidate the existing customer consent',async t=>{
  freeze(t);const before=stored().encrypted_session;
  verifyProvider=async()=>Response.json({error:'ACCESS_DENIED'},{status:401});
  const result=await call('/api/bank/accounts',{connection_id:connectionId,account_uid:'account'});
  assert.equal(result.status,409);assert.equal(result.body.code,'application_access_denied');
  assert.equal(stored().status,'connected');assert.equal(stored().encrypted_session,before);assert.equal(requests.length,0);
});

test('bank completion remains terminal while a separate control lease clears its aftercheck warning without another fetch attempt',async t=>{
  freeze(t);provider=async()=>Response.json({transactions:[transaction('terminal-success','2026-11-01')]});
  const result=await sync({date_from:'2026-11-01',date_to:'2026-11-02'});
  assert.equal(result.status,200);assert.equal(result.body.imported,1);assert.equal(result.body.warnings,undefined);
  const job=db.prepare('SELECT * FROM integration_jobs WHERE name=?').get('bank:'+connectionId);
  assert.equal(job.job_state,'succeeded');assert.ok(job.last_success>0);assert.equal(job.attempt_count,1);
  assert.equal(job.lease,'');assert.equal(stored().last_error,'');assert.equal(requests.length,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='bank_synced'").get().n,1);
});

test('a failed bank COMMIT rolls back originals, coverage and job success and permits recording the failed attempt',async t=>{
  freeze(t);const before=stored().encrypted_session;
  provider=async()=>Response.json({transactions:[transaction('commit-rejected','2026-11-01')]});
  const exec=db.exec.bind(db);let rejected=false;
  t.mock.method(db,'exec',sql=>{
    if(!rejected&&sql==='COMMIT'&&db.prepare("SELECT job_state FROM integration_jobs WHERE name=?").get('bank:'+connectionId)?.job_state==='succeeded'){
      rejected=true;throw Error('Synthetic commit failure');
    }
    return exec(sql);
  });
  const result=await sync({date_from:'2026-11-01',date_to:'2026-11-02'});
  assert.equal(rejected,true);assert.equal(result.status,502);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM import_jobs WHERE status='completed'").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='bank_synced'").get().n,0);
  assert.equal(stored().encrypted_session,before);assert.equal(stored().last_synced,'');
  const job=db.prepare('SELECT * FROM integration_jobs WHERE name=?').get('bank:'+connectionId);
  assert.equal(job.job_state,'retry_wait');assert.equal(job.last_success,0);assert.equal(job.attempt_count,1);
});

test('consent expiring during the terminal completion write still rolls back the whole bank import',async t=>{
  freeze(t);const before=stored().encrypted_session;
  verifyProvider=async()=>Response.json(liveSession({access:{valid_until:'2026-11-02T10:00:01Z'}}));
  provider=async()=>Response.json({transactions:[transaction('terminal-expiry','2026-11-01')]});
  const prepare=db.prepare.bind(db);let advanced=false;
  t.mock.method(db,'prepare',sql=>{
    const statement=prepare(sql);
    if(sql.startsWith("UPDATE integration_jobs SET job_state='succeeded'")){
      const run=statement.run.bind(statement);
      statement.run=(...args)=>{const value=run(...args);advanced=true;t.mock.timers.tick(2000);return value;};
    }
    return statement;
  });
  const result=await sync({date_from:'2026-11-01',date_to:'2026-11-02'});
  assert.equal(advanced,true);assert.equal(result.status,409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,0);
  assert.equal(stored().encrypted_session,before);assert.equal(stored().last_synced,'');
  const job=db.prepare('SELECT * FROM integration_jobs WHERE name=?').get('bank:'+connectionId);
  assert.equal(job.job_state,'retry_wait');assert.equal(job.last_success,0);assert.equal(job.attempt_count,1);
});

test('losing the HTTP reply after the atomic bank commit preserves one successful attempt and one retained original',async t=>{
  freeze(t);provider=async()=>Response.json({transactions:[transaction('lost-http-reply','2026-11-01')]});
  const exec=db.exec.bind(db);let committed=false,client;
  t.mock.method(db,'exec',sql=>{
    const value=exec(sql);
    if(!committed&&sql==='COMMIT'&&db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='bank_synced'").get().n===1){committed=true;client.destroy();}
    return value;
  });
  const outcome=await new Promise(resolve=>{
    const body=JSON.stringify({connection_id:connectionId,date_from:'2026-11-01',date_to:'2026-11-02'});
    client=request(base+'/api/bank/sync',{method:'POST',headers:{Host:'localhost:3000',Origin:process.env.APP_ORIGIN,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{res.resume();resolve(res.statusCode);});
    client.on('error',error=>resolve(error.code));client.end(body);
  });
  assert.equal(committed,true);assert.equal(outcome,'ECONNRESET');
  const status=await call('/api/bank/status');assert.equal(status.status,200);
  const job=db.prepare('SELECT * FROM integration_jobs WHERE name=?').get('bank:'+connectionId);
  assert.equal(job.job_state,'succeeded');assert.ok(job.last_success>0);assert.equal(job.attempt_count,1);assert.equal(job.lease,'');
  assert.equal(stored().last_error,'');assert.deepEqual(Object.values(decryptObject(stored().encrypted_session).sync_coverage.accounts)[0].ranges,[['2026-11-01','2026-11-02']]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM import_jobs WHERE status='completed'").get().n,1);
  assert.equal(requests.length,1);
  const retry=await sync({date_from:'2026-11-01',date_to:'2026-11-02'});
  assert.equal(retry.status,200);assert.equal(retry.body.imported,0);assert.equal(retry.body.duplicate,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,1);
});

test('failed lease cleanup after bank commit retains a successful result and a durable aftercheck warning',async t=>{
  freeze(t);provider=async()=>Response.json({transactions:[transaction('cleanup-failed','2026-11-01')]});
  const prepare=db.prepare.bind(db);let failed=false;
  t.mock.method(db,'prepare',sql=>{
    if(!failed&&sql.startsWith('UPDATE integration_jobs SET\n          job_state=CASE WHEN record_attempt=1')&&db.prepare('SELECT last_success FROM integration_jobs WHERE name=?').get('bank:'+connectionId)?.last_success){failed=true;throw Error('Synthetic lease cleanup failure');}
    return prepare(sql);
  });
  const result=await sync({date_from:'2026-11-01',date_to:'2026-11-02'});
  assert.equal(failed,true);assert.equal(result.status,200);assert.equal(result.body.imported,1);
  assert.match(result.body.warnings[0],/Efterkontrollen/);assert.equal(stored().last_error,result.body.warnings[0]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,1);
  const job=db.prepare('SELECT * FROM integration_jobs WHERE name=?').get('bank:'+connectionId);
  assert.equal(job.job_state,'succeeded');assert.ok(job.last_success>0);assert.equal(job.attempt_count,1);
});

for(const phase of ['control','persistent'])test(`${phase} cleanup failure cannot relabel a committed bank import as failed`,async t=>{
  freeze(t);provider=async()=>Response.json({transactions:[transaction('cleanup-'+phase,'2026-11-01')]});
  const prepare=db.prepare.bind(db);let failures=0;
  t.mock.method(db,'prepare',sql=>{
    if(sql.startsWith('UPDATE integration_jobs SET\n          job_state=CASE WHEN record_attempt=1')){
      const job=prepare('SELECT last_success,fence_version FROM integration_jobs WHERE name=?').get('bank:'+connectionId);
      if(job?.last_success&&(phase==='persistent'||job.fence_version===2)){failures++;throw Error('Synthetic cleanup failure');}
    }
    return prepare(sql);
  });
  const result=await sync({date_from:'2026-11-01',date_to:'2026-11-02'});
  assert.ok(failures>0);assert.equal(result.status,200);assert.equal(result.body.imported,1);
  assert.match(result.body.warnings[0],/Efterkontrollen/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,1);
  const job=db.prepare('SELECT * FROM integration_jobs WHERE name=?').get('bank:'+connectionId);
  assert.equal(job.job_state,'succeeded');assert.ok(job.last_success>0);assert.equal(job.attempt_count,1);
});
