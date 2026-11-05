#!/usr/bin/env node
// Read-only source review; only isolated fixture databases are written.
// Run with Node 24. No live bank/Gmail calls or project files are changed.
import {readFileSync,realpathSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {sitesCases,nodeCases,contractCases} from './lib/multiple-invoice-review-cases.mjs';

let root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),selected='all';
for(let index=2;index<process.argv.length;index++){
 const name=process.argv[index],value=process.argv[++index];
 if(name==='--source-root'&&value)root=resolve(value);
 else if(name==='--case'&&['all','sites','node','contract'].includes(value))selected=value;
 else throw Error('Usage: node scripts/review-multiple-invoice-paths.mjs [--source-root PATH] [--case all|sites|node|contract]');
}
root=realpathSync(root);
const url=path=>pathToFileURL(resolve(root,path)).href;
const read=path=>readFileSync(resolve(root,path),'utf8');
const required=['sites/tests/bank-account-commit.test.mjs','test/manual-allocation-evidence-api.test.js','test/helpers/reconciliation-contract-cases.mjs'];
for(const path of required)if(!existsSync(resolve(root,path)))throw Error('Missing review fixture: '+path);
const prefix=(path,marker)=>{
 const contents=read(path),offset=contents.indexOf(marker);
 if(offset<0||contents.indexOf(marker,offset+marker.length)>=0)throw Error('Review fixture boundary changed: '+path);
 return contents.slice(0,offset);
};
const rebase=(source,base)=>source.replaceAll('import.meta.url',JSON.stringify(base))
 .replace(/from (['"])(\.[^'"]+)\1/g,(_,quote,path)=>'from '+JSON.stringify(new URL(path,base).href));
const asModule=source=>"await import('data:text/javascript;base64,'+Buffer.from("+JSON.stringify(source)+").toString('base64'));\n";
function sitesSource(){
 const base=url('sites/tests/bank-account-commit.test.mjs');
 let source=prefix('sites/tests/bank-account-commit.test.mjs','const races=[');
 const generic="import {genericCompanyState as emptyState} from './helpers/reference-policy-fixture.mjs';";
 if(!source.includes(generic)||!source.includes('f.read=()=>{'))throw Error('Sites fixture shape changed');
 source=source.replace(generic,"import {emptyState} from '../lib/domain.ts';");
 source=rebase(source,base).replace("f.read=()=>{","f.postRaw=async body=>{const response=await route.POST(new Request('https://mg.test/api/state',{method:'POST',headers:{Origin:'https://mg.test','Content-Type':'application/json'},body:JSON.stringify(body)}));return{status:response.status,body:await response.json()};};f.read=()=>{");
 return asModule(source+'\n'+sitesCases);
}
function nodeSource(){
 const base=url('test/manual-allocation-evidence-api.test.js');
 let source=rebase(prefix('test/manual-allocation-evidence-api.test.js','for(const [name,change,pattern]'),base);
 source=source.replace("import('../src/server.js')","import("+JSON.stringify(url('src/server.js'))+")");
 source="import {storeDocument,saveSettings,getSettings,listInvoices} from "+JSON.stringify(url('src/db.js'))+";\nimport {normalizeBankApiTransaction} from "+JSON.stringify(url('src/importers.js'))+";\nimport {reconciliationData} from "+JSON.stringify(url('src/reconciliation.js'))+";\n"+source;
 // Installed before the fixture dynamically imports the local server.
 const guard="const reviewFetch=globalThis.fetch;globalThis.fetch=(input,...args)=>{const target=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(target.hostname!=='127.0.0.1')throw Error('Review forbids external calls');return reviewFetch(input,...args);};\n";
 return asModule(guard+source+'\n'+nodeCases);
}
function contractSource(){
 return "import test from 'node:test';import assert from 'node:assert/strict';\nimport {buildReconciliationPreview,validateReconciliationApproval} from "+JSON.stringify(url('sites/lib/reconciliation-contract.js'))+";\nimport {reconciliationContractFixture} from "+JSON.stringify(url('test/helpers/reconciliation-contract-cases.mjs'))+";\n"+contractCases;
}
const sources=['src/db.js','src/server.js','sites/lib/domain.ts','sites/lib/reconciliation-evidence.ts','sites/lib/reconciliation-contract.js','sites/app/api/state/route.ts',...required];
const fingerprints=Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(read(path)).digest('hex')]));
let commit='unavailable';try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch{}
console.log('AREA23_SOURCE',JSON.stringify({commit,runtime:process.version,files:fingerprints}));
let failed=false;
for(const [name,build]of [['sites',sitesSource],['node',nodeSource],['contract',contractSource]]){
 if(selected!=='all'&&selected!==name)continue;
 const result=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','--eval',build()],{cwd:root,env:{...process.env,NODE_ENV:'test'},encoding:'utf8',timeout:60_000,maxBuffer:8_000_000});
 if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
 if(result.error)console.error('AREA23_RUN_ERROR',name,result.error.code||'RUN_FAILED');
 if(result.status!==0||result.error)failed=true;
}
for(const [path,before]of Object.entries(fingerprints))if(createHash('sha256').update(read(path)).digest('hex')!==before){console.error('AREA23_SOURCE_CHANGED',path);failed=true;}
process.exitCode=failed?1:0;
