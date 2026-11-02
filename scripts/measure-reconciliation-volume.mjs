import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=new URL('../',import.meta.url),args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?'':args[i+1]||'';};
const revision=option('--revision'),output=option('--output'),budget=Number(option('--assert-state-ms')||0);
if(revision&&!/^[a-f0-9]{7,40}$/.test(revision))throw Error('Use an explicit hexadecimal revision.');
const sizes=(name,fallback,max)=>{const raw=option(name);if(!raw)return fallback;const values=raw.split(',').map(Number);if(values.some(n=>!Number.isSafeInteger(n)||n<1||n>max))throw Error(`${name} requires comma-separated integers from 1 to ${max}.`);return values;};
const pureSizes=sizes('--pure-sizes',[50,100,200,400],2000),stateSizes=sizes('--state-sizes',[10,25,50,100],400);
const sha=value=>createHash('sha256').update(value).digest('hex');
const source=relative=>revision?execFileSync('git',['show',`${revision}:${relative}`],{cwd:fileURLToPath(root),encoding:'utf8'}):readFileSync(new URL(relative,root),'utf8');
const ts=createRequire(new URL('../sites/package.json',import.meta.url))('typescript');
const encoded=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
function moduleUrl(relative,overrides={}){
 let code=source(relative);if(relative.endsWith('.ts'))code=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 return encoded(code.replace(/from\s+(['"])(\.[^'"]+)\1/g,(_,q,specifier)=>'from '+JSON.stringify(overrides[specifier]||new URL(specifier,new URL(relative,root)).href)));
}
const revisionPaths=['src/reconciliation.js','sites/lib/reconciliation-engine.js','sites/lib/reconciliation.ts'];
// These actual support imports stay in this checkout even in a revision-pinned run.
const checkoutPaths=['sites/lib/domain.ts','sites/lib/bank-api-original.js','sites/lib/payment-references.js','sites/lib/reference-evidence-compat.js','sites/lib/payer-evidence.js','sites/lib/uuid.js','sites/tests/helpers/bank-api-fixture.mjs','src/payment-references.js','src/bank-evidence.js','src/db.js','src/security.js','src/importers.js'];
const hashSources=()=>Object.fromEntries([...revisionPaths.map(p=>[p,sha(source(p))]),...checkoutPaths.map(p=>[p,sha(readFileSync(new URL(p,root)))])]);
const hashes=hashSources();
const siteEngine=moduleUrl('sites/lib/reconciliation-engine.js');
const engines={node:(await import(moduleUrl('src/reconciliation.js'))).analyzeReconciliation,sites:(await import(siteEngine)).analyzeReconciliation};
const {reconcileState}=await import(moduleUrl('sites/lib/reconciliation.ts',{'./domain':new URL('../sites/lib/domain.ts',import.meta.url).href,'./reconciliation-engine.js':siteEngine}));
const {emptyState,balance}=await import(new URL('../sites/lib/domain.ts',import.meta.url));
const {syntheticBankTransaction}=await import(new URL('../sites/tests/helpers/bank-api-fixture.mjs',import.meta.url));
const pure=[],stateRuns=[];
for(const n of pureSizes){
 const invoices=Array.from({length:n},(_,k)=>({id:'invoice-'+k,direction:'customer',kind:'invoice',currency:'SEK',party:'Synthetic customer '+k,invoice_number:'SYN-'+k,reference:'SYN-'+k,organization_number:'',issued_at:'2026-01-01',total_cents:10000+k,remaining_cents:10000+k}));
 const transactions=invoices.map((i,k)=>({id:'payment-'+k,amount_cents:i.total_cents,available_cents:i.total_cents,currency:'SEK',booked_at:'2026-10-01',payer:i.party,reference:i.reference,account:'synthetic-account',bank_reference:'synthetic-bank-'+k,verified:true}));
 const data={invoices,transactions},before=JSON.stringify(data);
 for(const [engine,analyze]of Object.entries(engines)){
  const samples=[];let findings;for(let sample=0;sample<3;sample++){const start=performance.now();findings=analyze(data);samples.push(performance.now()-start);}
  assert.equal(findings.length,n);assert.deepEqual(findings.map(f=>[f.invoice_id,f.transaction_id,f.safe,f.amount_cents]),invoices.map((i,k)=>[i.id,'payment-'+k,true,10000+k]));assert.equal(JSON.stringify(data),before);
  pure.push({engine,invoices:n,payments:n,safe:n,samplesMs:samples,findingsSha256:sha(JSON.stringify(findings)),inputSha256:sha(before),inputUnchanged:true});
 }
}
for(const n of stateSizes){
 const state=emptyState();state.company={name:'Synthetic Company',email:'synthetic@example.invalid'};state.invoices=Array.from({length:n},(_,k)=>({id:'invoice-'+k,direction:'receivable',party:'Synthetic customer '+k,email:'',number:'SYN-'+k,ocr:'SYN-'+k,total:10000+k,currency:'SEK',issued:'2026-01-01',due:'2026-10-30',reviewed:true,voided:false,note:'',bankgiro:'',documentId:'',source:'synthetic',createdAt:'2026-10-01T00:00:00Z'}));
 state.transactions=state.invoices.map((i,k)=>syntheticBankTransaction({id:'payment-'+k,amount:i.total,party:i.party,payerReference:i.ocr,date:'2026-10-01',kind:'payment',verified:true,bankReference:'synthetic-bank-'+k}));
 const before=JSON.stringify(state),start=performance.now(),result=reconcileState(state),elapsedMs=performance.now()-start;
 assert.equal(result.state.allocations.length,n);assert.ok(result.state.invoices.every(i=>balance(result.state,i)===0));assert.equal(JSON.stringify(state),before);assert.deepEqual(result.state.transactions,state.transactions);
 const allocationFacts=result.state.allocations.map(a=>[a.invoiceId,a.transactionId,a.amount,a.effect]);assert.deepEqual(allocationFacts,state.invoices.map((i,k)=>[i.id,'payment-'+k,10000+k,'payment']));
 stateRuns.push({invoices:n,payments:n,allocations:n,allBalancesZero:true,inputUnchanged:true,originalsUnchanged:true,elapsedMs,inputSha256:sha(before),originalsSha256:sha(JSON.stringify(state.transactions)),findingsSha256:sha(JSON.stringify(result.findings)),allocationFactsSha256:sha(JSON.stringify(allocationFacts))});
}
assert.deepEqual(hashSources(),hashes);
const report={schema:'synthetic-reconciliation-volume-v1',generatedAt:new Date().toISOString(),node:process.version,typeScript:ts.version,revision:revision||'working-tree',runnerSha256:sha(readFileSync(fileURLToPath(import.meta.url))),workload:{pureSizes,stateSizes},sourceBindings:{revisionPaths,checkoutPaths},sourceSha256:hashes,scope:'Local synthetic pure Node/Sites analysis and Sites domain allocations with retained synthetic API originals. No network, D1/R2, browser, production throughput or SLA claim. Only revisionPaths are pinned; domain/support imports and selected support hashes use this checkout. This is not an isolated historical dependency environment; compare only when those inputs are unchanged.',pure,stateRuns};
if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({revision:report.revision,pure:pure.map(x=>({engine:x.engine,n:x.invoices,medianMs:[...x.samplesMs].sort((a,b)=>a-b)[1]})),stateRuns}));
if(budget)assert.ok(stateRuns.at(-1).elapsedMs<budget,`Diagnostic local ${stateRuns.at(-1).invoices}-pair run exceeded ${budget}ms`);
