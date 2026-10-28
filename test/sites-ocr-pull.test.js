import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {runSitesOcr,boundedBody} from '../src/sites-ocr-pull.js';
import {imageDimensions} from '../src/image-dimensions.js';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {runDocumentProcess} from '../src/invoice-extraction.js';
import {image} from './fixtures.js';
test('OCR pull worker makes one bounded job at a time and never follows redirects',async()=>{
  const bytes=Buffer.from('synthetic document'),token=randomBytes(32).toString('base64url'),lease=randomBytes(32).toString('base64url');let count=0,complete=0;
  const fetchImpl=async(url,options)=>{
    assert.equal(new URL(url).origin,'https://site.example');assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer '+token);
    if(url.endsWith('/lease'))return Response.json({job:count++===0?{id:'test-document',lease,mime:'image/png',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}:null});
    if(url.includes('/document?')){assert.equal(options.headers['X-MG-OCR-Lease'],lease);return new Response(bytes);}
    if(url.endsWith('/complete')){const body=JSON.parse(options.body);assert.equal(body.text,'Synthetic OCR');assert.equal(body.lease,lease);complete++;return Response.json({state:'needs_review'});}
    throw Error('Unexpected API');
  };
  assert.deepEqual(await runSitesOcr({origin:'https://site.example',token},{fetchImpl,extract:async()=>({text:'Synthetic OCR',method:'ocr',confidence:90})}),{processed:1,failed:0});assert.equal(complete,1);
});
test('OCR worker rejects input limits and credential-bearing redirects',async()=>{
  await assert.rejects(boundedBody(new Response(new Uint8Array(20)),10),/response_limit/);
  await assert.rejects(runSitesOcr({origin:'http://site.example',token:'x'}),/configuration/);
  await assert.rejects(runSitesOcr({origin:'https://site.example',token:randomBytes(32).toString('base64url')},{fetchImpl:async()=>new Response(null,{status:302,headers:{Location:'https://untrusted.example'}})}),/site_unavailable/);
});
test('oversized images are rejected before native canvas decoding',()=>{
  const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(50000,16);png.writeUInt32BE(50000,20);assert.throws(()=>imageDimensions(png,'image/png'),/image_dimensions/);png.writeUInt32BE(100,16);png.writeUInt32BE(50,20);assert.deepEqual(imageDimensions(png,'image/png'),{width:100,height:50});
});

