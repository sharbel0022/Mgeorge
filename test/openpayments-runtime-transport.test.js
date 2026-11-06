import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {chmodSync,copyFileSync,symlinkSync,writeFileSync,readFileSync} from 'node:fs';
import {nodeSaasBankRuntime} from '../src/saas-bank-runtime.js';
import {openDatabase} from '../src/db.js';
import {createNodeOpenPaymentsCompanySyncRuntime,readNodeOpenPaymentsCompanySyncStatus} from '../src/openpayments-company-bank-sync.js';
import {certificateFixture,localProvider} from './helpers/openpayments-local-tls.mjs';

let certificates;
before(()=>{certificates=certificateFixture();});
after(()=>certificates.close());
const context={version:'company-context-v1',companyId:'synthetic-company',storageOwner:'synthetic-owner',actorId:'synthetic-actor',role:'owner',membershipVersion:1,companyVersion:1,contextVersion:1};
function fixture(t,{mtls=certificates.configuration,disabled=false,durable=false}={}) {
  const db=durable?openDatabase(certificates.file('synthetic-'+crypto.randomUUID()+'.sqlite')):new DatabaseSync(':memory:');db.exec('CREATE TABLE IF NOT EXISTS saas_bank_state(owner TEXT PRIMARY KEY,revision INTEGER,payload TEXT)');t.after(()=>db.close());
  const config={environment:'PRODUCTION',clientId:'synthetic-app',clientSecret:'synthetic-secret',credentialGeneration:'synthetic-production-g1',features:['bank_discovery','consents','accounts','transactions'],redirectUris:['https://app.example/api/companies/synthetic-company/bank/callback']};
  const registration={companyId:context.companyId,actorId:context.actorId,verified:true,corporateAccessVerified:true,redirectVerified:true,corporateId:'synthetic-company-id',psuId:'synthetic-psu-id',bicFi:'OPBKSE21',bankId:'OPBKSE21',bankName:'Synthetic Bank',authenticationMethodId:'mbid',psu:{ipAddress:'192.0.2.10',userAgent:'Synthetic TLS test'},ratePolicy:{verified:true,evidenceId:'synthetic-rate-policy',maxRequests:100,windowMs:60000}};
  const environment={SAAS_BANK_ENABLED:disabled?'false':'true',SAAS_OPENPAYMENTS_CONFIG:JSON.stringify(config),SAAS_OPENPAYMENTS_REGISTRATIONS:JSON.stringify([registration]),...(mtls===null?{}:{SAAS_OPENPAYMENTS_MTLS_CONFIG:JSON.stringify(mtls)})};
  const options={db,context,assertCurrent:()=>{},sessionHash:'synthetic-session',origin:'https://app.example',environment};
  return {environment,options,create:overrides=>nodeSaasBankRuntime({...options,...overrides})};
}
const discovery=received=>received.path==='/connect/token'?{access_token:'synthetic-token',token_type:'Bearer',expires_in:3600,scope:new URLSearchParams(received.body).get('scope')}:{aspsps:[{bicFi:'OPBKSE21',name:'Synthetic Bank'}]};

test('ordinary Node production runtime uses configured certificate files for real local mutual TLS',async t=>{
  const provider=await localProvider(t,certificates,discovery),f=fixture(t),bank=f.create();
  assert.equal((await bank.snapshot()).actions.connect,true,'a real configured transport must reach the ordinary runtime');
  const result=await bank.discovery();
  assert.equal(result.banks[0].id,'OPBKSE21');
  assert.equal(provider.requests.length,2);
  assert.ok(provider.requests.every(r=>r.clientAuthorized&&r.clientFingerprint===certificates.fingerprint));
  assert.deepEqual(provider.requests.map(r=>r.host),['auth.openbankingplatform.com','api.openbankingplatform.com']);
  assert.equal(f.options.db.prepare('SELECT count(*) n FROM saas_bank_state').get().n,0,'discovery cannot create a consent');
});

