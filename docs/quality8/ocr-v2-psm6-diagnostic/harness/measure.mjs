import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fork,execFileSync} from 'node:child_process';
import {deserialize} from 'node:v8';
import {performance} from 'node:perf_hooks';
import {root,folder,packet,target,corpusCommit,fixture,firstPath,baselinePath,json,write,git,hash,fileHash,verifySource,verifyCorpus,runtimeInventory,hostObservation,parsers,parseRows,summaries,compareFields,percentCount} from './common.mjs';

assert.ok(process.argv.length===3&&['--check','--run'].includes(process.argv[2]),'Use --check or --run');
const run=process.argv[2]==='--run',plan=json(join(packet,'plan.json')),source=json(join(packet,'source-inventory.json')),runtime=json(join(packet,'runtime-before.json')),inputs=json(join(packet,'input-inventory.json')),protectedFiles=json(join(packet,'protected-files.json'));
const verify=()=>{
  assert.equal(process.version,'v24.22.1');assert.equal(plan.targetSourceCommit,target);assert.equal(plan.corpusFreezeCommit,corpusCommit);
  verifySource(root,source);verifySource(plan.sourceRoot,source);verifyCorpus(root,corpusCommit);
  assert.equal(fileHash(join(plan.sourceRoot,'src/invoice-worker-psm6.js')),plan.diagnosticWorkerSha256);
  for(const [path,want] of Object.entries(plan.harnessHashes))assert.equal(fileHash(join(folder,path)),want,path);
  for(const [path,want] of Object.entries(plan.inventoryHashes))assert.equal(fileHash(join(packet,path)),want,path);
  for(const [path,want] of Object.entries(protectedFiles))assert.equal(fileHash(join(root,path)),want,path);
  assert.deepEqual(runtimeInventory(),runtime,'Runtime changed after preparation');
  return true;
};
verify();
const planPath=join(packet,'plan.json'),planSha256=fileHash(planPath),planCommit=git('rev-parse','HEAD');
if(run){
  for(const path of [relative(root,planPath),...Object.keys(plan.harnessHashes).map(path=>relative(root,join(folder,path))),...Object.keys(plan.inventoryHashes).map(path=>relative(root,join(packet,path)))]){
    const committed=execFileSync('git',['show',planCommit+':'+path],{cwd:root,maxBuffer:30_000_000});assert.equal(hash(committed),fileHash(join(root,path)),'Exact preregistration must be committed: '+path);
  }
}
const first=json(firstPath),baseline=json(baselinePath),gold=json(join(fixture,'gold.json')),engines=await parsers(),psm3=[];
for(const item of inputs){
  const old=first.processing.find(row=>row.id===item.id);assert.ok(old);
  psm3.push(...parseRows(engines,item,{text:old.observedText,method:old.method,confidence:old.ocrConfidence,ocrEvidence:old.ocrEvidence},gold,old.error));
}
for(const row of psm3){
  const recorded=baseline.details.find(old=>old.id===row.id&&old.engine===row.engine);assert.ok(recorded);
  assert.deepEqual(row.fields.map(f=>({name:f.name,expected:f.expected,actual:f.actual,correct:f.correct})),recorded.fields.map(f=>({name:f.name,expected:f.expected,actual:f.actual,correct:f.correct})),`Stored PSM3 replay parity ${row.id}/${row.engine}`);
  assert.equal(row.level,recorded.level);assert.equal(row.falseGreenCritical,recorded.falseGreenCritical);
}
const psm3Summaries=summaries(psm3);
if(!run){console.log(JSON.stringify({checkPassed:true,ocrCalls:0,parserCalls:24,planSha256,baselineMandatoryRecall:psm3Summaries.node.normal.mandatory10.fieldRecall}));process.exit(0);}

