import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {runSitesOcr,boundedBody} from '../src/sites-ocr-pull.js';
import {imageDimensions} from '../src/image-dimensions.js';
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
