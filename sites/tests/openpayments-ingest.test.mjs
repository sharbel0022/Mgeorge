import {sitesTokenCoordinatorUrl} from './helpers/openpayments-coordinator-loader.mjs';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {seal,unseal,randomToken} from '../lib/banking/security.ts';
import {OpenPaymentsProvider} from '../lib/banking/openpayments-provider.js';
import {CONFIG,CONTEXT,ACCOUNT,fixtureTransport,json} from './helpers/openpayments-fixture.mjs';
import assert from 'node:assert/strict';
import {createOpenPaymentsBankgiroCapture,readOpenPaymentsBankgiroCapture} from '../lib/bankgiro-openpayments-capture.js';
import {provisionCompany,resolveCompanyScope,assertScopeCurrent} from '../lib/company-storage.js';
import {applyCommand,economicTransactions,specificationPreview} from '../lib/domain.ts';
import {ingestFixture,seedState,account,hash} from './helpers/bankgiro-ingest-fixture.mjs';
const companyId='synthetic-company-a';
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const local=path=>new URL('../lib/'+path,import.meta.url).href;
function compiled(path,imports){let code=stripTypeScriptTypes(readFileSync(new URL('../lib/'+path,import.meta.url),'utf8'),{mode:'transform'});imports={'./openpayments-sites-token-coordinator':sitesTokenCoordinatorUrl,'./openpayments-workers-transport.js':local('banking/openpayments-workers-transport.js'),...imports};for(const[from,to]of Object.entries(imports))for(const q of ['"',"'"])code=code.replaceAll(q+from+q,JSON.stringify(to));return data(code);}
async function withActualOpenPaymentsAuthority(t,f,company){
 const key=randomToken(),registration={companyId:company,actorId:f.owner,verified:true,corporateAccessVerified:true,redirectVerified:true,bankId:'OPBKSE21',corporateId:CONTEXT.corporateId,psuId:CONTEXT.psuId,bicFi:CONTEXT.bicFi};
 Object.assign(f.env,{SAAS_BANK_ENABLED:'true',SAAS_OPENPAYMENTS_CONFIG:JSON.stringify(CONFIG),SAAS_OPENPAYMENTS_REGISTRATIONS:JSON.stringify([registration]),BANK_DATA_ENCRYPTION_KEY:key});
 const scope=await resolveCompanyScope(f.database,f.owner,{companyId:company,contextVersion:1,action:'write'});
 const codec={seal:(o,p,v)=>seal(key,o,p,v),unseal:(o,p,v)=>unseal(key,o,p,v)},binding={...CONTEXT.binding,companyId:company,owner:f.owner};
 const transport=fixtureTransport({'GET /psd2/accountinformation/v1/accounts':()=>json({accounts:[{...ACCOUNT,iban:account}]})}),provider=new OpenPaymentsProvider(CONFIG,{transport:transport.transport}),client=provider.forCompany({...CONTEXT,binding},{...transport.dependencies,codec,assertCurrent:async current=>{assert.deepEqual(current,binding);await assertScopeCurrent(f.database,scope,'manage_integrations');}});
 const consent=await client.createConsent({validUntil:new Date(Date.now()+30*86400000).toISOString().slice(0,10)}),list=await client.listAccounts(consent.handle),payload=await seal(key,f.owner,'saas-bank-state',{id:binding.connectionId,bankId:'OPBKSE21',generation:CONFIG.credentialGeneration,status:'active',permissions:['accounts:read','transactions:read'],validUntil:list.validUntil,consentHandle:consent.handle,accounts:list.accounts.map((a,i)=>({...a,id:'selected-op-'+i})),selected:['selected-op-0']});
 const globalKey='__op_ingest_'+crypto.randomUUID().replaceAll('-','');globalThis[globalKey]=f;t.after(()=>delete globalThis[globalKey]);const envUrl=data(`export const env=globalThis[${JSON.stringify(globalKey)}].env;`),server=f.moduleUrls.server,domain=local('domain.ts');
 const resolver=compiled('banking/openpayments-account-state.ts',{'cloudflare:workers':envUrl,'../server':server,'./security':local('banking/security.ts'),'./bank-data-provider.js':local('banking/bank-data-provider.js'),'./openpayments/config.js':local('banking/openpayments/config.js'),'./openpayments-normalization.js':local('banking/openpayments-normalization.js')});
 const transactions=compiled('banking/transactions.ts',{'../domain':domain,'../payment-references.js':local('payment-references.js'),'../payer-evidence.js':local('payer-evidence.js')}),bankgiro=compiled('bankgiro-service.ts',{'./server':server,'./domain':domain,'./bankgiro-parser.js':local('bankgiro-parser.js'),'./banking/store':f.moduleUrls.store,'./banking/transactions':transactions,'./banking/openpayments-account-state':resolver});
 const evidence=compiled('reconciliation-evidence.ts',{'./server':server,'./domain':domain,'./reconciliation':f.moduleUrls.reconciliation,'./reconciliation-engine.js':local('reconciliation-engine.js'),'./bankgiro-service':bankgiro});
 const service=compiled('bankgiro-ingest-service.ts',{'cloudflare:workers':envUrl,'./server':server,'./domain':domain,'./bankgiro-service':bankgiro,'./bankgiro-parser.js':local('bankgiro-parser.js'),'./reconciliation-evidence':evidence,'./bankgiro-ingest.js':local('bankgiro-ingest.js'),'./bankgiro-ingest-store.js':local('bankgiro-ingest-store.js'),'./bankgiro-source.js':local('bankgiro-source.js'),'./bankgiro-source-registry.js':data('export const resolveBankgiroSource=async()=>null;')});
 f.sink=(await import(service)).createSitesBankgiroSink();return payload;
}