test('concurrent ordinary runtimes share only the application token while keeping each request boundary',async t=>{
  const provider=await localProvider(t,certificates,discovery),f=fixture(t),counts=[0,0,0,0];
  const banks=counts.map((_,index)=>f.create({providerOptions:{requestBoundary:async operation=>{counts[index]++;return operation({signal:new AbortController().signal,deadline:Date.now()+20000});}}}));
  const results=await Promise.all(banks.map(bank=>bank.discovery()));
  assert.ok(results.every(result=>result.banks[0].id==='OPBKSE21'));
  assert.equal(provider.requests.filter(r=>r.path==='/connect/token').length,1,'one app token can serve current runtimes for the same exact app/config/TLS identity');
  assert.equal(counts.reduce((sum,n)=>sum+n,0),5,'one token exchange plus four independently budgeted discovery calls');
  assert.ok(counts.every(count=>count>=1),'every caller uses its own HTTP boundary');
});

test('a shared in-flight token never bypasses a caller whose membership was revoked',async t=>{
  let revoked=false;
  const provider=await localProvider(t,certificates,r=>{if(r.path==='/connect/token')revoked=true;return discovery(r);}),f=fixture(t),a=f.create(),b=f.create({assertCurrent:()=>{if(revoked)throw Error('synthetic membership revoked');}});
  const result=await Promise.allSettled([a.discovery(),b.discovery()]);
  assert.equal(result[0].status,'fulfilled');assert.equal(result[1].status,'rejected');assert.equal(result[1].reason.code,'RESOURCE_SCOPE_MISMATCH');
  assert.equal(provider.requests.filter(r=>r.path==='/connect/token').length,1);assert.equal(provider.requests.filter(r=>r.path!=='/connect/token').length,1,'only the still-authorized caller may read provider data');
});

test('an API token rejection invalidates all current runtime clients without retrying automatically',async t=>{
  let apiReads=0;const provider=await localProvider(t,certificates,r=>r.path!=='/connect/token'&&++apiReads===2?{status:401,body:{error:'synthetic-token-rejected'}}:discovery(r)),f=fixture(t);
  await f.create().discovery();await assert.rejects(f.create().discovery(),{code:'INVALID_ACCESS_TOKEN'});
  assert.equal(provider.requests.filter(r=>r.path==='/connect/token').length,1,'a rejected API call does not replay itself');
  await f.create().discovery();assert.equal(provider.requests.filter(r=>r.path==='/connect/token').length,2);assert.equal(apiReads,3);
});

test('restoring authorized configuration after observed rotation uses a fresh token identity',async t=>{
  const provider=await localProvider(t,certificates,discovery),f=fixture(t),old=f.create(),original=f.environment.SAAS_OPENPAYMENTS_MTLS_CONFIG;
  await old.discovery();f.environment.SAAS_OPENPAYMENTS_MTLS_CONFIG=JSON.stringify({...certificates.configuration,certificateSha256:'0'.repeat(64)});
  await assert.rejects(old.discovery(),{code:'CONSENT_APPLICATION_CHANGED'});f.environment.SAAS_OPENPAYMENTS_MTLS_CONFIG=original;
  await f.create().discovery();assert.equal(provider.requests.filter(r=>r.path==='/connect/token').length,2,'the invalidated old token is never revived');
});

test('missing server certificate configuration leaves production unavailable without network calls',async t=>{
  const provider=await localProvider(t,certificates,discovery),f=fixture(t,{mtls:null}),bank=f.create();
  assert.equal((await bank.snapshot()).actions.connect,false);
  await assert.rejects(bank.discovery(),{code:'SAAS_BANK_DISABLED'});
  assert.deepEqual(provider.requests,[]);
});

