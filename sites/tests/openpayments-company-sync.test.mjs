import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {companyFixture} from './helpers/company-storage-fixture.mjs';
import {assertScopeCurrent} from '../lib/company-storage.js';
import {createSaasBankRuntime} from '../lib/banking/saas-bank-runtime.js';
import {seal,unseal,randomToken} from '../lib/banking/security.ts';
import {fixtureTransport,CONFIG,CONSENT_ID,AUTH_ID,ACCOUNT_ID,TX,json} from './helpers/openpayments-fixture.mjs';
import {applyCommand,paymentOriginalIssue} from '../lib/domain.ts';
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const local=path=>new URL('../lib/'+path,import.meta.url).href;
function compiled(path,imports){let code=stripTypeScriptTypes(readFileSync(new URL('../lib/'+path,import.meta.url),'utf8'),{mode:'transform'});for(const[from,to]of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+from+quote,JSON.stringify(to));return data(code);}
const module=await import(compiled('banking/openpayments-company-sync.ts',{'../server':data('export const db=()=>{},identity=async()=>{},currentCompanyContext=()=>{},withCompanyOwner=async()=>{},readWorkspace=async()=>{};'),'../domain':local('domain.ts'),'../reconciliation-evidence':data('export const reconciliationPreviewWithOriginals=async()=>[];'),'../company-bank-sync-store.js':local('company-bank-sync-store.js'),'../company-bank-sync.js':local('company-bank-sync.js'),'../company-bank-account-key.js':local('company-bank-account-key.js'),'../company-reconciliation-policy.js':local('company-reconciliation-policy.js'),'./saas-runtime':data('export const saasBankSnapshot=async()=>{},saasBankSyncContext=async()=>{},saasBankSyncConfiguration=async()=>{};'),'./openpayments-company-enrichment':data('export const enrichOpenPaymentsCompany=async()=>({state:"unavailable"});'),'./openpayments-normalization.js':local('banking/openpayments-normalization.js')}));
const date=new Date().toISOString().slice(0,10),expiry=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
async function setup(t,{transactions,consentStatus,enabled=true,bankgiro=false}={}){
 const f=companyFixture(t);await f.create('company-a');const scope=await f.scope(),context=scope.context,db=f.database(scope),key=randomToken();
 const guard=()=>assertScopeCurrent(f.raw,scope,'manage_integrations');
 const transport=fixtureTransport({
 ['GET /psd2/consent/v1/consents/'+CONSENT_ID+'/status']:()=>json({consentStatus:consentStatus?consentStatus():'valid'}),
 ['GET /psd2/consent/v1/consents/'+CONSENT_ID]:()=>json({consentStatus:'valid',validUntil:expiry,recurringIndicator:true,frequencyPerDay:4,access:{}}),
 ['PUT /psd2/consent/v1/consents/'+CONSENT_ID+'/authorisations/'+AUTH_ID]:()=>json({scaStatus:'started',_links:{scaOAuth:{href:`https://oauth.sandbox.openbankingplatform.com/connect/authorize?client_id=[CLIENT_ID]&scope=accountinformation%20corporate&response_type=code&redirect_uri=[TPP_REDIRECT_URI]&state=[TPP_STATE]&acr_values=idp:OPBKSE21%20consentId:${CONSENT_ID}%20ConsentAuthorisationId:${AUTH_ID}`}}},200,{'aspsp-sca-approach':'REDIRECT'}),
 ['GET /psd2/accountinformation/v1/accounts/'+ACCOUNT_ID+'/transactions']:(url,init)=>transactions?transactions({f,url,init}):json({account:{iban:'SE4550000000058398257466'},transactions:{booked:[{...TX,bookingDate:date,remittanceInformationStructured:'0000599'}],_links:{}}}),
 });
 const owner=context.storageOwner,codec={seal:(o,p,v)=>seal(key,o,p,v),unseal:(o,p,v)=>unseal(key,o,p,v)};
 const store={async read(){const row=await db.prepare('SELECT revision,payload FROM saas_bank_state WHERE owner=?').bind(owner).first();return row?{revision:row.revision,value:await unseal(key,owner,'saas-bank-state',row.payload)}:{revision:0,value:null};},async compareAndSet(expected,value){const payload=await seal(key,owner,'saas-bank-state',value);const r=expected===0?await db.prepare('INSERT INTO saas_bank_state(owner,revision,payload) VALUES(?,1,?)').bind(owner,payload).run():await db.prepare('UPDATE saas_bank_state SET revision=revision+1,payload=? WHERE owner=? AND revision=?').bind(payload,owner,expected).run();return r.meta.changes===1;}};
 const registration={bankgiroVerified:bankgiro,companyId:context.companyId,actorId:context.actorId,verified:true,corporateAccessVerified:true,redirectVerified:true,corporateId:'synthetic-company-a',psuId:'synthetic-psu-a',bicFi:'OPBKSE21',bankId:'OPBKSE21',bankName:'Synthetic Bank',authenticationMethodId:'mbid',ratePolicy:{verified:true,evidenceId:'synthetic-policy',maxRequests:100,windowMs:60000},psu:{ipAddress:'192.0.2.10',userAgent:'Synthetic fixture'}};
 const config={...CONFIG,features:bankgiro?['bank_discovery','consents','accounts','transactions','bankgiro_enrichment']:undefined,redirectUris:['https://app.example/api/companies/company-a/bank/callback']};
 const runtime=(options={},requestKey='synthetic-key-0123456789')=>createSaasBankRuntime({context,config,registration,enabled:true,codec,store,assertCurrent:guard,sessionHash:'synthetic-session',redirectUri:config.redirectUris[0],providerOptions:{...options,transport:transport.transport},requestKey});
 const bank=runtime();await bank.start({bankId:'OPBKSE21',permissions:['accounts:read','transactions:read',...(bankgiro?['bankgiro:read']:[])],expectedRevision:0});let snapshot=await bank.snapshot();const state=new URL(await bank.redirect(snapshot.authorization.id)).searchParams.get('state');await bank.callback({state,code:'synthetic-code',scope:'accountinformation corporate'});snapshot=await bank.snapshot();const accountId=snapshot.accounts[0].id;await runtime({},'synthetic-select-key-123456').select({connectionId:snapshot.connection.id,accountIds:[accountId],expectedRevision:snapshot.revision});
 let previews=0;
 const deps={database:db,context,assertCurrent:guard,configuration:async()=>({enabled,credentialGeneration:config.credentialGeneration,companyId:context.companyId,owner,bankId:'OPBKSE21',evidenceId:'synthetic-binding',dateFrom:date,automaticEnabled:false,configurationHash:'fixed-config',bankgiroRegistration:null,stored:(await store.read()).value}),snapshot:()=>runtime().snapshot(),resolve:(id,options)=>runtime(options).syncContext(id),readWorkspace:async()=>{const row=await db.prepare('SELECT revision,payload FROM workspaces WHERE owner=?').bind(owner).first();return{revision:row.revision,state:JSON.parse(row.payload)};},preview:async(o,s)=>{assert.equal(o,owner);for(const row of s.transactions)assert.equal(paymentOriginalIssue(s,row),'');previews++;return[];}};
 const adapter=module.createSitesOpenPaymentsCompanySync(deps);transport.calls.length=0;return{f,db,context,owner,adapter,accountId,transport,deps,key,config,registration,previews:()=>previews};
}
test('real Sites company DB + provider + lease commit raw receipts and preview-only canonical workspace',async t=>{
 const f=await setup(t);assert.equal((await f.adapter.status(f.accountId)).state,'never');assert.equal(f.transport.calls.length,0);
 const result=await f.adapter.run(f.accountId);assert.equal(result.status,'success',JSON.stringify(result));assert.equal(result.imported,1);
 const workspace=await f.deps.readWorkspace();assert.equal(workspace.state.transactions[0].payerReference,'0000599');assert.equal(workspace.state.transactions[0].verified,false);assert.equal(workspace.state.allocations.length,0);assert.equal(f.previews(),1);
 const receipt=f.f.sql.prepare("SELECT detail FROM audit_events WHERE action='openpayments.original'").get();const envelope=JSON.parse(receipt.detail);assert.ok(envelope.originals[0].rawResponse.body.includes('0000599'));assert.equal(f.f.sql.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n,f.transport.calls.length);
 const second=await f.adapter.run(f.accountId);assert.equal(second.imported,0);assert.equal((await f.deps.readWorkspace()).state.transactions.length,1);assert.equal((await f.adapter.status(f.accountId)).state,'succeeded');
});
test('Sites receipt failure rolls back workspace and raw audit original together',async t=>{
 const f=await setup(t),before=await f.deps.readWorkspace();f.f.sql.exec("CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON company_bank_sync_receipts BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END");
 assert.notEqual((await f.adapter.run(f.accountId)).status,'success');assert.deepEqual(await f.deps.readWorkspace(),before);assert.equal(f.f.sql.prepare("SELECT count(*) n FROM audit_events WHERE action='openpayments.original'").get().n,0);
});
test('Sites actual provider429 is budgeted and persisted without exposing private provider error',async t=>{
 const f=await setup(t,{transactions:()=>json({error:'synthetic-secret'},429,{'retry-after':'120'})});const result=await f.adapter.run(f.accountId);assert.equal(result.code,'PROVIDER_429');assert.ok(!JSON.stringify(result).includes('synthetic-secret'));const calls=f.transport.calls.length;await f.adapter.run(f.accountId);assert.equal(f.transport.calls.length,calls);assert.ok((await f.adapter.status(f.accountId)).nextAllowedAt);
});
test('Sites stale expected revision cannot read provider and default scheduler is disabled',async t=>{
 const f=await setup(t);assert.equal((await f.adapter.run(f.accountId,{expectedRevision:1})).status,'blocked');assert.equal(f.transport.calls.length,0);assert.deepEqual(await f.adapter.scheduled(),{disabled:true,results:[]});
});
test('Sites membership version change during provider response prevents all canonical writes',async t=>{
 const f=await setup(t,{transactions:({f})=>{f.sql.prepare("UPDATE company_memberships SET membership_version=membership_version+1 WHERE company_id='company-a'").run();return json({transactions:{booked:[{...TX,bookingDate:date}],_links:{}}});}});
 assert.notEqual((await f.adapter.run(f.accountId)).status,'success');const row=f.f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(f.owner);assert.equal(JSON.parse(row.payload).transactions.length,0);assert.equal(f.f.sql.prepare('SELECT count(*) n FROM company_bank_sync_receipts').get().n,0);
});
test('Sites metadata and workspace transaction also reject membership change at the batch boundary',async t=>{
 const f=await setup(t);f.f.beforeBatch=statements=>{if(statements.some(s=>s.query.includes('INSERT INTO audit_events')&&s.args.includes('openpayments.original'))){f.f.beforeBatch=null;f.f.sql.prepare("UPDATE company_memberships SET membership_version=membership_version+1 WHERE company_id='company-a'").run();}};
 assert.notEqual((await f.adapter.run(f.accountId)).status,'success');assert.equal(JSON.parse(f.f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(f.owner).payload).transactions.length,0);assert.equal(f.f.sql.prepare('SELECT count(*) n FROM company_bank_sync_receipts').get().n,0);
});
test('Sites rejected conflicting original stays retained without changing the prior monetary row',async t=>{
 let amount='625.00';const f=await setup(t,{transactions:()=>json({transactions:{booked:[{...TX,bookingDate:date,transactionAmount:{amount,currency:'SEK'}}],_links:{}}})});assert.equal((await f.adapter.run(f.accountId)).status,'success');amount='999.00';assert.equal((await f.adapter.run(f.accountId)).code,'IMPORT_IDENTITY_CONFLICT');const workspace=await f.deps.readWorkspace();assert.equal(workspace.state.transactions.length,1);assert.equal(workspace.state.transactions[0].amount,62500);assert.equal(workspace.state.allocations.length,0);assert.equal(f.f.sql.prepare("SELECT count(*) n FROM audit_events WHERE action='openpayments.sync_rejected'").get().n,1);
});
test('Sites viewer reads existing receipts without own PSU enrollment or job writes',async t=>{
 const f=await setup(t);await f.adapter.run(f.accountId);const before=f.transport.calls.length;
 const {changeCompanyMembership,selectCompany,resolveCompanyScope}=await import('../lib/company-storage.js');await changeCompanyMembership(f.f.raw,await f.f.scope(),{actorId:'actor-viewer',role:'viewer',status:'active'});await selectCompany(f.f.raw,'actor-viewer','company-a',1);const viewer=await resolveCompanyScope(f.f.raw,'actor-viewer',{companyId:'company-a',contextVersion:2,action:'read'});
 const configuration=async()=>({...await f.deps.configuration(),enabled:false,serviceEnabled:true});
 const readOnly=module.createSitesOpenPaymentsCompanySync({...f.deps,database:f.f.database(viewer),context:viewer.context,assertCurrent:()=>assertScopeCurrent(f.f.raw,viewer,'read'),configuration});
 assert.equal((await readOnly.status(f.accountId)).state,'succeeded');assert.equal(f.transport.calls.length,before);await assert.rejects(readOnly.run(f.accountId));assert.equal(f.transport.calls.length,before);
});

