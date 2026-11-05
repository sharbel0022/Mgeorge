import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encryptObject} from '../src/security.js';

const directory=mkdtempSync(join(tmpdir(),'mg-company-gmail-scheduler-'));
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'http://localhost:3000',DB_PATH:join(directory,'db.sqlite'),SESSION_SECRET:'1'.repeat(64),BANK_DATA_KEY:'2'.repeat(64),GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret'});
for(const name of ['MG_ADMIN_PASSWORD','ENABLE_BANKING_APPLICATION_ID','ENABLE_BANKING_PRIVATE_KEY','ENABLE_BANKING_PRIVATE_KEY_FILE'])delete process.env[name];
const app=await import('../src/server.js');
app.db.exec(readFileSync(new URL('../sites/drizzle/0023_saas_bank_sync.sql',import.meta.url),'utf8'));
app.db.prepare('INSERT INTO company_bank_sync_scopes(company_id,owner,evidence_id,created_at) VALUES(?,?,?,?)').run('synthetic-company','local-admin','synthetic-binding',Date.now());
app.db.prepare('UPDATE app_settings SET data=? WHERE id=1').run(JSON.stringify({sync_interval_minutes:60,gmail_sync_interval_minutes:60}));
app.db.prepare('INSERT INTO gmail_connections(id,email,encrypted_tokens) VALUES(?,?,?)').run('gmail','mg.vitvaror@gmail.com',encryptObject({access_token:'synthetic',refresh_token:'synthetic-refresh',expires_at:Date.now()+3600000,scope:'https://www.googleapis.com/auth/gmail.readonly'}));
const originalFetch=globalThis.fetch;
let messageReads=0;
globalThis.fetch=async input=>{
 const path=new URL(input).pathname;
 if(path.endsWith('/profile'))return Response.json({emailAddress:'mg.vitvaror@gmail.com'});
 if(path.endsWith('/messages')){messageReads++;return Response.json({messages:[]});}
 throw Error('Unexpected synthetic provider endpoint');
};
test.after(async()=>{globalThis.fetch=originalFetch;if(app.server.listening)await new Promise(resolve=>app.server.close(resolve));app.companyRuntime.close();app.db.close();rmSync(directory,{recursive:true,force:true});});

test('company bank enrollment preserves scheduled Gmail imports and their success checkpoint',async()=>{
 await app.runScheduledSync();
 assert.equal(messageReads,1,'bank coordination must not suppress the independent Gmail scheduler');
 const mail=app.db.prepare('SELECT * FROM gmail_connections WHERE id=?').get('gmail');
 const job=app.db.prepare("SELECT * FROM integration_jobs WHERE name='gmail'").get();
 assert.equal(mail.status,'connected');assert.ok(mail.last_synced);
 assert.equal(job.job_state,'succeeded');assert.equal(job.failures,0);
 assert.equal(app.db.prepare('SELECT count(*) n FROM allocations').get().n,0);
});

test('manual Gmail completion is not relabelled as failure by blocked legacy reconciliation',async()=>{
 app.db.prepare('DELETE FROM integration_jobs').run();
 app.db.prepare("UPDATE gmail_connections SET last_synced='',status='connected'").run();
 const base=await new Promise(resolve=>app.server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+app.server.address().port)));
 const before=messageReads;
 const response=await originalFetch(base+'/api/gmail/sync',{method:'POST',headers:{Origin:process.env.APP_ORIGIN,'Content-Type':'application/json'},body:'{}'});
 assert.equal(response.status,200,JSON.stringify(await response.json()));
 assert.equal(messageReads,before+1);
 assert.equal(app.db.prepare("SELECT job_state FROM integration_jobs WHERE name='gmail'").get().job_state,'succeeded');
 assert.equal(app.db.prepare('SELECT count(*) n FROM allocations').get().n,0);
});