function capture({company=companyId,owner='synthetic-owner',reference='0599',payer='Synthetic customer AB',captureId='capture-1',amount='625.00',parentReference='SYNTHETIC-DEPOSIT',bankgiro=true,payments}={}){
 const child={transactionId:'CHILD-1',entryReference:'CHILD-BANK-REF',transactionAmount:{amount,currency:'SEK'},bookingDate:'2026-10-26',debtorName:payer,remittanceInformationStructured:reference,aggregateTransactionId:'PARENT-1',aggregateAmount:'625.00',aggregateId:1,isAliasPayin:true,isEnriched:true,creditorAccount:{iban:account,bankgiroNumber:'123-4567'},additionalInformation:'Bank-reported detail'};
 const children=payments?payments.map(row=>({...child,transactionId:row.id,entryReference:row.id+'-BANK',transactionAmount:{amount:row.amount,currency:'SEK'},debtorName:row.payer,remittanceInformationStructured:row.reference})):[child];
 const body={account:{iban:account},transactions:{booked:[{transactionId:'PARENT-1',entryReference:parentReference,transactionAmount:{amount:'625.00',currency:'SEK'},bookingDate:'2026-10-26'}],...(bankgiro?{bankgiro:children}:{}),_links:{}}};
 return createOpenPaymentsBankgiroCapture({context:{owner,companyId:company,sourceId:'synthetic-source',scopeId:'synthetic-contract',accountId:'account-a',iban:account,bankgiro:'1234567'},captureId,pages:[{body:JSON.stringify(body,null,2)+'\n',requestPath:'/psd2/accountinformation/v1/accounts/account-a/transactions?bookingStatus=booked',requestId:'synthetic-request-'+captureId,receivedAt:'2026-11-04T18:00:00Z'}]});
}
async function fixture(t,{company=companyId,...options}={}){
 const state=seedState(options);if(company)state.company.id=company;
 const f=await ingestFixture(t,{state});
 if(company){
  await provisionCompany(f.database,{id:company,name:'Synthetic tenant',actorId:f.owner,legacyOwner:f.owner,verifiedLegacyOwner:f.owner,verifiedBy:'synthetic-operator',verificationEvidence:'Synthetic explicit adoption'});
  const payload=await withActualOpenPaymentsAuthority(t,f,company);
  const server=await import(f.moduleUrls.server),sink=f.sink;
  f.bound=async operation=>{
   let result,failure;
   const handler=server.withCompanyRequest(async()=>{try{result=await operation();return server.response({ok:true});}catch(error){failure=error;throw error;}});
   const response=await handler(new Request('https://synthetic.test/api/bankgiro/source/run',{method:'POST',headers:{Origin:'https://synthetic.test','X-Company-Id':company,'X-Company-Context-Version':'1'}}));
   if(failure)throw failure;if(!response.ok)throw Object.assign(Error('company scope rejected'),{code:(await response.json()).code});return result;
  };
  await f.bound(()=>f.scopedDatabase.prepare('INSERT INTO saas_bank_state(owner,revision,payload) VALUES(?,1,?)').bind(f.owner,payload).run());
  f.sink={retain:input=>f.bound(()=>sink.retain(input)),importReport:input=>f.bound(()=>sink.importReport(input))};
  const prepare=f.prepare;
  f.prepare=(...args)=>f.bound(()=>prepare(...args));
  f.write=state=>f.bound(()=>f.scopedDatabase.prepare('UPDATE workspaces SET payload=?,revision=revision+1 WHERE owner=?').bind(JSON.stringify(state),f.owner).run());
 }
 f.authorization={...f.authorization,companyId,bankgiro:'1234567',accountId:'account-a',iban:account,profileId:'openpayments-bankgiro-v1',origin:'provider_authorization',checkedAt:new Date().toISOString(),capabilities:['bankgiro_reports:read','accountinformation','bankgiroinformation','corporate']};
 f.capture=async input=>{const c=capture(input);return {...await f.prepare(c.bytes,{filename:c.filename,reportId:c.reportId}),capture:c};};
 return f;
}
test('native JSON intake retains raw pages and links a fully evidenced deposit without allocating',async t=>{
 const f=await fixture(t),input=await f.capture(),before=f.read().state,result=await f.sink.importReport(input),after=f.read().state;
 assert.equal(result.status,'IMPORTED');assert.equal(result.paymentCount,1);
 const payment=after.transactions.find(row=>row.specification);
 assert.equal(payment.payerReference,'0599');assert.equal(payment.party,'Synthetic customer AB');assert.equal(payment.parentId,before.transactions[0].id);
 assert.equal(payment.enrichmentEvidence.companyId,companyId);assert.equal(payment.rawBankData.aggregateTransactionId,'PARENT-1');
 assert.equal(payment.referenceEvidence.selected.kind,'structured');assert.equal(economicTransactions(after).reduce((sum,row)=>sum+row.amount,0),62500);
 assert.deepEqual(after.invoices,before.invoices);assert.deepEqual(after.allocations,[]);assert.deepEqual(after.company,before.company);
 assert.deepEqual(f.objects.get(f.owner+'/'+input.documentId),input.capture.bytes);
 assert.equal(readOpenPaymentsBankgiroCapture(f.objects.get(f.owner+'/'+input.documentId)).pages[0].requestId,'synthetic-request-capture-1');
 const receipt=after.imports.find(row=>row.documentId===input.documentId).enrichment.authorization;
 assert.equal(receipt.origin,'provider_authorization');assert.equal(receipt.accountId,'account-a');assert.equal(receipt.validUntil,input.authorization.validUntil);
 assert.deepEqual(JSON.parse(f.audits()[0].detail).enrichmentAuthorization,receipt);
});
test('two individual payers and 0599 versus 599 survive the whole source-to-model path with a custom reference policy',async t=>{
 const f=await fixture(t),configured=f.read().state;configured.company.invoiceReferencePolicies=[{version:'invoice-reference-policy-v1',id:'company-reference-policy',companyName:configured.company.name,referenceSource:'invoice_number',direction:'customer',matchMode:'exact'}];await f.write(configured);
 const input=await f.capture({payments:[{id:'CHILD-A',amount:'125.00',payer:'Synthetic payer A',reference:'0599'},{id:'CHILD-B',amount:'500.00',payer:'Synthetic payer B',reference:'599'}]}),result=await f.sink.importReport(input),state=f.read().state;
 assert.equal(result.status,'IMPORTED');assert.equal(result.paymentCount,2);
 assert.deepEqual(state.transactions.filter(row=>row.specification).map(row=>[row.party,row.amount,row.payerReference]),[['Synthetic payer A',12500,'0599'],['Synthetic payer B',50000,'599']]);
 assert.equal(economicTransactions(state).reduce((sum,row)=>sum+row.amount,0),62500);
 assert.deepEqual(state.company.invoiceReferencePolicies,configured.company.invoiceReferencePolicies);assert.deepEqual(state.invoices,configured.invoices);assert.deepEqual(state.allocations,[]);
});
test('the same original reimport and a fresh receipt for the same bank payment add no money or payment rows',async t=>{
 const f=await fixture(t),input=await f.capture();await f.sink.importReport(input);
 assert.equal((await f.sink.importReport(input)).status,'DUPLICATE');
 const other=await f.capture({captureId:'capture-2'});await f.sink.importReport(other);
 assert.equal(f.read().state.transactions.filter(row=>row.specification).length,1);
 assert.equal(economicTransactions(f.read().state).reduce((sum,row)=>sum+row.amount,0),62500);assert.equal(f.objects.size,2);
});
test('same date and amount without the common bank entry identity remain non-economic review',async t=>{
 const f=await fixture(t),input=await f.capture({parentReference:'DIFFERENT-DEPOSIT'}),result=await f.sink.importReport(input),state=f.read().state;
 assert.equal(result.status,'REVIEW');assert.equal(state.transactions.find(row=>row.specification).parentId,'');
 assert.equal(economicTransactions(state).length,1);assert.equal(state.allocations.length,0);
});
for(const [label,input,company] of [['other company',{company:'synthetic-company-b'},companyId],['other owner',{owner:'foreign-owner'},companyId],['unbound workspace',{},'']])test('native API intake rejects '+label+' before workspace mutation',async t=>{
 const f=await fixture(t,{company}),original=await f.capture(input),before=f.read();
 await assert.rejects(()=>f.sink.importReport(original));assert.deepEqual(f.read(),before);assert.equal(f.audits().length,0);
});
test('AIS-only authorization cannot admit Bankgiro enrichment',async t=>{
 const f=await fixture(t),input=await f.capture(),before=f.read();input.authorization.capabilities=['accountinformation','corporate'];
 await assert.rejects(()=>f.sink.importReport(input),{code:'AUTHORIZATION_BLOCKED'});assert.deepEqual(f.read(),before);
});
for(const [label,change] of [['missing individual payer',{payer:''}],['partial bank coverage',{amount:'125.00'}]])test(label+' remains review even with matching bank account',async t=>{
 const f=await fixture(t),input=await f.capture(change),result=await f.sink.importReport(input),state=f.read().state;
 assert.equal(result.status,'REVIEW');const row=state.transactions.find(row=>row.specification);
 assert.ok(row.bankgiroEnrichmentIssue);assert.equal(row.parentId,'');assert.equal(economicTransactions(state).reduce((sum,row)=>sum+row.amount,0),62500);
});
test('missing Bankgiro information produces an explicit retained review receipt without a transaction',async t=>{
 const f=await fixture(t),input=await f.capture({bankgiro:false}),before=f.read().state,result=await f.sink.importReport(input);
 assert.equal(result.status,'REVIEW');assert.equal(result.reasonCode,'BANKGIRO_INFORMATION_UNAVAILABLE');assert.equal(result.paymentCount,0);
 assert.deepEqual(f.read().state.transactions,before.transactions);assert.equal(f.read().state.imports.length,before.imports.length+1);
 assert.equal((await f.sink.importReport(input)).status,'DUPLICATE');
});
test('a changed original checksum prevents any normalization commit',async t=>{
 const f=await fixture(t),input=await f.capture(),before=f.read();f.objects.get(f.owner+'/'+input.documentId)[20]^=1;
 await assert.rejects(()=>f.sink.importReport(input));assert.deepEqual(f.read(),before);
});
test('a valid transport hash cannot override a foreign account in the actual provider response',async t=>{
 const f=await fixture(t),c=capture(),container=JSON.parse(new TextDecoder().decode(c.bytes)),body=JSON.parse(container.pages[0].body);
 body.account.iban='SE3550000000054910000003';container.pages[0].body=JSON.stringify(body);container.pages[0].sha256=hash(Buffer.from(container.pages[0].body));
 const bytes=new TextEncoder().encode(JSON.stringify(container)),input=await f.prepare(bytes,{filename:c.filename,reportId:c.reportId}),before=f.read();
 await assert.rejects(()=>f.sink.importReport(input),{code:'ACCOUNT_MISMATCH'});assert.deepEqual(f.read(),before);assert.deepEqual(f.objects.get(f.owner+'/'+input.documentId),bytes);
});
test('job and capture report identities must agree even when the owned original hash is correct',async t=>{
 const f=await fixture(t),input=await f.capture(),before=f.read();input.job.reportId='different-report';await f.bound(()=>f.scopedDatabase.prepare('UPDATE bankgiro_ingest_jobs SET report_id=? WHERE id=?').bind(input.job.reportId,input.job.id).run());
 await assert.rejects(()=>f.sink.importReport(input),{code:'IDENTITY_CONFLICT'});assert.deepEqual(f.read(),before);
});
test('a concurrent company switch prevents committing the earlier company capture',async t=>{
 const f=await fixture(t),input=await f.capture(),before=f.read().state;
 f.beforeBatch=async()=>{f.beforeBatch=null;const changed=f.read().state;changed.company.id='company-b';await f.write(changed);};
 await assert.rejects(()=>f.sink.importReport(input));const after=f.read().state;
 assert.equal(after.company.id,'company-b');assert.deepEqual(after.transactions,before.transactions);assert.deepEqual(after.allocations,before.allocations);assert.equal(f.audits().length,0);
});
test('the domain refuses cross-company normalized observations even outside the automatic sink',()=>{
 const state=seedState();state.company.id=companyId;
 const c=capture({company:'synthetic-company-b'}),rows=c.normalization.rows;
 assert.throws(()=>applyCommand(state,{type:'bankgiro.import',documentId:'captured-document',hash:c.sha256,name:c.filename,rows}));
});
test('a provider completeness hold cannot be erased by account resolution or direct preview',()=>{
 const state=seedState();state.company.id=companyId;
 const c=capture({amount:'125.00'}),rows=c.normalization.rows;
 rows[0].amount=62500; // simulate a caller trying to paper over the incomplete original
 assert.equal(specificationPreview(state,rows).linked,0);assert.equal(specificationPreview(state,rows).review,1);
});

