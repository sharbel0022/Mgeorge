import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {setImmediate as immediate} from 'node:timers/promises';
import {runSitesOcr, sitesOcrFailure} from '../src/sites-ocr-pull.js';

function fixture({complete, receipt, heartbeat, extract, protocol=2}={}) {
  const token=randomBytes(32).toString('base64url'),lease=randomBytes(32).toString('base64url');
  const bytes=Buffer.from('synthetic retained original for receipt recovery');
  const job={id:'synthetic-receipt-job',lease,mime:'image/png',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  if(protocol===2)Object.assign(job,{protocol:2,run_id:createHash('sha256').update(JSON.stringify(['document-job-v1','synthetic-owner',job.id,lease])).digest('base64url'),lease_until:new Date(Date.now()+180000).toISOString()});
  const f={job,bodies:[],receipts:0,heartbeats:0,extractions:0,leases:0,downloads:0,stored:false};
  f.accepted=(settled=true)=>({accepted:true,settled,state:settled?'needs_review':'processing',id:job.id,sha256:job.sha256,run_id:job.run_id,accepted_at:new Date().toISOString()});
  f.missing=()=>({accepted:false,retryable:true,id:job.id,sha256:job.sha256,run_id:job.run_id});
  const fetchImpl=async(url,options)=>{
    assert.equal(new URL(url).origin,'https://synthetic.example');
    assert.equal(options.headers.Authorization,'Bearer '+token);
    assert.equal(options.redirect,'manual');
    const action=new URL(url).pathname.split('/').pop(),body=options.body?JSON.parse(options.body):null;
    if(action==='lease'){f.leases++;return Response.json({job:f.leases===1?job:null});}
    if(action==='document'){f.downloads++;assert.equal(options.headers['X-MG-OCR-Lease'],lease);return new Response(bytes);}
    assert.equal(body.id,job.id);assert.equal(body.lease,lease);assert.equal(body.sha256,job.sha256);
    if(action==='heartbeat'){
      f.heartbeats++;
      return heartbeat?heartbeat(f):Response.json({ok:true,run_id:job.run_id,lease_until:new Date(Date.now()+180000).toISOString()});
    }
    if(action==='receipt'){f.receipts++;return receipt?receipt(f):Response.json(f.stored?f.accepted():f.missing());}
    if(action==='complete'){
      f.bodies.push(body);
      if(complete)return complete(f);
      f.stored=true;return Response.json({state:'needs_review'});
    }
    throw Error('unexpected worker action '+action);
  };
  f.run=()=>runSitesOcr({origin:'https://synthetic.example',token,mode:'local'},{fetchImpl,extract:async(data,mime)=>{
    f.extractions++;assert.deepEqual(data,bytes);assert.equal(mime,'image/png');
    return extract?extract(f):{text:'Synthetic unverified invoice',method:'ocr',confidence:60};
  }});
  return f;
}

test('protocol 2 refreshes the authenticated lease before extracting and stops after completion',async()=>{
  const f=fixture();assert.deepEqual(await f.run(),{processed:1,failed:0});
  assert.ok(f.heartbeats>=1);assert.equal(f.extractions,1);assert.equal(f.bodies.length,1);
});

test('an older server retains the existing worker protocol without unsupported requests',async()=>{
  const f=fixture({protocol:1});assert.deepEqual(await f.run(),{processed:1,failed:0});
  assert.equal(f.heartbeats,0);assert.equal(f.receipts,0);
});

test('a lost completion acknowledgement is confirmed from the matching durable receipt',async()=>{
  const f=fixture({complete:f=>{f.stored=true;throw Error('synthetic response lost after commit');}});
  assert.deepEqual(await f.run(),{processed:1,failed:0});
  assert.equal(f.extractions,1);assert.equal(f.bodies.length,1);assert.equal(f.receipts,1);
});

test('a transport failure before acceptance resends only the same result and live lease',async()=>{
  const f=fixture({complete:f=>{
    if(f.bodies.length===1)throw Error('synthetic upload interrupted before commit');
    f.stored=true;return Response.json({state:'needs_review'});
  }});
  assert.deepEqual(await f.run(),{processed:1,failed:0});
  assert.equal(f.extractions,1);assert.equal(f.bodies.length,2);assert.equal(f.receipts,1);
  assert.deepEqual(f.bodies[1],f.bodies[0]);
});

test('accepted but unfinished work remains pending and is never recomputed or counted complete',async()=>{
  const f=fixture({complete:f=>{f.stored=true;throw Error('synthetic continuation interrupted');},receipt:f=>Response.json(f.accepted(false))});
  assert.deepEqual(await f.run(),{processed:0,failed:0,accepted_pending:1,status_unknown:true});
  assert.equal(f.bodies.length,1);assert.equal(f.extractions,1);assert.equal(f.leases,1);
});

test('persistent uncertain completion is bounded at three sends of one extracted result',async()=>{
  const f=fixture({complete:()=>{throw Error('synthetic persistent upload outage');}});
  await assert.rejects(f.run());
  assert.equal(f.extractions,1);assert.equal(f.bodies.length,3);assert.equal(f.receipts,3);
  assert.deepEqual(f.bodies[0],f.bodies[2]);assert.equal(f.leases,1);
});

test('an expired or replaced lease never retries completion after the receipt check rejects it',async()=>{
  const f=fixture({complete:()=>new Response('changed',{status:409}),receipt:()=>new Response('changed',{status:409})});
  await assert.rejects(f.run());assert.equal(f.bodies.length,1);assert.equal(f.receipts,1);
});

for(const field of ['id','sha256','run_id'])test('a mismatched '+field+' in a receipt cannot certify saved work',async()=>{
  const f=fixture({complete:()=>{throw Error('synthetic uncertain response');},receipt:f=>Response.json({...f.accepted(),[field]:'other'})});
  await assert.rejects(f.run());assert.equal(f.bodies.length,1);assert.equal(f.receipts,1);
});

for(const status of [401,403,302,429])test('completion HTTP '+status+' stops without receipt polling or retransmission',async()=>{
  const f=fixture({complete:()=>new Response('private provider text',{status,headers:status===429?{'Retry-After':'120'}:{}})});
  await assert.rejects(f.run(),error=>{assert.equal(sitesOcrFailure(error).http_status,status);return true;});
  assert.equal(f.bodies.length,1);assert.equal(f.receipts,0);
});

test('a server Retry-After defers completion recovery without immediate polling',async()=>{
  const f=fixture({complete:()=>new Response('private provider text',{status:503,headers:{'Retry-After':'120'}})});
  await assert.rejects(f.run());assert.equal(f.bodies.length,1);assert.equal(f.receipts,0);
});

test('failed initial heartbeat prevents downloading or acknowledging an OCR failure',async()=>{
  const f=fixture({heartbeat:()=>new Response('lease changed',{status:409})});
  await assert.rejects(f.run());assert.equal(f.heartbeats,1);assert.equal(f.extractions,0);
  assert.equal(f.downloads,0);assert.equal(f.bodies.length,0);
});

test('heartbeats continue during extraction and stop once the run settles',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let release,started;
  const waiting=new Promise(resolve=>{release=resolve;}),reached=new Promise(resolve=>{started=resolve;});
  const f=fixture({extract:async()=>{started();await waiting;return {text:'Synthetic incomplete result',method:'ocr',confidence:60};}});
  const running=f.run();await reached;
  const first=f.heartbeats;
  t.mock.timers.tick(30000);await immediate();
  assert.ok(f.heartbeats>first);
  release();assert.deepEqual(await running,{processed:1,failed:0});
  const final=f.heartbeats;t.mock.timers.tick(30000);await immediate();assert.equal(f.heartbeats,final);
});

