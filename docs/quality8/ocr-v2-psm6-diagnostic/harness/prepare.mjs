// Preregistration only: builds identical raster bytes and hashes; never calls OCR.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,mkdtempSync,symlinkSync,copyFileSync,realpathSync} from 'node:fs';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {ocrRasterSize} from '../../../../src/ocr-raster-size.js';
import {root,folder,packet,target,corpusCommit,fixture,firstPath,baselinePath,json,write,git,hash,fileHash,freezeSource,verifyCorpus,localGraph,runtimeInventory} from './common.mjs';

assert.equal(process.version,'v24.22.1');
assert.equal(git('rev-parse','HEAD'),target,'Prepare on the exact clean production base');
assert.ok(!existsSync(packet),'A prepared experiment cannot silently be prepared again');
const manifest=verifyCorpus(root,corpusCommit),first=json(firstPath),baseline=json(baselinePath);
assert.equal(fileHash(firstPath),'13557c3012331fa0101fbe3e6fe498fd2fbf3346b8740cfe5fe4b83e8393b6e7');
assert.equal(first.passed,false);assert.equal(baseline.ocrCalls,0);assert.equal(baseline.sourceCommit,'635ca5e3bcf3c1c8ecff16b192a44cde35175d69');
const source=freezeSource(root,target),opticalExecutionGraph=localGraph(root,['src/invoice-worker.js']);
const parserGraph=localGraph(root,['src/invoice-extraction.js','sites/lib/invoice-fields.js']);
const opticalChangedSinceFirst=opticalExecutionGraph.filter(path=>source.hashes[path]!==first.sourceHashes[path]);
const parserChangedSinceReparse=parserGraph.filter(path=>source.hashes[path]!==baseline.sourceHashes[path]);
assert.deepEqual(opticalChangedSinceFirst,[],'Optical code must match original PSM3 observation');
assert.deepEqual(parserChangedSinceReparse,[],'Frozen PSM3 replay must use this same parser graph');
const originalWorker=readFileSync(join(root,'src/invoice-worker.js'),'utf8');
assert.equal(originalWorker.split('tessedit_pageseg_mode:PSM.AUTO').length,2);
const workerCopy=join(folder,'harness/invoice-worker-psm6.js');
assert.equal(readFileSync(workerCopy,'utf8'),originalWorker.replace('tessedit_pageseg_mode:PSM.AUTO','tessedit_pageseg_mode:PSM.SINGLE_BLOCK'));
const runtime=runtimeInventory();assert.deepEqual(runtime.dependencies,first.runtime.dependencies);assert.equal(runtime.node,first.runtime.node);
const bounds=json(join(fixture,'rendered-text-bounds.json')),inputs=[];
for(const item of manifest.images){
  const bytes=readFileSync(join(fixture,item.filename));assert.equal(hash(bytes),item.sha256);
  const image=await loadImage(bytes),canvas=createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);
  const size=ocrRasterSize(canvas.width,canvas.height);let raster=canvas;
  if(size.width!==canvas.width||size.height!==canvas.height){raster=createCanvas(size.width,size.height);const context=raster.getContext('2d');context.imageSmoothingQuality='high';context.drawImage(canvas,0,0,size.width,size.height);}
  const png=raster.toBuffer('image/png');
  inputs.push({...item,originalBytes:bytes.length,expectedRasterSha256:hash(png),rasterBytes:png.length,rasterWidth:raster.width,rasterHeight:raster.height,renderedPercentMarkers:bounds.filter(row=>row.id===item.id&&row.text.includes('%')).map(({text,x,y,width,height})=>({text,x,y,width,height})),renderedPercentCount:bounds.filter(row=>row.id===item.id).reduce((sum,row)=>sum+(row.text.match(/%/g)||[]).length,0)});
}
assert.equal(inputs.length,12);assert.equal(inputs.filter(i=>i.population==='normal-readable').length,10);assert.equal(inputs.filter(i=>i.population==='stress').length,2);
const artifactRoot=mkdtempSync(join(tmpdir(),'quality8-psm6-source-')),sourceRoot=join(artifactRoot,'source'),archive=join(artifactRoot,'source.tar');
mkdirSync(sourceRoot);execFileSync('git',['archive','--format=tar','--output='+archive,target],{cwd:root});execFileSync('tar',['-xf',archive,'-C',sourceRoot]);
symlinkSync(realpathSync(join(root,'node_modules')),join(sourceRoot,'node_modules'),'dir');
copyFileSync(workerCopy,join(sourceRoot,'src/invoice-worker-psm6.js'));
const protectedPaths=[...Object.keys(manifest.corpusHashes),...Object.keys(manifest.harnessHashes),'test/fixtures/quality8/ocr-holdout-v2/manifest.json',relative(root,firstPath),relative(root,baselinePath)];
const protectedFiles=Object.fromEntries([...new Set(protectedPaths)].sort().map(path=>[path,fileHash(join(root,path))]));
const harnessFiles=['README.md',...readdirSync(join(folder,'harness')).filter(name=>/\.(?:mjs|js)$/.test(name)).sort().map(name=>'harness/'+name)];
const harnessHashes=Object.fromEntries(harnessFiles.map(path=>[path,fileHash(join(folder,path))]));
mkdirSync(packet);write(join(packet,'source-inventory.json'),{...source,opticalExecutionGraph,parserGraph,opticalChangedSinceFirst,parserChangedSinceReparse});
write(join(packet,'runtime-before.json'),runtime);write(join(packet,'input-inventory.json'),inputs);write(join(packet,'protected-files.json'),protectedFiles);
write(join(packet,'plan.json'),{schema:'mgeorge-known-v2-psm6-preregistered-experiment-v1',createdAt:new Date().toISOString(),postHoldoutDiagnostic:true,independentHoldout:false,productionScoreChange:false,noOcrInvoked:true,targetSourceCommit:target,targetSourceTree:source.targetTree,sourceRoot,sourceArchiveSha256:fileHash(archive),corpusFreezeCommit:corpusCommit,firstResultSha256:fileHash(firstPath),baselineReparseSha256:fileHash(baselinePath),firstResultSourceCommit:first.targetSourceCommit,baselineReparseSourceCommit:baseline.sourceCommit,firstResultMandatoryRecall:first.summaries.node.normal.mandatory10.fieldRecall,baselineReparseMandatoryRecall:baseline.summaries.node.normal.mandatory10.fieldRecall,change:{from:'PSM.AUTO',fromValue:3,to:'PSM.SINGLE_BLOCK',toValue:6,language:'swe',oem:1,otherParameters:'unchanged'},maximumRecognitionCalls:12,oneRecognitionPerImage:true,coldChildPerImage:true,concurrency:1,noRetries:true,order:inputs.map(i=>i.id),sourceWorkerSha256:source.hashes['src/invoice-worker.js'],diagnosticWorkerSha256:fileHash(workerCopy),thresholds:manifest.preregistration,harnessHashes,inventoryHashes:Object.fromEntries(['source-inventory.json','runtime-before.json','input-inventory.json','protected-files.json'].map(path=>[path,fileHash(join(packet,path))])),capture:'Observational wrapper returns the same object after exclusive V8/JSON capture, before any layout reconstruction.',baselineGeometryLimit:'Full old bbox unavailable for ten original cases; no new PSM3 calls.',noV3Access:true});
console.log(JSON.stringify({prepared:true,ocrCalls:0,images:inputs.length,sourceRoot,planSha256:fileHash(join(packet,'plan.json')),sourceSha256:source.sourceSha256,runtimeSha256:fileHash(join(packet,'runtime-before.json')),opticalChangedSinceFirst,parserChangedSinceReparse}));
