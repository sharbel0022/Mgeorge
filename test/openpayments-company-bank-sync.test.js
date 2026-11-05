import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.js';
import {createCompanyRuntime} from '../src/company-runtime.js';
import {digest,decryptObject,encryptObject} from '../src/security.js';
import {nodeSaasBankRuntime} from '../src/saas-bank-runtime.js';
import {createNodeOpenPaymentsCompanySyncRuntime,readNodeOpenPaymentsCompanySyncStatus} from '../src/openpayments-company-bank-sync.js';
import {fixtureTransport,CONFIG,CONSENT_ID,AUTH_ID,ACCOUNT_ID,TX,json} from '../sites/tests/helpers/openpayments-fixture.mjs';
process.env.BANK_DATA_KEY='b'.repeat(64);delete process.env.ENCRYPTION_KEY;
const date=new Date().toISOString().slice(0,10),expiry=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
async function fixture(t,{transactions,consentStatus,automatic,bankgiro=false,bindCompany=false,...settings}={}){
 const folder=mkdtempSync(join(tmpdir(),'mg-op-sync-')),db=openDatabase(join(folder,'company.sqlite'));let companyRuntime;t.after(()=>{companyRuntime?.close();db.close();rmSync(folder,{recursive:true,force:true});});
 let context={version:'company-context-v1',companyId:'company-a',storageOwner:'owner-a',actorId:'actor-a',role:'owner',membershipVersion:1,companyVersion:1,contextVersion:1};
 if(bindCompany){companyRuntime=createCompanyRuntime({controlDb:db,legacyDatabasePath:join(folder,'company.sqlite'),legacyPrincipal:'owner-a'});companyRuntime.bindLegacyCompany({companyId:'company-a',storageOwner:'owner-a',actorId:'owner-a',name:'Synthetic company A',verification:{status:'verified',evidenceId:'synthetic-verified-company',verifiedBy:'owner-a'}});companyRuntime.setMembership({companyId:'company-a',actorId:'actor-a',role:'owner',status:'active'});context=companyRuntime.selectActiveCompany({actorId:'actor-a',companyId:'company-a'});}
 db.exec('CREATE TABLE synthetic_membership(active INTEGER); INSERT INTO synthetic_membership VALUES(1)');
 const assertCurrent=()=>{if(companyRuntime)companyRuntime.run(context,()=>companyRuntime.assert('manage_integrations'));if(db.prepare('SELECT active FROM synthetic_membership').get().active!==1)throw Object.assign(Error('AUTHORIZATION_CHANGED'),{code:'AUTHORIZATION_CHANGED'});};
 const fixture=fixtureTransport({
  ['GET /psd2/consent/v1/consents/'+CONSENT_ID+'/status']:()=>json({consentStatus:consentStatus?consentStatus({db}):'valid'}),
  ['GET /psd2/consent/v1/consents/'+CONSENT_ID]:()=>json({consentStatus:'valid',validUntil:expiry,recurringIndicator:true,frequencyPerDay:4,access:{}}),
  ['PUT /psd2/consent/v1/consents/'+CONSENT_ID+'/authorisations/'+AUTH_ID]:()=>json({scaStatus:'started',_links:{scaOAuth:{href:`https://oauth.sandbox.openbankingplatform.com/connect/authorize?client_id=[CLIENT_ID]&scope=accountinformation%20corporate&response_type=code&redirect_uri=[TPP_REDIRECT_URI]&state=[TPP_STATE]&acr_values=idp:OPBKSE21%20consentId:${CONSENT_ID}%20ConsentAuthorisationId:${AUTH_ID}`}}},200,{'aspsp-sca-approach':'REDIRECT'}),
  ['GET /psd2/accountinformation/v1/accounts/'+ACCOUNT_ID+'/transactions']:(url,init)=>transactions?transactions({db,url,init,fixture}):json({account:{iban:'SE4550000000058398257466'},transactions:{booked:[{...TX,bookingDate:date,remittanceInformationStructured:'0000599'}],_links:{}}}),
 });
 const config={...CONFIG,...(bankgiro?{features:['bank_discovery','consents','accounts','transactions','bankgiro_enrichment']}:{}),redirectUris:['https://app.example/api/companies/company-a/bank/callback']};
 const registration={companyId:'company-a',actorId:'actor-a',verified:true,corporateAccessVerified:true,redirectVerified:true,corporateId:'synthetic-company-a',psuId:'synthetic-psu-a',bicFi:'OPBKSE21',bankId:'OPBKSE21',bankName:'Synthetic Bank',authenticationMethodId:'mbid',psu:{ipAddress:'192.0.2.10',userAgent:'Synthetic fixture'},ratePolicy:{verified:true,evidenceId:'synthetic-rate-proof',maxRequests:100,windowMs:60000}};
 if(bankgiro){registration.bankgiroVerified=true;registration.bankgiroRegistration={id:'synthetic-opbg',scopeId:'synthetic-bg-scope',companyId:'company-a',owner:'owner-a',enabled:true,verified:true,origin:'provider_authorization',generation:'synthetic-bg-generation',evidenceId:'synthetic-report-agreement',accountId:ACCOUNT_ID,configurationRevision:1,profileId:'openpayments-bankgiro-v1',capabilities:['bankgiro_reports:read','accountinformation','bankgiroinformation','corporate'],iban:'SE4550000000058398257466',bankgiro:'12345678',validUntil:'2099-01-01T00:00:00Z'};}
 const environment={SAAS_BANK_ENABLED:'true',SAAS_OPENPAYMENTS_CONFIG:JSON.stringify(config),SAAS_OPENPAYMENTS_REGISTRATIONS:JSON.stringify([registration])};
 const providerOptions={transport:fixture.transport};
 const options={db,context,assertCurrent,environment,origin:'https://app.example',providerOptions};
 const bank=nodeSaasBankRuntime({...options,sessionHash:'synthetic-session',requestKey:'synthetic-create-123456'});
 await bank.start({bankId:'OPBKSE21',permissions:['accounts:read','transactions:read'],expectedRevision:0});let snapshot=await bank.snapshot();const state=new URL(await bank.redirect(snapshot.authorization.id)).searchParams.get('state');
 await bank.callback({state,code:'synthetic-code',scope:'accountinformation corporate'});snapshot=await bank.snapshot();const accountId=snapshot.accounts[0].id;
 await nodeSaasBankRuntime({...options,sessionHash:'synthetic-session',requestKey:'synthetic-select-123456'}).select({connectionId:snapshot.connection.id,accountIds:[accountId],expectedRevision:snapshot.revision});
 const runtime=await createNodeOpenPaymentsCompanySyncRuntime({...options,evidenceId:'synthetic-database-binding',automatic,...settings});fixture.calls.length=0;
 return{db,runtime,accountId,fixture,environment,options};
}
test('actual Node consent/provider modules commit OP originals and canonical rows with no allocations',async t=>{
 const f=await fixture(t);const before=await f.runtime.status(f.accountId);assert.equal(before.state,'never');assert.equal(f.fixture.calls.length,0);
 const result=await f.runtime.manual(f.accountId);assert.equal(result.status,'success',JSON.stringify(result));assert.equal(result.imported,1);
 const row=f.db.prepare('SELECT * FROM bank_transactions').get();assert.equal(row.source,'open_payments');assert.equal(row.account,'SE4550000000058398257466');assert.equal(row.reference,'0000599');assert.equal(row.raw_bank_data_sha256,digest(row.raw_bank_data));assert.ok(!Object.hasOwn(JSON.parse(row.raw_bank_data),'status'));
 const original=f.db.prepare('SELECT content,content_sha256 FROM import_jobs WHERE source=?').get('open_payments');assert.equal(original.content_sha256,digest(original.content));const retained=JSON.parse(Buffer.from(original.content).toString());assert.equal(retained.originals[0].bankDataSha256,digest(JSON.stringify(retained.originals[0].bankData)));
 assert.equal(f.db.prepare('SELECT count(*) n FROM allocations').get().n,0);assert.equal((await f.runtime.status(f.accountId)).state,'succeeded');
 const reserved=f.db.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n;assert.equal(reserved,f.fixture.calls.length,'every actual token/status/page HTTP request consumes a durable budget reservation');
 const repeat=await f.runtime.manual(f.accountId);assert.equal(repeat.status,'success');assert.equal(repeat.imported,0);assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);
});
test('revocation during actual transaction HTTP response fences every financial write',async t=>{
 const f=await fixture(t,{transactions:({db})=>{db.prepare('UPDATE synthetic_membership SET active=0').run();return json({transactions:{booked:[{...TX,bookingDate:date}],_links:{}}});}});
 assert.equal((await f.runtime.manual(f.accountId)).status,'blocked');assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_receipts').get().n,0);
});
test('receipt failure rolls back original and bank row in the same canonical transaction',async t=>{
 const f=await fixture(t);f.db.exec("CREATE TRIGGER fail_op_receipt BEFORE INSERT ON company_bank_sync_receipts BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END");
 assert.notEqual((await f.runtime.manual(f.accountId)).status,'success');for(const table of ['bank_transactions','import_jobs','company_bank_sync_receipts'])assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
});
test('actual provider429 persists cooldown and suppresses another HTTP request',async t=>{
 const f=await fixture(t,{transactions:()=>json({error:'synthetic'},429,{'retry-after':'120'})});
 const result=await f.runtime.manual(f.accountId);assert.equal(result.code,'PROVIDER_429',JSON.stringify(result));const calls=f.fixture.calls.length;await f.runtime.manual(f.accountId);assert.equal(f.fixture.calls.length,calls);assert.ok((await f.runtime.status(f.accountId)).nextAllowedAt);
});
test('automatic dispatch stays disabled without explicit verified operator registration',async t=>{
 const f=await fixture(t);assert.deepEqual(await f.runtime.scheduled(),{results:[],remaining:0,disabled:true});assert.equal(f.fixture.calls.length,0);
});
test('missing stable bank identity rejects entire page without silently omitting money',async t=>{
 const f=await fixture(t,{transactions:()=>json({transactions:{booked:[{...TX,bookingDate:date,entryReference:undefined}],_links:{}}})});assert.notEqual((await f.runtime.manual(f.accountId)).status,'success');assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,0);const receipt=f.db.prepare("SELECT content FROM import_jobs WHERE source='open_payments' AND status='blocked'").get();assert.ok(receipt);assert.ok(Buffer.from(receipt.content).toString().includes('rawResponse'));assert.equal((await f.runtime.status(f.accountId)).lastSuccessAt,null);
});
test('read-only viewer status uses real durable receipt and performs no provider request or write',async t=>{
 const f=await fixture(t);await f.runtime.manual(f.accountId);const calls=f.fixture.calls.length;
 const before=f.db.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n;
 const status=await readNodeOpenPaymentsCompanySyncStatus({db:f.db,context:{...f.options.context,role:'viewer'},assertCurrent:()=>{},accountId:f.accountId,environment:f.environment});
 assert.equal(status.state,'succeeded');assert.ok(status.lastSuccessAt);assert.equal(f.fixture.calls.length,calls);assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n,before);
});
test('wrong company selector and changed consent revision cannot dispatch bank reads',async t=>{
 const f=await fixture(t),status=await f.runtime.status(f.accountId);
 assert.equal((await f.runtime.run({companyId:'company-b',connectionId:status.connectionId,accountKey:status.accountKey})).status,'blocked');assert.equal(f.fixture.calls.length,0);
 const result=await f.runtime.manual(f.accountId,{expectedRevision:1});assert.equal(result.status,'blocked');assert.equal(f.fixture.calls.length,0);
});
test('concurrent duplicate dispatch holds the same account lease',async t=>{
 let release,arrived;const held=new Promise(resolve=>{release=resolve}),entered=new Promise(resolve=>{arrived=resolve});
 const f=await fixture(t,{transactions:async()=>{arrived();await held;return json({transactions:{booked:[{...TX,bookingDate:date}],_links:{}}});}});
 const first=f.runtime.manual(f.accountId);await entered;const second=await f.runtime.manual(f.accountId);assert.equal(second.code,'ACCOUNT_BUSY');release();assert.equal((await first).status,'success');assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);
});
test('configured automatic operator dispatch calls the same durable runner without creating timers',async t=>{
 const f=await fixture(t,{automatic:{enabled:true,operatorVerified:true,evidenceId:'synthetic-operator-proof'}});const result=await f.runtime.scheduled();assert.equal(result.results.length,1);assert.equal(result.results[0].status,'success');assert.equal((await f.runtime.status(f.accountId)).automaticEnabled,true);
});
test('conflicting stable identity retains rejected provider original without changing earlier money',async t=>{
 let amount='625.00';const f=await fixture(t,{transactions:()=>json({transactions:{booked:[{...TX,bookingDate:date,transactionAmount:{amount,currency:'SEK'}}],_links:{}}})});
 assert.equal((await f.runtime.manual(f.accountId)).status,'success');amount='999.00';assert.equal((await f.runtime.manual(f.accountId)).code,'IMPORT_IDENTITY_CONFLICT');assert.equal(f.db.prepare('SELECT amount_cents FROM bank_transactions').get().amount_cents,62500);const rejected=f.db.prepare("SELECT content,content_sha256 FROM import_jobs WHERE source='open_payments' AND status='blocked'").get();assert.ok(rejected);assert.equal(rejected.content_sha256,digest(rejected.content));assert.equal(f.db.prepare('SELECT count(*) n FROM allocations').get().n,0);
});