const attemptPath=join(packet,'first-attempt.json');
assert.ok(!existsSync(attemptPath),'One registered attempt already exists; rerun forbidden');
write(attemptPath,{planCommit,planSha256,startedAt:new Date().toISOString(),mode:6,maximumRecognitionCalls:12,noRetries:true});
const casesDir=join(packet,'cases');mkdirSync(casesDir);
const output=join(packet,'result.json'),report={schema:'mgeorge-known-v2-psm6-result-v1',status:'running',postHoldoutDiagnostic:true,independentHoldout:false,productionScoreChange:false,startedAt:new Date().toISOString(),planCommit,planSha256,targetSourceCommit:target,firstResultSha256:fileHash(firstPath),baselineReparseSha256:fileHash(baselinePath),firstResultOriginalSummary:first.summaries,psm3Summaries,psm3Details:psm3,processing:[],psm6Details:[],opticalCallsStarted:0,opticalCallsCompleted:0,parserCalls:24,runtimeBefore:hostObservation()};
write(output,report);
const checkpoint=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const workerPath=join(plan.sourceRoot,'src/invoice-worker-psm6.js');
const hookUrl=pathToFileURL(join(folder,'harness/capture-hook.mjs')).href;
const layout=await import(pathToFileURL(join(root,'sites/lib/ocr-layout.js')).href);
try{
  for(const item of inputs){
    const dir=join(casesDir,item.id);mkdirSync(dir);
    const bytes=readFileSync(join(fixture,item.filename));assert.equal(hash(bytes),item.sha256);
    write(join(dir,'intent.json'),{id:item.id,population:item.population,inputSha256:item.sha256,expectedRasterSha256:item.expectedRasterSha256,rasterWidth:item.rasterWidth,rasterHeight:item.rasterHeight,planCommit,planSha256});
    const startedAt=new Date().toISOString(),start=performance.now();let stderr='',workerResult=null,workerError=null;
    try{
      workerResult=await new Promise((resolve,reject)=>{
        let message=null;const child=fork(workerPath,[],{execPath:process.execPath,execArgv:['--max-old-space-size=256','--import',hookUrl],serialization:'advanced',stdio:['ignore','ignore','pipe','ipc'],cwd:plan.sourceRoot,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,OCR_DIAGNOSTIC_WORKER:workerPath,OCR_DIAGNOSTIC_CASE:dir}});
        const timer=setTimeout(()=>{child.kill();reject(Error('Worker timeout; no retry'));},90000);
        child.stderr.on('data',chunk=>{stderr+=chunk.toString();});child.once('message',value=>{message=value;});child.once('error',error=>{clearTimeout(timer);reject(error);});
        child.once('exit',(code,signal)=>{clearTimeout(timer);if(code!==0||!message)return reject(Error('Worker failed '+code+'/'+signal));resolve(message);});
        child.send({bytes,mime_type:item.mimeType,preview:false});
      });
      if(workerResult.error)workerError='document-process-error';
    }catch(error){workerError=String(error);workerResult={error:true};}
    write(join(dir,'worker-result.json'),workerResult);writeFileSync(join(dir,'worker-stderr.txt'),stderr,{flag:'wx'});
    const begin=existsSync(join(dir,'recognition-start.json'))?json(join(dir,'recognition-start.json')):null;
    const finished=existsSync(join(dir,'recognition-finished.json'))?json(join(dir,'recognition-finished.json')):null;
    if(begin)report.opticalCallsStarted+=begin.calls;if(finished)report.opticalCallsCompleted+=finished.calls;
    let raw=null,rawLines=[],rawWords=[],layoutReplay=null;
    if(existsSync(join(dir,'raw-response.v8'))){
      raw=deserialize(readFileSync(join(dir,'raw-response.v8')));assert.equal(JSON.stringify(raw),JSON.stringify(json(join(dir,'raw-response.json'))));
      rawLines=(raw.data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>p.lines||[]));rawWords=rawLines.flatMap(line=>line.words||[]);
      layoutReplay=layout.reconstructOcrLayout(raw.data.text,raw.data.blocks);write(join(dir,'layout-replay.json'),layoutReplay);
      if(!workerError)assert.equal(layoutReplay.text,workerResult.text,'Raw replay equals actual unchanged product layout');
    }
    const old=first.processing.find(row=>row.id===item.id);
    const row={id:item.id,population:item.population,layout:item.layout,startedAt,completedAt:new Date().toISOString(),durationMs:performance.now()-start,inputSha256:item.sha256,expectedRasterSha256:item.expectedRasterSha256,actualRasterSha256:begin?.rasterSha256||null,recognitionCalls:begin?.calls||0,completedRecognitionCalls:finished?.calls||0,error:workerError,method:workerResult.method??null,confidence:workerResult.confidence??null,rawBlocks:raw?.data?.blocks?.length??0,rawLines:rawLines.length,rawWords:rawWords.length,rawText:raw?.data?.text??null,observedText:workerResult.text??null,ocrEvidence:workerResult.ocrEvidence??null,layoutReconstructed:layoutReplay?.reconstructed??null,percentMarkers:{rendered:item.renderedPercentCount,psm3Worker:percentCount(old.observedText),psm6Raw:percentCount(raw?.data?.text),psm6Worker:percentCount(workerResult.text)},artifactHashes:Object.fromEntries(readdirSync(dir).sort().map(name=>[name,fileHash(join(dir,name))]))};
    write(join(dir,'receipt.json'),row);report.processing.push(row);report.psm6Details.push(...parseRows(engines,item,workerResult,gold,workerError));report.parserCalls+=2;checkpoint();
    console.log(JSON.stringify({id:item.id,recognitionCalls:row.recognitionCalls,completedRecognitionCalls:row.completedRecognitionCalls,error:row.error,durationMs:Math.round(row.durationMs),rawWords:row.rawWords}));
    if(!begin||begin.calls!==1||!finished||finished.calls!==1)throw Error('Optical/capture failure; retained partial attempt, no rerun');
  }
  report.psm6Summaries=summaries(report.psm6Details);report.fieldComparison=compareFields(psm3,report.psm6Details);
  report.diagnosticThresholds={};
  for(const [engine,result] of Object.entries(report.psm6Summaries)){
    const numeric=scope=>({precision:scope.fieldPrecision,recall:scope.fieldRecall,passed:scope.fieldPrecision!==null&&scope.fieldPrecision>=.98&&scope.fieldRecall!==null&&scope.fieldRecall>=.85&&scope.errorCount===0});
    const gate={all13:numeric(result.normal.all13),mandatory10:numeric(result.normal.mandatory10),zeroCriticalFalseGreen:result.falseGreenCritical===0,stressAbstained:result.stress.all13.documents===2&&result.stress.all13.greenCount===0};
    gate.passed=gate.all13.passed&&gate.mandatory10.passed&&gate.zeroCriticalFalseGreen&&gate.stressAbstained;report.diagnosticThresholds[engine]=gate;
  }
  report.sourceRuntimeCorpusAndHarnessStable=verify();report.runtimeAfter=hostObservation();assert.equal(report.opticalCallsStarted,12);assert.equal(report.opticalCallsCompleted,12);
  report.status='completed';report.completedAt=new Date().toISOString();checkpoint();
}catch(error){report.status='interrupted';report.error=String(error);report.completedAt=new Date().toISOString();report.psm6Summaries=summaries(report.psm6Details);checkpoint();console.error(report.error);process.exitCode=1;}
console.log(JSON.stringify({status:report.status,output,ocrCalls:report.opticalCallsStarted,completedOcrCalls:report.opticalCallsCompleted,diagnosticThresholds:report.diagnosticThresholds??null}));
