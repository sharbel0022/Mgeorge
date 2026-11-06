// Known post-holdout raw-response replay only. No worker or OCR invocation.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {projectReviewedFields,evaluateDocument,summarizeDocuments} from '../../test/helpers/ocr-quality-metrics.mjs';
import {localGraph,graphEntries,mandatoryFields,criticalFields} from './ocr-holdout-provenance.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){
 if(!['--packet-root','--source-commit','--output'].includes(args[i])||!args[i+1]||options[args[i]])throw Error('Use --packet-root PATH --source-commit SHA --output NEW.json');
 options[args[i]]=args[i+1];
}
for(const key of ['--packet-root','--source-commit','--output'])if(!options[key])throw Error('Missing '+key);
const packet=resolve(options['--packet-root']),output=resolve(options['--output']),target=options['--source-commit'];
if(existsSync(output))throw Error('Refusing to overwrite any earlier replay');
const base='ae56dc9a9e3d76697e38a196692a337ae0900b0d',diagnostic='e653a8d12fc276e2d6d0ecdbc1710101fd64b3d1',first='45fd0e9d5f13071129da983996c4a6c33804f62d';
const digest=value=>createHash('sha256').update(value).digest('hex');
const blob=(commit,path)=>execFileSync('git',['show',commit+':'+path],{cwd:root,maxBuffer:20_000_000});
const dataModule=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const manifestBytes=readFileSync(join(packet,'manifest.json')),manifest=JSON.parse(manifestBytes);
assert.equal(digest(manifestBytes),'df914f43de498b6f01efc961735113a6f6bbd576c84b688dd510b502c5ae5ed2');
function verifyPacket(){for(const entry of manifest.files){const bytes=readFileSync(join(packet,entry.path));assert.equal(bytes.length,entry.bytes);assert.equal(digest(bytes),entry.sha256,entry.path);}}
verifyPacket();
const opticalGraph=localGraph(root,graphEntries),sourceHashes={};
for(const path of opticalGraph){const bytes=readFileSync(join(root,path));assert.deepEqual(bytes,blob(target,path),'Exact source mismatch: '+path);sourceHashes[path]=digest(bytes);}
const goldBytes=blob(first,'test/fixtures/quality8/ocr-holdout-v2/gold.json'),gold=JSON.parse(goldBytes);
assert.equal(digest(goldBytes),'943a3f9039726d50817de5ad5e913c85aa5210f52e70db487be18e4bb5840af0');
const corpus=JSON.parse(blob(first,'test/fixtures/quality8/ocr-holdout-v2/manifest.json'));
const firstResultBytes=blob(first,'docs/quality8/ocr-independent-holdout-v2-result.json');
assert.equal(digest(firstResultBytes),'13557c3012331fa0101fbe3e6fe498fd2fbf3346b8740cfe5fe4b83e8393b6e7');