test('Sites fresh remote consent check after pages rejects provider revocation before receipt',async t=>{
 let revoked=false;const f=await setup(t,{consentStatus:()=>revoked?'revokedByPsu':'valid',transactions:()=>{revoked=true;return json({transactions:{booked:[{...TX,bookingDate:date}],_links:{}}});}});assert.notEqual((await f.adapter.run(f.accountId)).status,'success');assert.equal((await f.deps.readWorkspace()).state.transactions.length,0);assert.equal(f.f.sql.prepare('SELECT count(*) n FROM company_bank_sync_receipts').get().n,0);
});

test('Sites malformed bank row retains complete original without financial writes or success',async t=>{
 const f=await setup(t,{transactions:()=>json({transactions:{booked:[{...TX,bookingDate:date,entryReference:undefined}],_links:{}}})});assert.notEqual((await f.adapter.run(f.accountId)).status,'success');assert.equal((await f.deps.readWorkspace()).state.transactions.length,0);const original=f.f.sql.prepare("SELECT detail FROM audit_events WHERE action='openpayments.invalid_original'").get();assert.ok(JSON.parse(original.detail).originals[0].rawResponse.body);assert.equal((await f.adapter.status(f.accountId)).lastSuccessAt,null);
});

async function realEnrichmentModules(t,f){
 const globalKey='__op_full_'+crypto.randomUUID().replaceAll('-',''),objects=new Map();
 const bucket={async put(id,bytes){objects.set(id,Uint8Array.from(new Uint8Array(bytes)));},async get(id){const bytes=objects.get(id);return bytes?{size:bytes.length,body:bytes,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;},async delete(id){objects.delete(id);}};
 const env={DB:f.f.raw,BUCKET:bucket,SAAS_BANK_ENABLED:'true',SAAS_OPENPAYMENTS_CONFIG:JSON.stringify(f.config),SAAS_OPENPAYMENTS_REGISTRATIONS:JSON.stringify([f.registration]),BANK_DATA_ENCRYPTION_KEY:f.key};
 globalThis[globalKey]={env,user:{userId:f.context.actorId,displayName:'Synthetic actor'}};t.after(()=>delete globalThis[globalKey]);const ref=`globalThis[${JSON.stringify(globalKey)}]`,envUrl=data(`export const env=${ref}.env;`),domain=local('domain.ts');
 const server=compiled('server.ts',{'cloudflare:workers':envUrl,'@/app/chatgpt-auth':data(`export const getChatGPTUser=async()=>${ref}.user;`),'./domain':domain,'./company-storage.js':local('company-storage.js')});
 const resolver=compiled('banking/openpayments-account-state.ts',{'cloudflare:workers':envUrl,'../server':server,'./security':local('banking/security.ts'),'./bank-data-provider.js':local('banking/bank-data-provider.js'),'./openpayments/config.js':local('banking/openpayments/config.js'),'./openpayments-normalization.js':local('banking/openpayments-normalization.js')});
 const store=data('export const connection=async()=>null,accounts=async()=>[],application=async()=>null;');
 const transactions=compiled('banking/transactions.ts',{'../domain':domain,'../payment-references.js':local('payment-references.js'),'../payer-evidence.js':local('payer-evidence.js')});
 const bankgiro=compiled('bankgiro-service.ts',{'./server':server,'./domain':domain,'./bankgiro-parser.js':local('bankgiro-parser.js'),'./banking/store':store,'./banking/transactions':transactions,'./banking/openpayments-account-state':resolver});
 const reconciliation=compiled('reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':local('reconciliation-engine.js')});
 const evidence=compiled('reconciliation-evidence.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-engine.js':local('reconciliation-engine.js'),'./bankgiro-service':bankgiro});
 const service=compiled('bankgiro-ingest-service.ts',{'cloudflare:workers':envUrl,'./server':server,'./domain':domain,'./bankgiro-service':bankgiro,'./bankgiro-parser.js':local('bankgiro-parser.js'),'./reconciliation-evidence':evidence,'./bankgiro-ingest.js':local('bankgiro-ingest.js'),'./bankgiro-ingest-store.js':local('bankgiro-ingest-store.js'),'./bankgiro-source.js':local('bankgiro-source.js'),'./bankgiro-source-registry.js':data('export const resolveBankgiroSource=async()=>null;')});
 const enricher=compiled('banking/openpayments-company-enrichment.ts',{'../server':server,'../bankgiro-ingest.js':local('bankgiro-ingest.js'),'../bankgiro-ingest-store.js':local('bankgiro-ingest-store.js'),'../bankgiro-ingest-service':service,'../bankgiro-openpayments-capture.js':local('bankgiro-openpayments-capture.js')});
 return{server:await import(server),enricher:await import(enricher),evidence:await import(evidence),objects};
}