test('remote provider revocation after the transaction page blocks financial commit',async t=>{
 let revoked=false;const f=await fixture(t,{consentStatus:()=>revoked?'revokedByPsu':'valid',transactions:()=>{revoked=true;return json({transactions:{booked:[{...TX,bookingDate:date}],_links:{}}});}});assert.notEqual((await f.runtime.manual(f.accountId)).status,'success');assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM company_bank_sync_receipts').get().n,0);
});

const bankgiroPage=()=>json({account:{iban:'SE4550000000058398257466'},transactions:{booked:[{...TX,bookingDate:date}],bankgiro:[{transactionId:'synthetic-child',entryReference:'synthetic-child-ref',aggregateTransactionId:TX.transactionId,aggregateAmount:'625.00',aggregateId:12,isAliasPayin:true,isEnriched:true,transactionAmount:{amount:'625.00',currency:'SEK'},bookingDate:date,debtorName:'Synthetic Payer AB',remittanceInformationStructured:'0599'}],_links:{}}});
test('actual bound Node OP sync retains native Bankgiro review original without duplicate financial rows',async t=>{const f=await fixture(t,{bankgiro:true,bindCompany:true,transactions:bankgiroPage});const first=await f.runtime.manual(f.accountId);assert.equal(first.status,'partial',JSON.stringify(first));const document=f.db.prepare("SELECT * FROM documents WHERE source='bankgiro_source'").get();assert.ok(document,'actual retained Bankgiro original');assert.equal(document.fingerprint,digest(document.content));const job=f.db.prepare("SELECT * FROM import_jobs WHERE mime_type='application/vnd.mgeorge.openpayments-bankgiro+json'").get();assert.equal(job.status,'needs_review');assert.equal(job.owner,'owner-a');assert.equal(job.content_sha256,digest(job.content));assert.equal(f.db.prepare("SELECT count(*) n FROM bankgiro_ingest_jobs WHERE status='REVIEW'").get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM allocations').get().n,0);assert.equal(first.coverage.bankgiro,'partial');const repeat=await f.runtime.manual(f.accountId);assert.equal(repeat.status,'partial',JSON.stringify(repeat));assert.equal(repeat.imported,0);assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM allocations').get().n,0);});
test('Node OP enrichment refuses an unbound company database even with synthetic matching context',async t=>{const f=await fixture(t,{bankgiro:true,transactions:bankgiroPage});const result=await f.runtime.manual(f.accountId);assert.equal(result.status,'blocked');assert.equal(result.code,'COMPANY_SCOPE_MISMATCH');assert.equal(f.db.prepare("SELECT count(*) n FROM documents WHERE source='bankgiro_source'").get().n,0);});
test('revocation after AIS commit prevents retained Bankgiro original and leaves existing money exact',async t=>{const f=await fixture(t,{bankgiro:true,bindCompany:true,transactions:bankgiroPage,consentStatus:({db})=>{if(db.prepare('SELECT count(*) n FROM bank_transactions').get().n)db.prepare('UPDATE synthetic_membership SET active=0').run();return'valid';}});const result=await f.runtime.manual(f.accountId);assert.equal(result.status,'blocked',JSON.stringify(result));assert.equal(f.db.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);assert.equal(f.db.prepare('SELECT amount_cents FROM bank_transactions').get().amount_cents,62500);assert.equal(f.db.prepare("SELECT count(*) n FROM documents WHERE source='bankgiro_source'").get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM allocations').get().n,0);});

for(const change of ['revision','connection'])test('Node status keeps historical success without current coverage after consent '+change+' changes',async t=>{
 const f=await fixture(t);assert.equal((await f.runtime.manual(f.accountId)).status,'success');
 const read=()=>readNodeOpenPaymentsCompanySyncStatus({db:f.db,context:{...f.options.context,role:'viewer'},assertCurrent:()=>{},accountId:f.accountId,environment:f.environment});
 const previous=await read(),calls=f.fixture.calls.length;
 if(change==='revision')f.db.prepare('UPDATE saas_bank_state SET revision=revision+1 WHERE owner=?').run(f.options.context.storageOwner);
 else{const row=f.db.prepare('SELECT payload FROM saas_bank_state WHERE owner=?').get(f.options.context.storageOwner),value=decryptObject(row.payload);value.value.id='replacement-consent-connection';f.db.prepare('UPDATE saas_bank_state SET payload=? WHERE owner=?').run(encryptObject(value),f.options.context.storageOwner);}
 for(const current of [await read(),await f.runtime.status(f.accountId)]){assert.equal(current.state,'never');assert.equal(current.lastSuccessAt,previous.lastSuccessAt);assert.equal(current.errorCode,null);assert.deepEqual(current.coverage,{ais:'unknown',bankgiro:'unknown',paymentDataComplete:false});}
 assert.equal(f.fixture.calls.length,calls);
});

for(const [change,code] of [['disabled','configuration_required'],['generation','configuration_changed'],['unavailable-production','configuration_required'],['expired','consent_expired']])test('Node status blocks stale success after '+change,async t=>{
 const f=await fixture(t);assert.equal((await f.runtime.manual(f.accountId)).status,'success');
 const read=()=>readNodeOpenPaymentsCompanySyncStatus({db:f.db,context:{...f.options.context,role:'viewer'},assertCurrent:()=>{},accountId:f.accountId,environment:f.environment,automaticEnabled:true});
 const previous=await read(),calls=f.fixture.calls.length;
 if(change==='disabled')f.environment.SAAS_BANK_ENABLED='false';
 else if(change==='expired'){const row=f.db.prepare('SELECT payload FROM saas_bank_state WHERE owner=?').get(f.options.context.storageOwner),value=decryptObject(row.payload);value.value.validUntil='2020-01-01T00:00:00Z';f.db.prepare('UPDATE saas_bank_state SET payload=? WHERE owner=?').run(encryptObject(value),f.options.context.storageOwner);}
 else{const config=JSON.parse(f.environment.SAAS_OPENPAYMENTS_CONFIG);if(change==='generation')config.credentialGeneration='rotated-generation';else config.environment='PRODUCTION';f.environment.SAAS_OPENPAYMENTS_CONFIG=JSON.stringify(config);}
 const current=await read();assert.equal(current.state,'blocked');assert.equal(current.errorCode,code);assert.equal(current.automaticEnabled,false);assert.equal(current.lastSuccessAt,previous.lastSuccessAt);assert.deepEqual(current.coverage,{ais:'unknown',bankgiro:'unknown',paymentDataComplete:false});assert.equal(f.fixture.calls.length,calls);
});