const beforeDetails=dataModule(blob(base,'src/invoice-details.js'));
function parserModule(commit,path){
 let source=blob(commit,path).toString('utf8');
 const mappings=path.startsWith('src/')?{'./invoice-details.js':beforeDetails,'./document-triage.js':pathToFileURL(join(root,'src/document-triage.js')).href,'../sites/lib/ocr-bankgiro-evidence.js':pathToFileURL(join(root,'sites/lib/ocr-bankgiro-evidence.js')).href,'./importers.js':pathToFileURL(join(root,'src/importers.js')).href}:{'./invoice-details.js':beforeDetails,'./domain':pathToFileURL(join(root,'sites/lib/domain.ts')).href,'./document-triage.js':pathToFileURL(join(root,'sites/lib/document-triage.js')).href,'./ocr-bankgiro-evidence.js':pathToFileURL(join(root,'sites/lib/ocr-bankgiro-evidence.js')).href};
 for(const [from,to]of Object.entries(mappings))for(const quote of ['"',"'"])source=source.replaceAll(quote+from+quote,JSON.stringify(to));
 return import(dataModule(source));
}
// Only the layout and party modules differ from the already reviewed base.
const changedFromBase=opticalGraph.filter(path=>sourceHashes[path]!==digest(blob(base,path)));
assert.deepEqual(changedFromBase,['sites/lib/invoice-details.js','sites/lib/ocr-layout.js','src/invoice-details.js']);
const beforeLayout=await import(dataModule(blob(base,'sites/lib/ocr-layout.js')));
const afterLayout=await import(pathToFileURL(join(root,'sites/lib/ocr-layout.js')).href);
const beforeNode=await parserModule(base,'src/invoice-extraction.js'),beforeSites=await parserModule(base,'sites/lib/invoice-fields.js');
const afterNode=await import(pathToFileURL(join(root,'src/invoice-extraction.js')).href);
const {loadInvoiceParser}=await import(pathToFileURL(join(root,'sites/tests/helpers/invoice-module-loader.mjs')).href),afterSites=await loadInvoiceParser();
const {collectOcrBankgiroPage,bindOcrBankgiroEvidence}=await import(pathToFileURL(join(root,'sites/lib/ocr-bankgiro-evidence.js')).href);
const wordsOf=blocks=>blocks.flatMap(block=>block.paragraphs.flatMap(paragraph=>paragraph.lines.flatMap(line=>line.words)));
const report={schema:'mgeorge-known-explicit-layout-replay-v1',sourceCommit:target,sourceBase:base,sourceHashes,opticalGraph,changedFromBase,diagnosticCommit:diagnostic,diagnosticManifestSha256:digest(manifestBytes),firstResultCommit:first,firstResultSha256:digest(firstResultBytes),goldSha256:digest(goldBytes),independentHoldout:false,acceptanceMeasurement:false,opticalCallsDuringThisReplay:0,priorUnexpectedLegacyFixtureOcrCalls:3,description:'Known post-holdout regression on two saved full raw responses. No new recognition. The separate three-call legacy-fixture test deviation is recorded in the accompanying report.',metricHelperSha256:digest(readFileSync(join(root,'test/helpers/ocr-quality-metrics.mjs'))),runnerSha256:digest(readFileSync(fileURLToPath(import.meta.url))),startedAt:new Date().toISOString(),runtime:{node:process.version},cases:[],details:[],parserCalls:0,stressIncluded:false};
for(const id of ['holdout-v2-normal-09','holdout-v2-normal-05']){
 const prefix=join(packet,'packet',id),rawBytes=readFileSync(join(prefix,'raw-response.json')),raw=JSON.parse(rawBytes),data=raw.data,before=structuredClone(data);
 const receipt=JSON.parse(readFileSync(join(prefix,'receipt.json'))),worker=JSON.parse(readFileSync(join(prefix,'worker-result.json'))),item=corpus.images.find(item=>item.id===id);
 assert.ok(item);assert.equal(receipt.inputSha256,item.sha256);assert.equal(data.confidence,worker.confidence);
 const inputWords=wordsOf(data.blocks),sourceIndex=new Map(inputWords.map((word,index)=>[word,index]));
 const caseResult={id,population:'known-normal-regression',rawResponseSha256:digest(rawBytes),inputSha256:receipt.inputSha256,recognitionInputSha256:receipt.artifactHashes['recognition-input.png'],confidence:data.confidence,sourceWords:inputWords.length,variants:{}};
 for(const [variant,layout,parsers]of [['before',beforeLayout,[['node',beforeNode.interpretInvoice],['sites',beforeSites.interpretInvoice]]],['after',afterLayout,[['node',afterNode.interpretInvoice],['sites',afterSites.interpretInvoice]]]]){
  const rebuilt=layout.reconstructOcrLayout(data.text,data.blocks),retained=wordsOf(rebuilt.blocks);
  assert.deepEqual(data,before);assert.equal(retained.length,inputWords.length);assert.equal(new Set(retained).size,inputWords.length);for(const word of inputWords)assert.ok(retained.includes(word));
  assert.deepEqual(rebuilt.text.trim().split(/\s+/).sort(),data.text.trim().split(/\s+/).sort());
  if(variant==='before')assert.equal(rebuilt.text,worker.text,'Before helper must reproduce the sealed worker text');
  const evidence=bindOcrBankgiroEvidence(receipt.inputSha256,rebuilt.text,[collectOcrBankgiroPage(rebuilt.text,rebuilt.blocks)]);
  caseResult.variants[variant]={text:rebuilt.text,textSha256:digest(rebuilt.text),reconstructed:rebuilt.reconstructed,wordObjectsPreserved:true,wordRows:rebuilt.blocks.flatMap(block=>block.paragraphs.flatMap(paragraph=>paragraph.lines.map(line=>({text:line.text,originalWordIndices:line.words.map(word=>sourceIndex.get(word))})))),ocrEvidence:evidence};
  for(const [engine,parse]of parsers){
   const started=performance.now(),extraction=parse(rebuilt.text,{...item.metadata,method:'ocr',ocrConfidence:data.confidence,ocrInputSha256:receipt.inputSha256,ocrEvidence:evidence}),durationMs=performance.now()-started;report.parserCalls++;
   const result=evaluateDocument({id,engine,variant,family:'known-layout-diagnosis',subset:'known-normal-regression',...projectReviewedFields(extraction,gold.cases[id]),level:extraction.level,requireReview:gold.cases[id].requireReview,error:null,durationMs,issues:extraction.issues,fieldEvidence:extraction.fields,parties:{supplier:extraction.details.supplier,recipient:extraction.details.recipient}});
   result.falseGreenCritical=result.green&&Boolean(result.requireReview||result.fields.some(field=>criticalFields.includes(field.name)&&!field.correct));
   report.details.push(result);
  }
 }
 report.cases.push(caseResult);
}
const subset=(rows,fields)=>rows.map(row=>evaluateDocument({id:row.id,expected:Object.fromEntries(row.fields.filter(field=>fields.includes(field.name)).map(field=>[field.name,field.expected])),actual:Object.fromEntries(row.fields.filter(field=>fields.includes(field.name)).map(field=>[field.name,field.actual])),level:row.level,requireReview:row.requireReview,error:row.error,durationMs:row.durationMs}));
report.summaries={};
for(const variant of ['before','after'])for(const engine of ['node','sites']){
 const rows=report.details.filter(row=>row.variant===variant&&row.engine===engine);
 report.summaries[variant+'-'+engine]={all13:summarizeDocuments(rows),mandatory10:summarizeDocuments(subset(rows,mandatoryFields)),image9:summarizeDocuments(subset(rows,mandatoryFields.filter(field=>field!=='direction'))),falseGreenCritical:rows.filter(row=>row.falseGreenCritical).length};
}
verifyPacket();for(const [path,sha256]of Object.entries(sourceHashes))assert.equal(digest(readFileSync(join(root,path))),sha256);
report.packetUnchanged=true;report.sourceUnchanged=true;report.completedAt=new Date().toISOString();
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({sourceCommit:target,opticalCallsDuringThisReplay:0,parserCalls:report.parserCalls,summaries:report.summaries,after:report.details.filter(row=>row.variant==='after'&&row.engine==='node').map(row=>({id:row.id,level:row.level,fields:Object.fromEntries(row.fields.map(field=>[field.name,field.actual]))}))},null,2));
