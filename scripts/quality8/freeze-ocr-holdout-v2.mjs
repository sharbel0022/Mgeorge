// Finalize the preregistration after visual QA. No product module is imported.
// No OCR, image-text extraction or application parser is invoked by this script.
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scalarFields,mandatoryFields,criticalFields,harnessFiles,fixturePath,hash,fileHash,runtimeDependencies,ordered} from './ocr-holdout-v2-provenance.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),fixture=join(root,fixturePath);
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--prior-root')throw Error('Usage: freeze-ocr-holdout-v2.mjs --prior-root REPOSITORY_WITH_UNCHANGED_V1');
const priorRoot=resolve(args[1]),output=join(fixture,'manifest.json');
if(existsSync(output))throw Error('Refusing to overwrite the v2 preregistration');
const specs=JSON.parse(readFileSync(join(fixture,'documents.json'),'utf8'));
const gold=JSON.parse(readFileSync(join(fixture,'gold.json'),'utf8'));
const render=JSON.parse(readFileSync(join(fixture,'render-inventory.json'),'utf8'));
const qa=JSON.parse(readFileSync(join(fixture,'visual-qa.json'),'utf8'));
const priorGold=JSON.parse(readFileSync(join(priorRoot,'test/fixtures/quality8/ocr-holdout-v1/gold.json'),'utf8'));
const priorResult=JSON.parse(readFileSync(join(priorRoot,'docs/quality8/ocr-independent-holdout-result.json'),'utf8'));
if(priorResult.passed!==false)throw Error('The original unsuccessful v1 result must remain available as separate historical evidence');
if(specs.cases.length!==12||Object.keys(gold.cases).length!==12||render.images.length!==12||specs.cases.filter(row=>row.population==='normal-readable').length!==10||specs.cases.filter(row=>row.population==='stress').length!==2)throw Error('Unexpected preregistered population');
if(qa.normalCount!==10||qa.stressCount!==2||qa.ocrInvocations!==0||qa.applicationParserInvocations!==0||qa.images.length!==12)throw Error('Visual QA and zero prior executions are required');
if(render.specificationSha256!==fileHash(join(fixture,'documents.json'))||render.generatorSha256!==fileHash(join(root,'scripts/quality8/generate-ocr-holdout-v2.py')))throw Error('Rendering inputs changed after visual inspection');
for(const row of specs.cases){
  const answer=gold.cases[row.id]?.fields;
  if(!answer||Object.keys(answer).length!==13||scalarFields.some(field=>!Object.hasOwn(answer,field)))throw Error('All thirteen literal gold fields are required');
  if(![answer.net_cents,answer.vat_cents,answer.total_cents].every(Number.isSafeInteger)||answer.net_cents+answer.vat_cents!==answer.total_cents)throw Error('Literal gold arithmetic is inconsistent');
  if(row.population==='normal-readable')for(const field of scalarFields.filter(field=>!['direction','kind','currency'].includes(field))){
    if(Object.values(priorGold.cases).some(old=>old.fields[field]===answer[field]))throw Error('A new holdout fact reuses the old v1 value: '+field);
  }
  if(row.metadata?.direction!=='supplier'||row.metadata?.direction_confident!==true)throw Error('Direction must remain explicitly supplied metadata');
  const image=render.images.find(image=>image.id===row.id),review=qa.images.find(image=>image.id===row.id);
  if(!image||!review||image.sha256!==review.sha256||fileHash(join(fixture,image.filename))!==image.sha256)throw Error('Image differs from visually inspected bytes');
  const bytes=readFileSync(join(fixture,image.filename));
  if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==1600||bytes.readUInt32BE(20)!==2000)throw Error('Unexpected raster dimensions or format');
}
for(const [path,want] of Object.entries(render.fonts))if(fileHash(path)!==want)throw Error('Rendering font changed after inspection');
const metric='test/helpers/ocr-quality-metrics.mjs';
if(fileHash(join(root,metric))!==fileHash(join(priorRoot,metric)))throw Error('The existing metric helper must remain unchanged');
function files(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(directory,entry.name)):[join(directory,entry.name)]).sort();}
const corpusHashes=ordered(Object.fromEntries(files(fixture).map(file=>[relative(root,file),fileHash(file)])));
const harnessHashes=ordered(Object.fromEntries(harnessFiles.map(file=>[file,fileHash(join(root,file))])));
const previousPaths=['test/fixtures/quality8/ocr-holdout-v1/manifest.json','test/fixtures/quality8/ocr-holdout-v1/gold.json','docs/quality8/ocr-independent-holdout-result.json','docs/quality8/ocr-independent-holdout-report.md'];
const manifest={schema:'mgeorge-independent-ocr-holdout-v2',synthetic:true,createdAt:new Date().toISOString(),
  sourceBinding:{status:'pending-delivery-sha-at-corpus-freeze',rule:'Do not run any OCR or application parser before root provides the frozen delivery SHA and a separate exact source binding is committed. The corpus, gold and harness remain unchanged.',inventory:'All tracked src/ and sites/lib/ files, package manifests/locks, transitive optical/downstream import graphs, installed OCR versions and local trained-data/WASM hashes.'},
  preregistration:{normalDocuments:10,stressDocuments:2,selection:'All twelve predetermined images remain included. No OCR, extracted text or application-parser result was observed before this freeze. No failed case is removed, replaced, relabelled or pooled with v1.',
    population:'Ten new printed Swedish SEK supplier invoices with 25% VAT, five normal sans/serif families, ten natural inline/stacked/two-column arrangements, 1600x2000 pixels and 28-36px normal field/body text. Two separately labelled damaged images retain their source gold. A purposive sample, not population-representative data.',
    metadata:'direction=supplier and direction_confident=true are supplied context. No direction-recognition claim may be drawn from these images. Report mandatory image-derived nine fields separately.',
    scalarFields,mandatoryFields,mandatoryImageFields:mandatoryFields.filter(field=>field!=='direction'),criticalFields,normalPrecisionMinimum:0.98,normalRecallMinimum:0.85,
    acceptance:'For EACH parser, both all-13 and mandatory-10 normal scopes require precision >=98% and recall >=85%, with no processing errors. Also require zero critical false-green decisions and safe non-green abstention on BOTH stress images. No cross-parser or cross-population averaging.',
    stressAcceptance:'Keep original complete gold; absent source values count as FN. Stress never improves normal-population precision/recall or replaces a readable input.',
    freezeRule:'Commit literal gold, specification, visually inspected exact PNGs, generator, measurement code, metric definitions and thresholds before any OCR. Bind and commit the later delivered implementation SHA before first execution. Retain the first complete result and any infrastructure interruption transparently; no output-dependent tuning.'},
  previousV1:{separate:true,preserved:true,passed:false,normalDocuments:8,stressDocuments:2,artifactHashes:Object.fromEntries(previousPaths.map(file=>[file,fileHash(join(priorRoot,file))]))},
  documentsSha256:fileHash(join(fixture,'documents.json')),goldSha256:fileHash(join(fixture,'gold.json')),corpusHashes,harnessHashes,harnessSha256:hash(JSON.stringify(harnessHashes)),
  generator:{sha256:render.generatorSha256,pillowVersion:render.pillowVersion,fontHashes:render.fonts},runtime:runtimeDependencies(root),
  images:render.images,datasetSha256:hash(JSON.stringify(render.images.map(({id,sha256,population})=>({id,sha256,population})))),
  visualQaSha256:fileHash(join(fixture,'visual-qa.json')),ocrInvocationsBeforeFreeze:0,applicationParserInvocationsBeforeFreeze:0};
writeFileSync(output,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,normal:10,stress:2,images:12,ocrInvoked:false,applicationParserInvoked:false,sourceBinding:'pending delivered SHA'},null,2));
