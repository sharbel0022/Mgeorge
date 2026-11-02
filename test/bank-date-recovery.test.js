import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {bankingRequest,fetchBookedTransactions} from '../src/bank.js';

// Generated credentials and a complete HTTP boundary mock: never call a bank.
const names=['ENABLE_BANKING_APPLICATION_ID','ENABLEBANKING_APP_ID','ENABLE_BANKING_PRIVATE_KEY','ENABLE_BANKING_PRIVATE_KEY_FILE','ENABLEBANKING_PRIVATE_KEY_FILE','ENABLE_BANKING_ENVIRONMENT','ENABLEBANKING_ENVIRONMENT'];
const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
const originalFetch=globalThis.fetch;
const privateKey=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
beforeEach(()=>{
  for(const name of names)delete process.env[name];
  process.env.ENABLE_BANKING_APPLICATION_ID='synthetic-date-recovery';
  process.env.ENABLE_BANKING_PRIVATE_KEY=privateKey;
  process.env.ENABLE_BANKING_ENVIRONMENT='SANDBOX';
  globalThis.fetch=async()=>{throw Error('Unexpected synthetic provider request');};
});
after(()=>{globalThis.fetch=originalFetch;for(const [name,value] of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value;}});
const transaction=(id,date)=>({status:'BOOK',entry_reference:id,booking_date:date,transaction_amount:{amount:'1.00',currency:'SEK'},credit_debit_indicator:'CRDT'});
const periodError=()=>Response.json({error:'WRONG_TRANSACTIONS_PERIOD',message:'private provider diagnostic'},{status:400});
const range=url=>{const query=new URL(url).searchParams;return [query.get('date_from'),query.get('date_to'),query.get('continuation_key')];};

test('long history is fetched in inclusive UTC windows without a gap at leap day',async()=>{
  const requested=[];
  globalThis.fetch=async url=>{const [from,to,cursor]=range(url);requested.push([from,to]);assert.equal(cursor,null);return Response.json({transactions:[transaction(from,from)]});};
  const rows=await fetchBookedTransactions('synthetic-account',{dateFrom:'2024-02-28',dateTo:'2024-06-01'});
  assert.deepEqual(requested,[['2024-02-28','2024-05-27'],['2024-05-28','2024-06-01']]);
  assert.deepEqual(rows.map(row=>row.booking_date),['2024-02-28','2024-05-28']);
});

test('only unavailable periods narrow the same start and reuse the accepted width across DST',async()=>{
  const requested=[];
  globalThis.fetch=async url=>{
    const [from,to]=range(url);requested.push([from,to]);
    if(Date.parse(to)-Date.parse(from)>2*86400000)return periodError();
    return Response.json({transactions:[transaction(from,from)]});
  };
  const rows=await fetchBookedTransactions('synthetic-account',{dateFrom:'2026-03-27',dateTo:'2026-04-02'});
  assert.deepEqual(requested,[['2026-03-27','2026-04-02'],['2026-03-27','2026-03-29'],['2026-03-30','2026-04-01'],['2026-04-02','2026-04-02']]);
  assert.deepEqual(rows.map(row=>row.booking_date),['2026-03-27','2026-03-30','2026-04-02']);
});

test('a period rejection on a later page discards that attempt and restarts pagination',async()=>{
  const requested=[];
  globalThis.fetch=async url=>{
    const item=range(url);requested.push(item);const [from,to,cursor]=item;
    if(from==='2026-01-01'&&to==='2026-01-04')return cursor?periodError():Response.json({transactions:[transaction('discard-this-attempt','2026-01-01')],continuation_key:'old-cursor'});
    assert.equal(cursor,null);
    return Response.json({transactions:[transaction(from,from)]});
  };
  const rows=await fetchBookedTransactions('synthetic-account',{dateFrom:'2026-01-01',dateTo:'2026-01-04'});
  assert.deepEqual(requested,[['2026-01-01','2026-01-04',null],['2026-01-01','2026-01-04','old-cursor'],['2026-01-01','2026-01-02',null],['2026-01-03','2026-01-04',null]]);
  assert.deepEqual(rows.map(row=>row.entry_reference),['2026-01-01','2026-01-03']);
});

test('empty historical pages with a continuation key do not end the exact requested interval',async()=>{
  const requested=[];
  globalThis.fetch=async url=>{const item=range(url);requested.push(item);return item[2]?Response.json({transactions:[transaction('after-empty-page','2025-01-07')]}):Response.json({transactions:[],continuation_key:'historical-page'});};
  const rows=await fetchBookedTransactions('synthetic-account',{dateFrom:'2025-01-01',dateTo:'2025-01-31'});
  assert.deepEqual(requested,[['2025-01-01','2025-01-31',null],['2025-01-01','2025-01-31','historical-page']]);
  assert.deepEqual(rows.map(row=>row.entry_reference),['after-empty-page']);
});

