// Independent, single-use optical experiment. Frozen corpus is never rewritten.
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,realpathSync,readdirSync,statSync} from 'node:fs';
import {dirname,resolve,join,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {cpus,loadavg,platform,release,arch} from 'node:os';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'../../../..');
const raw=resolve(root,'../independent-ocr-raw/completion-independent-20261106');
const output=join(raw,'first-pass');
const sha=b=>createHash('sha256').update(b).digest('hex');
const hashFile=p=>sha(readFileSync(p));
const readJson=p=>JSON.parse(readFileSync(p,'utf8'));
const writeJson=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n',{flag:'wx',flush:true});
const frozenManifest=readJson(join(here,'freeze-manifest.json'));
const expectedManifest='246ea4ac2f60d7567fddd2ee57cd7c48bc3f23a4a2b902a1f3fab30ece12781c';
function verifyFrozen(){
  if(hashFile(join(here,'freeze-manifest.json'))!==expectedManifest)throw Error('Original manifest changed');
  for(const f of frozenManifest.files)if(hashFile(f.path)!==f.sha256)throw Error('Frozen file changed: '+f.path);
}
verifyFrozen();
const corpus=readJson(join(here,'corpus.json'));
const plan=readJson(join(here,'run-plan.json'));
if(JSON.stringify(corpus.cases.map(x=>x.id))!==JSON.stringify(plan.case_order))throw Error('Case order mismatch');
if(corpus.cases.length!==19||corpus.cases.some(x=>x.metadata.direction_semantics!=='incoming'||x.gold.direction!=='incoming'))throw Error('Unexpected frozen corpus contract');
if(existsSync(join(output,'attempts.jsonl'))||existsSync(join(here,'runtime-binding.json')))throw Error('Refusing to repeat or overwrite a first run');
mkdirSync(output,{recursive:true});
const ledger=join(output,'attempts.jsonl');
writeFileSync(ledger,'',{flag:'wx',flush:true});
const record=v=>appendFileSync(ledger,JSON.stringify({...v,recordedAt:new Date().toISOString()})+'\n',{flush:true});

