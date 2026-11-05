// Development reparse of known, frozen V2 text. No worker, rasterizer or OCR calls.
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {projectReviewedFields, evaluateDocument, summarizeDocuments} from '../../test/helpers/ocr-quality-metrics.mjs';
import {hash, fileHash, resolveLocal, mandatoryFields, criticalFields} from './ocr-holdout-v2-provenance.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const targetCommit='635ca5e';
const originalPath='docs/quality8/ocr-independent-holdout-v2-result.json';
const originalHash='13557c3012331fa0101fbe3e6fe498fd2fbf3346b8740cfe5fe4b83e8393b6e7';
const output=resolve(process.argv[2]||'');
if(!process.argv[2]||existsSync(output))throw Error('Supply a new output file; existing evidence is never overwritten');
if(fileHash(join(root,originalPath))!==originalHash)throw Error('First V2 result changed');
const previous=JSON.parse(readFileSync(join(root,originalPath),'utf8'));
if(previous.status!=='completed'||previous.passed!==false)throw Error('Unexpected first result');
const fixture=join(root,'test/fixtures/quality8/ocr-holdout-v2');
const manifest=JSON.parse(readFileSync(join(fixture,'manifest.json'),'utf8'));
const gold=JSON.parse(readFileSync(join(fixture,'gold.json'),'utf8'));
if(fileHash(join(fixture,'manifest.json'))!==previous.manifestSha256||fileHash(join(fixture,'gold.json'))!==previous.goldSha256)throw Error('Frozen corpus changed');
if(manifest.images.length!==previous.processing.length)throw Error('Wrong observation population');
for(const [i,item] of manifest.images.entries()){
 const sample=previous.processing[i];
 if(sample.id!==item.id||sample.population!==item.population||sample.inputSha256!==item.sha256||hash(sample.observedText)!==sample.extractedTextSha256)throw Error('Stored observation mismatch');
}
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const sourceCommit=git('rev-parse',targetCommit);
const paths=[...new Set([...git('ls-tree','-r','--name-only',sourceCommit,'--','src','sites/lib').split('\n'),'package.json','package-lock.json','sites/package.json','sites/package-lock.json'])].filter(Boolean).sort();
const sourceHashes=Object.fromEntries(paths.map(path=>{
 const actual=readFileSync(join(root,path)),expected=execFileSync('git',['show',sourceCommit+':'+path],{cwd:root,maxBuffer:10_000_000});
 if(!actual.equals(expected))throw Error('Source differs from exact target: '+path);
 return [path,hash(actual)];
}));
const node=await import(pathToFileURL(join(root,'src/invoice-extraction.js')).href);
const entry=join(root,'sites/lib/invoice-fields.js');
let code=readFileSync(entry,'utf8');
code=code.replace(/\b(from\s*|import\s*\(\s*|import\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,(_,prefix,_quote,specifier)=>prefix+JSON.stringify(pathToFileURL(resolveLocal(root,entry,specifier)).href));
const sites=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const engines=[['node',node.interpretInvoice],['sites',sites.interpretInvoice]];
const report={schema:'mgeorge-known-v2-stored-text-reparse-v1',status:'running',startedAt:new Date().toISOString(),independentHoldout:false,knownDevelopmentCorpus:true,ocrCalls:0,parserCalls:0,sourceCommit,sourceTree:git('rev-parse',sourceCommit+'^{tree}'),sourceHashes,runnerSha256:fileHash(fileURLToPath(import.meta.url)),metricHelperSha256:fileHash(join(root,'test/helpers/ocr-quality-metrics.mjs')),runtime:{node:process.version},originalFirstResult:{path:originalPath,sha256:originalHash,source:previous.targetSourceCommit,passed:false},datasetSha256:previous.datasetSha256,goldSha256:previous.goldSha256,manifestSha256:previous.manifestSha256,observationsSha256:hash(JSON.stringify(previous.processing)),details:[],summaries:{},limitations:['Known V2 texts, not an independent acceptance population.','No new OCR or geometry reconstruction: stored text, word evidence, confidence and hashes are supplied unchanged.','Both parsers share the same historical optical result.','Direction remains supplied context; image9 excludes it.','No production, upload, automatic registration, payment or mail test.']};
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
for(const [i,item] of manifest.images.entries()){
 const sample=previous.processing[i];
 for(const [engine,parse] of engines){
  const start=performance.now();let extraction,error=null;report.parserCalls++;
  try{extraction=parse(sample.observedText,{...item.metadata,method:sample.method||'pdf',ocrConfidence:sample.ocrConfidence||0,ocrEvidence:sample.ocrEvidence,ocrInputSha256:sample.inputSha256});}
  catch{extraction={fields:{},level:'red',issues:[]};error='parser-error';}
  if(sample.error)extraction.level='red';
  const row=evaluateDocument({id:item.id,family:item.layout,subset:item.population,engine,...projectReviewedFields(extraction,gold.cases[item.id]),level:extraction.level,requireReview:gold.cases[item.id].requireReview,error:sample.error||error,durationMs:performance.now()-start,issues:extraction.issues||[],fieldEvidence:extraction.fields,inputSha256:sample.inputSha256,observationSha256:hash(JSON.stringify(sample))});
  row.falseGreenCritical=row.green&&Boolean(row.error||row.requireReview||item.population==='stress'||row.fields.some(f=>criticalFields.includes(f.name)&&!f.correct));
  report.details.push(row);
 }
}
const scoped=(rows,names)=>rows.map(row=>evaluateDocument({id:row.id,family:row.family,subset:row.subset,engine:row.engine,expected:Object.fromEntries(row.fields.filter(f=>names.includes(f.name)).map(f=>[f.name,f.expected])),actual:Object.fromEntries(row.fields.filter(f=>names.includes(f.name)).map(f=>[f.name,f.actual])),level:row.level,requireReview:row.requireReview,error:row.error,durationMs:row.durationMs}));
for(const [engine] of engines){
 const normal=report.details.filter(r=>r.engine===engine&&r.subset==='normal-readable'),stress=report.details.filter(r=>r.engine===engine&&r.subset==='stress');
 report.summaries[engine]={normal:{all13:summarizeDocuments(normal),mandatory10:summarizeDocuments(scoped(normal,mandatoryFields)),image9:summarizeDocuments(scoped(normal,mandatoryFields.filter(f=>f!=='direction')))},stress:summarizeDocuments(stress),falseGreenCritical:report.details.filter(r=>r.engine===engine&&r.falseGreenCritical).length};
}
report.sourceStable=Object.entries(sourceHashes).every(([p,h])=>fileHash(join(root,p))===h);
report.firstResultUnchanged=fileHash(join(root,originalPath))===originalHash;
report.observationsUnchanged=hash(JSON.stringify(previous.processing))===report.observationsSha256;
if(!report.sourceStable||!report.firstResultUnchanged||!report.observationsUnchanged)throw Error('Protected data changed');
report.status='completed';report.completedAt=new Date().toISOString();writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sourceCommit,ocrCalls:report.ocrCalls,parserCalls:report.parserCalls,firstHoldoutStillFailed:true,summaries:Object.fromEntries(Object.entries(report.summaries).map(([engine,s])=>[engine,{...Object.fromEntries(Object.entries(s.normal).map(([k,m])=>[k,{counts:m.counts,precision:m.fieldPrecision,recall:m.fieldRecall,exactDocuments:m.exactDocuments}])),falseGreenCritical:s.falseGreenCritical,stressGreenCount:s.stress.greenCount}]))},null,2));

