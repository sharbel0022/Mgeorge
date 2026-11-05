import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const originalPath=join(root,'source/sites/lib/ocr-layout.js'),source=readFileSync(originalPath,'utf8');
const marker='    const outgoing=new Map(pairs.map(pair=>[pair.label.id,pair.value])),incoming=new Set(pairs.map(pair=>pair.value.id));';
assert.equal(source.split(marker).length,2);
const injected=`    diagnosticTrace={segments:segments.map(segment=>({id:segment.id,row:segment.row.index,text:segment.text,box:segment.box,glyphHeight:segment.glyphHeight,label:segment.label,explicitLabel:segment.explicitLabel,complete:segment.complete,excluded:!!segment.row.excluded,disabled:disabled.has(segment.row)})),proposed:proposed.map(pair=>({label:pair.label.id,value:pair.value.id,claims:claims.get(pair.value.id)})),pairs:pairs.map(pair=>({label:pair.label.id,value:pair.value.id})),disabledRows:[...disabled].map(row=>row.index)};\n`;
const instrumented='let diagnosticTrace=null;\n'+source.replace(marker,injected+marker)+'\nexport const getDiagnosticTrace=()=>diagnosticTrace;\n';
const tracePath=join(root,'harness/ocr-layout-instrumented.mjs');writeFileSync(tracePath,instrumented,{flag:'wx'});
const real=await import(pathToFileURL(originalPath).href),copy=await import(pathToFileURL(tracePath).href);
for(const id of ['09','05']){
 const dir=join(root,'diagnostic/holdout-v2-normal-'+id),raw=JSON.parse(readFileSync(join(dir,'raw-response.json'),'utf8'));
 const actual=real.reconstructOcrLayout(raw.data.text,raw.data.blocks),traced=copy.reconstructOcrLayout(raw.data.text,raw.data.blocks);
 assert.deepEqual(traced,actual);
 const trace={schema:'mgeorge-layout-post-holdout-trace-v1',postHoldoutDiagnostic:true,acceptanceMeasurement:false,id,sourceSha256:createHash('sha256').update(source).digest('hex'),traceSourceSha256:createHash('sha256').update(instrumented).digest('hex'),outputIdenticalToUnchangedHelper:true,...copy.getDiagnosticTrace()};
 writeFileSync(join(dir,'layout-trace.json'),JSON.stringify(trace,null,2)+'\n',{flag:'wx'});
 const relevant=trace.segments.filter(s=>id==='05'?s.row>=3&&s.row<=6:s.row===11||s.row===12||s.row===13||s.row>=21&&s.row<=23);
 console.log(JSON.stringify({id,segments:relevant,proposed:trace.proposed,pairs:trace.pairs,disabledRows:trace.disabledRows}));
}
