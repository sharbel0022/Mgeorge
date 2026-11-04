import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,files,upload,rows,readable,bytes} from './helpers/file-upload-concurrency-fixture.mjs';

function oversizedMultipart(contentLength){
 const boundary='synthetic-upload-boundary',encode=value=>new TextEncoder().encode(value);
 const padding=new Uint8Array(1_000_000).fill(65);
 const parts=[
  encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.csv"\r\nContent-Type: text/csv\r\n\r\n`),
  bytes,
  encode(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="ignored"\r\n\r\n`),
  ...Array(17).fill(padding),
  encode(`\r\n--${boundary}--\r\n`)
 ];
 const state={cancelled:false,readBytes:0,totalBytes:parts.reduce((sum,part)=>sum+part.byteLength,0)};
 let index=0;
 const body=new ReadableStream({
  pull(controller){
   if(index===parts.length){controller.close();return;}
   const part=parts[index++];state.readBytes+=part.byteLength;controller.enqueue(part);
  },
  cancel(){state.cancelled=true;}
 },{highWaterMark:0});
 const headers={origin:'https://mg.test','content-type':`multipart/form-data; boundary=${boundary}`};
 if(contentLength!==undefined)headers['content-length']=contentLength;
 return {state,request:new Request('https://mg.test/api/files',{method:'POST',headers,body,duplex:'half'})};
}

for(const [label,contentLength]of [['missing',undefined],['understated','64']]){
 test(`upload cancels excessive multipart bytes with ${label} Content-Length before persisting`,async t=>{
  const f=fixture(t),{request,state}=oversizedMultipart(contentLength);
  const result=await files.POST(request);
  assert.equal(result.status,413);
  assert.equal(state.cancelled,true,'overflow must cancel the incoming stream');
  assert.ok(state.readBytes<state.totalBytes,'overflow must stop before consuming the remaining body');
  assert.equal(rows(f).length,0);
  assert.equal(f.puts.length,0);
  assert.equal(f.objects.size,0);
 });
}

test('bounded normal multipart upload preserves the readable original',async t=>{
 const f=fixture(t),result=await files.POST(upload()),body=await result.json();
 assert.equal(result.status,200);
 assert.equal(rows(f).length,1);
 assert.equal(f.puts.length,1);
 assert.equal(f.objects.size,1);
 await readable(body.id);
});

test('a file larger than 15 MB is still rejected within the multipart body limit',async t=>{
 const f=fixture(t),form=new FormData();
 form.set('file',new File([new Uint8Array(15_000_001)],'synthetic.csv'));
 const result=await files.POST(new Request('https://mg.test/api/files',{method:'POST',headers:{origin:'https://mg.test'},body:form}));
 assert.equal(result.status,400);
 assert.equal(rows(f).length,0);
 assert.equal(f.puts.length,0);
 assert.equal(f.objects.size,0);
});