test('disabled service does not load or expose an invalid private certificate path',async t=>{
  const f=fixture(t,{disabled:true,mtls:{...certificates.configuration,privateKeyFile:'/SYNTHETIC_PRIVATE_PATH/unavailable'}});
  assert.equal((await f.create().snapshot()).actions.connect,false);
});

for(const [name,change] of [
  ['credential generation',c=>c.credentialGeneration='different'],
  ['certificate fingerprint',c=>c.certificateSha256='0'.repeat(64)],
  ['CA fingerprint',c=>c.caSha256='0'.repeat(64)],
  ['relative key path',c=>c.privateKeyFile='client.key'],
  ['unconfigured CA fingerprint',c=>delete c.caSha256],
  ['unknown override',c=>c.rejectUnauthorized=false],
])test('production configuration rejects '+name+' before a socket or state change',async t=>{
  const provider=await localProvider(t,certificates,discovery),config={...certificates.configuration};change(config);const f=fixture(t,{mtls:config});
  await assert.rejects(async()=>f.create().discovery(),error=>{assert.equal(error.code,'INVALID_CLIENT_CERTIFICATE');assert.doesNotMatch(error.message,/client\.key|SYNTHETIC_PRIVATE|BEGIN/);return true;});
  assert.deepEqual(provider.requests,[]);assert.equal(f.options.db.prepare('SELECT count(*) n FROM saas_bank_state').get().n,0);
});

test('a world-readable private key is rejected even when its certificate matches',async t=>{
  const path=certificates.file('unsafe.key');copyFileSync(certificates.file('client.key'),path);chmodSync(path,0o644);
  const f=fixture(t,{mtls:{...certificates.configuration,privateKeyFile:path}});
  await assert.rejects(async()=>f.create().discovery(),{code:'INVALID_CLIENT_CERTIFICATE'});
});

test('a symlink cannot supply server credential material',async t=>{
  const path=certificates.file('linked.key');symlinkSync(certificates.file('client.key'),path);
  const f=fixture(t,{mtls:{...certificates.configuration,privateKeyFile:path}});
  await assert.rejects(async()=>f.create().discovery(),{code:'INVALID_CLIENT_CERTIFICATE'});
});

for(const [name,contents] of [
  ['malformed PEM',()=> 'not a certificate'],
  ['a leaf certificate used as CA',()=>certificates.read('server.pem')],
])test('configured trust rejects '+name+' even with a matching file digest',async t=>{
  const path=certificates.file(name.startsWith('malformed')?'malformed-ca.pem':'leaf-ca.pem'),pem=contents();writeFileSync(path,pem,{mode:0o600});
  const provider=await localProvider(t,certificates,discovery),f=fixture(t,{mtls:{...certificates.configuration,caFile:path,caSha256:createHash('sha256').update(pem).digest('hex')}});
  await assert.rejects(async()=>f.create().discovery(),{code:'INVALID_CLIENT_CERTIFICATE'});assert.deepEqual(provider.requests,[]);
});

test('certificate configuration rotation fences an already-created runtime before any provider call',async t=>{
  const provider=await localProvider(t,certificates,discovery),f=fixture(t),bank=f.create();
  f.environment.SAAS_OPENPAYMENTS_MTLS_CONFIG=JSON.stringify({...certificates.configuration,certificateSha256:'0'.repeat(64)});
  await assert.rejects(bank.discovery(),{code:'CONSENT_APPLICATION_CHANGED'});
  assert.deepEqual(provider.requests,[]);
});

test('changing a private key file fences the captured runtime rather than retaining the old key',async t=>{
  const path=certificates.file('rotated.key');copyFileSync(certificates.file('client.key'),path);chmodSync(path,0o600);
  const provider=await localProvider(t,certificates,discovery),f=fixture(t,{mtls:{...certificates.configuration,privateKeyFile:path}}),bank=f.create();
  writeFileSync(path,readFileSync(certificates.file('ca.key')),{mode:0o600});
  await assert.rejects(bank.discovery(),{code:'INVALID_CLIENT_CERTIFICATE'});assert.deepEqual(provider.requests,[]);
});

