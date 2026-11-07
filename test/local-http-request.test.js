import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {request} from '../scripts/start/common.mjs';
async function server(t,handler){const s=http.createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();});return {hostname:'127.0.0.1',port:s.address().port,path:'/'};}
async function bounded(options){let timer;try{return await Promise.race([request(options).then(value=>({value}),error=>({error})),new Promise(r=>timer=setTimeout(()=>r({unsettled:true}),1800))]);}finally{clearTimeout(timer);}}
test('HTTP deadline bounds a response that continuously drips bytes',async t=>{const options=await server(t,(q,r)=>{r.writeHead(200);r.write('{');const tick=setInterval(()=>r.write(' '),60);r.once('close',()=>clearInterval(tick));});const begin=Date.now();const result=await bounded(options);assert.ok(result.error,'drip response must reject within the absolute deadline');assert.match(result.error.message,/Tidsgräns/);assert.ok(Date.now()-begin<1400);});
test('a prematurely closed HTTP response rejects instead of leaving readiness pending',async t=>{const options=await server(t,(q,r)=>{r.writeHead(200,{'content-length':'100'});r.write('{"ok":');setTimeout(()=>r.destroy(),50);});const result=await bounded(options);assert.ok(result.error,'premature HTTP close must settle as an error');assert.equal(result.value,undefined);});
test('HTTP response bound counts bytes including multibyte characters',async t=>{const options=await server(t,(q,r)=>r.end(JSON.stringify({text:'é'.repeat(4500)})));const result=await bounded(options);assert.ok(result.error,'over8192 bytes must be rejected');assert.match(result.error.message,/För stort/);});
test('bounded HTTP helper still returns complete valid JSON responses',async t=>{const options=await server(t,(q,r)=>r.end('{"ok":true}'));const result=await bounded(options);assert.deepEqual(result.value,{status:200,body:{ok:true}});});
