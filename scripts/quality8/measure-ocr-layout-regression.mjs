// Development regression on the already-known holdout V1 images. This does not
// replace, rewrite or constitute a new independent holdout measurement.
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {projectReviewedFields,evaluateDocument,summarizeDocuments} from '../../test/helpers/ocr-quality-metrics.mjs';
import {hash,fileHash,localGraph,resolveLocal,runtimeDependencies,mandatoryFields,criticalFields,graphEntries,downstreamEntries} from './ocr-holdout-provenance.mjs';

const harnessRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--source-root','--output'].includes(args[i])||!args[i+1]||options[args[i]])throw Error('Use --source-root CHECKOUT --output NEW_RESULT.json');options[args[i]]=args[i+1];}
if(!options['--source-root']||!options['--output'])throw Error('Both source and new output paths are required');
const root=resolve(options['--source-root']),output=resolve(options['--output']);
if(existsSync(output))throw Error('Refusing to overwrite a previous measurement');
const fixture=join(harnessRoot,'test/fixtures/quality8/ocr-holdout-v1'),manifestPath=join(fixture,'manifest.json'),firstPath=join(harnessRoot,'docs/quality8/ocr-independent-holdout-result.json');
if(fileHash(manifestPath)!=='6d9bb30d672b23096e469a38d8eabf88ce2582501d3fc2a82b83a96f82f9311b'||fileHash(firstPath)!=='91e1bfd75277c0175a4145739e70759fa9f65b900a75d94dcf94e131b5e59c46')throw Error('The first held measurement/manifest must remain byte-identical');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8')),gold=JSON.parse(readFileSync(join(fixture,'gold.json'),'utf8'));
const protectedFiles={
  'test/fixtures/quality8/ocr-holdout-v1/manifest.json':fileHash(manifestPath),
  'test/fixtures/quality8/ocr-holdout-v1/documents.json':manifest.documentsSha256,
  'test/fixtures/quality8/ocr-holdout-v1/gold.json':manifest.goldSha256,
  'docs/quality8/ocr-independent-holdout-result.json':fileHash(firstPath),
  ...manifest.harnessHashes,
  ...Object.fromEntries(manifest.images.map(item=>['test/fixtures/quality8/ocr-holdout-v1/'+item.filename,item.sha256])),
};
function checkProtected(){for(const [file,want] of Object.entries(protectedFiles))if(fileHash(join(harnessRoot,file))!==want)throw Error('Frozen first-holdout file changed: '+file);}
checkProtected();
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const sourceCommit=git('rev-parse','HEAD'),sourceTree=git('rev-parse','HEAD^{tree}');
const sourceFiles=[...new Set([...git('ls-tree','-r','--name-only','HEAD','--','src','sites/lib').split('\n').filter(Boolean),'package.json','package-lock.json','sites/package.json','sites/package-lock.json'])].sort();
if(git('status','--porcelain','--',...sourceFiles))throw Error('Production source must be clean and committed');
const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,fileHash(join(root,file))]));
const processing=[],details=[],report={schema:'mgeorge-ocr-layout-regression-v1',independentHoldout:false,developmentKnownImages:true,synthetic:true,status:'running',startedAt:new Date().toISOString(),
  sourceCommit,sourceTree,sourceHashes,sourceSha256:hash(JSON.stringify(sourceHashes)),opticalGraph:localGraph(root,graphEntries),downstreamGraph:localGraph(root,downstreamEntries),
  changedSourceFilesFromFirst:Object.keys({...manifest.source.hashes,...sourceHashes}).filter(file=>manifest.source.hashes[file]!==sourceHashes[file]),
  protectedFirstEvidenceHashes:protectedFiles,firstHoldoutFreezeCommit:'82f4a0a07d2f27115e78816b5b7ae8520ad93926',firstHoldoutPassed:false,
  datasetSha256:manifest.datasetSha256,goldSha256:manifest.goldSha256,parameter:'PSM.AUTO; one fixed setting, no parameter grid',
  runnerSha256:fileHash(fileURLToPath(import.meta.url)),metricHelperSha256:fileHash(join(harnessRoot,'test/helpers/ocr-quality-metrics.mjs')),
  runtime:{node:process.version,dependencies:runtimeDependencies(root)},processing,details,
  methodology:{chain:'Actual runDocumentProcess once per unchanged PNG, followed by actual Node and Sites parsers using the resulting text, actual confidence and original-bound word evidence.',
    population:'The same eight readable normal images and two separate stress images as the unsuccessful first holdout. They were used in diagnosis before this change, so this pass is regression evidence only.',
    metrics:'Unchanged existing TP/FP/FN, exact-value and document-exactness helper. Wrong non-null values count as FP and FN; null known values remain FN. All 13 fields and mandatory 10 are reported separately, without pooling engines or stress.',
    metadata:'supplier direction is supplied metadata, not image recovery; the required image-only nine fields are also shown.',
    limits:'Sites uses its actual parser on Node-worker optical output. Browser image/PDF behavior is verified separately in focused tests. No production/cloud transport, registration or financial approval is performed.'}};
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const node=await import(pathToFileURL(join(root,'src/invoice-extraction.js')).href),sitesEntry=join(root,'sites/lib/invoice-fields.js');
let code=readFileSync(sitesEntry,'utf8');
code=code.replace(/\b(from\s*|import\s*\(\s*|import\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,(_,prefix,_quote,specifier)=>prefix+JSON.stringify(pathToFileURL(resolveLocal(root,sitesEntry,specifier)).href));
const sites=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')),parsers=[['node',node.interpretInvoice],['sites',sites.interpretInvoice]];
for(const item of manifest.images){
  let parsed,error=null;const bytes=readFileSync(join(fixture,item.filename)),start=performance.now();
  try{parsed=await node.runDocumentProcess(bytes,item.mimeType);if(parsed.error)error='document-process-error';}catch{parsed={error:true};error='document-process-exception';}
  const processingTimeMs=performance.now()-start,text=parsed.text||'';
  processing.push({id:item.id,population:item.population,inputSha256:item.sha256,method:parsed.method??null,confidence:parsed.confidence??null,ocrEvidence:parsed.ocrEvidence??null,text,textSha256:hash(text),processingTimeMs,error});
  for(const [engine,parse] of parsers){
    const start=performance.now();let extraction,parserError=null;
    try{extraction=parse(text,{...item.metadata,method:parsed.method||'pdf',ocrConfidence:parsed.confidence||0,ocrEvidence:parsed.ocrEvidence,ocrInputSha256:item.sha256});}catch{extraction={fields:{},level:'red',issues:[]};parserError='parser-error';}
    if(error)extraction.level='red';const parsingTimeMs=performance.now()-start;
    const row=evaluateDocument({id:item.id,family:item.layout,subset:item.population,engine,...projectReviewedFields(extraction,gold.cases[item.id]),level:extraction.level,requireReview:gold.cases[item.id].requireReview,error:error||parserError,durationMs:processingTimeMs+parsingTimeMs,processingTimeMs,parsingTimeMs,inputSha256:item.sha256,issues:extraction.issues||[],fieldEvidence:extraction.fields});
    row.falseGreenCritical=row.green&&Boolean(row.error||row.requireReview||item.population==='stress'||row.fields.some(field=>criticalFields.includes(field.name)&&!field.correct));details.push(row);
  }
  save();process.stderr.write(`Regression ${item.id}: ${Math.round(processingTimeMs)} ms\n`);
}
const subset=(rows,fields)=>rows.map(row=>evaluateDocument({id:row.id,family:row.family,subset:row.subset,expected:Object.fromEntries(row.fields.filter(f=>fields.includes(f.name)).map(f=>[f.name,f.expected])),actual:Object.fromEntries(row.fields.filter(f=>fields.includes(f.name)).map(f=>[f.name,f.actual])),level:row.level,requireReview:row.requireReview,error:row.error,durationMs:row.durationMs}));
report.summaries=Object.fromEntries(parsers.map(([engine])=>{
  const normal=details.filter(row=>row.engine===engine&&row.subset==='normal-readable'),stress=details.filter(row=>row.engine===engine&&row.subset==='stress');
  return [engine,{normal:{all13:summarizeDocuments(normal),mandatory10:summarizeDocuments(subset(normal,mandatoryFields)),mandatoryImage9:summarizeDocuments(subset(normal,mandatoryFields.filter(f=>f!=='direction')))},stress:summarizeDocuments(stress),falseGreenCritical:details.filter(row=>row.engine===engine&&row.falseGreenCritical).length}];
}));
report.numericTargets=Object.fromEntries(Object.entries(report.summaries).map(([engine,summary])=>[engine,{all13:summary.normal.all13.fieldPrecision>=.98&&summary.normal.all13.fieldRecall>=.85,mandatory10:summary.normal.mandatory10.fieldPrecision>=.98&&summary.normal.mandatory10.fieldRecall>=.85,zeroFalseGreenCritical:summary.falseGreenCritical===0,stressAbstained:summary.stress.documents===2&&summary.stress.greenCount===0}]));
report.sourceStable=Object.entries(sourceHashes).every(([file,want])=>fileHash(join(root,file))===want);if(!report.sourceStable)throw Error('Product source changed during regression');checkProtected();report.firstEvidenceUnchanged=true;
report.status='completed';report.completedAt=new Date().toISOString();save();
console.log(JSON.stringify({sourceCommit,sourceStable:report.sourceStable,firstEvidenceUnchanged:report.firstEvidenceUnchanged,independentHoldout:false,numericTargets:report.numericTargets,summaries:Object.fromEntries(Object.entries(report.summaries).map(([engine,s])=>[engine,{all13:{counts:s.normal.all13.counts,precision:s.normal.all13.fieldPrecision,recall:s.normal.all13.fieldRecall,exactDocuments:s.normal.all13.exactDocuments},mandatory10:{counts:s.normal.mandatory10.counts,precision:s.normal.mandatory10.fieldPrecision,recall:s.normal.mandatory10.fieldRecall,exactDocuments:s.normal.mandatory10.exactDocuments},falseGreenCritical:s.falseGreenCritical,stressGreen:s.stress.greenCount}]))},null,2));
