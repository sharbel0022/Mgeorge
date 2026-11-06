// Replay retained development observations. No optical or network calls.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [rootArg,captureArg,outputArg]=process.argv.slice(2);
assert.ok(rootArg&&captureArg&&outputArg);
const root=resolve(rootArg),capture=resolve(captureArg),output=resolve(outputArg);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=path=>readFileSync(path),json=path=>JSON.parse(read(path));
const moduleAt=path=>import(pathToFileURL(join(root,path)).href);
const {reconstructOcrLayout}=await moduleAt('sites/lib/ocr-layout.js');
const {collectOcrBankgiroPage,bindOcrBankgiroEvidence}=await moduleAt('sites/lib/ocr-bankgiro-evidence.js');
const {loadInvoiceParsers}=await moduleAt('test/helpers/load-invoice-parsers.mjs');
const {evaluateDocument,projectReviewedFields,summarizeDocuments}=await moduleAt('test/helpers/ocr-quality-metrics.mjs');
const parsers=await loadInvoiceParsers(root);
const originalBytes=read(join(capture,'result.json'));
assert.equal(sha(originalBytes),'d6db21532448fb8f8bb4a103c35f1b61cc44132392ca7ba12a0ed4a98c58c1dc');
const original=JSON.parse(originalBytes);
const goldPath=join(root,'test/fixtures/quality8/ocr-holdout-v2/gold.json'),manifestPath=join(root,'test/fixtures/quality8/ocr-holdout-v2/manifest.json');
const gold=json(goldPath),manifest=json(manifestPath);
const paths=execFileSync('git',['ls-files','src','sites/lib','test/helpers/ocr-quality-metrics.mjs','test/helpers/load-invoice-parsers.mjs'],{cwd:root,encoding:'utf8'}).trim().split('\n');
const hashes=()=>Object.fromEntries(paths.map(path=>[path,sha(read(join(root,path)))]));
const sourceHashes=hashes();
const report={schema:'completion-ocr-known-observation-replay-v1',startedAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHashes,scriptSha256:sha(read(new URL(import.meta.url))),corpus:{knownDevelopment:true,independentHoldout:false,v3Accessed:false,originalResultSha256:sha(originalBytes),goldSha256:sha(read(goldPath)),manifestSha256:sha(read(manifestPath))},opticalCalls:0,parserCalls:0,inputs:[],details:[],summaries:{}};
for(const sample of original.processing){
  const path=join(capture,sample.id,'raw-response.json'),bytes=read(path),{data}=JSON.parse(bytes);
  const layout=reconstructOcrLayout(data.text,data.blocks);
  const proof=bindOcrBankgiroEvidence(sample.inputSha256,layout.text,[collectOcrBankgiroPage(layout.text,layout.blocks)]);
  const item=manifest.images.find(row=>row.id===sample.id);
  assert.ok(item);
  report.inputs.push({id:sample.id,rawSha256:sha(bytes),originalInputSha256:sample.inputSha256,reconstructed:layout.reconstructed});
  for(const [engine,parse] of Object.entries(parsers)){
    report.parserCalls++;
    const result=parse(layout.text,{...item.metadata,method:'ocr',ocrConfidence:data.confidence,ocrEvidence:proof,ocrInputSha256:sample.inputSha256});
    report.details.push(evaluateDocument({id:item.id,family:item.layout,subset:item.population,engine,...projectReviewedFields(result,gold.cases[item.id]),level:result.level,requireReview:gold.cases[item.id].requireReview,error:sample.error,issues:result.issues,fieldEvidence:result.fields}));
  }
  assert.equal(sha(read(path)),sha(bytes));
}
const mandatory=['invoice_number','party','organization_number','issued_at','due_at','total_cents','net_cents','vat_cents','direction','currency'];
for(const engine of ['node','sites'])for(const subset of ['normal-readable','stress']){
  const rows=report.details.filter(row=>row.engine===engine&&row.subset===subset);
  const scoped=rows.map(row=>evaluateDocument({id:row.id,expected:Object.fromEntries(row.fields.filter(f=>mandatory.includes(f.name)).map(f=>[f.name,f.expected])),actual:Object.fromEntries(row.fields.filter(f=>mandatory.includes(f.name)).map(f=>[f.name,f.actual])),level:row.level,requireReview:row.requireReview,error:row.error}));
  report.summaries[engine+'/'+subset]={all13:summarizeDocuments(rows),mandatory10:summarizeDocuments(scoped)};
}
assert.deepEqual(hashes(),sourceHashes);
assert.equal(sha(read(goldPath)),report.corpus.goldSha256);assert.equal(sha(read(manifestPath)),report.corpus.manifestSha256);
report.completedAt=new Date().toISOString();
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({head:report.head,parserCalls:report.parserCalls,opticalCalls:0,summaries:report.summaries},null,2));
