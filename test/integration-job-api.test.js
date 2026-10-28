import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encryptObject} from '../src/security.js';

// Independent server module instances have separate memory and SQLite handles.
// No .env or real provider is used; only this synthetic temporary database.
const folder=mkdtempSync(join(tmpdir(),'mg-integration-race-'));
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'http://localhost:3000',DB_PATH:join(folder,'db.sqlite'),SESSION_SECRET:'1'.repeat(64),BANK_DATA_KEY:'2'.repeat(64),GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret'});
for(const name of ['ENABLE_BANKING_APPLICATION_ID','ENABLE_BANKING_PRIVATE_KEY','ENABLE_BANKING_PRIVATE_KEY_FILE'])delete process.env[name];
const first=await import('../src/server.js?integration-race-first');
const second=await import('../src/server.js?integration-race-second');
first.db.prepare('INSERT INTO gmail_connections(id,email,encrypted_tokens) VALUES(?,?,?)').run('synthetic-gmail','mg.vitvaror@gmail.com',encryptObject({access_token:'synthetic-token',refresh_token:'synthetic-refresh',expires_at:Date.now()+3600000,scope:'https://www.googleapis.com/auth/gmail.readonly'}));
const originalFetch=globalThis.fetch;
let listCalls=0,fail=false,pause=null,retryAfter='';
globalThis.fetch=async url=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/profile'))return Response.json({emailAddress:'mg.vitvaror@gmail.com'});
  if(path.endsWith('/messages')){listCalls++;if(pause)await pause;if(retryAfter)return new Response('private rate limit response',{status:429,headers:{'Retry-After':retryAfter}});if(fail)throw Error('synthetic outage');return Response.json({messages:[]});}
  throw Error('Unexpected synthetic provider endpoint');
};
test('two server instances sharing one database cannot fetch Gmail concurrently',async()=>{
  let release;pause=new Promise(r=>{release=r;});
  const a=first.runScheduledSync();
  while(!listCalls)await new Promise(r=>setImmediate(r));
  const b=second.runScheduledSync();
  try{for(let n=0;n<5;n++)await new Promise(r=>setImmediate(r));assert.equal(listCalls,1);}finally{pause=null;release();await Promise.all([a,b]);}
});
test('scheduled failure cooldown survives server restart',async()=>{
  first.db.prepare("UPDATE gmail_connections SET last_synced='',status='connected'").run();
  // Clear only the test lease/attempt state so this scenario starts independently.
  if(first.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='integration_jobs'").get())first.db.prepare('DELETE FROM integration_jobs').run();
  const fresh=await import('../src/server.js?integration-race-failure');
  fail=true;const before=listCalls;
  await fresh.runScheduledSync();assert.equal(listCalls,before+1);
  const restarted=await import('../src/server.js?integration-race-restarted');
  try{await restarted.runScheduledSync();assert.equal(listCalls,before+1);}finally{fresh.db.close();restarted.db.close();fail=false;}
});
test('a delayed provider response cannot advance a checkpoint or release a replacement lease',async()=>{
  first.db.prepare("UPDATE gmail_connections SET last_synced='',status='connected'").run();first.db.prepare('DELETE FROM integration_jobs').run();
  const delayed=await import('../src/server.js?integration-race-delayed');
  let release;pause=new Promise(r=>{release=r;});const before=listCalls,run=delayed.runScheduledSync();
  while(listCalls===before)await new Promise(r=>setImmediate(r));
  first.db.prepare("UPDATE integration_jobs SET lease='synthetic-replacement',lease_until=? WHERE name='gmail'").run(Date.now()+60000);
  try{pause=null;release();await run;assert.equal(first.db.prepare('SELECT last_synced FROM gmail_connections').get().last_synced,'');assert.equal(first.db.prepare("SELECT lease FROM integration_jobs WHERE name='gmail'").get().lease,'synthetic-replacement');}finally{delayed.db.close();}
});
test('a restarted server exposes the persisted exhaustion alarm without leaking lease tokens',async()=>{
  first.db.prepare("UPDATE integration_jobs SET failures=3,lease='',lease_until=0,last_error='Gmail-hämtningen behöver kontrolleras' WHERE name='gmail'").run();
  const restarted=await import('../src/server.js?integration-race-alarm'),base=await new Promise(resolve=>restarted.server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+restarted.server.address().port)));
  try{
    const response=await originalFetch(base+'/api/settings'),settings=await response.json();assert.equal(response.status,200);assert.match(settings.scheduler.last_error,/stoppad efter tre försök/);assert.equal(settings.scheduler.jobs[0].blocked,true);assert.equal(Object.hasOwn(settings.scheduler.jobs[0],'lease'),false);
    const mail=await (await originalFetch(base+'/api/gmail/status')).json();assert.equal(mail.next_sync,null);assert.equal(mail.job.blocked,true);
  }finally{await new Promise(resolve=>restarted.server.close(resolve));restarted.db.close();}
});
test('Gmail provider Retry-After persists across restart and blocks early manual retries',async()=>{
  first.db.prepare("UPDATE gmail_connections SET last_synced='',status='connected'").run();first.db.prepare('DELETE FROM integration_jobs').run();retryAfter='7200';
  const limited=await import('../src/server.js?integration-provider-wait'),before=listCalls;await limited.runScheduledSync();assert.equal(listCalls,before+1);
  assert.ok(first.db.prepare("SELECT next_attempt FROM integration_jobs WHERE name='gmail'").get().next_attempt>=Date.now()+7199_000);
  first.db.prepare("UPDATE integration_jobs SET last_attempt=0 WHERE name='gmail'").run();const restarted=await import('../src/server.js?integration-provider-wait-restarted');
  const base=await new Promise(resolve=>restarted.server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+restarted.server.address().port)));
  try{
    await restarted.runScheduledSync();assert.equal(listCalls,before+1);
    const response=await originalFetch(base+'/api/gmail/sync',{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},body:'{}'});assert.equal(response.status,429);assert.ok(Number(response.headers.get('Retry-After'))>=7199);assert.equal(listCalls,before+1);
  }finally{retryAfter='';await new Promise(resolve=>restarted.server.close(resolve));limited.db.close();restarted.db.close();}
});
test.after(()=>{globalThis.fetch=originalFetch;first.db.close();second.db.close();rmSync(folder,{recursive:true,force:true});});