test('OP-only Sites sync joins actual provider pages, trusted grant, retained sink and preview without EB authority',async t=>{
 const {openPaymentsPage,openPaymentsBooked,openPaymentsChild,OPENPAYMENTS_IBAN}=await import('./helpers/openpayments-bankgiro-fixture.mjs');
 const f=await setup(t,{bankgiro:true,transactions:()=>json(openPaymentsPage({booked:[openPaymentsBooked({bookingDate:date,remittanceInformationUnstructured:'Bankgiro inbetalning'})],children:[openPaymentsChild({bookingDate:date})]}))});
 const modules=await realEnrichmentModules(t,f),registration={verified:true,enabled:true,origin:'provider_authorization',companyId:f.context.companyId,owner:f.owner,id:'synthetic-source',scopeId:'synthetic-scope',generation:'synthetic-grant-v1',evidenceId:'synthetic-proof',accountId:ACCOUNT_ID,iban:OPENPAYMENTS_IBAN,bankgiro:'1234567',profileId:'openpayments-bankgiro-v1',configurationRevision:1,validUntil:new Date(Date.now()+86400000).toISOString(),capabilities:['bankgiro_reports:read','accountinformation','bankgiroinformation','corporate']};
 const configuration=async()=>({...await f.deps.configuration(),bankgiroRegistration:registration});
 const handler=modules.server.withCompanyRequest(async req=>{await modules.server.identity(req);const adapter=module.createSitesOpenPaymentsCompanySync({...f.deps,database:modules.server.db(),readWorkspace:modules.server.readWorkspace,preview:modules.evidence.reconciliationPreviewWithOriginals,enrich:modules.enricher.enrichOpenPaymentsCompany,configuration});return modules.server.response(await adapter.run(f.accountId));});
 const response=await handler(new Request('https://app.example/api/companies/company-a/bank/sync',{method:'POST',headers:{Origin:'https://app.example','Content-Type':'application/json','X-Company-Id':f.context.companyId,'X-Company-Context-Version':String(f.context.contextVersion)},body:'{}'}));
 const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.status,'success',JSON.stringify(result));assert.equal(result.coverage.bankgiro,'verified',JSON.stringify(result));
 const state=(await f.deps.readWorkspace()).state;assert.equal(state.transactions.length,2);assert.equal(state.allocations.length,0);assert.equal(f.f.sql.prepare('SELECT count(*) n FROM bank_connections').get().n,0);assert.equal(modules.objects.size,1);assert.equal(f.f.sql.prepare('SELECT count(*) n FROM documents').get().n,1);assert.equal(f.f.sql.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n,f.transport.calls.length);
});

test('prior consent receipt stays historical but cannot certify current authority coverage',async t=>{
 const f=await setup(t);await f.adapter.run(f.accountId);const previous=await f.adapter.status(f.accountId);await f.db.prepare('UPDATE saas_bank_state SET revision=revision+1 WHERE owner=?').bind(f.owner).run();const current=await f.adapter.status(f.accountId);assert.equal(current.state,'never');assert.equal(current.lastSuccessAt,previous.lastSuccessAt);assert.equal(current.coverage.bankgiro,'unknown');assert.equal(current.coverage.paymentDataComplete,false);
});

test('read-only status cannot present success after provider credential generation rotates',async t=>{
 const f=await setup(t);await f.adapter.run(f.accountId);const rotated=module.createSitesOpenPaymentsCompanySync({...f.deps,configuration:async()=>({...await f.deps.configuration(),credentialGeneration:'rotated-generation'})});const current=await rotated.status(f.accountId);assert.equal(current.state,'blocked');assert.equal(current.errorCode,'configuration_changed');assert.ok(current.lastSuccessAt);assert.equal(current.coverage.bankgiro,'unknown');
});
