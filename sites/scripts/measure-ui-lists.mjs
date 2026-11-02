#!/usr/bin/env node
/**
 * Reproduce from the repository root (no network, database or provider access):
 *   git show a9f88ae:sites/components/bank-payments.tsx > /tmp/mgeorge-bank-payments-baseline-a9f88ae.tsx
 *   node --experimental-strip-types sites/scripts/measure-ui-lists.mjs --baseline /tmp/mgeorge-bank-payments-baseline-a9f88ae.tsx --output docs/measurements/final-ui-lists.json
 *
 * Both component versions use this checkout's exact same real presentation and
 * economic modules. SSR starts a fresh component instance for each render; this
 * measures initial-page work, not client memoization or browser interaction.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {cpus} from 'node:os';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {emptyState} from '../lib/domain.ts';
import {syntheticBankTransaction} from '../tests/helpers/bank-api-fixture.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const args=process.argv.slice(2),option=(name,fallback)=>{const index=args.indexOf(name);if(index<0)return fallback;if(index+1>=args.length||args[index+1].startsWith('--'))throw Error(`Missing value for ${name}`);return args[index+1];};
const baselinePath=option('--baseline','');
if(!baselinePath)throw Error('Pass --baseline PATH containing git show a9f88ae:sites/components/bank-payments.tsx.');
const sizes=option('--sizes','100,1000,5000').split(',').map(Number),runs=Number(option('--runs','3')),budgetMs=Number(option('--budget-ms','180000'));
if(!sizes.length||sizes.some(n=>!Number.isSafeInteger(n)||n<1||n>10000)||!Number.isSafeInteger(runs)||runs<3||runs>10||!Number.isFinite(budgetMs)||budgetMs<1000)throw Error('Use sizes 1–10000, runs 3–10 and a positive budget of at least 1000 ms.');
const outputPath=resolve(option('--output',resolve(root,'docs/measurements/final-ui-lists.json')));
const hash=value=>createHash('sha256').update(value).digest('hex');
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const file=path=>new URL(path,import.meta.url).href;
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
function compile(source,imports={}){
 let code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const [name,target]of Object.entries({'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'./domain':file('../lib/domain.ts'),'@/lib/domain':file('../lib/domain.ts'),'./reconciliation-engine.js':file('../lib/reconciliation-engine.js'),'./payment-references.js':file('../lib/payment-references.js'),...imports}))for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(target));
 return data(code);
}
const baselineSource=readFileSync(resolve(baselinePath),'utf8'),currentSource=read('../components/bank-payments.tsx');
const presentation=compile(read('../lib/payment-presentation.ts')),pagination=compile(read('../components/list-pagination.tsx'));
const counterKey='__synthetic_ui_measure_'+process.pid;
globalThis[counterKey]={calls:0};
const observed=data(`import * as actual from ${JSON.stringify(presentation)};export * from ${JSON.stringify(presentation)};export function bankPaymentView(...args){globalThis[${JSON.stringify(counterKey)}].calls++;return actual.bankPaymentView(...args);}`);
const aliases={'@/lib/payment-presentation':observed,'./list-pagination':pagination};
const variants={baseline:(await import(compile(baselineSource,aliases))).default,current:(await import(compile(currentSource,aliases))).default};
const dependencies=['../lib/domain.ts','../lib/payment-presentation.ts','../lib/reconciliation-engine.js','../lib/payment-references.js','../lib/payer-evidence.js','../tests/helpers/bank-api-fixture.mjs','../components/list-pagination.tsx'];
const result={
 schema:'mgeorge-synthetic-ui-lists-v1',recordedAt:new Date().toISOString(),baselineCommit:option('--baseline-commit','a9f88ae'),
 component:'sites/components/bank-payments.tsx',baselineComponentSha256:hash(baselineSource),currentComponentSha256:hash(currentSource),
 runnerSha256:hash(readFileSync(fileURLToPath(import.meta.url))),
 dependencies:Object.fromEntries(dependencies.map(path=>[fileURLToPath(new URL(path,import.meta.url)).slice(root.length),hash(read(path))])),
 environment:{node:process.version,react:React.version,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model||'unknown',logicalCpuCount:cpus().length},
 method:{requestedSizes:sizes,measuredRuns:runs,warmupRuns:1,order:'Warm each variant once; alternate baseline/current order between measured rounds.',time:'performance.now around renderToStaticMarkup only; compilation, fixture creation, hashing and markup checks excluded.',render:'Real React SSR, real payment-presentation and domain modules; first page; no BankPaymentSummary.',budgetMs,synthetic:true},
 limits:['Local synthetic shared-host measurement, not a production latency guarantee.','Excludes network, provider calls, fetching, search/filter work, complete-state summary, hydration, browser layout, keyboard focus and financial-engine SLA.','Fresh SSR instances do not measure client useMemo retention; separate interactive regression tests cover unchanged rerenders.','Only the baseline component source is historical; both variants share the same current dependent modules.','A synchronous render already in progress can exceed the configured between-dataset time budget.'],
 datasets:[],skipped:[]
};
const started=performance.now();
function makeFixture(size){
 const state=emptyState(),candidates={};
 state.transactions=Array.from({length:size},(_,index)=>{
  const batch=index%20===19,reference=batch?'':`REF-${String(index+1).padStart(6,'0')}`;
  const tx=syntheticBankTransaction({id:`synthetic-bank-${index+1}`,party:batch?'':`Synthetic bank payer ${index+1}`,date:'2026-10-26',amount:10000+index,bankReference:`SYNTHETIC-UI-${index+1}`,payerReference:reference,kind:batch?'batch':'payment',description:batch?'Bankgiro inbetalning':''});
  if(!batch&&index%7===0)candidates[tx.id]=[{number:`SYN-${index+1}`,identifiers:[{field:'reference',value:reference}]}];
  return tx;
 });
 return {state,transactions:state.transactions,candidates,open(){throw Error('SSR must not open or mutate a payment.');}};
}
const snapshot=props=>JSON.stringify({state:props.state,transactions:props.transactions,candidates:props.candidates});
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
function measure(Component,props){
 globalThis[counterKey].calls=0;
 const start=performance.now(),html=renderToStaticMarkup(React.createElement(Component,props)),elapsedMs=performance.now()-start;
 return {elapsedMs,markupBytes:Buffer.byteLength(html),desktopRows:(html.match(/class="bank-open-payment"/g)||[]).length,mobileCards:(html.match(/class="bank-payment-card"/g)||[]).length,evidenceCalls:globalThis[counterKey].calls,markupSha256:hash(html)};
}
function save(){mkdirSync(dirname(outputPath),{recursive:true});writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n');}
try{
 for(const size of sizes){
  const elapsed=performance.now()-started,last=result.datasets.at(-1),projected=last?last.totalElapsedMs*(size/last.size)**2:0;
  // Obtain a medium-sized observation before projecting the large-list cost;
  // a single small sample overstates fixed SSR setup cost under quadratic growth.
  if(elapsed>=budgetMs||(last&&last.size>=1000&&elapsed+projected>budgetMs)){
   result.skipped.push({size,reason:'Between-dataset time budget; conservative quadratic projection from the last completed dataset.',elapsedMs:elapsed,projectedDatasetMs:projected});save();continue;
  }
  const datasetStarted=performance.now(),props=makeFixture(size),inputBeforeSha256=hash(snapshot(props)),samples={baseline:[],current:[]},warmup={};
  for(const name of ['baseline','current'])warmup[name]=measure(variants[name],props);
  for(let round=0;round<runs;round++)for(const name of round%2?['current','baseline']:['baseline','current'])samples[name].push(measure(variants[name],props));
  const inputAfterSha256=hash(snapshot(props));
  if(inputBeforeSha256!==inputAfterSha256)throw Error(`Input mutation at size ${size}`);
  const entry={size,inputBeforeSha256,inputAfterSha256,inputsUnchanged:true,baseline:{},current:{}};
  for(const name of ['baseline','current']){
   const values=samples[name],first=values[0],expected=name==='baseline'?size:Math.min(50,size);
   if(values.some(value=>value.desktopRows!==expected||value.mobileCards!==expected||value.evidenceCalls!==expected||value.markupSha256!==first.markupSha256))throw Error(`Unexpected or unstable ${name} rows/markup at size ${size}`);
   entry[name]={warmupMs:warmup[name].elapsedMs,samplesMs:values.map(value=>value.elapsedMs),medianMs:median(values.map(value=>value.elapsedMs)),markupBytes:first.markupBytes,desktopRows:first.desktopRows,mobileCards:first.mobileCards,evidenceCallsPerRender:first.evidenceCalls,markupSha256:first.markupSha256};
  }
  entry.medianSpeedup=entry.baseline.medianMs/entry.current.medianMs;
  entry.markupReductionPercent=100*(1-entry.current.markupBytes/entry.baseline.markupBytes);
  entry.totalElapsedMs=performance.now()-datasetStarted;
  result.datasets.push(entry);save();
  process.stdout.write(JSON.stringify({size,baselineMs:entry.baseline.medianMs,currentMs:entry.current.medianMs,baselineRows:entry.baseline.desktopRows,currentRows:entry.current.desktopRows,inputsUnchanged:true})+'\n');
 }
 result.elapsedMs=performance.now()-started;save();
 process.stdout.write(JSON.stringify({output:outputPath,completedSizes:result.datasets.map(value=>value.size),skippedSizes:result.skipped.map(value=>value.size)})+'\n');
}finally{delete globalThis[counterKey];}
