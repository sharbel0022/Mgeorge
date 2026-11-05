import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {fork} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {deserialize} from 'node:v8';
import {cpus,loadavg,release} from 'node:os';
import {performance} from 'node:perf_hooks';

const root=resolve(fileURLToPath(new URL('..',import.meta.url))),sourceRoot=join(root,'source'),sealedRoot=join(root,'sealed'),out=join(root,'diagnostic');
const repository='/workspace/scratch/4d79ab4bea8e/onboarding',target='571073b8172ab53899a4ce3c2b717c7fe24daee2';
const hash=value=>createHash('sha256').update(value).digest('hex'),fileHash=path=>hash(readFileSync(path));
const write=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
if(existsSync(out))throw Error('This diagnostic directory already exists; no automatic rerun is permitted.');
mkdirSync(out);
const provenance=await import(pathToFileURL(join(sourceRoot,'scripts/quality8/ocr-holdout-v2-provenance.mjs')).href);
const source=provenance.freezeSource(sourceRoot,target,repository);
const firstPath=join(sealedRoot,'docs/quality8/ocr-independent-holdout-v2-result.json'),first=JSON.parse(readFileSync(firstPath,'utf8'));
assert.equal(first.passed,false);assert.equal(fileHash(firstPath),'13557c3012331fa0101fbe3e6fe498fd2fbf3346b8740cfe5fe4b83e8393b6e7');
assert.deepEqual(source.hashes,first.sourceHashes);
const fixture='test/fixtures/quality8/ocr-holdout-v2',manifestPath=join(sealedRoot,fixture,'manifest.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const protectedFiles=[{path:firstPath,sha256:fileHash(firstPath)},{path:manifestPath,sha256:fileHash(manifestPath)},...Object.entries(manifest.corpusHashes).map(([path,sha256])=>({path:join(sealedRoot,path),sha256})),...Object.entries(manifest.harnessHashes).map(([path,sha256])=>({path:join(sourceRoot,path),sha256}))];
const verifyProtected=()=>{for(const entry of protectedFiles)assert.equal(fileHash(entry.path),entry.sha256,entry.path);return true;};
verifyProtected();
const runtime={node:process.version,versions:process.versions,platform:process.platform,architecture:process.arch,osRelease:release(),cpuModel:cpus()[0]?.model,cpuCount:cpus().length,dependencies:provenance.runtimeDependencies(sourceRoot),sourceNodeModules:realpathSync(join(sourceRoot,'node_modules')),loadBefore:loadavg()};
assert.equal(runtime.node,first.runtime.node);assert.deepEqual(runtime.dependencies,first.runtime.dependencies);
write(join(out,'source-inventory.json'),source);write(join(out,'runtime-before.json'),runtime);write(join(out,'protected-files.json'),protectedFiles);
const questions=[
 {id:'holdout-v2-normal-09',question:'Why does the visually explicit right-hand summary (Netto / Summa moms / Att betala, each with a value on its own physical row) not form a proven field column on unchanged 571: do the actual words/bboxes lack the association, or does a named existing layout guard stop it?'},
 {id:'holdout-v2-normal-05',question:'Do the actual words/bboxes support an unambiguous split of Leverantör and Faktureras till into exactly one company-name candidate per explicitly labelled role column?'}
];
write(join(out,'plan.json'),{schema:'mgeorge-v2-post-holdout-diagnostic-v1',postHoldoutDiagnostic:true,independentHoldout:false,acceptanceMeasurement:false,targetSourceCommit:target,firstV2ResultSha256:fileHash(firstPath),firstV2Passed:false,orderedQuestions:questions,maximumRecognitionCalls:2,oneRecognitionPerImage:true,sourceInventorySha256:fileHash(join(out,'source-inventory.json')),runtimeInventorySha256:fileHash(join(out,'runtime-before.json')),protectedFilesSha256:fileHash(join(out,'protected-files.json')),capture:'Unchanged source worker, observational ESM import hook wraps only its Tesseract createWorker/recognize methods; no OCR parameters or returned response are changed.',harnessSha256:fileHash(fileURLToPath(import.meta.url)),createdAt:new Date().toISOString()});
const req=createRequire(join(sourceRoot,'package.json')),tesseractUrl=pathToFileURL(req.resolve('tesseract.js')).href,workerUrl=pathToFileURL(join(sourceRoot,'src/invoice-worker.js')).href;
const layoutModule=await import(pathToFileURL(join(sourceRoot,'sites/lib/ocr-layout.js')).href);
const receipts=[];
for(const question of questions){
 const item=manifest.images.find(image=>image.id===question.id);assert.ok(item);const imagePath=join(sealedRoot,fixture,item.filename),input=readFileSync(imagePath);assert.equal(hash(input),item.sha256);
 const dir=join(out,item.id);mkdirSync(dir);write(join(dir,'question-and-input.json'),{...question,inputSha256:item.sha256,inputBytes:input.length,width:item.width,height:item.height,mimeType:item.mimeType,filename:item.filename});
 const bridge=join(dir,'capture-tesseract.mjs'),hook=join(dir,'capture-hook.mjs');
 writeFileSync(bridge,`import api from ${JSON.stringify(tesseractUrl)};\nimport {writeFileSync} from 'node:fs';\nimport {createHash} from 'node:crypto';\nimport {serialize} from 'node:v8';\nconst dir=${JSON.stringify(dir)},sha=b=>createHash('sha256').update(b).digest('hex');\nconst write=(name,value)=>writeFileSync(dir+'/'+name,JSON.stringify(value,null,2)+'\\n',{flag:'wx'});\nlet calls=0;export const PSM=api.PSM;\nexport async function createWorker(...workerArgs){\n const parameters=[],worker=await api.createWorker(...workerArgs),recognize=worker.recognize,setParameters=worker.setParameters;\n worker.setParameters=async function(...args){parameters.push(structuredClone(args));return Reflect.apply(setParameters,this,args);};\n worker.recognize=async function(...args){\n  if(++calls!==1)throw Error('More than one diagnostic recognition was attempted');\n  const png=Buffer.from(args[0]);writeFileSync(dir+'/recognition-input.png',png,{flag:'wx'});\n  write('recognition-start.json',{calls,startedAt:new Date().toISOString(),workerLanguage:workerArgs[0],workerOEM:workerArgs[1],workerOptions:workerArgs[2],parameters,recognitionOptions:args[1],outputOptions:args[2],rasterSha256:sha(png),rasterBytes:png.length,rasterWidth:png.readUInt32BE(16),rasterHeight:png.readUInt32BE(20)});\n  const result=await Reflect.apply(recognize,this,args);\n  const binary=serialize(result);writeFileSync(dir+'/raw-response.v8',binary,{flag:'wx'});write('raw-response.json',result);\n  write('recognition-finished.json',{calls,completedAt:new Date().toISOString(),rawResponseV8Sha256:sha(binary),globalConfidence:result.data?.confidence,rawTextSha256:sha(result.data?.text||''),topLevelKeys:Object.keys(result),dataKeys:Object.keys(result.data||{})});\n  return result;\n };\n return worker;\n}\n`,{flag:'wx'});
 writeFileSync(hook,`import {registerHooks} from 'node:module';\nregisterHooks({resolve(specifier,context,nextResolve){if(specifier==='tesseract.js'&&context.parentURL===${JSON.stringify(workerUrl)})return {url:${JSON.stringify(pathToFileURL(bridge).href)},shortCircuit:true};return nextResolve(specifier,context);}});\n`,{flag:'wx'});
 const startedAt=new Date().toISOString(),start=performance.now();let stderr='';
 const result=await new Promise((resolve,reject)=>{
  let message=null;const child=fork(new URL(workerUrl),[],{execPath:process.execPath,execArgv:['--max-old-space-size=256','--import',pathToFileURL(hook).href],serialization:'advanced',stdio:['ignore','ignore','pipe','ipc'],cwd:sourceRoot,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP}});
  const timer=setTimeout(()=>{child.kill();reject(Error('Diagnostic worker timeout; no retry.'));},90000);
  child.stderr.on('data',chunk=>{stderr+=chunk.toString();});child.once('message',value=>{message=value;});child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',(code,signal)=>{clearTimeout(timer);if(code!==0||!message)return reject(Error('Diagnostic worker failed: '+code+'/'+signal+' '+stderr));resolve(message);});
  child.send({bytes:input,mime_type:item.mimeType,preview:false});
 });
 const completedAt=new Date().toISOString(),durationMs=performance.now()-start;write(join(dir,'worker-result.json'),result);writeFileSync(join(dir,'worker-stderr.txt'),stderr,{flag:'wx'});
 const raw=deserialize(readFileSync(join(dir,'raw-response.v8'))),json=JSON.parse(readFileSync(join(dir,'raw-response.json'),'utf8'));
 assert.equal(JSON.stringify(raw),JSON.stringify(json),'JSON and exact V8 response retain the same serializable observation');
 const afterLayout=layoutModule.reconstructOcrLayout(raw.data.text,raw.data.blocks);assert.equal(afterLayout.text,result.text,'Read-only replay of unchanged layout must equal the actual worker result');write(join(dir,'layout-replay.json'),afterLayout);
 const lines=(raw.data.blocks||[]).flatMap(block=>(block.paragraphs||[]).flatMap(paragraph=>paragraph.lines||[])),words=lines.flatMap(line=>line.words||[]),firstItem=first.processing.find(old=>old.id===item.id),begin=JSON.parse(readFileSync(join(dir,'recognition-start.json'),'utf8'));
 const receipt={id:item.id,question:question.question,postHoldoutDiagnostic:true,independentHoldout:false,acceptanceMeasurement:false,recognitionCalls:begin.calls,targetSourceCommit:target,sourceSha256:source.sourceSha256,inputSha256:item.sha256,startedAt,completedAt,durationMsIncludingCapture:durationMs,workerError:result.error??null,rawBlocks:raw.data.blocks?.length??0,rawLines:lines.length,rawWords:words.length,globalConfidence:raw.data.confidence,layoutReconstructed:afterLayout.reconstructed,firstV2ObservedTextSha256:firstItem.extractedTextSha256,rawTextSha256:hash(raw.data.text),workerTextSha256:hash(result.text),workerTextMatchesFirstV2:hash(result.text)===firstItem.extractedTextSha256,parameters:begin.parameters,captureHookSha256:fileHash(hook),captureBridgeSha256:fileHash(bridge),artifactHashes:Object.fromEntries(['question-and-input.json','recognition-input.png','recognition-start.json','recognition-finished.json','raw-response.json','raw-response.v8','worker-result.json','worker-stderr.txt','layout-replay.json'].map(file=>[file,fileHash(join(dir,file))]))};
 write(join(dir,'receipt.json'),receipt);receipts.push(receipt);process.stdout.write(JSON.stringify(receipt)+'\n');
 assert.equal(provenance.verifySource(sourceRoot,source),true);assert.equal(verifyProtected(),true);
}
const runtimeAfter={...runtime,dependencies:provenance.runtimeDependencies(sourceRoot),loadAfter:loadavg()};assert.deepEqual(runtimeAfter.dependencies,runtime.dependencies);write(join(out,'runtime-after.json'),runtimeAfter);
write(join(out,'receipt.json'),{schema:'mgeorge-v2-post-holdout-diagnostic-receipt-v1',status:'completed',postHoldoutDiagnostic:true,independentHoldout:false,acceptanceMeasurement:false,targetSourceCommit:target,firstV2Passed:false,firstV2ResultSha256:fileHash(firstPath),sourceStable:provenance.verifySource(sourceRoot,source),protectedFilesStable:verifyProtected(),runtimeDependenciesStable:true,totalRecognitionCalls:receipts.reduce((sum,r)=>sum+r.recognitionCalls,0),cases:receipts.map(({id,question,inputSha256,recognitionCalls,rawBlocks,rawLines,rawWords,globalConfidence,layoutReconstructed,workerTextMatchesFirstV2})=>({id,question,inputSha256,recognitionCalls,rawBlocks,rawLines,rawWords,globalConfidence,layoutReconstructed,workerTextMatchesFirstV2})),completedAt:new Date().toISOString()});
