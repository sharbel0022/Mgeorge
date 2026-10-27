import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiBase, configStatus, isConfigured, jwt, bankingRequest, assertApplicationReady, findSwedbank, startConsentBody, validateAuthorizationUrl, fetchBookedTransactions } from '../src/bank.js';

// All certificates in this suite are ephemeral fixtures. Never load .env or an
// administrator's key, and never fall through to a real bank request.
const folder=mkdtempSync(join(tmpdir(),'mgeorge-bank-'));
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=privateKey.export({type:'pkcs8',format:'pem'}),keyFile=join(folder,'test-only.key');
writeFileSync(keyFile,pem);
const applicationId='7d3ca760-9c0d-460b-b211-513121427f7f';
const names=['ENABLE_BANKING_APPLICATION_ID','ENABLEBANKING_APP_ID','ENABLE_BANKING_PRIVATE_KEY','ENABLE_BANKING_PRIVATE_KEY_FILE','ENABLEBANKING_PRIVATE_KEY_FILE','ENABLE_BANKING_ENVIRONMENT','ENABLEBANKING_ENVIRONMENT','ENABLE_BANKING_KEY_ROTATED','APP_ORIGIN'];
const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
const realFetch=globalThis.fetch;
const respond=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
const origin='http://localhost:3000';
function configured(){
  for(const name of names)delete process.env[name];
  process.env.ENABLE_BANKING_APPLICATION_ID=applicationId;
  process.env.ENABLE_BANKING_PRIVATE_KEY_FILE=keyFile;
  process.env.ENABLE_BANKING_ENVIRONMENT='SANDBOX';
  process.env.APP_ORIGIN=origin;
  globalThis.fetch=async()=>{throw Error('unexpected bank network request blocked');};
}
const application=(extra={})=>({kid:applicationId,environment:'SANDBOX',active:true,services:['AIS'],countries:['SE'],redirect_urls:[origin+'/api/bank/callback'],...extra});
const businessBank=(extra={})=>({name:'Swedbank',country:'SE',psu_types:['business'],maximum_consent_validity:86400,...extra});
const dateRange={dateFrom:'2026-09-28',dateTo:'2026-10-27'};
test.beforeEach(configured);
test.after(()=>{
  globalThis.fetch=realFetch;
  for(const name of names){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}
  rmSync(folder,{recursive:true,force:true});
});