const sourceFiles=execFileSync('git',['ls-files','src','sites/lib'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
const sourceHashes=Object.fromEntries(sourceFiles.map(p=>[p,hashFile(join(root,p))]));
const lockHashes=Object.fromEntries(['package.json','package-lock.json','sites/package.json','sites/package-lock.json'].map(p=>[p,hashFile(join(root,p))]));
const require=createRequire(join(root,'package.json'));
function packageRecord(name){
  let entry;
  try{entry=require.resolve(name+'/package.json');}catch{entry=require.resolve(name);}
  let dir=dirname(entry);
  while(!existsSync(join(dir,'package.json'))){const parent=dirname(dir);if(parent===dir)throw Error('No package metadata: '+name);dir=parent;}
  const manifest=readJson(join(dir,'package.json'));
  const files={};
  function walk(d){for(const n of readdirSync(d)){if(n==='node_modules')continue;const p=join(d,n);if(statSync(p).isDirectory())walk(p);else files[relative(dir,p)]=hashFile(p);}}
  walk(dir);
  return {name:manifest.name,version:manifest.version,path:realpathSync(dir),files};
}
const packages=['tesseract.js','tesseract.js-core','@tesseract.js-data/swe','@napi-rs/canvas','@napi-rs/canvas-linux-x64-gnu','@napi-rs/canvas-linux-x64-musl','@noble/hashes','pdfjs-dist','fflate'];
const binding={schema:'mgeorge-independent-ocr-runtime-binding-v1',boundAt:new Date().toISOString(),manifestSha256:expectedManifest,sourceRoot:root,baselineCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),comparisonCommit:'24390ef7e8cf6b2274c57804dc9c2d74d362ab12',sourceHashes,lockHashes,
  harnessHashes:Object.fromEntries(['run-first-pass.mjs','score-first-pass.mjs','runtime-audit.md'].map(p=>[p,hashFile(join(here,p))])),
  runtime:{node:process.version,nodeExecutable:process.execPath,nodeExecutableSha256:hashFile(process.execPath),versions:process.versions,platform:platform(),release:release(),architecture:arch(),cpuModel:cpus()[0]?.model,cpuCount:cpus().length,loadBefore:loadavg(),environmentKeys:Object.keys(process.env).sort(),dependencies:packages.map(packageRecord)},
  opticalCallsBeforeBinding:0,parserCallsBeforeBinding:0,directionTranslation:{incoming:'supplier',outgoing:'customer'},directionConfident:true,workerTimeoutSeconds:90,protocolMaximumSeconds:120};
writeJson(join(here,'runtime-binding.json'),binding);
record({event:'runtime-bound',runtimeBindingSha256:hashFile(join(here,'runtime-binding.json')),manifestSha256:expectedManifest});

function resolveLocal(entry,spec){
  const p=resolve(dirname(entry),spec);
  for(const x of [p,p+'.js',p+'.mjs',p+'.ts',join(p,'index.js')])if(existsSync(x)&&statSync(x).isFile())return x;
  throw Error('Unresolved local import: '+spec);
}
let node,sites;
try{
  node=await import(pathToFileURL(join(root,'src/invoice-extraction.js')).href);
  const entry=join(root,'sites/lib/invoice-fields.js');
  let code=readFileSync(entry,'utf8');
  code=code.replace(/\b(from\s*|import\s*\(\s*|import\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,(_,prefix,_q,spec)=>prefix+JSON.stringify(pathToFileURL(resolveLocal(entry,spec)).href));
  sites=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}catch(e){record({event:'setup-error',error:String(e),stack:e?.stack,opticalCalls:0,parserCalls:0});throw e;}

const startedAt=new Date().toISOString(),started=performance.now();
const optical=[],parsers=[];
for(const c of corpus.cases){
  const bytes=readFileSync(c.image_path);
  if(sha(bytes)!==c.image_sha256)throw Error('Input hash mismatch: '+c.id);
  const at=new Date().toISOString(),t=performance.now();
  record({event:'optical-start',id:c.id,attempt:1,inputSha256:c.image_sha256,startedAt:at});
  let processed,error=null;
  try{processed=await node.runDocumentProcess(bytes,'image/png');if(processed?.error)error={kind:'document-process-error',message:'Worker returned error:true'};}
  catch(e){processed=null;error={kind:'document-process-exception',message:String(e),stack:e?.stack};}
  const observation={id:c.id,population:c.population,attempt:1,startedAt:at,completedAt:new Date().toISOString(),durationMs:performance.now()-t,inputSha256:c.image_sha256,inputBytes:bytes.length,mimeType:'image/png',processed,error};
  const observationPath=join(output,c.id+'.optical.json');writeJson(observationPath,observation);
  const text=processed?.text||'';
  optical.push({id:c.id,path:observationPath,sha256:hashFile(observationPath),textSha256:sha(text),durationMs:observation.durationMs,error,confidence:processed?.confidence??null,characters:text.length});
  record({event:'optical-complete',id:c.id,error,observationSha256:hashFile(observationPath),textSha256:sha(text),durationMs:observation.durationMs});
  for(const [engine,parse] of [['node',node.interpretInvoice],['sites',sites.interpretInvoice]]){
    const opts={...c.metadata,direction:'supplier',direction_confident:true,method:processed?.method||'ocr',ocrConfidence:processed?.confidence??0,ocrEvidence:processed?.ocrEvidence,ocrInputSha256:c.image_sha256};
    const parseAt=new Date().toISOString(),pt=performance.now();
    record({event:'parser-start',id:c.id,engine,attempt:1,observationSha256:hashFile(observationPath),textSha256:sha(text)});
    let extraction=null,parserError=null;
    try{extraction=parse(text,opts);}catch(e){parserError={kind:'parser-exception',message:String(e),stack:e?.stack};}
    const row={id:c.id,engine,population:c.population,attempt:1,startedAt:parseAt,completedAt:new Date().toISOString(),durationMs:performance.now()-pt,observationSha256:hashFile(observationPath),textSha256:sha(text),inputSha256:c.image_sha256,options:opts,extraction,parserError,processingError:error,effectiveLevel:error||parserError?'red':extraction?.level??'red'};
    const parserPath=join(output,c.id+'.'+engine+'.json');writeJson(parserPath,row);
    parsers.push({id:c.id,engine,path:parserPath,sha256:hashFile(parserPath),durationMs:row.durationMs,parserError,processingError:error,originalLevel:extraction?.level??null,effectiveLevel:row.effectiveLevel});
    record({event:'parser-complete',id:c.id,engine,error:parserError,originalLevel:extraction?.level??null,effectiveLevel:row.effectiveLevel,outputSha256:hashFile(parserPath)});
  }
  console.log(JSON.stringify({case:c.id,opticalMs:Math.round(observation.durationMs),opticalError:error?.kind??null,completedOptical:optical.length,completedParser:parsers.length}));
}
verifyFrozen();
for(const [p,h] of Object.entries(sourceHashes))if(hashFile(join(root,p))!==h)throw Error('Source changed during run: '+p);
for(const [p,h] of Object.entries(binding.harnessHashes))if(hashFile(join(here,p))!==h)throw Error('Harness changed during run: '+p);
const dependenciesAfter=packages.map(packageRecord);
if(JSON.stringify(dependenciesAfter)!==JSON.stringify(binding.runtime.dependencies))throw Error('Dependencies changed during run');
const receipt={schema:'mgeorge-independent-ocr-first-pass-v1',status:'completed',startedAt,completedAt:new Date().toISOString(),durationMs:performance.now()-started,manifestSha256:expectedManifest,runtimeBindingSha256:hashFile(join(here,'runtime-binding.json')),opticalCalls:optical.length,parserCalls:parsers.length,attemptsPerCase:1,optical,parsers,sourceStable:true,corpusStable:true,runtimeStable:true,loadAfter:loadavg(),resourceUsageParent:process.resourceUsage()};
writeJson(join(output,'run-receipt.json'),receipt);
record({event:'run-complete',opticalCalls:optical.length,parserCalls:parsers.length,receiptSha256:hashFile(join(output,'run-receipt.json'))});
console.log(JSON.stringify({completed:true,opticalCalls:optical.length,parserCalls:parsers.length,durationMs:receipt.durationMs,opticalErrors:optical.filter(x=>x.error).length,parserErrors:parsers.filter(x=>x.parserError).length}));
