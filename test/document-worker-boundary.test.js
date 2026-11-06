import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {once} from 'node:events';
import {createCanvas} from '@napi-rs/canvas';

const privateFailure='PRIVATE_IMAGE_TEXT secret-token /private/customer/original.png';
const canvas=createCanvas(320,100),context=canvas.getContext('2d');
context.fillStyle='white';context.fillRect(0,0,320,100);context.fillStyle='black';context.font='20px sans-serif';context.fillText('SYNTHETIC WORKER TEST',5,50);
const bytes=canvas.toBuffer('image/png'),helper=new URL('./helpers/document-worker-boundary-child.mjs',import.meta.url);
const originalFork=childProcess.fork,originalSetTimeout=globalThis.setTimeout;
let current;
childProcess.fork=(_filename,_args,options)=>{
  const state=current;
  if(state.mode==='spawn-error')throw Error(privateFailure);
  const child=originalFork(helper,[state.mode],{...options,stdio:['ignore','pipe','pipe','ipc']});
  state.child=child;state.stderr='';state.stdout='';state.events=[];
  state.spawned=once(child,'spawn');
  state.closed=new Promise(resolve=>child.once('close',(exitCode,signal)=>{state.exitCode=exitCode;state.signal=signal;resolve();}));
  child.on('message',value=>state.events.push({event:'message',value}));
  child.stderr.on('data',value=>state.stderr+=String(value));child.stdout.on('data',value=>state.stdout+=String(value));
  if(state.mode==='parent-send-error')child.send=(_value,callback)=>{
    queueMicrotask(()=>{if(callback)callback(Error(privateFailure));else child.emit('error',Error(privateFailure));});return false;
  };
  if(state.mode==='parent-send-throw')child.send=()=>{throw Error(privateFailure);};
  return child;
};
syncBuiltinESMExports();
const {runDocumentProcess}=await import('../src/invoice-extraction.js');

async function run(mode){
  const state={mode};current=state;
  try{state.result=await runDocumentProcess(bytes,'image/png');}
  catch(error){state.error=error;}
  finally{if(state.error&&state.child&&!state.child.killed&&state.child.exitCode===null)state.child.kill();if(state.closed)await state.closed;}
  return state;
}
function safeFailure(state,code,message='worker'){
  assert.ok(state.error);assert.equal(state.error.message,message);assert.equal(state.error.code,code);
  assert.deepEqual(Object.keys(state.error).sort(),['code','elapsedMs','exitCode','receivedMessage','signal','timedOut'].sort());
  assert.ok(Number.isSafeInteger(state.error.elapsedMs)&&state.error.elapsedMs>=0);
  assert.equal(state.error.receivedMessage,false);assert.equal(state.error.timedOut,message==='timeout');
  assert.doesNotMatch(JSON.stringify(state.error),/PRIVATE_IMAGE_TEXT|secret-token|original\.png|\/private\/customer/);
  assert.doesNotMatch(state.error.message,/PRIVATE_IMAGE_TEXT|secret-token/);
}
test.after(()=>{childProcess.fork=originalFork;syncBuiltinESMExports();globalThis.setTimeout=originalSetTimeout;});

test('completed actual-worker receipt keeps text, confidence and evidence when cleanup fails',async()=>{
  const good=await run('success');assert.equal(good.error,undefined);assert.equal(good.result.text,'SYNTHETIC COMPLETED RECEIPT');
  assert.equal(good.result.confidence,96);assert.equal(good.result.method,'ocr');assert.ok(good.result.ocrEvidence);
  const failedCleanup=await run('cleanup');assert.equal(failedCleanup.error,undefined);
  const {workerDiagnostics,...preserved}=failedCleanup.result;
  assert.deepEqual(preserved,good.result);assert.deepEqual(workerDiagnostics,{code:'DOCUMENT_WORKER_CLEANUP_FAILED'});
  assert.doesNotMatch(JSON.stringify(failedCleanup.result),/PRIVATE_IMAGE_TEXT|secret-token|original\.png/);
  assert.doesNotMatch(failedCleanup.stderr,/PRIVATE_IMAGE_TEXT|secret-token|original\.png/);
});
test('actual worker retains its unreadable error receipt through a second cleanup failure',async()=>{
  const state=await run('read-error-cleanup');assert.equal(state.error,undefined);
  assert.deepEqual(state.result,{error:true,workerDiagnostics:{code:'DOCUMENT_WORKER_CLEANUP_FAILED'}});
  assert.equal(state.stderr,'');
});
for(const [mode,exitCode,signal] of [['exit0',0,null],['exit7',7,null],['signal',null,'SIGTERM']])test('actual child '+mode+' is safely classified without inventing a result',async()=>{
  const state=await run(mode);safeFailure(state,'DOCUMENT_WORKER_EXIT_WITHOUT_RESULT');
  assert.equal(state.error.exitCode,exitCode);assert.equal(state.error.signal,signal);assert.equal(state.result,undefined);
});
for(const mode of ['send-callback-error','send-throw'])test('actual worker '+mode+' exits unsuccessfully without leaking its exception',async()=>{
  const state=await run(mode);safeFailure(state,'DOCUMENT_WORKER_EXIT_WITHOUT_RESULT');
  assert.equal(state.exitCode,1);assert.equal(state.error.exitCode,1);assert.equal(state.events.length,0);assert.equal(state.stderr,'');
});
for(const [mode,code] of [['spawn-error','DOCUMENT_WORKER_START_FAILED'],['parent-send-error','DOCUMENT_WORKER_SEND_FAILED'],['parent-send-throw','DOCUMENT_WORKER_SEND_FAILED']])test('parent '+mode+' retains only bounded failure metadata',async()=>{
  const state=await run(mode);safeFailure(state,code);assert.equal(state.error.exitCode,null);assert.equal(state.error.signal,null);
});
test('the existing 90-second timeout terminates the actual hanging child and releases the slot',async()=>{
  let timeoutCallback;
  globalThis.setTimeout=(callback,delay,...args)=>{
    if(delay===90000)timeoutCallback=callback;
    return originalSetTimeout(callback,delay,...args);
  };
  const state={mode:'hang'};current=state;
  try{
    const pending=runDocumentProcess(bytes,'image/png').then(value=>{state.result=value;},error=>{state.error=error;});
    await state.spawned;assert.equal(typeof timeoutCallback,'function');timeoutCallback();await pending;
    safeFailure(state,'DOCUMENT_WORKER_TIMEOUT','timeout');assert.equal(state.child.killed,true);await state.closed;
    assert.equal((await run('success')).result.method,'ocr');
  }finally{globalThis.setTimeout=originalSetTimeout;if(state.child&&!state.child.killed)state.child.kill();}
});
test('two pending jobs still reject a third with 429 and cancellation releases both slots',async()=>{
  const states=[],pending=[];
  try{
    for(let index=0;index<2;index++){const state={mode:'hang'};states.push(state);current=state;pending.push(runDocumentProcess(bytes,'image/png').catch(error=>error));await state.spawned;}
    await assert.rejects(()=>runDocumentProcess(bytes,'image/png'),error=>error.status===429&&/Dokumenttolkning pågår/.test(error.message));
    for(const state of states)state.child.kill();
    const failures=await Promise.all(pending);await Promise.all(states.map(state=>state.closed));
    assert.equal(failures.every(error=>error.code==='DOCUMENT_WORKER_EXIT_WITHOUT_RESULT'),true);
    assert.equal((await run('success')).result.method,'ocr');
  }finally{for(const state of states)if(state.child&&!state.child.killed)state.child.kill();await Promise.all(pending);}
});
