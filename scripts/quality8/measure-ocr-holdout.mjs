// One preregistered pass through the unchanged real worker and both parsers.
// No expected value, threshold, input image or product source is written here.
import {readFileSync,writeFileSync,existsSync,mkdirSync,realpathSync} from 'node:fs';
import {dirname,resolve,join,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {cpus,platform,release,arch,loadavg} from 'node:os';
import {projectReviewedFields,evaluateDocument,summarizeDocuments} from '../../test/helpers/ocr-quality-metrics.mjs';
import {hash,fileHash,verifySource,resolveLocal,runtimeDependencies,mandatoryFields,criticalFields} from './ocr-holdout-provenance.mjs';

const harnessRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const fixture=join(harnessRoot,'test/fixtures/quality8/ocr-holdout-v1');
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){
  if(!['--source-root','--output'].includes(args[i])||!args[i+1]||options[args[i]])throw Error('Usage: node scripts/quality8/measure-ocr-holdout.mjs --source-root EXACT_CHECKOUT_OR_ARCHIVE --output NEW_RESULT.json');
  options[args[i]]=args[i+1];
}
if(!options['--source-root']||!options['--output'])throw Error('Both --source-root and --output are required');
const sourceRoot=resolve(options['--source-root']),output=resolve(options['--output']);
if(existsSync(output))throw Error('Refusing to overwrite an earlier measurement');
const manifestPath=join(fixture,'manifest.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const gold=JSON.parse(readFileSync(join(fixture,'gold.json'),'utf8'));
if(fileHash(join(fixture,'gold.json'))!==manifest.goldSha256||fileHash(join(fixture,'documents.json'))!==manifest.documentsSha256)throw Error('Gold/specification changed after freeze');
for(const [file,want] of Object.entries(manifest.harnessHashes))if(fileHash(join(harnessRoot,file))!==want)throw Error('Measurement harness changed after freeze: '+file);
for(const item of manifest.images)if(fileHash(join(fixture,item.filename))!==item.sha256)throw Error('Input image changed after freeze: '+item.id);
verifySource(sourceRoot,manifest.source);
const runtime=runtimeDependencies(sourceRoot);
if(JSON.stringify(runtime)!==JSON.stringify(manifest.runtime))throw Error('Runtime dependencies or trained data changed after freeze');
const frozenPaths=[relative(harnessRoot,manifestPath),'test/fixtures/quality8/ocr-holdout-v1/documents.json','test/fixtures/quality8/ocr-holdout-v1/gold.json',...manifest.images.map(item=>'test/fixtures/quality8/ocr-holdout-v1/'+item.filename),...Object.keys(manifest.harnessHashes)];
const freezeCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:harnessRoot,encoding:'utf8'}).trim();
for(const file of frozenPaths){
  const committed=execFileSync('git',['show',freezeCommit+':'+file],{cwd:harnessRoot,maxBuffer:10_000_000});
  if(hash(committed)!==fileHash(join(harnessRoot,file)))throw Error('Corpus/harness must be committed before first OCR: '+file);
}
const startedAt=new Date().toISOString(),beforeLoad=loadavg(),details=[],processing=[];
const report={schema:'mgeorge-independent-ocr-holdout-result-v1',synthetic:true,status:'running',startedAt,freezeCommit,
  targetSourceCommit:manifest.source.targetCommit,targetSourceTree:manifest.source.targetTree,sourceRoot,sourceSha256:manifest.source.sourceSha256,
  manifestSha256:fileHash(manifestPath),datasetSha256:manifest.datasetSha256,goldSha256:manifest.goldSha256,harnessSha256:manifest.harnessSha256,
  sourceHashes:manifest.source.hashes,opticalGraph:manifest.source.opticalGraph,downstreamGraph:manifest.source.downstreamGraph,
  sourceStable:null,corpusStable:null,preregistration:manifest.preregistration,
  runtime:{node:process.version,versions:process.versions,platform:platform(),osRelease:release(),architecture:arch(),cpuModel:cpus()[0]?.model??null,cpuCount:cpus().length,dependencies:runtime,sourceNodeModules:realpathSync(join(sourceRoot,'node_modules')),loadBefore:beforeLoad},
  methodology:{
    opticalChain:'One real runDocumentProcess(bytes, image/png) call per frozen raster, from the exact selected source. Its original text, actual confidence and hash-bound word evidence are passed once to the actual Node parser and once to the actual Sites parser. No confidence override, OCR-text editing or gold-dependent input preprocessing.',
    sitesScope:'The actual Sites field parser consumes the same Node-worker optical output. This measures Sites field interpretation after the existing worker, not browser Tesseract, cloud transport, upload, registration or payment approval.',
    scalarPrecision:'TP/(TP+FP); an incorrect non-null value counts as both FP and FN. Null output for a known source value counts as FN. Exact string and integer minor-unit comparison uses the unchanged existing metric helper.',
    scalarRecall:'TP/(TP+FN), independently for all 13 fields, mandatory 10 and mandatory 9 excluding the supplied direction metadata.',
    documentExactness:'Every field in the corresponding scope must equal gold, and processing must not have failed. No case is omitted from its fixed population.',
    falseGreen:'The existing strict false-green rubric applies to all 13 fields. Critical false-green is also counted explicitly when green occurs with processing failure, required review, stress input or a wrong/missing critical field.',
    independence:'New specifications, separate literal gold, frozen raster bytes and preregistered measurement code were committed before the first OCR call. No observed holdout output was used for source, threshold, corpus or answer changes.',
    timing:'One cold child OCR worker per input; its measured processing time is shared by the two parser evaluations. Parser durations are measured separately. Per-engine times must not be summed to estimate wall time.'},
  processing,details,limitations:[
    'Small purposive synthetic sample; eight readable layouts do not establish population precision at 98% with statistical confidence or represent all customer invoices.',
    'Single-page printed Swedish SEK supplier invoices with 25% VAT and explicit labels. No handwriting, arbitrary multi-page documents, other currencies/languages or real customer originals.',
    'Direction is supplied trusted context, not visually recognized. Required image-derived fields are additionally reported without direction.',
    'Both engines share one optical result for each raster. The 16 normal parser evaluations are not 16 independent images.',
    'OCR documents remain under the product manual-review policy. Zero false-green results alone does not demonstrate usable automatic economic approval.',
    'Stress image gold retains the uncorrupted source facts. Safe abstention lowers stress recall; stress is never pooled into or substituted for the readable acceptance population.',
    'All src/ and sites/lib/ hashes are retained to detect later relevant changes. Only the worker and field parsers are executed here; downstream economy/domain/presentation hashes are contextual provenance, not functional acceptance of those services.',
    'No live bank, Gmail, production data, paid OCR service, network OCR model download or new dependency is used. Installed local Swedish trained data are hashed.',
    'Measured time depends on this shared host, its load and installed native dependencies; no production latency guarantee is inferred.'
  ]};
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
const checkpoint=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');

