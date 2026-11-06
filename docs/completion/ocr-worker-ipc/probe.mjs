import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports,createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

const root='/workspace/scratch/aab0f7dc06f9/security-ipc-probe';
const out='/workspace/scratch/aab0f7dc06f9/security-evidence/ipc-24390ef';
const require=createRequire(join(root,'package.json'));
const {createCanvas}=require('@napi-rs/canvas');
const canvas=createCanvas(640,240),context=canvas.getContext('2d');
context.fillStyle='white';context.fillRect(0,0,640,240);context.fillStyle='black';context.font='30px sans-serif';
context.fillText('SYNTHETIC IPC PROBE',30,70);context.fillText('Local diagnostic 12345',30,130);
const bytes=canvas.toBuffer('image/png');writeFileSync(join(out,'new-synthetic-input.png'),bytes);
const sha=value=>createHash('sha256').update(value).digest('hex');
const controlled=join(out,'controlled-child.mjs');
writeFileSync(controlled,`process.once('message',()=>{const mode=process.argv[2];if(mode==='exit0')process.exit(0);if(mode==='exit7')process.exit(7);if(mode==='signal')process.kill(process.pid,'SIGTERM');const text=mode==='large'?'x'.repeat(262144):'synthetic';process.send({text,method:'probe'},()=>process.exit(0));});\n`);
const cleanupChild=join(out,'cleanup-fault-child.mjs');
writeFileSync(cleanupChild,`import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(join(root,'package.json'))});const tess=require('tesseract.js');tess.createWorker=async()=>({setParameters:async()=>{},recognize:async()=>({data:{text:'SYNTHETIC IPC CLEANUP PROBE',confidence:99,blocks:[]}}),terminate:async()=>{throw Error('SYNTHETIC_CLEANUP_FAILURE');}});await import(${JSON.stringify(pathToFileURL(join(root,'src/invoice-worker.js')).href)});\n`);
const originalFork=childProcess.fork;let active;
childProcess.fork=(filename,args,options)=>{
  const row=active;
  const target=row.mode==='real'?filename:row.mode==='cleanup-fault'?cleanupChild:controlled;
  const worker=originalFork(target,row.mode==='real'||row.mode==='cleanup-fault'?args:[row.mode],{...options,stdio:['ignore','pipe','pipe','ipc']});
  row.pid=worker.pid;row.execArgv=options.execArgv;row.events=[];row.stderr='';row.stdoutBytes=0;
  row.closed=new Promise(resolve=>worker.once('close',(code,signal)=>{row.events.push({event:'close',code,signal});resolve();}));
  worker.on('message',value=>row.events.push({event:'message',error:Boolean(value?.error),textBytes:Buffer.byteLength(value?.text??'')}));
  worker.on('error',error=>row.events.push({event:'error',code:error.code??null,name:error.name}));
  worker.on('disconnect',()=>row.events.push({event:'disconnect'}));
  worker.on('exit',(code,signal)=>row.events.push({event:'exit',code,signal}));
  worker.stdout.on('data',chunk=>row.stdoutBytes+=chunk.length);
  worker.stderr.on('data',chunk=>{if(row.stderr.length<65536)row.stderr+=chunk.toString().slice(0,65536-row.stderr.length);});
  return worker;
};
syncBuiltinESMExports();
const {runDocumentProcess}=await import(pathToFileURL(join(root,'src/invoice-extraction.js')));
const results=[];
for(const mode of ['small','large','small','large','exit0','exit7','signal','cleanup-fault','real']){
  active={mode,startedAt:new Date().toISOString()};
  try{const value=await runDocumentProcess(bytes,'image/png');active.wrapper={resolved:true,error:Boolean(value?.error),method:value?.method??null,textBytes:Buffer.byteLength(value?.text??'')};}
  catch(error){active.wrapper={resolved:false,name:error.name,message:error.message,code:error.code??null,signal:error.signal??null};}
  await active.closed;delete active.closed;active.completedAt=new Date().toISOString();results.push(active);
  console.log(JSON.stringify({mode,wrapper:active.wrapper,events:active.events,stderr:active.stderr.slice(0,600)}));
}
const receipt={format:'MG-IPC-diagnostic-1',commit:'24390ef7e8cf6b2274c57804dc9c2d74d362ab12',tree:'ad40b5a5ae7710939801d73e5e16eb80f3186f48',scope:'new non-holdout synthetic probe; no source edits',sourceFiles:['src/invoice-extraction.js','src/invoice-worker.js'].map(path=>({path,sha256:sha(readFileSync(join(root,path)))})),input:{bytes:bytes.length,sha256:sha(bytes),width:640,height:240},instrumentation:'Test-only child_process.fork hook captures stdout/stderr and events. Controlled transport children and injected cleanup exception are synthetic diagnostics; final real mode uses unmodified actual worker. Original 256 MiB V8 old-space flag retained. No holdout data read.',results};
writeFileSync(join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
assert.equal(results.filter(r=>r.mode==='small'||r.mode==='large').every(r=>r.wrapper.resolved),true);
assert.equal(results.find(r=>r.mode==='cleanup-fault').wrapper.resolved,false);
assert.equal(results.find(r=>r.mode==='real').wrapper.resolved,true);
