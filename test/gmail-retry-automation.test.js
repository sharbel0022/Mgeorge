import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encryptObject} from '../src/security.js';

const folder=mkdtempSync(join(tmpdir(),'gmail-automation-retry-'));
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'http://localhost:3000',DB_PATH:join(folder,'db.sqlite'),SESSION_SECRET:'1'.repeat(64),BANK_DATA_KEY:'2'.repeat(64),GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret'});
for(const name of ['MG_ADMIN_PASSWORD','ENABLE_BANKING_APPLICATION_ID','ENABLE_BANKING_PRIVATE_KEY','ENABLE_BANKING_PRIVATE_KEY_FILE'])delete process.env[name];
const originalFetch=globalThis.fetch;
const first=await import('../src/server.js?gmail-automation-retry');
first.db.prepare('INSERT INTO gmail_connections(id,email,encrypted_tokens) VALUES(?,?,?)').run('gmail','mg.vitvaror@gmail.com',encryptObject({access_token:'synthetic',refresh_token:'synthetic-refresh',expires_at:Date.now()+3600000,scope:'https://www.googleapis.com/auth/gmail.readonly'}));
let mode='unavailable',calls=0;
globalThis.fetch=async url=>{
  const path=new URL(url).pathname;
  if(path==='/token'&&mode==='revoked')return Response.json({error:'invalid_grant'},{status:400});
  if(path.endsWith('/profile'))return Response.json({emailAddress:'mg.vitvaror@gmail.com'});
  if(path.endsWith('/messages')){
    calls++;
    if(mode==='network')throw Error('synthetic-private-outage');
    if(mode==='stream')return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"messages":'));},pull(controller){controller.error(Error('synthetic-private-stream-outage'));}}));
    if(mode==='unavailable')return Response.json({error:{code:503,message:'synthetic-private-provider-detail'}},{status:503,headers:{'Retry-After':'7200'}});
    if(mode==='revoked')return new Response('synthetic-private-expired-page',{status:401});
    return Response.json({messages:[]});
  }
  throw Error('Unexpected provider endpoint');
};

for(const modeUnderTest of ['unavailable','network','stream'])test(`Gmail ${modeUnderTest} retry deadline survives restart and blocks early manual fetch`,async()=>{
  mode=modeUnderTest;
  first.db.prepare('DELETE FROM integration_jobs').run();first.db.prepare("UPDATE gmail_connections SET status='connected',last_synced='' ").run();
  const at=Date.now(),before=calls;await first.runScheduledSync();assert.equal(calls,before+1);
  const row=first.db.prepare("SELECT * FROM integration_jobs WHERE name='gmail'").get();
  assert.ok(row.next_attempt>=at+(mode==='unavailable'?7200000:900000));
  const restarted=await import('../src/server.js?gmail-retry-'+mode);
  const base=await new Promise(resolve=>restarted.server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+restarted.server.address().port)));
  try{
    await restarted.runScheduledSync();assert.equal(calls,before+1);
    const response=await originalFetch(base+'/api/gmail/sync',{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,429);assert.ok(Number(response.headers.get('Retry-After'))>0);assert.equal(calls,before+1);
    assert.doesNotMatch(JSON.stringify(await response.json()),/synthetic-private/);
  }finally{await new Promise(resolve=>restarted.server.close(resolve));restarted.db.close();}
});

test('Gmail revoked authorization has no advertised next sync and is not retried unattended',async()=>{
  mode='revoked';first.db.prepare('DELETE FROM integration_jobs').run();first.db.prepare("UPDATE gmail_connections SET status='connected',last_synced='' ").run();
  const before=calls;await first.runScheduledSync();assert.equal(calls,before+1);
  first.db.prepare('UPDATE integration_jobs SET next_attempt=0,last_attempt=0').run();
  const restarted=await import('../src/server.js?gmail-retry-revoked');
  const base=await new Promise(resolve=>restarted.server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+restarted.server.address().port)));
  try{
    await restarted.runScheduledSync();assert.equal(calls,before+1);
    const status=await(await originalFetch(base+'/api/gmail/status')).json();
    assert.equal(status.status,'renewal_required');assert.equal(status.next_sync,null);
    assert.doesNotMatch(JSON.stringify(status),/synthetic-private/);
  }finally{await new Promise(resolve=>restarted.server.close(resolve));restarted.db.close();}
});
test.after(()=>{globalThis.fetch=originalFetch;first.db.close();rmSync(folder,{recursive:true,force:true});});
