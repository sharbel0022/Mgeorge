import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const hangingSource="process.on('SIGTERM',()=>{});process.on('message',()=>{});process.send({ready:true});";
const fixtureSource=[
 "import test from 'node:test';",
 "import {spawn} from 'node:child_process';",
 "import {DatabaseSync} from 'node:sqlite';",
 "import {existsSync} from 'node:fs';",
 "import {createStartupResources} from "+JSON.stringify(new URL('./helpers/startup-test-resources.js',import.meta.url).href)+";",
 "const folder=process.argv[1],path=process.argv[2],controller=new AbortController();",
 "let child,childExit,callbackFinished=false,reopenedAfterCancellation=false,finishCallback;",
 "const callbackDone=new Promise(resolve=>finishCallback=resolve);",
 "process.on('message',message=>{if(message.cancel)controller.abort(new Error('Synthetic ready-barrier cancellation'));});",
 "const run=test('synthetic held-lock cancellation',{signal:controller.signal,timeout:15000},async t=>{",
 " const resources=createStartupResources(t,folder);",
 " try{",
 "  const holder=resources.hold(new DatabaseSync(path));",
 "  holder.exec('PRAGMA journal_mode=WAL; CREATE TABLE probe(value TEXT);');",
 "  holder.prepare('INSERT INTO probe(value) VALUES (?)').run('original');",
 "  holder.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE;');",
 "  holder.prepare('UPDATE probe SET value=?').run('uncommitted');",
 "  child=spawn(process.execPath,['--input-type=module','--eval',"+JSON.stringify(hangingSource)+"],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});",
 "  const terminal=resources.watch(child);",
 "  process.send({phase:'spawned',pid:child.pid});",
 "  child.once('close',(code,signal)=>{childExit={code,signal};process.send({phase:'childClosed',code,signal});});",
 "  child.once('message',message=>{if(message.ready)process.send({phase:'ready'});});",
 "  await terminal;",
 "  if(t.signal.aborted)return;",
 "  reopenedAfterCancellation=true;",
 "  const unexpected=new DatabaseSync(path);unexpected.close();",
 " }finally{await resources.cleanup();callbackFinished=true;finishCallback();}",
 "});",
 "await Promise.all([run,callbackDone]);",
 "let recovered=false,value,recoveryError;",
 "const probe=new DatabaseSync(path);",
 "try{probe.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;');value=probe.prepare('SELECT value FROM probe').get().value;probe.exec('ROLLBACK');recovered=true;}",
 "catch(error){recoveryError={code:error.code,errcode:error.errcode};}",
 "finally{probe.close();}",
 "await new Promise((resolve,reject)=>process.send({phase:'done',callbackFinished,cancelled:controller.signal.aborted,reopenedAfterCancellation,childExit,folderRemoved:!existsSync(folder),recovered,value,recoveryError},error=>error?reject(error):resolve()));",
 "process.disconnect();",
].join('\n');

test('startup resources close a hanging contender and release its SQLite holder on real test cancellation',{timeout:15000},async t=>{
 const root=mkdtempSync(join(tmpdir(),'mg-startup-cancellation-')),folder=join(root,'owned'),path=join(root,'holder.sqlite');
 mkdirSync(folder);
 let host,hostClosed,contenderPid,contenderClosed=false,watchdog,watchdogFired=false,cleanupPromise,cleanupStarted=false;
 let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),truncated=false,ready=false,report;
 const events=[];
 const diagnostic=()=>JSON.stringify({ready,report,events,watchdogFired,stdout:stdout.toString('utf8'),stderr:stderr.toString('utf8'),truncated});
 const killPid=pid=>{try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}};
 const cleanup=()=>cleanupPromise??=(async()=>{
  cleanupStarted=true;clearTimeout(watchdog);
  try{
   if(Number.isInteger(contenderPid)&&contenderPid>0&&!contenderClosed)killPid(contenderPid);
  }finally{
   try{if(host&&host.exitCode===null&&host.signalCode===null)host.kill('SIGKILL');if(hostClosed)await hostClosed;}
   finally{rmSync(root,{recursive:true,force:true});}
  }
 })();
 t.after(cleanup);
 t.signal.addEventListener('abort',()=>{void cleanup().catch(()=>{});},{once:true});
 try{
  // This is a separate real node:test host, not a child of the outer reporter.
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  host=spawn(process.execPath,['--input-type=module','--eval',fixtureSource,folder,path],{env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
  hostClosed=new Promise(resolve=>host.once('close',(code,signal)=>resolve({code,signal})));
  for(const [stream,read,write]of [[host.stdout,()=>stdout,value=>stdout=value],[host.stderr,()=>stderr,value=>stderr=value]])stream.on('data',bytes=>{const prior=read(),room=8192-prior.length;if(bytes.length>room)truncated=true;if(room>0)write(Buffer.concat([prior,bytes.subarray(0,room)]));});
  const reported=new Promise((resolve,reject)=>{
   host.once('error',reject);
   host.once('close',()=>{if(!report)reject(new Error('Cancellation fixture closed without cleanup evidence: '+diagnostic()));});
   host.on('message',message=>{
    if(events.length<8)events.push(message);
    if(message.phase==='spawned')contenderPid=message.pid;
    if(message.phase==='childClosed')contenderClosed=true;
    if(message.phase==='ready'&&!ready){ready=true;host.send({cancel:true});}
    if(message.phase==='done'){report=message;resolve(message);}
   });
  });
  // Failure budget only: correctness is decided by IPC/resource evidence.
  // The outer owner forcibly cleans RED or a broken fixture; watchdog use fails.
  const deadline=new Promise((resolve,reject)=>{
   watchdog=setTimeout(()=>{watchdogFired=true;reject(new Error('SYNTHETIC_STARTUP_CANCELLATION_WATCHDOG: '+diagnostic()));void cleanup().catch(()=>{});},10000);
  });
  const [observed,exit]=await Promise.race([Promise.all([reported,hostClosed]),deadline]);
  clearTimeout(watchdog);
  const details=diagnostic();
  assert.equal(watchdogFired,false,details);assert.equal(cleanupStarted,false,details);
  assert.equal(ready,true,details);assert.equal(truncated,false,details);
  assert.equal(exit.code,1,details);assert.equal(exit.signal,null,details);
  assert.equal(observed.cancelled,true,details);assert.equal(observed.callbackFinished,true,details);
  assert.equal(observed.reopenedAfterCancellation,false,details);
  assert.equal(contenderClosed,true,details);assert.equal(observed.childExit.signal,'SIGKILL',details);
  assert.equal(observed.folderRemoved,true,details);assert.equal(existsSync(folder),false,details);
  assert.equal(observed.recovered,true,details);assert.equal(observed.value,'original',details);
  assert.throws(()=>process.kill(contenderPid,0),error=>error.code==='ESRCH',details);
 }finally{await cleanup();}
});