function cloudFixture({extract=async()=>({text:'Synthetic OCR',method:'ocr',confidence:90}),complete={state:'needs_review'},bytes=Buffer.from('synthetic document'),downloadBytes=bytes,jobs=1}={}){
  const token=randomBytes(32).toString('base64url'),lease=randomBytes(32).toString('base64url');
  const calls=[],bodies=[];let claimed=0,extractCalls=0;
  const job={id:'synthetic-document',lease,mime:'image/png',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  const fetchImpl=async(url,options)=>{
    calls.push(new URL(url).pathname);
    assert.equal(new URL(url).origin,'https://site.example');
    assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer '+token);assert.equal(options.headers['X-MG-OCR-Runner'],'cloud');
    if(url.endsWith('/process'))return Response.json({processed:0});
    if(url.endsWith('/lease'))return Response.json({job:claimed++<jobs?job:null});
    if(url.includes('/document?')){assert.equal(options.headers['X-MG-OCR-Lease'],lease);return new Response(downloadBytes);}
    if(url.endsWith('/complete')){bodies.push(JSON.parse(options.body));return typeof complete==='function'?complete(bodies.at(-1)):Response.json(complete);}
    throw Error('unexpected_request');
  };
  return {token,lease,job,calls,bodies,run:options=>runSitesOcr({origin:'https://site.example',token,mode:'cloud'},{fetchImpl,extract:async(...args)=>{extractCalls++;return extract(...args);},...options}),get extractCalls(){return extractCalls;}};
}

test('cloud worker processes the text queue before OCR and counts only saved completions',async t=>{
  const timeouts=[];t.mock.method(AbortSignal,'timeout',milliseconds=>{timeouts.push(milliseconds);return new AbortController().signal;});
  const f=cloudFixture();assert.deepEqual(await f.run(),{processed:1,failed:0});
  assert.deepEqual(f.calls,['/api/ocr-worker/process','/api/ocr-worker/lease','/api/ocr-worker/document','/api/ocr-worker/complete','/api/ocr-worker/lease']);
  assert.deepEqual(timeouts,[60000,25000,25000,25000,25000]);
});

test('cloud pull path OCRs a real synthetic scan without the local Windows task',async()=>{
  const f=cloudFixture({bytes:image().toBuffer('image/png'),extract:runDocumentProcess});
  assert.deepEqual(await f.run(),{processed:1,failed:0});
  assert.equal(f.bodies[0].method,'ocr');assert.match(f.bodies[0].text,/0606/);assert.match(f.bodies[0].text,/3\s*750[,.]00/);
});

test('cloud worker stops after six jobs even when the queue remains populated',async()=>{
  const f=cloudFixture({jobs:100});assert.deepEqual(await f.run({maxJobs:100}),{processed:6,failed:0});assert.equal(f.extractCalls,6);assert.equal(f.bodies.length,6);
});

test('integrity failure never reaches OCR and sends a text-free failure acknowledgment',async()=>{
  const f=cloudFixture({downloadBytes:Buffer.from('changed document'),complete:{ok:true}});
  assert.deepEqual(await f.run(),{processed:0,failed:1});assert.equal(f.extractCalls,0);
  assert.deepEqual(f.bodies[0],{id:f.job.id,lease:f.lease,sha256:f.job.sha256,text:'',method:'ocr',confidence:0,error:true});
});

test('cloud worker does not overwrite trusted job identities with extractor properties',async()=>{
  const f=cloudFixture({extract:async()=>({text:'Synthetic OCR',method:'ocr',confidence:90,id:'injected',lease:'injected',sha256:'injected',debug:'private'})});
  await f.run();assert.deepEqual(f.bodies[0],{id:f.job.id,lease:f.lease,sha256:f.job.sha256,text:'Synthetic OCR',method:'ocr',confidence:90});
});

test('malformed extractor confidence and method become bounded document failures',async()=>{
  for(const result of [{text:'private',method:'external',confidence:90},{text:'private',method:'ocr',confidence:101},{text:'private',method:'ocr',confidence:NaN}]){
    const f=cloudFixture({extract:async()=>result,complete:{ok:true}});assert.deepEqual(await f.run(),{processed:0,failed:1});assert.equal(f.bodies[0].text,'');
  }
});

test('expired or ignored completion fails the run instead of claiming success',async()=>{
  for(const complete of [()=>Response.json({error:'expired'},{status:409}),{ignored:true},{ok:true}]){
    const f=cloudFixture({complete});await assert.rejects(f.run(),/site_unavailable|completion_rejected/);assert.equal(f.bodies.length,1);
  }
});

test('cloud process authorization failures stop before documents are requested',async()=>{
  const token=randomBytes(32).toString('base64url');let requests=0;
  await assert.rejects(runSitesOcr({origin:'https://site.example',token,mode:'cloud'},{fetchImpl:async(url)=>{requests++;assert.ok(url.endsWith('/process'));return new Response(null,{status:401});}}),/authorization/);assert.equal(requests,1);
});

test('cloud worker rejects malformed leases and unsupported mode before extraction',async()=>{
  const f=cloudFixture();await assert.rejects(f.run({fetchImpl:async(url)=>Response.json(url.endsWith('/process')?{processed:0}:{job:{...f.job,size:15000001}})}),/invalid_job/);
  await assert.rejects(runSitesOcr({origin:'https://site.example',token:f.token,mode:'untrusted'}),/configuration/);
  await assert.rejects(f.run({maxJobs:NaN}),/configuration/);
});

test('cloud CLI fails safely without printing environment secrets or exception details',()=>{
  const secret='private-sensitive-value',result=spawnSync(process.execPath,['scripts/run-sites-cloud-ocr.mjs'],{cwd:new URL('..',import.meta.url),encoding:'utf8',env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,MG_SITES_ORIGIN:secret,MG_SITES_OCR_TOKEN:secret}});
  assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).status,'failed');assert.ok(!result.stdout.includes(secret));assert.equal(result.stderr,'');
});

test('cloud workflow confines credentials to main-only OCR step and has no document exports',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/sites-cloud-ocr.yml',import.meta.url),'utf8');
  assert.match(workflow,/github\.ref == 'refs\/heads\/main'.*MG_CLOUD_OCR_ENABLED == 'true'/);
  assert.match(workflow,/cancel-in-progress: false/);assert.match(workflow,/timeout-minutes: 15/);assert.match(workflow,/contents: read/);
  assert.ok(!/pull_request:|pull_request_target:|upload-artifact|cache:|secrets: inherit/.test(workflow));
  assert.equal((workflow.match(/MG_SITES_OCR_TOKEN:/g)||[]).length,1);
});