test('missing server configuration fails closed without disclosing secrets',()=>{
  delete process.env.ENABLE_BANKING_APPLICATION_ID;
  assert.equal(isConfigured(),false);
  assert.equal(configStatus().code,'not_configured');
  assert.throws(jwt,e=>e.code==='not_configured'&&e.status===409);
  assert.doesNotMatch(JSON.stringify(configStatus()),/PRIVATE KEY|7d3ca760|test-only\.key/);
});
test('environment and explicit production key rotation are mandatory before any key is read',()=>{
  delete process.env.ENABLE_BANKING_ENVIRONMENT;
  assert.equal(configStatus().code,'environment_required');
  process.env.ENABLE_BANKING_ENVIRONMENT='production';
  process.env.ENABLE_BANKING_PRIVATE_KEY_FILE='nonexistent-do-not-read.key';
  assert.equal(configStatus().code,'key_rotation_required');
  process.env.ENABLE_BANKING_KEY_ROTATED='true';
  assert.equal(configStatus().code,'invalid_origin');
  process.env.APP_ORIGIN='https://fakturor.example.com';
  assert.equal(configStatus().code,'invalid_private_key');
  process.env.ENABLE_BANKING_PRIVATE_KEY_FILE=keyFile;
  assert.equal(configStatus().configured,true);
});
test('invalid or non-RSA private keys return only a safe configuration error',()=>{
  delete process.env.ENABLE_BANKING_PRIVATE_KEY_FILE;
  process.env.ENABLE_BANKING_PRIVATE_KEY='a secret that must not appear in any error';
  assert.equal(configStatus().code,'invalid_private_key');
  assert.throws(jwt,e=>e.code==='invalid_private_key'&&!e.message.includes('a secret'));
  process.env.ENABLE_BANKING_PRIVATE_KEY=generateKeyPairSync('ed25519').privateKey.export({format:'pem',type:'pkcs8'});
  assert.equal(configStatus().code,'invalid_private_key');
});
test('legacy file configuration and protected multiline key environment remain supported',()=>{
  delete process.env.ENABLE_BANKING_APPLICATION_ID;delete process.env.ENABLE_BANKING_PRIVATE_KEY_FILE;delete process.env.ENABLE_BANKING_ENVIRONMENT;
  process.env.ENABLEBANKING_APP_ID=applicationId;process.env.ENABLEBANKING_PRIVATE_KEY_FILE=keyFile;process.env.ENABLEBANKING_ENVIRONMENT='SANDBOX';
  assert.equal(isConfigured(),true);
  process.env.ENABLE_BANKING_APPLICATION_ID='different-application';
  assert.equal(configStatus().code,'ambiguous_configuration');
  delete process.env.ENABLEBANKING_APP_ID;process.env.ENABLE_BANKING_APPLICATION_ID=applicationId;
  delete process.env.ENABLEBANKING_PRIVATE_KEY_FILE;process.env.ENABLE_BANKING_PRIVATE_KEY=pem.replace(/\n/g,'\\n');
  assert.equal(isConfigured(),true);
  process.env.ENABLE_BANKING_PRIVATE_KEY_FILE=keyFile;
  assert.equal(configStatus().code,'ambiguous_configuration');
});
test('JWT uses the official RS256 application identity, audience and bounded lifetime',()=>{
  const value=jwt(),[header,payload,signature]=value.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header,'base64url')),{typ:'JWT',alg:'RS256',kid:applicationId});
  const claims=JSON.parse(Buffer.from(payload,'base64url'));
  assert.equal(claims.iss,'enablebanking.com');assert.equal(claims.aud,'api.enablebanking.com');assert.equal(claims.exp-claims.iat,3600);
  assert.ok(Math.abs(claims.iat-Math.floor(Date.now()/1000))<2);
  const verifier=createVerify('RSA-SHA256');verifier.update(header+'.'+payload);verifier.end();
  assert.equal(verifier.verify(publicKey,Buffer.from(signature,'base64url')),true);
});
test('adapter permits AIS only and does not follow API redirects with its authorization header',async()=>{
  let called=0;
  globalThis.fetch=async(url,options)=>{called++;assert.equal(url,apiBase+'/application');assert.equal(options.redirect,'error');assert.match(options.headers.Authorization,/^Bearer /);return respond(application());};
  await bankingRequest('/application');assert.equal(called,1);
  for(const path of ['//evil.example/application','/\\evil.example/application','/accounts/../application','https://evil.example','/payments','/sessions/abc#fragment']){
    await assert.rejects(bankingRequest(path),e=>['invalid_path','read_only'].includes(e.code));
  }
  await assert.rejects(bankingRequest('/payments',{method:'POST',body:{amount:'1'}}),e=>e.code==='read_only');
  assert.equal(called,1);
});
test('readiness confirms application activation, actual environment, AIS country and exact callback',async()=>{
  globalThis.fetch=async()=>respond(application());
  const ready=await assertApplicationReady(origin);assert.equal(ready.active,true);assert.equal(ready.environment,'SANDBOX');assert.ok(Date.parse(ready.checked_at));
  const cases=[
    [{active:false},'application_inactive'],[{environment:'PRODUCTION'},'environment_mismatch'],
    [{kid:'different'},'application_mismatch'],[{services:['PIS']},'ais_not_enabled'],
    [{countries:['FI']},'ais_not_enabled'],[{redirect_urls:[origin+'/api/bank/callback/']},'redirect_not_registered']
  ];
  for(const [extra,code] of cases){globalThis.fetch=async()=>respond(application(extra));await assert.rejects(assertApplicationReady(origin),e=>e.code===code);}
});
test('bank discovery only offers Swedish Swedbank business connections',async()=>{
  globalThis.fetch=async url=>{assert.equal(url,apiBase+'/aspsps?country=SE');return respond({aspsps:[businessBank({name:'Swedbank Företag'}),businessBank({psu_types:['personal']}),businessBank({country:'EE'}),businessBank({name:'Other bank'}),businessBank(),businessBank({psu_types:undefined})]});};
  assert.deepEqual((await findSwedbank()).map(x=>x.name),['Swedbank','Swedbank Företag']);
});
test('consent is business read-only with random state, registered origin and bank-limited validity',()=>{
  const before=Date.now(),body=startConsentBody(businessBank(),'s'.repeat(43),origin);
  assert.equal(body.psu_type,'business');assert.equal(body.language,'sv');assert.equal(body.state,'s'.repeat(43));
  assert.equal(body.access.transactions,true);assert.equal(body.access.balances,false);assert.equal(body.redirect_url,origin+'/api/bank/callback');
  assert.ok(Date.parse(body.access.valid_until)>before+86360_000);assert.ok(Date.parse(body.access.valid_until)<=Date.now()+86400_000);
  assert.throws(()=>startConsentBody(businessBank(),'too-short',origin),e=>e.code==='invalid_state');
  assert.throws(()=>startConsentBody(businessBank({psu_types:['personal']}),'s'.repeat(43),origin),e=>e.code==='business_bank_unavailable');
  assert.throws(()=>startConsentBody(businessBank({maximum_consent_validity:0}),'s'.repeat(43),origin),e=>e.code==='invalid_consent_validity');
  for(const value of ['http://evil.example','https://example.com/path','https://example.com?x=y','https://user@example.com'])assert.throws(()=>startConsentBody(businessBank(),'s'.repeat(43),value),e=>e.code==='invalid_origin');
});
test('bank authentication only redirects to the official HTTPS authorization origin',()=>{
  const allowed='https://auth.enablebanking.com/ais/start?sessionid=test';assert.equal(validateAuthorizationUrl(allowed),allowed);
  for(const url of ['http://auth.enablebanking.com/ais/start','https://evil.enablebanking.com/','https://auth.enablebanking.com.evil.example/','https://user@auth.enablebanking.com/','https://auth.enablebanking.com:8443/','javascript:alert(1)','https://auth.enablebanking.com/#fragment'])assert.throws(()=>validateAuthorizationUrl(url),e=>e.code==='invalid_authorization_url');
});
test('session authorization and account retrieval use AIS POST/GET without accepting provider secrets in errors',async()=>{
  const calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return url.endsWith('/sessions')?respond({session_id:'confirmed-session',accounts:[{uid:'account',currency:'SEK'}],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:'2026-11-01T12:00:00Z'}}):respond({uid:'account',currency:'SEK'});};
  const session=await bankingRequest('/sessions',{method:'POST',body:{code:'one-use-code'}});
  assert.equal(session.accounts[0].uid,'account');assert.equal(JSON.parse(calls[0].options.body).code,'one-use-code');
  assert.equal((await bankingRequest('/accounts/account')).uid,'account');
  assert.equal(calls[1].options.method,'GET');
  globalThis.fetch=async()=>respond({error:'WRONG_AUTHORIZATION_CODE',message:'private banking data',detail:pem},400);
  await assert.rejects(bankingRequest('/sessions',{method:'POST',body:{code:'bad'}}),e=>e.code==='authorization_failed'&&!e.message.includes('private banking data')&&!e.message.includes('PRIVATE KEY'));
});
test('expired and revoked sessions explicitly require reconnection',async()=>{
  for(const error of ['EXPIRED_SESSION','CLOSED_SESSION','REVOKED_SESSION','SESSION_DOES_NOT_EXIST']){
    globalThis.fetch=async()=>respond({error,message:'never reflect this'},404);
    await assert.rejects(bankingRequest('/sessions/expired'),e=>e.code==='renewal_required'&&e.status===409&&e.providerStatus===404&&!e.message.includes('never reflect'));
  }
});
test('rate limits retain bounded retry delay and do not replay a failed POST',async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;return respond({error:'ASPSP_RATE_LIMIT_EXCEEDED',message:'private'},429,{'Retry-After':'120'});};
  await assert.rejects(bankingRequest('/auth',{method:'POST',body:{}}),e=>e.code==='rate_limited'&&e.status===429&&e.retryAfter===120);
  assert.equal(calls,1);
  globalThis.fetch=async()=>respond({error:'ASPSP_RATE_LIMIT_EXCEEDED'},400,{'Retry-After':'999999'});
  await assert.rejects(bankingRequest('/application'),e=>e.retryAfter===86400);
});
test('provider permission, invalid JSON and network errors are redacted',async()=>{
  globalThis.fetch=async()=>respond({message:pem,error:'ACCESS_DENIED'},403);
  await assert.rejects(bankingRequest('/application'),e=>e.code==='application_access_denied'&&!e.message.includes('PRIVATE KEY'));
  globalThis.fetch=async()=>new Response('not json',{status:200});
  await assert.rejects(bankingRequest('/application'),e=>e.code==='invalid_response');
  globalThis.fetch=async()=>{throw Error('private network diagnostic and token');};
  await assert.rejects(bankingRequest('/application'),e=>e.code==='bank_unavailable'&&!e.message.includes('token'));
  globalThis.fetch=async()=>new Response(null,{status:204});
  assert.deepEqual(await bankingRequest('/sessions/session',{method:'DELETE'}),{});
});
test('transactions follow continuation keys, preserve both directions and only return booked entries',async()=>{
  const calls=[];
  globalThis.fetch=async url=>{
    const parsed=new URL(url);calls.push(parsed);assert.equal(parsed.pathname,'/accounts/account-1/transactions');
    assert.equal(parsed.searchParams.get('transaction_status'),'BOOK');assert.equal(parsed.searchParams.get('date_from'),dateRange.dateFrom);assert.equal(parsed.searchParams.get('date_to'),dateRange.dateTo);
    return parsed.searchParams.has('continuation_key')?respond({transactions:[{entry_reference:'outgoing',status:'BOOK',credit_debit_indicator:'DBIT'}]}):respond({transactions:[{entry_reference:'incoming',status:'BOOK',credit_debit_indicator:'CRDT'},{entry_reference:'pending',status:'PDNG'}],continuation_key:'page+2/='});
  };
  const rows=await fetchBookedTransactions('account-1',dateRange);
  assert.deepEqual(rows.map(x=>x.entry_reference),['incoming','outgoing']);assert.equal(calls.length,2);assert.equal(calls[1].searchParams.get('continuation_key'),'page+2/=');
});
test('invalid dates, malformed transaction status and repeated pagination fail the complete batch',async()=>{
  await assert.rejects(fetchBookedTransactions('a',{dateFrom:'2026-02-30',dateTo:'2026-03-01'}),e=>e.code==='invalid_date_range');
  await assert.rejects(fetchBookedTransactions('a',{dateFrom:'2026-01-01',dateTo:'2026-10-27'}),e=>e.code==='invalid_date_range');
  globalThis.fetch=async()=>respond({transactions:[{booking_date:'2026-10-01'}]});
  await assert.rejects(fetchBookedTransactions('a',dateRange),e=>e.code==='invalid_response');
  let pages=0;globalThis.fetch=async()=>{pages++;return respond({transactions:[{status:'BOOK'}],continuation_key:'repeated'});};
  await assert.rejects(fetchBookedTransactions('a',dateRange),e=>e.code==='repeated_cursor');assert.equal(pages,2);
});
test('transactions never return a partial batch after page or transaction limits',async()=>{
  let pages=0;globalThis.fetch=async()=>respond({transactions:[],continuation_key:'page-'+(++pages)});
  await assert.rejects(fetchBookedTransactions('a',dateRange),e=>e.code==='page_limit');assert.equal(pages,15);
  globalThis.fetch=async()=>respond({transactions:Array.from({length:5001},()=>({status:'BOOK'}))});
  await assert.rejects(fetchBookedTransactions('a',dateRange),e=>e.code==='transaction_limit');
});