for(const protocol of [1,2])for(const payload of [{receipt_accepted:true},{ignored:true,receipt_accepted:true}])test('protocol '+protocol+' cannot accept a remote internal receipt marker '+JSON.stringify(payload),async()=>{
  const f=fixture({protocol,complete:()=>Response.json(payload)});
  await assert.rejects(f.run());assert.equal(f.extractions,1);
});
for(const protocol of [1,2])test('protocol '+protocol+' does not turn an acknowledged OCR failure into success through a remote receipt marker',async()=>{
  const f=fixture({protocol,extract:()=>({error:true}),complete:()=>Response.json({ok:true,receipt_accepted:true})});
  assert.deepEqual(await f.run(),{processed:0,failed:1});
});
for(const protocol of [1,2])test('protocol '+protocol+' ignores remote pending markers on a valid completion',async()=>{
  const f=fixture({protocol,complete:()=>Response.json({state:'needs_review',accepted_pending:true})});
  assert.deepEqual(await f.run(),{processed:1,failed:0});
});

test('a registered completion preserves success and exposes its pending after-check',async()=>{
  const f=fixture({complete:()=>Response.json({registered:true,aftercheck_pending:true,warning:'synthetic private aftercheck detail'})});
  assert.deepEqual(await f.run(),{processed:1,failed:0,aftercheck_pending:true});
  assert.equal(f.bodies.length,1);assert.equal(f.receipts,0);
});
test('a settled registered receipt exposes a pending after-check without resending the result',async()=>{
  const f=fixture({complete:f=>{f.stored=true;throw Error('synthetic lost registration acknowledgement');},receipt:f=>Response.json({...f.accepted(),state:'registered',aftercheck_pending:true})});
  assert.deepEqual(await f.run(),{processed:1,failed:0,aftercheck_pending:true});
  assert.equal(f.bodies.length,1);assert.equal(f.receipts,1);assert.equal(f.extractions,1);
});