for(const [name,body,status,code,headers] of [
  ['invalid date order',{error:'WRONG_DATE_INTERVAL'},400,'invalid_date_range'],
  ['rate limit',{error:'ASPSP_RATE_LIMIT_EXCEEDED'},429,'rate_limited',{'Retry-After':'172800'}],
  ['expired consent',{error:'EXPIRED_SESSION'},400,'renewal_required'],
  ['application access',{error:'ACCESS_DENIED'},403,'application_access_denied'],
  ['other provider failure',{error:'UNKNOWN_FAILURE'},500,'bank_error']
])test(`${name} never starts date-recovery requests`,async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;return Response.json(body,{status,headers});};
  await assert.rejects(fetchBookedTransactions('synthetic-account',{dateFrom:'2026-01-01',dateTo:'2026-01-31'}),error=>error.code===code&&(code!=='rate_limited'||error.retryAfter===172800));
  assert.equal(calls,1);
});

test('an unavailable single day stops after six narrowings without claiming partial history',async()=>{
  const requested=[];globalThis.fetch=async url=>{requested.push(range(url).slice(0,2));return periodError();};
  await assert.rejects(fetchBookedTransactions('synthetic-account',{dateFrom:'2026-01-01',dateTo:'2026-03-31'}),{code:'transaction_period_unavailable'});
  assert.deepEqual(requested,[['2026-01-01','2026-03-31'],['2026-01-01','2026-02-14'],['2026-01-01','2026-01-22'],['2026-01-01','2026-01-11'],['2026-01-01','2026-01-05'],['2026-01-01','2026-01-02'],['2026-01-01','2026-01-01']]);
});

test('the request budget includes rejected periods and successful split windows',async()=>{
  let calls=0;globalThis.fetch=async url=>{calls++;const [from,to]=range(url);return from===to?Response.json({transactions:[transaction(from,from)]}):periodError();};
  await assert.rejects(fetchBookedTransactions('synthetic-account',{dateFrom:'2026-01-01',dateTo:'2026-03-31'}),{code:'page_limit'});
  assert.equal(calls,15);
});

test('revocation after a rejected provider request stops before a narrowed retry',async()=>{
  let calls=0,revoked=false;globalThis.fetch=async()=>{calls++;revoked=true;return periodError();};
  const authorize=()=>{if(revoked)throw Object.assign(Error('Synthetic revocation'),{status:401});};
  await assert.rejects(fetchBookedTransactions('synthetic-account',{dateFrom:'2026-01-01',dateTo:'2026-01-31',authorize}),{status:401});
  assert.equal(calls,1);
});

test('a stalled response body reports a timeout and cannot trigger date recovery',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let calls=0;
  globalThis.fetch=async(_url,options)=>{
    calls++;
    return new Response(new ReadableStream({start(controller){options.signal.addEventListener('abort',()=>controller.error(new DOMException('Synthetic timeout','AbortError')));}}),{status:200});
  };
  const pending=bankingRequest('/application');
  await Promise.resolve();
  t.mock.timers.tick(18000);
  await assert.rejects(pending,{code:'bank_timeout'});
  assert.equal(calls,1);
});

test('an expired total fetch deadline prevents any provider request',async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({transactions:[]});};
  await assert.rejects(fetchBookedTransactions('synthetic-account',{dateFrom:'2026-01-01',dateTo:'2026-01-31',deadline:Date.now()-1}),{code:'bank_timeout'});
  assert.equal(calls,0);
});

for(const status of [429,503])test(`HTTP ${status} preserves Retry-After before consuming a stalled body`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let reads=0,cancelled=0;
  globalThis.fetch=async(_url,options)=>{
    const response=new Response(new ReadableStream({
      start(controller){options.signal.addEventListener('abort',()=>{if(!cancelled)controller.error(new DOMException('Synthetic body timeout','AbortError'));});},
      cancel(){cancelled++;return new Promise(()=>{});}
    }),{status,headers:{'Retry-After':'172800'}});
    const json=response.json.bind(response);response.json=()=>{reads++;return json();};return response;
  };
  const check=assert.rejects(bankingRequest('/application'),error=>error.status===status&&error.retryAfter===172800&&!error.message.includes('Synthetic'));
  await Promise.resolve();t.mock.timers.tick(18000);await check;
  assert.equal(reads,0);assert.equal(cancelled,1);
});

test('Retry-After accepts numeric seconds without mistaking leading zeroes for an unbounded block',async()=>{
  globalThis.fetch=async()=>Response.json({error:'ASPSP_RATE_LIMIT_EXCEEDED'},{status:429,headers:{'Retry-After':'000000000120'}});
  await assert.rejects(bankingRequest('/application'),error=>error.retryAfter===120&&!error.retryBlocked);
});

for(const header of ['2026-11-03','Mon, 03 Nov 2026 10:00:00 GMT','Sun, 01 Nov 2026 10:00:00 GMT'])test(`nonstandard, inconsistent or past retry dates retain the six-hour fallback: ${header}`,async t=>{
  t.mock.method(Date,'now',()=>Date.parse('2026-11-02T10:00:00Z'));
  globalThis.fetch=async()=>Response.json({error:'ASPSP_RATE_LIMIT_EXCEEDED'},{status:429,headers:{'Retry-After':header}});
  await assert.rejects(bankingRequest('/application'),error=>error.retryAfter===21600&&!error.retryBlocked);
});