const node=await import(pathToFileURL(join(sourceRoot,'src/invoice-extraction.js')).href);
const sitesEntry=join(sourceRoot,'sites/lib/invoice-fields.js');
let sitesSource=readFileSync(sitesEntry,'utf8');
// Identical import-URL adaptation to the repository's existing measurement.
// The parser logic and its selected-checkout dependencies are not replaced.
sitesSource=sitesSource.replace(/\b(from\s*|import\s*\(\s*|import\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,(_,prefix,_quote,specifier)=>prefix+JSON.stringify(pathToFileURL(resolveLocal(sourceRoot,sitesEntry,specifier)).href));
const sites=await import('data:text/javascript;base64,'+Buffer.from(sitesSource).toString('base64'));
const engines=[['node',node.interpretInvoice],['sites',sites.interpretInvoice]];
for(const sample of manifest.images){
  const bytes=readFileSync(join(fixture,sample.filename)),sampleStartedAt=new Date().toISOString();
  if(!report.firstOcrStartedAt){report.firstOcrStartedAt=sampleStartedAt;checkpoint();}
  let processed,error=null;const start=performance.now();
  try{processed=await node.runDocumentProcess(bytes,sample.mimeType);if(processed.error)error='document-process-error';}
  catch{processed={error:true};error='document-process-exception';}
  const processingTimeMs=performance.now()-start,text=processed.text||'';
  processing.push({id:sample.id,population:sample.population,startedAt:sampleStartedAt,completedAt:new Date().toISOString(),inputSha256:sample.sha256,inputBytes:bytes.length,mimeType:sample.mimeType,method:processed.method??null,ocrConfidence:processed.confidence??null,ocrEvidence:processed.ocrEvidence??null,processingTimeMs,error,extractedCharacters:text.length,extractedTextSha256:hash(text),observedText:text});
  for(const [engine,parse] of engines){
    let extraction,parserError=null;const parseStarted=performance.now();
    try{extraction=parse(text,{...sample.metadata,method:processed.method||'pdf',ocrConfidence:processed.confidence||0,ocrEvidence:processed.ocrEvidence,ocrInputSha256:sample.sha256});}
    catch{extraction={fields:{},level:'red',issues:[]};parserError='parser-error';}
    if(error)extraction.level='red';
    const parsingTimeMs=performance.now()-parseStarted;
    const row=evaluateDocument({id:sample.id,family:sample.layout,subset:sample.population,engine,...projectReviewedFields(extraction,gold.cases[sample.id]),level:extraction.level,requireReview:gold.cases[sample.id].requireReview,durationMs:processingTimeMs+parsingTimeMs,processingTimeMs,parsingTimeMs,error:error||parserError,inputSha256:sample.sha256,method:processed.method??null,issues:extraction.issues||[],fieldEvidence:extraction.fields,notes:sample.notes});
    row.falseGreenCritical=row.green&&Boolean(row.error||row.requireReview||sample.population==='stress'||row.fields.some(field=>criticalFields.includes(field.name)&&!field.correct));
    details.push(row);
  }
  checkpoint();process.stderr.write(`Measured ${sample.id}: ${Math.round(processingTimeMs)} ms${error?' ('+error+')':''}\n`);
}

function scopedRows(rows,names){
  return rows.map(row=>{
    const fields=row.fields.filter(field=>names.includes(field.name));
    return evaluateDocument({id:row.id,family:row.family,subset:row.subset,engine:row.engine,expected:Object.fromEntries(fields.map(field=>[field.name,field.expected])),actual:Object.fromEntries(fields.map(field=>[field.name,field.actual])),level:row.level,requireReview:row.requireReview,durationMs:row.durationMs,error:row.error});
  });
}
const numericGate=summary=>({precisionMinimum:manifest.preregistration.normalPrecisionMinimum,recallMinimum:manifest.preregistration.normalRecallMinimum,
  precisionPassed:summary.fieldPrecision!==null&&summary.fieldPrecision>=manifest.preregistration.normalPrecisionMinimum,
  recallPassed:summary.fieldRecall!==null&&summary.fieldRecall>=manifest.preregistration.normalRecallMinimum,
  passed:summary.fieldPrecision!==null&&summary.fieldPrecision>=manifest.preregistration.normalPrecisionMinimum&&summary.fieldRecall!==null&&summary.fieldRecall>=manifest.preregistration.normalRecallMinimum&&summary.errorCount===0});
report.summaries={};report.acceptance={};
for(const [engine] of engines){
  const normal=details.filter(row=>row.engine===engine&&row.subset==='normal-readable'),stress=details.filter(row=>row.engine===engine&&row.subset==='stress');
  const all13=summarizeDocuments(normal),mandatory10=summarizeDocuments(scopedRows(normal,mandatoryFields)),mandatoryImage9=summarizeDocuments(scopedRows(normal,mandatoryFields.filter(field=>field!=='direction'))),stress13=summarizeDocuments(stress);
  report.summaries[engine]={normal:{all13,mandatory10,mandatoryImage9},stress:{all13:stress13},falseGreenCritical:details.filter(row=>row.engine===engine&&row.falseGreenCritical).length};
  report.acceptance[engine]={normalAll13:numericGate(all13),normalMandatory10:numericGate(mandatory10),zeroFalseGreenCritical:report.summaries[engine].falseGreenCritical===0,stressAbstained:stress.length===2&&stress.every(row=>!row.green),normalProcessingErrors:normal.filter(row=>row.error).length};
  const gate=report.acceptance[engine];gate.passed=gate.normalAll13.passed&&gate.normalMandatory10.passed&&gate.zeroFalseGreenCritical&&gate.stressAbstained;
}
verifySource(sourceRoot,manifest.source);report.sourceStable=true;
report.corpusStable=fileHash(manifestPath)===report.manifestSha256&&fileHash(join(fixture,'gold.json'))===manifest.goldSha256&&fileHash(join(fixture,'documents.json'))===manifest.documentsSha256&&manifest.images.every(item=>fileHash(join(fixture,item.filename))===item.sha256)&&Object.entries(manifest.harnessHashes).every(([file,want])=>fileHash(join(harnessRoot,file))===want);
if(!report.corpusStable)throw Error('Frozen corpus/harness changed during measurement');
report.status='completed';report.completedAt=new Date().toISOString();report.runtime.loadAfter=loadavg();report.passed=Object.values(report.acceptance).every(gate=>gate.passed);checkpoint();
console.log(JSON.stringify({output,freezeCommit,targetSourceCommit:report.targetSourceCommit,sourceStable:report.sourceStable,corpusStable:report.corpusStable,passed:report.passed,acceptance:report.acceptance,summaries:Object.fromEntries(Object.entries(report.summaries).map(([engine,s])=>[engine,{all13:{counts:s.normal.all13.counts,precision:s.normal.all13.fieldPrecision,recall:s.normal.all13.fieldRecall,exactDocuments:s.normal.all13.exactDocuments},mandatory10:{counts:s.normal.mandatory10.counts,precision:s.normal.mandatory10.fieldPrecision,recall:s.normal.mandatory10.fieldRecall,exactDocuments:s.normal.mandatory10.exactDocuments},mandatoryImage9:{precision:s.normal.mandatoryImage9.fieldPrecision,recall:s.normal.mandatoryImage9.fieldRecall},falseGreenCritical:s.falseGreenCritical,stressGreenCount:s.stress.all13.greenCount}]))},null,2));
// A valid negative acceptance result is a completed measurement, not a harness
// error. Its explicit passed:false is retained in JSON and the written report.
