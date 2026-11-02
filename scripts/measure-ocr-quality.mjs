// Reproducible synthetic field benchmark. Run this same file against both
// checkouts; --source-root selects application code, never a different corpus.
import {readFileSync,writeFileSync,existsSync,mkdirSync,realpathSync} from 'node:fs';
import {resolve,join,dirname,extname,relative} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {cpus,loadavg,platform,release,arch} from 'node:os';
import {corpusVersion,textCases,opticalCases,buildOpticalInputs,scalarFieldNames} from '../test/helpers/ocr-quality-corpus.mjs';
import {projectReviewedFields,evaluateDocument,summarizeDocuments} from '../test/helpers/ocr-quality-metrics.mjs';

const args=process.argv.slice(2),allowed=new Set(['--source-root','--output','--text-repeats','--text-only','--help']);
for(let i=0;i<args.length;i++){
  if(!allowed.has(args[i]))throw Error('Unknown argument: '+args[i]);
  if(!['--text-only','--help'].includes(args[i])){
    if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing value for '+args[i]);
    i++;
  }
}
if(args.includes('--help')){
  console.log('node scripts/measure-ocr-quality.mjs --source-root CHECKOUT --output REPORT.json [--text-repeats 5] [--text-only]');
  process.exit(0);
}
const option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const root=resolve(option('--source-root')||'.'),output=option('--output'),textOnly=args.includes('--text-only');
const repeats=Number(option('--text-repeats')??5);
if(!Number.isSafeInteger(repeats)||repeats<1||repeats>1000)throw Error('--text-repeats must be an integer from 1 through 1000');
const hash=value=>createHash('sha256').update(value).digest('hex');
const runnerRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const startedAt=new Date().toISOString(),loadBefore=loadavg();
const git=(...gitArgs)=>execFileSync('git',gitArgs,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const resolveLocal=(importer,specifier)=>{
  const target=resolve(dirname(importer),specifier);
  const choices=extname(target)?[target]:[target,target+'.js',target+'.mjs',target+'.ts',join(target,'index.js')];
  const match=choices.find(path=>existsSync(path));
  if(!match)throw Error('Cannot resolve local import '+specifier+' from '+relative(root,importer));
  return match;
};
const localImports=source=>[...source.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)(['"])(\.{1,2}\/[^'"]+)\1/g)];
function sourceHashes(){
  const seen=new Set(),pending=['src/invoice-extraction.js','src/invoice-worker.js','sites/lib/invoice-fields.js'].map(file=>join(root,file));
  while(pending.length){
    const file=pending.pop();if(seen.has(file))continue;
    if(!file.startsWith(root+'/'))throw Error('Source import escapes selected checkout');
    seen.add(file);
    const source=readFileSync(file,'utf8');
    for(const match of localImports(source))pending.push(resolveLocal(file,match[2]));
  }
  for(const file of ['package.json','package-lock.json','sites/package.json','sites/package-lock.json'])if(existsSync(join(root,file)))seen.add(join(root,file));
  return Object.fromEntries([...seen].sort().map(file=>[relative(root,file),hash(readFileSync(file))]));
}
const beforeHashes=sourceHashes();
const sourceCommit=git('rev-parse','HEAD');
const sourceStatus=git('status','--porcelain','--untracked-files=all','--',...Object.keys(beforeHashes));
const node=await import(pathToFileURL(join(root,'src/invoice-extraction.js')).href);
const sitesEntry=join(root,'sites/lib/invoice-fields.js');
let sitesSource=readFileSync(sitesEntry,'utf8');
// Preserve the real Sites module, with the same checkout's actual money parser
// and helpers. Only its relative import URLs are adapted for Node evaluation.
sitesSource=sitesSource.replace(/\b(from\s*|import\s*\(\s*|import\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,(_,prefix,_quote,specifier)=>prefix+JSON.stringify(pathToFileURL(resolveLocal(sitesEntry,specifier)).href));
const sites=await import('data:text/javascript;base64,'+Buffer.from(sitesSource).toString('base64'));
const parsers=[['node',node.interpretInvoice],['sites',sites.interpretInvoice]];
const samples=textOnly?textCases:[...textCases,...opticalCases];
if(new Set(samples.map(sample=>sample.id)).size!==samples.length)throw Error('Duplicate sample identifiers');
for(const sample of samples){
  if(scalarFieldNames.some(field=>!Object.hasOwn(sample.gold.fields,field)))throw Error('Incomplete scalar gold for '+sample.id);
}
const details=[];
for(const [engine,parse] of parsers){
  // One full untimed warmup, identical for both checkouts and all text cases.
  for(const sample of textCases)parse(sample.text,sample.metadata);
  for(const sample of textCases){
    const timeSamplesMs=[];let extraction,firstSignature,error=null;
    for(let repeat=0;repeat<repeats;repeat++){
      const start=performance.now();
      try{extraction=parse(sample.text,sample.metadata);}catch{extraction={fields:{},level:'red',issues:[]};error='parser-error';}
      timeSamplesMs.push(performance.now()-start);
      const signature=JSON.stringify({level:extraction.level,...projectReviewedFields(extraction,sample.gold)});
      if(firstSignature===undefined)firstSignature=signature;
      else if(signature!==firstSignature)error='non-deterministic-reviewed-output';
    }
    details.push(evaluateDocument({id:sample.id,family:sample.family,subset:sample.subset,engine,
      ...projectReviewedFields(extraction,sample.gold),level:extraction.level,requireReview:sample.requireReview,
      durationMs:timeSamplesMs.reduce((sum,time)=>sum+time,0)/repeats,timeSamplesMs,error,
      inputSha256:hash(sample.text),inputCharacters:sample.text.length,method:extraction.method,issues:extraction.issues||[],note:sample.note}));
  }
}

const binaryInputs=textOnly?[]:await buildOpticalInputs();
const processing=[];
for(const sample of binaryInputs){
  const start=performance.now();let processed,error=null;
  try{processed=await node.runDocumentProcess(sample.bytes,sample.mimeType);if(processed.error)error='document-process-error';}
  catch{processed={error:true};error='document-process-exception';}
  const processingTimeMs=performance.now()-start;
  const text=processed.text||'';
  processing.push({id:sample.id,mimeType:sample.mimeType,inputBytes:sample.bytes.length,inputSha256:hash(sample.bytes),method:processed.method??null,ocrConfidence:processed.confidence??null,processingTimeMs,error,extractedCharacters:text.length,extractedTextSha256:hash(text),observedText:text});
  for(const [engine,parse] of parsers){
    const parsingStart=performance.now();let extraction,parserError=null;
    try{extraction=parse(text,{...sample.metadata,method:processed.method||'pdf',ocrConfidence:processed.confidence||0});}
    catch{extraction={fields:{},level:'red',issues:[]};parserError='parser-error';}
    if(error)extraction.level='red';
    const parsingTimeMs=performance.now()-parsingStart;
    details.push(evaluateDocument({id:sample.id,family:sample.family,subset:sample.subset,engine,
      ...projectReviewedFields(extraction,sample.gold),level:extraction.level,requireReview:sample.requireReview,
      durationMs:processingTimeMs+parsingTimeMs,processingTimeMs,parsingTimeMs,error:error||parserError,
      inputSha256:hash(sample.bytes),method:processed.method??null,issues:extraction.issues||[],note:sample.note}));
  }
  process.stderr.write(`Measured ${sample.id}: ${Math.round(processingTimeMs)} ms${error?' ('+error+')':''}\n`);
}
const summaries=Object.fromEntries(parsers.map(([engine])=>[engine,{
  text:summarizeDocuments(details.filter(row=>row.engine===engine&&row.subset==='text')),
  pdfNative:summarizeDocuments(details.filter(row=>row.engine===engine&&row.subset==='pdf-native')),
  raster:summarizeDocuments(details.filter(row=>row.engine===engine&&row.subset==='raster')),
  pdfRaster:summarizeDocuments(details.filter(row=>row.engine===engine&&row.subset==='pdf-raster')),
}]));
const afterHashes=sourceHashes(),sourceStable=JSON.stringify(beforeHashes)===JSON.stringify(afterHashes);
const harnessFiles=['scripts/measure-ocr-quality.mjs','test/helpers/ocr-quality-metrics.mjs','test/helpers/ocr-quality-corpus.mjs'];
const harnessHashes=Object.fromEntries(harnessFiles.map(file=>[file,hash(readFileSync(join(runnerRoot,file)))]));
const corpusSha256=hash(JSON.stringify({version:corpusVersion,textCases,opticalCases}));
const inputManifest=samples.map(sample=>({id:sample.id,subset:sample.subset,sha256:sample.subset==='text'?hash(sample.text):hash(binaryInputs.find(input=>input.id===sample.id).bytes)}));
const require=createRequire(import.meta.url);
const dependencies=Object.fromEntries(['pdfjs-dist','@napi-rs/canvas','tesseract.js','@tesseract.js-data/swe'].map(name=>[name,JSON.parse(readFileSync(require.resolve(name+'/package.json'),'utf8')).version]));
let rasterFont=null;
try{
  const path=execFileSync('fc-match',['--format=%{file}','Arial'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  if(path&&existsSync(path))rasterFont={path,sha256:hash(readFileSync(path))};
}catch{/* Byte hashes still detect any rendering difference on systems without fontconfig. */}
const report={schema:'mgeorge-ocr-quality-measurement-v1',synthetic:true,startedAt,completedAt:new Date().toISOString(),
  sourceRoot:root,sourceCommit,sourceWorkingTreeDirty:Boolean(sourceStatus),sourceWorkingTreeStatus:sourceStatus,sourceStable,
  sourceSha256:hash(JSON.stringify(beforeHashes)),sourceHashes:beforeHashes,...(!sourceStable?{sourceHashesAfter:afterHashes}:{}),
  corpusVersion,corpusSha256,datasetSha256:hash(JSON.stringify({corpusSha256,inputManifest})),inputManifest,
  runnerSha256:hash(JSON.stringify(harnessHashes)),harnessHashes,
  runtime:{node:process.version,versions:process.versions,platform:platform(),osRelease:release(),architecture:arch(),cpuModel:cpus()[0]?.model??null,cpuCount:cpus().length,loadBefore,loadAfter:loadavg(),dependencies,sourceNodeModules:realpathSync(join(root,'node_modules')),rasterFont},
  methodology:{textCases:textCases.length,opticalCases:binaryInputs.length,evaluations:details.length,textRepeats:repeats,textWarmupPasses:1,
    fieldPrecision:'TP / (TP + FP) over returned non-null reviewed field values; wrong non-null values count as FP and FN.',
    fieldRecall:'TP / (TP + FN) over non-null golden values; correct abstentions on null gold do not inflate precision or recall.',
    documentCoverage:'Documents for which every reviewed scalar and selected detail field is exact, including required abstentions, divided by all evaluated documents. Processing errors remain failures.',
    falseGreen:'Green result when golden requireReview is true OR any reviewed field is wrong/missing OR processing failed. This is a strict annotated scope; see scalar/detail breakdown and separate greenWrongValue, greenIncomplete and greenUnsafeDecision counts.',
    falseGreenReasons:'greenWrongValueCount counts any FP; greenIncompleteCount counts FN without FP; greenUnsafeDecisionCount counts golden requireReview. Unsafe decisions may overlap either field reason, so these must not be summed.',
    annotationScope:'All 13 legacy scalar fields are annotated on every case. Selected positive/partial cases also annotate source party roles, reference type, rates and row cells. Baseline has no detail API: missing detail values count as FN, with scalar-only coverage reported separately.',
    detailRows:'Each annotated row has seven reviewed facts and one document row-count fact. Extra returned row cells are FP; expected null cells are abstentions. Evidence text and timestamps are not field facts.',
    textTiming:'Mean of repeated synchronous parser calls after one full corpus warmup. Imports, fixture generation and grading are excluded.',
    opticalTiming:'One cold Node document worker per PDF/raster input, including startup, PDF extraction/rendering and local Tesseract when selected. Worker output is parsed by both engines; each engine time is shared worker time plus its own parse time.',
    sitesOpticalScope:'Sites results use the Sites parser on text from the selected checkout\'s Node PDF/OCR worker. This is not an end-to-end browser, cloud OCR or manual Sites upload measurement.',
  },
  limitations:[
    'This fixed small synthetic corpus is development evidence, not a random production sample, a live LLM evaluation, a general accuracy guarantee or an estimate of customer manual-review volume.',
    'Deterministic labelled text measures field interpretation, not optical recognition. Actual native PDF, raster images and raster PDFs are reported in separate subsets.',
    'Selected new detail fields expand the output contract. Scalar and expanded coverage/false-green reasons must be read together; absent baseline details are not described as wrong non-null monetary values.',
    'Text and fixture generators are fully present in the harness, but only supported selected facts are annotated. The suite does not evaluate handwriting, arbitrary table layouts, all languages, all currencies or real private originals.',
    'The deliberately pixelated invoice retains its known source gold, so safe abstention correctly lowers field recall. A blank image has null factual gold and still requires review.',
    'Full OCR text is retained only for these small synthetic binary inputs. This is not a test of complete production text retention: the application has its own text/page/pixel limits and stores a bounded text excerpt.',
    'Single-machine elapsed times are noisy and may overlap other agents or tests on a shared host. Repeats reduce parser noise but do not isolate CPU load; no performance guarantee or statistically reliable speedup is claimed.',
    'Both checkouts may share installed node_modules. Source hashes, lockfiles, installed dependency versions, raster font and exact generated byte hashes identify this environment; this is not a separately rebuilt historical runtime.',
  ],
  summaries,processing,details};
if(output){const target=resolve(output);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,JSON.stringify(report,null,2)+'\n');}
const compact=Object.fromEntries(Object.entries(summaries).map(([engine,subsets])=>[engine,Object.fromEntries(Object.entries(subsets).map(([name,summary])=>[name,{documents:summary.documents,counts:summary.counts,fieldPrecision:summary.fieldPrecision,fieldRecall:summary.fieldRecall,documentCoverage:summary.documentCoverage,falseGreenCount:summary.falseGreenCount,greenWrongValueCount:summary.greenWrongValueCount,greenIncompleteCount:summary.greenIncompleteCount,greenUnsafeDecisionCount:summary.greenUnsafeDecisionCount,manualReviewRate:summary.manualReviewRate,averageTimeMs:summary.averageTimeMs,errorCount:summary.errorCount}]))]));
console.log(JSON.stringify({sourceCommit,sourceStable,sourceSha256:report.sourceSha256,corpusSha256,datasetSha256:report.datasetSha256,runnerSha256:report.runnerSha256,summaries:compact},null,2));
if(!sourceStable)process.exitCode=1;
if(details.some(row=>row.error))process.exitCode=1;
