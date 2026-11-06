import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';

// Test-only transport: imports the real parent function; no actual child, OCR,
// image, corpus, provider or network operation is performed by these probes.
const root=process.env.WORKER_REVIEW_TARGET_ROOT;
assert.ok(root);
const originalFork=childProcess.fork,originalTimer=globalThis.setTimeout;
let scenario,children=[],budget;const timers=new Set();
class SyntheticChild extends EventEmitter {
  killed=false;
  kill(){this.killed=true;return true;}
  send(payload,callback){return scenario(this,payload,callback);}
}
childProcess.fork=(filename,args,options)=>{
  assert.match(filename.href,/invoice-worker\.js$/);
  assert.deepEqual(args,[]);assert.deepEqual(options.execArgv,['--max-old-space-size=256']);
  assert.deepEqual(options.stdio,['ignore','ignore','ignore','ipc']);assert.equal(options.serialization,'advanced');
  assert.deepEqual(Object.keys(options.env).sort(),['PATH','SystemRoot','TEMP']);
  const child=new SyntheticChild();children.push(child);return child;
};
syncBuiltinESMExports();
globalThis.setTimeout=(fn,delay,...args)=>{
  assert.equal(delay,90000);budget=fn;const timer=originalTimer(fn,delay,...args);timers.add(timer);return timer;
};
const {runDocumentProcess}=await import(pathToFileURL(root+'/src/invoice-extraction.js'));
test.after(()=>{for(const timer of timers)clearTimeout(timer);childProcess.fork=originalFork;syncBuiltinESMExports();globalThis.setTimeout=originalTimer;});
const bytes=Buffer.from('SYNTHETIC IPC BYTES');
const receipt={text:'COMPLETED SYNTHETIC RESULT',confidence:96,method:'ocr',ocrEvidence:{schema:'synthetic-evidence',inputSha256:'synthetic-input'}};
function privateError(){const e=Error('PRIVATE_SOURCE_TEXT /private/original secret-token');Object.defineProperty(e,'code',{get(){throw Error('MUST_NOT_READ_GETTER');}});return e;}
function checkFailure(error,code,{exitCode=null,signal=null,timedOut=false}={}){
  assert.equal(error.code,code);assert.equal(error.message,timedOut?'timeout':'worker');
  assert.equal(error.exitCode,exitCode);assert.equal(error.signal,signal);assert.equal(error.timedOut,timedOut);
  assert.equal(error.receivedMessage,false);assert.ok(Number.isSafeInteger(error.elapsedMs)&&error.elapsedMs>=0);
  assert.deepEqual(Object.keys(error).sort(),['code','elapsedMs','exitCode','receivedMessage','signal','timedOut']);
  assert.doesNotMatch(JSON.stringify(error),/PRIVATE|private|original|secret-token|MUST_NOT_READ/);return true;
}
async function rejects(code,options){await assert.rejects(runDocumentProcess(bytes,'image/png'),e=>checkFailure(e,code,options));}

test('false send return is backpressure, and the exact complete result is preserved',async()=>{
  scenario=(child,payload,callback)=>{assert.equal(payload.bytes,bytes);assert.equal(payload.preview,false);queueMicrotask(()=>{callback?.(null);child.emit('message',receipt);child.emit('exit',0,null);});return false;};
  assert.equal(await runDocumentProcess(bytes,'image/png'),receipt);
});
test('message success remains stable after a subsequent process error or exit',async()=>{
  scenario=(child,_payload,callback)=>{queueMicrotask(()=>{callback?.(null);child.emit('message',receipt);child.emit('error',privateError());child.emit('exit',7,null);});return true;};
  assert.equal(await runDocumentProcess(bytes,'image/png'),receipt);
});
test('process error exposes no private exception fields or getters',async()=>{
  scenario=child=>{queueMicrotask(()=>child.emit('error',privateError()));return true;};
  await rejects('DOCUMENT_WORKER_PROCESS_FAILED');assert.equal(children.at(-1).killed,true);
});
test('input send failure beats a later claimed receipt',async()=>{
  scenario=(child,_payload,callback)=>{queueMicrotask(()=>{if(callback)callback(privateError());else child.emit('error',privateError());child.emit('message',receipt);});return false;};
  await rejects('DOCUMENT_WORKER_SEND_FAILED');assert.equal(children.at(-1).killed,true);
});
test('synchronous send throw stays private and stops the child',async()=>{
  scenario=()=>{throw privateError();};await rejects('DOCUMENT_WORKER_SEND_FAILED');assert.equal(children.at(-1).killed,true);
});
for(const [label,exitCode,signal,want] of [
 ['normal exit without result',0,null,{exitCode:0}],
 ['nonzero exit without result',7,null,{exitCode:7}],
 ['known signal',null,'SIGTERM',{signal:'SIGTERM'}],
 ['untrusted exit fields','PRIVATE_CODE','PRIVATE_SIGNAL',{}],
 ['objects without coercion',{toString(){throw Error('MUST_NOT_COERCE');}},{toString(){throw Error('MUST_NOT_COERCE');}},{}],
])test(label,async()=>{
  scenario=child=>{queueMicrotask(()=>child.emit('exit',exitCode,signal));return true;};
  await rejects('DOCUMENT_WORKER_EXIT_WITHOUT_RESULT',want);
});
test('90-second timeout rejects before a late result and the slot is released',async()=>{
  scenario=()=>true;const promise=runDocumentProcess(bytes,'image/png');const child=children.at(-1);
  budget();child.emit('message',receipt);await assert.rejects(promise,e=>checkFailure(e,'DOCUMENT_WORKER_TIMEOUT',{timedOut:true}));
  assert.equal(child.killed,true);
  scenario=child=>{queueMicrotask(()=>child.emit('message',receipt));return true;};assert.equal(await runDocumentProcess(bytes,'image/png'),receipt);
});
test('the two-job boundary remains 429 and both failed slots can be reused',async()=>{
  scenario=()=>true;const first=runDocumentProcess(bytes,'image/png').catch(e=>e),a=children.at(-1);
  const second=runDocumentProcess(bytes,'image/png').catch(e=>e),b=children.at(-1),count=children.length;
  await assert.rejects(runDocumentProcess(bytes,'image/png'),e=>e.status===429);assert.equal(children.length,count);
  a.emit('exit',0,null);b.emit('exit',0,null);
  checkFailure(await first,'DOCUMENT_WORKER_EXIT_WITHOUT_RESULT',{exitCode:0});checkFailure(await second,'DOCUMENT_WORKER_EXIT_WITHOUT_RESULT',{exitCode:0});
  scenario=child=>{queueMicrotask(()=>child.emit('message',receipt));return true;};assert.equal(await runDocumentProcess(bytes,'image/png'),receipt);
});