test('real provider raw receipt joins catalog-scoped intake and represents an AIS aggregate exactly once',async t=>{
 const {OpenPaymentsProvider}=await import('../lib/banking/openpayments-provider.js');
 const {CONFIG,CONTEXT,ACCOUNT,ACCOUNT_ID,NOW,fixtureTransport,json}=await import('./helpers/openpayments-fixture.mjs');
 const {createOpenPaymentsBankgiroCaptureFromProvider}=await import('../lib/bankgiro-openpayments-capture.js');
 const f=await fixture(t),template=capture(),body=template.pages[0].body;
 const transport=fixtureTransport({
  'GET /psd2/accountinformation/v1/accounts':()=>json({accounts:[{...ACCOUNT,iban:account}]}),
  ['GET /psd2/accountinformation/v1/accounts/'+ACCOUNT_ID+'/transactions']:()=>new Response(body,{headers:{'Content-Type':'application/json'}}),
 });
 const provider=new OpenPaymentsProvider({...CONFIG,features:['consents','accounts','transactions','bankgiro_enrichment']},{transport:transport.transport,now:()=>NOW});
 const binding={...CONTEXT.binding,owner:f.owner,companyId};
 const connection=provider.forCompany({...CONTEXT,binding},{...transport.dependencies,assertCurrent:async input=>assert.deepEqual(input,binding)});
 const consent=await connection.createConsent({validUntil:'2026-12-01'}),accounts=await connection.listAccounts(consent.handle);
 const result=await connection.getTransactions(accounts.accounts[0].handle,{dateFrom:'2026-10-26',dateTo:'2026-10-26'});
 const joined=createOpenPaymentsBankgiroCaptureFromProvider({context:{...template.context,accountId:ACCOUNT_ID},captureId:'provider-to-intake-1',originals:result.originals,binding});
 f.authorization.accountId=ACCOUNT_ID;
 const input=await f.prepare(joined.bytes,{filename:joined.filename,reportId:joined.reportId});
 const outcome=await f.sink.importReport(input),state=f.read().state;
 assert.equal(outcome.status,'IMPORTED');assert.equal(state.allocations.length,0);
 assert.equal(economicTransactions(state).reduce((sum,row)=>sum+row.amount,0),62500);
 assert.equal(state.transactions.filter(row=>row.specification).length,1);
 assert.equal(readOpenPaymentsBankgiroCapture(f.objects.get(f.owner+'/'+input.documentId)).pages[0].body,body);
 assert.equal((await f.sink.importReport(input)).status,'DUPLICATE');
});