test('certificate replacement during a response prevents the next request and result exposure',async t=>{
  const path=certificates.file('midflight.key');copyFileSync(certificates.file('client.key'),path);chmodSync(path,0o600);
  const f=fixture(t,{mtls:{...certificates.configuration,privateKeyFile:path}});
  const provider=await localProvider(t,certificates,r=>{if(r.path==='/connect/token')writeFileSync(path,readFileSync(certificates.file('ca.key')),{mode:0o600});return discovery(r);});
  await assert.rejects(f.create().discovery(),error=>['INVALID_CLIENT_CERTIFICATE','RESOURCE_SCOPE_MISMATCH'].includes(error.code));
  assert.equal(provider.requests.length,1);assert.equal(f.options.db.prepare('SELECT count(*) n FROM saas_bank_state').get().n,0);
});

test('configured CA is verified by real TLS and is not a switch to disable server verification',async t=>{
  const withoutCA={...certificates.configuration};delete withoutCA.caFile;delete withoutCA.caSha256;
  const provider=await localProvider(t,certificates,discovery),f=fixture(t,{mtls:withoutCA});
  await assert.rejects(f.create().discovery());
  assert.deepEqual(provider.requests,[],'untrusted server cannot receive the application token request');
});

test('normal production consent, selected-account scheduled sync and stored status share the configured mTLS path',async t=>{
  process.env.BANK_DATA_KEY='b'.repeat(64);delete process.env.ENCRYPTION_KEY;
  const consent='11111111-1111-4111-8111-111111111111',auth='22222222-2222-4222-8222-222222222222',account='33333333-3333-4333-8333-333333333333';
  const today=new Date().toISOString().slice(0,10),until=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  const provider=await localProvider(t,certificates,r=>{
    const path=new URL(r.path,'https://synthetic.example').pathname;
    if(path==='/connect/token')return discovery(r);
    if(path==='/psd2/aspspinformation/v1/aspsps/OPBKSE21')return {bicFi:'OPBKSE21',name:'Synthetic Bank',supportedAuthorizationMethods:[{name:'OAuth2',uri:'https://auth.openbankingplatform.com/.well-known/openid-configuration'}],accountInformation:{transactionHistoryMaxDays:90}};
    if(path==='/psd2/consent/v1/consents'&&r.method==='POST')return {status:201,body:{consentId:consent,consentStatus:'received'}};
    if(path===`/psd2/consent/v1/consents/${consent}/authorisations`)return {status:201,body:{authorisationId:auth,scaStatus:'received',scaMethods:[{authenticationMethodId:'mbid',authenticationType:'PUSH_OTP',name:'Synthetic BankID'}]}};
    if(path===`/psd2/consent/v1/consents/${consent}/authorisations/${auth}`)return {headers:{'aspsp-sca-approach':'REDIRECT'},body:{scaStatus:'started',_links:{scaOAuth:{href:`https://auth.openbankingplatform.com/connect/authorize?client_id=[CLIENT_ID]&scope=accountinformation%20corporate&response_type=code&redirect_uri=[TPP_REDIRECT_URI]&state=[TPP_STATE]&acr_values=idp:OPBKSE21%20consentId:${consent}%20ConsentAuthorisationId:${auth}`}}}};
    if(path===`/psd2/consent/v1/consents/${consent}/status`)return {consentStatus:'valid'};
    if(path===`/psd2/consent/v1/consents/${consent}`)return {consentStatus:'valid',validUntil:until,recurringIndicator:true,frequencyPerDay:4,access:{}};
    if(path==='/psd2/accountinformation/v1/accounts')return {accounts:[{resourceId:account,iban:'SE4550000000058398257466',currency:'SEK',usage:'ORGA',name:'Synthetic corporate account'}]};
    if(path===`/psd2/accountinformation/v1/accounts/${account}`)return {resourceId:account,iban:'SE4550000000058398257466',currency:'SEK',usage:'ORGA',name:'Synthetic corporate account'};
    if(path===`/psd2/accountinformation/v1/accounts/${account}/transactions`)return {account:{iban:'SE4550000000058398257466'},transactions:{booked:[{transactionId:'synthetic-lookup',entryReference:'synthetic-entry',transactionAmount:{amount:'625.00',currency:'SEK'},bookingDate:today,debtorName:'Synthetic payer',remittanceInformationStructured:'0599'}],_links:{}}};
    throw Error('Unexpected synthetic provider operation');
  });
  const f=fixture(t,{durable:true}),bank=f.create({requestKey:'synthetic-create-00001'});
  await bank.start({bankId:'OPBKSE21',permissions:['accounts:read','transactions:read'],expectedRevision:0});
  const pending=await bank.snapshot(),state=new URL(await bank.redirect(pending.authorization.id)).searchParams.get('state');
  await bank.callback({state,code:'synthetic-code',scope:'accountinformation corporate'});
  const approved=await bank.snapshot(),accountId=approved.accounts[0].id;
  await f.create({requestKey:'synthetic-select-00001'}).select({connectionId:approved.connection.id,accountIds:[accountId],expectedRevision:approved.revision});
  const sync=await createNodeOpenPaymentsCompanySyncRuntime({...f.options,evidenceId:'synthetic-company-binding',existingDataCompanyId:context.companyId,automatic:{enabled:true,operatorVerified:true,evidenceId:'synthetic-operator'}});
  const result=await sync.scheduled();
  assert.equal(result.results[0].status,'success',JSON.stringify(result));assert.equal(result.results[0].imported,1);
  const rows=f.options.db.prepare('SELECT amount_cents,reference FROM bank_transactions').all();assert.deepEqual(rows.map(r=>({...r})),[{amount_cents:62500,reference:'0599'}]);
  assert.equal(f.options.db.prepare('SELECT count(*) n FROM allocations').get().n,0);
  const calls=provider.requests.length;
  const status=await readNodeOpenPaymentsCompanySyncStatus({...f.options,accountId,automaticEnabled:true});
  assert.equal(status.state,'succeeded');assert.equal(status.automaticEnabled,true);assert.equal(provider.requests.length,calls,'stored status does not contact the provider');
  assert.ok(provider.requests.every(r=>r.clientAuthorized&&r.clientFingerprint===certificates.fingerprint));
  t.diagnostic(JSON.stringify({syntheticLocalTlsRequests:calls,verifiedClientCertificates:provider.requests.filter(r=>r.clientAuthorized&&r.clientFingerprint===certificates.fingerprint).length,applicationTokenRequests:provider.requests.filter(r=>r.path==='/connect/token'&&new URLSearchParams(r.body).get('grant_type')==='client_credentials').length,authorizationCodeRequests:provider.requests.filter(r=>r.path==='/connect/token'&&new URLSearchParams(r.body).get('grant_type')==='authorization_code').length,productionProviderRequests:0}));
  assert.equal(provider.requests.filter(r=>r.path==='/connect/token'&&new URLSearchParams(r.body).get('grant_type')==='client_credentials').length,1,'onboarding and sync reuse the valid app token without sharing their tenant guards or request budgets');
  f.environment.SAAS_OPENPAYMENTS_MTLS_CONFIG=JSON.stringify({...certificates.configuration,certificateSha256:'0'.repeat(64)});
  const blocked=await readNodeOpenPaymentsCompanySyncStatus({...f.options,accountId,automaticEnabled:true});
  assert.equal(blocked.state,'blocked');assert.equal(blocked.automaticEnabled,false);assert.equal(blocked.lastSuccessAt,status.lastSuccessAt);assert.equal(provider.requests.length,calls);
});
