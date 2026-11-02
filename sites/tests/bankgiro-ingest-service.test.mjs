import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand,economicTransactions,balance} from '../lib/domain.ts';
import {parseSpecificationBytes} from '../lib/bankgiro-parser.js';
import {makeBankgiroXLSX} from './helpers/bankgiro-xlsx-fixture.mjs';
import {syntheticBankRow} from './helpers/bank-api-fixture.mjs';
import {ingestFixture,reportBytes,hash,account} from './helpers/bankgiro-ingest-fixture.mjs';

test('automatic retention stores the exact owned original once across renamed concurrent deliveries',async t=>{
 const f=await ingestFixture(t),bytes=reportBytes(),sha256=hash(bytes),before=f.read();
 const one={owner:f.owner,report:{reportId:'one',filename:'Original.xml',sha256},bytes,sha256,lease:f.lease};
 const [a,b]=await Promise.all([f.sink.retain(one),f.sink.retain({...one,report:{...one.report,filename:'Renamed.xml',reportId:'two'}})]);
 assert.equal(a.documentId,b.documentId);assert.equal(f.objects.size,1);assert.deepEqual(f.objects.get(f.owner+'/'+a.documentId),bytes);
 const docs=f.sql.prepare('SELECT * FROM documents').all();assert.equal(docs.length,1);assert.equal(docs[0].owner,f.owner);assert.equal(docs[0].sha256,sha256);assert.equal(docs[0].mime,'application/xml');
 assert.deepEqual(f.read(),before);assert.equal(f.audits().length,0);
});
test('retention keeps referenced bytes after a database commit response is lost',async t=>{
 const f=await ingestFixture(t),bytes=reportBytes(),sha256=hash(bytes),input={owner:f.owner,report:{reportId:'one',filename:'Original.xml',sha256},bytes,sha256,lease:f.lease};
 f.afterBatch=statements=>{if(statements.some(s=>/INSERT INTO documents/.test(s.query))){f.afterBatch=null;throw Error('D1_ERROR: synthetic response lost after COMMIT');}};
 await assert.rejects(f.sink.retain(input));assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,1);assert.equal(f.objects.size,1);
 const retained=await f.sink.retain(input);assert.deepEqual(f.objects.get(f.owner+'/'+retained.documentId),bytes);assert.equal(f.objects.size,1);
});
test('retention refuses a forged hash before any original is written',async t=>{
 const f=await ingestFixture(t),bytes=reportBytes(),sha256='0'.repeat(64);
 await assert.rejects(f.sink.retain({owner:f.owner,report:{reportId:'one',filename:'Original.xml',sha256},bytes,sha256,lease:f.lease}),{code:'HASH_MISMATCH'});
 assert.equal(f.objects.size,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,0);
});
test('a complete individual report links under the verified aggregate with no allocation or invoice mutation',async t=>{
 const f=await ingestFixture(t),input=await f.prepare(),before=f.read().state,result=await f.sink.importReport(input),after=f.read().state;
 assert.equal(result.status,'IMPORTED');assert.equal(result.paymentCount,1);assert.equal(after.transactions.length,2);
 const child=after.transactions.find(row=>row.specification);assert.equal(child.payerReference,'0599');assert.equal(child.party,'Synthetic customer AB');assert.equal(child.parentId,before.transactions[0].id);assert.equal(child.bankFileProof.sha256,input.job.sha256);
 assert.equal(economicTransactions(after).reduce((sum,row)=>sum+row.amount,0),62500);assert.deepEqual(after.allocations,before.allocations);assert.deepEqual(after.invoices,before.invoices);assert.equal(balance(after,after.invoices[0]),62500);
 const audit=f.audits();assert.equal(audit.length,1);assert.equal(audit[0].action,'bankgiro.import');assert.equal(JSON.parse(audit[0].detail).command.documentId,input.documentId);assert.equal(JSON.parse(audit[0].detail).command.hash,input.job.sha256);
});
test('a complete two-payer report replaces the aggregate economically exactly once',async t=>{
 const f=await ingestFixture(t),bytes=reportBytes([{amount:'125.00',payer:'Synthetic customer AB',reference:'0599',id:'CHILD-A'},{amount:'500.00',payer:'Second synthetic payer AB',reference:'0060',id:'CHILD-B'}]),input=await f.prepare(bytes);
 const result=await f.sink.importReport(input),after=f.read();assert.equal(result.status,'IMPORTED');assert.equal(result.paymentCount,2);assert.equal(after.state.transactions.length,3);assert.equal(economicTransactions(after.state).reduce((sum,row)=>sum+row.amount,0),62500);assert.equal(after.state.allocations.length,0);
 const replay=await f.sink.importReport(input);assert.equal(replay.status,'DUPLICATE');assert.deepEqual(f.read(),after);assert.equal(f.audits().length,1);
});
test('a report arriving before AIS stays review-only and repeated intake does not promote it later',async t=>{
 const f=await ingestFixture(t,{parent:false}),input=await f.prepare(),result=await f.sink.importReport(input);assert.equal(result.status,'REVIEW');assert.equal(economicTransactions(f.read().state).length,0);assert.equal(f.read().state.allocations.length,0);
 const next=applyCommand(f.read().state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account,date:'2026-10-26',amount:62500,bankReference:'SYNTHETIC-DEPOSIT',party:'',payerReference:'',description:'Bankgiro inbetalning'})]}).state;f.write(next);const before=f.read();
 assert.equal((await f.sink.importReport(input)).status,'DUPLICATE');assert.deepEqual(f.read(),before);assert.equal(before.state.transactions.find(row=>row.specification).specificationStatus,'review');assert.equal(economicTransactions(before.state).reduce((sum,row)=>sum+row.amount,0),62500);
});
test('XLSX original remains retained non-economic evidence with no invented bank transaction ID',async t=>{
 const f=await ingestFixture(t),input=await f.prepare(makeBankgiroXLSX(),{filename:'Synthetic.xlsx'}),before=f.read().state,result=await f.sink.importReport(input),after=f.read().state;
 assert.equal(result.status,'REVIEW');assert.equal(after.transactions.filter(row=>row.specification).length,1);assert.equal(after.transactions.find(row=>row.specification).bankReference,'');assert.equal(after.transactions.find(row=>row.specification).specificationStatus,'review');
 assert.equal(economicTransactions(after).reduce((sum,row)=>sum+row.amount,0),62500);assert.deepEqual(after.allocations,before.allocations);assert.deepEqual(after.invoices,before.invoices);
});
test('missing payer and payment reference remain missing and cannot release the aggregate',async t=>{
 const f=await ingestFixture(t),input=await f.prepare(reportBytes([{amount:'625.00',payer:'',reference:'',id:'CHILD-A'}])),result=await f.sink.importReport(input),state=f.read().state,row=state.transactions.find(row=>row.specification);
 assert.equal(result.status,'REVIEW');assert.equal(row.party,'');assert.equal(row.payerReference,'');assert.equal(row.verified,false);assert.equal(state.allocations.length,0);assert.equal(economicTransactions(state).reduce((sum,row)=>sum+row.amount,0),62500);
});
test('changed retained report bytes cannot change the workspace or audit',async t=>{
 const f=await ingestFixture(t),input=await f.prepare(),before=f.read();f.objects.set(f.owner+'/'+input.documentId,reportBytes([{amount:'625.00',payer:'Synthetic customer AB',reference:'0600',id:'SYNTHETIC-CHILD-1'}]));
 const failure=await f.sink.importReport(input).catch(error=>({code:error?.code}));assert.deepEqual(failure,{code:'INVALID_ORIGINAL'});assert.deepEqual(f.read(),before);assert.equal(f.audits().length,0);
});
test('another owner cannot consume a retained report or reuse its lease',async t=>{
 const f=await ingestFixture(t),input=await f.prepare(),before=f.read();
 await assert.rejects(f.sink.importReport({...input,owner:'foreign-owner'}));await assert.rejects(f.sink.importReport({...input,authorization:{...input.authorization,owner:'foreign-owner'}}));assert.deepEqual(f.read(),before);assert.equal(f.audits().length,0);
});
test('a lost import response is retried from the committed original receipt without a second write',async t=>{
 const f=await ingestFixture(t),input=await f.prepare();
 f.afterBatch=statements=>{if(statements.some(s=>/UPDATE workspaces SET payload/.test(s.query))){f.afterBatch=null;throw Error('D1_ERROR: synthetic response lost after COMMIT');}};
 await assert.rejects(f.sink.importReport(input));const saved=f.read();assert.equal(saved.state.transactions.length,2);assert.equal(saved.state.allocations.length,0);
 assert.equal((await f.sink.importReport(input)).status,'DUPLICATE');assert.deepEqual(f.read(),saved);assert.equal(f.audits().length,1);
});
for(const kind of ['lease','lease expiry','revision','consent','job identity','document identity'])test(kind+' changing at the commit boundary cannot partially import a report',async t=>{
 const f=await ingestFixture(t),input=await f.prepare(),before=f.read();let fired=false;
 f.beforeBatch=statements=>{if(!fired&&statements.some(s=>/UPDATE workspaces SET payload/.test(s.query))){fired=true;
  if(kind==='lease')f.sql.prepare("UPDATE bankgiro_ingest_leases SET token='replacement' WHERE owner=?").run(f.owner);
  if(kind==='lease expiry')f.sql.prepare('UPDATE bankgiro_ingest_leases SET expires_at=? WHERE owner=?').run(Date.now()-1000,f.owner);
  if(kind==='revision')f.sql.prepare('UPDATE workspaces SET revision=revision+1 WHERE owner=?').run(f.owner);
  if(kind==='consent')f.sql.prepare("UPDATE bank_connections SET selected_accounts='[]' WHERE owner=?").run(f.owner);
  if(kind==='job identity')f.sql.prepare("UPDATE bankgiro_ingest_jobs SET report_id='replacement' WHERE id=?").run(input.job.id);
  if(kind==='document identity')f.sql.prepare("UPDATE documents SET sha256=? WHERE id=?").run('0'.repeat(64),input.documentId);
 }};
 await assert.rejects(f.sink.importReport(input));assert.equal(fired,true);assert.deepEqual(f.read().state,before.state);assert.equal(f.audits().length,0);assert.equal(f.read().revision,before.revision+(kind==='revision'?1:0));
});

for(const change of ['revocation','generation'])for(const when of ['original read','commit'])test('source authorization '+change+' during '+when+' prevents report mutation',async t=>{
 const f=await ingestFixture(t),input=await f.prepare(),before=f.read();let fired=false;
 const mutate=()=>{fired=true;f.sql.prepare(change==='revocation'?"UPDATE bankgiro_ingest_sources SET authorization_status='BLOCKED' WHERE owner=?":"UPDATE bankgiro_ingest_sources SET authorization_generation='replacement' WHERE owner=?").run(f.owner);};
 if(when==='original read')f.onRead=()=>{if(!fired)mutate();};
 else f.beforeBatch=statements=>{if(!fired&&statements.some(s=>/UPDATE workspaces SET payload/.test(s.query)))mutate();};
 const failed=await f.sink.importReport(input).then(()=>false,()=>true);assert.equal(failed,true);assert.equal(fired,true);assert.deepEqual(f.read(),before);assert.equal(f.audits().length,0);assert.equal(f.objects.size,1);
});
for(const change of ['revocation','generation'])test('an already imported report cannot return a duplicate receipt after source authorization '+change,async t=>{
 const f=await ingestFixture(t),input=await f.prepare();await f.sink.importReport(input);const before=f.read();
 f.onRead=()=>f.sql.prepare(change==='revocation'?"UPDATE bankgiro_ingest_sources SET authorization_status='BLOCKED' WHERE owner=?":"UPDATE bankgiro_ingest_sources SET authorization_generation='replacement' WHERE owner=?").run(f.owner);
 const failure=await f.sink.importReport(input).catch(error=>({code:error?.code}));assert.deepEqual(failure,{code:'AUTHORIZATION_CHANGED'});assert.deepEqual(f.read(),before);assert.equal(f.audits().length,1);
});

test('a rejected oversized conflicting report retains its evidence hold and both originals without attempted money',async t=>{
 const f=await ingestFixture(t),first=await f.prepare();await f.sink.importReport(first);
 const full=f.read().state;full.company.name='x'.repeat(1798000-new TextEncoder().encode(JSON.stringify({...full,company:{...full.company,name:''}})).length);f.write(full);
 const incoming=await f.prepare(reportBytes([{amount:'625.00',payer:'Synthetic revised payer AB',reference:'0599',id:'SYNTHETIC-CHILD-1'}])),before=f.read(),auditCount=f.audits().length;
 await assert.rejects(f.sink.importReport(incoming));const after=f.read();
 assert.ok(after.state.bankEvidenceHold||after.state.transactions.some(row=>row.bankEvidenceConflicts?.length),'new contradictory evidence must survive a rejected financial import');
 assert.deepEqual(after.state.allocations,before.state.allocations);assert.deepEqual(after.state.invoices,before.state.invoices);assert.deepEqual(after.state.transactions.map(row=>[row.id,row.amount,row.parentId]),before.state.transactions.map(row=>[row.id,row.amount,row.parentId]));
 assert.equal(f.objects.size,2);assert.equal(f.audits().length,auditCount+1);const rejected=f.audits().find(row=>row.action==='bank.import_rejected');assert.ok(rejected);assert.equal(JSON.parse(rejected.detail).command.hash,incoming.job.sha256);
 await assert.rejects(f.sink.importReport(incoming));assert.equal(f.audits().length,auditCount+1);assert.equal(f.read().revision,after.revision);
});

const runRequest=(body='{}',origin='https://mg.test')=>new Request('https://mg.test/api/bankgiro/source/run',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body});
test('source status and run stay explicitly disabled without a registered delivery source',async t=>{
 const f=await ingestFixture(t);assert.equal(typeof f.service.bankgiroSourceStatus,'function');assert.equal(typeof f.service.runBankgiroSource,'function');
 const before=f.sql.prepare('SELECT total_changes() n').get().n;
 for(const value of [await f.service.bankgiroSourceStatus(f.owner),await f.service.runBankgiroSource(f.owner)]){assert.equal(value.enabled,false);assert.equal(value.state,'DISABLED');assert.equal(value.reason,'SOURCE_NOT_CONFIGURED');assert.deepEqual(value.jobs,[]);}
 assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.objects.size,0);
});
test('status reads the configured queue without authorizing or retrieving source data',async t=>{
 const f=await ingestFixture(t);f.source={id:'synthetic-source',mode:'production',authorize(){throw Error('A status read must not authorize');},listReports(){throw Error('A status read must not list');},fetchReport(){throw Error('A status read must not fetch');}};
 assert.equal(typeof f.service.bankgiroSourceStatus,'function');const before=f.sql.prepare('SELECT total_changes() n').get().n,result=await f.service.bankgiroSourceStatus(f.owner);
 assert.equal(result.enabled,true);assert.equal(result.counts.IMPORTED,0);assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.objects.size,0);
});
test('public source status omits private delivery and original metadata',async t=>{
 const f=await ingestFixture(t),input=await f.prepare();f.source={id:'synthetic-source',mode:'production',authorize(){throw Error('status must not authorize');},listReports(){throw Error('status must not list');},fetchReport(){throw Error('status must not fetch');}};
 f.sql.prepare("UPDATE bankgiro_ingest_sources SET cursor='synthetic-private-cursor' WHERE owner=?").run(f.owner);
 const result=await f.service.bankgiroSourceStatus(f.owner);
 assert.deepEqual(Object.keys(result).sort(),['enabled','sourceId','mode','state','reason','nextPollAt','missingReportIds','counts','jobs','lastError'].sort());
 assert.deepEqual(Object.keys(result.jobs[0]).sort(),['id','reportId','status','attempts','nextAttemptAt','updatedAt'].sort());
 const exposed=JSON.stringify(result);for(const value of [input.job.scopeId,input.job.authorizationGeneration,input.job.sha256,input.documentId,input.job.filename,'synthetic-private-cursor'])assert.equal(exposed.includes(value),false);
});
test('the registered-source entrypoint processes a synthetic delivery through the real queue and sink once',async t=>{
 const f=await ingestFixture(t),bytes=reportBytes(),report={reportId:'synthetic-delivery',filename:'Synthetic.xml',sha256:hash(bytes)};
 f.sql.prepare('DELETE FROM bankgiro_ingest_leases').run();
 f.source={id:'synthetic-source',mode:'production',async authorize({owner}){assert.equal(owner,f.owner);return {...f.authorization};},async listReports({owner}){assert.equal(owner,f.owner);return{reports:[report],nextCursor:null};},async fetchReport({owner,report:requested}){assert.equal(owner,f.owner);assert.equal(requested.reportId,report.reportId);return bytes;}};
 assert.equal(typeof f.service.runBankgiroSource,'function');const result=await f.service.runBankgiroSource(f.owner);assert.equal(result.counts.IMPORTED,1,JSON.stringify(result));
 const saved=f.read();assert.equal(saved.state.transactions.length,2);assert.equal(saved.state.allocations.length,0);assert.equal(f.objects.size,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM bankgiro_ingest_jobs').get().n,1);
 await f.service.runBankgiroSource(f.owner);assert.deepEqual(f.read(),saved);assert.equal(f.audits().length,1);assert.equal(f.objects.size,1);
});
test('synthetic sources cannot be activated through the production entrypoint',async t=>{
 const f=await ingestFixture(t);f.source={id:'synthetic-source',mode:'synthetic',authorize(){throw Error('must remain disabled');}};
 assert.equal(typeof f.service.runBankgiroSource,'function');const before=f.sql.prepare('SELECT total_changes() n').get().n,result=await f.service.runBankgiroSource(f.owner);assert.equal(result.enabled,false);assert.equal(result.reason,'SYNTHETIC_DISABLED');assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);
});
test('source endpoints authenticate and reject cross-origin runs before any write',async t=>{
 const f=await ingestFixture(t);await f.loadRoutes();const before=f.sql.prepare('SELECT total_changes() n').get().n;f.user=null;
 assert.equal((await f.statusRoute.GET(new Request('https://mg.test/api/bankgiro/source/status'))).status,401);assert.equal((await f.runRoute.POST(runRequest())).status,401);
 f.user={userId:f.owner};for(const origin of ['', 'https://foreign.test'])assert.equal((await f.runRoute.POST(runRequest('{}',origin))).status,403);
 assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.objects.size,0);
});
test('status endpoint uses the authenticated owner and remains read-only',async t=>{
 const f=await ingestFixture(t);await f.loadRoutes();const before=f.sql.prepare('SELECT total_changes() n').get().n;
 const response=await f.statusRoute.GET(new Request('https://mg.test/api/bankgiro/source/status?owner=foreign-owner')),body=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(body.state,'DISABLED');assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);
});
test('run endpoint accepts an empty request but refuses owner/provider/configuration and oversized bodies',async t=>{
 const f=await ingestFixture(t);await f.loadRoutes();const before=f.sql.prepare('SELECT total_changes() n').get().n;
 for(const body of ['', '{}']){const response=await f.runRoute.POST(runRequest(body));assert.equal(response.status,200);assert.equal((await response.json()).state,'DISABLED');}
 for(const body of ['{"owner":"foreign-owner"}','{"provider":"https://foreign.test"}','{"config":{"enabled":true}}','[]','null','42','{'])assert.equal((await f.runRoute.POST(runRequest(body))).status,400);
 assert.equal((await f.runRoute.POST(runRequest('x'.repeat(2049)))).status,413);assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);
});
test('a malformed delivered report is retained and blocked instead of repeatedly retried',async t=>{
 const f=await ingestFixture(t),bytes=new TextEncoder().encode('<broken XML>'),report={reportId:'malformed-delivery',filename:'Synthetic.xml',sha256:hash(bytes)},before=f.read();f.sql.prepare('DELETE FROM bankgiro_ingest_leases').run();
 f.source={id:'synthetic-source',mode:'production',async authorize(){return {...f.authorization};},async listReports(){return{reports:[report],nextCursor:null};},async fetchReport(){return bytes;}};
 const result=await f.service.runBankgiroSource(f.owner);assert.equal(result.counts.BLOCKED,1,JSON.stringify(result));assert.equal(result.counts.RETRY,0);assert.equal(f.sql.prepare('SELECT last_error FROM bankgiro_ingest_jobs WHERE id=?').get(result.jobs[0].id).last_error,'INVALID_ORIGINAL');assert.equal(f.objects.size,1);assert.deepEqual(f.read(),before);assert.equal(f.audits().length,0);
});
for(const field of ['payer name','bank reference','report metadata'])test('parser-accepted '+field+' beyond domain limits is retained and blocked without repeated imports',async t=>{
 const f=await ingestFixture(t),payment={amount:'625.00',payer:field==='payer name'?'P'.repeat(201):'Synthetic customer AB',reference:'0599',id:field==='bank reference'?'B'.repeat(301):'SYNTHETIC-CHILD-1'};
 let bytes=reportBytes([payment]);if(field==='report metadata')bytes=new TextEncoder().encode(new TextDecoder().decode(bytes).replace('SYNTHETIC-MESSAGE','M'.repeat(301)));
 assert.doesNotThrow(()=>parseSpecificationBytes(bytes,'Synthetic.xml'));
 const report={reportId:'invalid-domain-'+field,filename:'Synthetic.xml',sha256:hash(bytes)},before=f.read();let fetched=0;f.sql.prepare('DELETE FROM bankgiro_ingest_leases').run();
 f.source={id:'synthetic-source',mode:'production',async authorize(){return {...f.authorization};},async listReports(){return{reports:[report],nextCursor:'after-invalid-domain-report'};},async fetchReport(){fetched++;return bytes;}};
 const result=await f.service.runBankgiroSource(f.owner);assert.equal(result.counts.BLOCKED,1,JSON.stringify(result));assert.equal(result.counts.RETRY,0);
 const job=f.sql.prepare('SELECT * FROM bankgiro_ingest_jobs WHERE id=?').get(result.jobs[0].id);assert.equal(job.last_error,'INVALID_ORIGINAL');assert.equal(job.next_attempt_at,null);assert.equal(job.attempts,1);assert.ok(job.document_id);
 assert.deepEqual(f.objects.get(f.owner+'/'+job.document_id),bytes);assert.equal(f.objects.size,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,1);assert.equal(f.sql.prepare('SELECT cursor FROM bankgiro_ingest_sources WHERE owner=?').get(f.owner).cursor,null);assert.deepEqual(f.read(),before);assert.equal(f.audits().length,0);
 await f.service.runBankgiroSource(f.owner);assert.equal(fetched,1);assert.equal(f.sql.prepare('SELECT attempts FROM bankgiro_ingest_jobs WHERE id=?').get(job.id).attempts,1);assert.deepEqual(f.read(),before);assert.equal(f.audits().length,0);
});
for(const failure of ['storage','consent','revision'])test(failure+' failure remains retryable instead of being classified as an invalid original',async t=>{
 const f=await ingestFixture(t),bytes=reportBytes(),report={reportId:'retry-'+failure,filename:'Synthetic.xml',sha256:hash(bytes)},before=f.read();let fired=false,reads=0;f.sql.prepare('DELETE FROM bankgiro_ingest_leases').run();
 f.source={id:'synthetic-source',mode:'production',async authorize(){return {...f.authorization};},async listReports(){return{reports:[report],nextCursor:'after-retry-report'};},async fetchReport(){return bytes;}};
 if(failure==='storage')f.onRead=()=>{if(f.sql.prepare('SELECT COUNT(*) n FROM bankgiro_ingest_jobs WHERE document_id IS NOT NULL').get().n&&++reads===2){fired=true;throw Error('R2_UNAVAILABLE: synthetic transient read failure');}};
 else f.beforeBatch=statements=>{if(!fired&&statements.some(s=>/UPDATE workspaces SET payload/.test(s.query))){fired=true;f.sql.prepare(failure==='consent'?"UPDATE bank_connections SET selected_accounts='[]' WHERE owner=?":'UPDATE workspaces SET revision=revision+1 WHERE owner=?').run(f.owner);}};
 const result=await f.service.runBankgiroSource(f.owner);assert.equal(fired,true);assert.equal(result.counts.RETRY,1,JSON.stringify(result));assert.equal(result.counts.BLOCKED,0);
 const job=f.sql.prepare('SELECT * FROM bankgiro_ingest_jobs WHERE id=?').get(result.jobs[0].id);assert.equal(job.last_error,'SOURCE_UNAVAILABLE');assert.ok(job.document_id);assert.ok(job.next_attempt_at>Date.now());assert.deepEqual(f.read().state,before.state);assert.equal(f.audits().length,0);assert.equal(f.objects.size,1);
});
test('a domain-rejected contradictory report preserves evidence holds before the worker blocks it',async t=>{
 const f=await ingestFixture(t);let bytes=reportBytes(),report={reportId:'first-delivery',filename:'Synthetic.xml',sha256:hash(bytes)};f.sql.prepare('DELETE FROM bankgiro_ingest_leases').run();
 f.source={id:'synthetic-source',mode:'production',async authorize(){return {...f.authorization};},async listReports(){return{reports:[report],nextCursor:null};},async fetchReport(){return bytes;}};
 assert.equal((await f.service.runBankgiroSource(f.owner)).counts.IMPORTED,1);const before=f.read();
 bytes=reportBytes([{amount:'625.00',payer:'P'.repeat(201),reference:'0599',id:'SYNTHETIC-CHILD-1'}]);report={...report,reportId:'contradictory-delivery',sha256:hash(bytes)};
 const result=await f.service.runBankgiroSource(f.owner);assert.equal(result.counts.BLOCKED,1,JSON.stringify(result));assert.equal(result.counts.RETRY,0);
 const after=f.read();assert.ok(after.state.bankEvidenceHold||after.state.transactions.some(row=>row.bankEvidenceConflicts?.length));assert.deepEqual(after.state.allocations,before.state.allocations);assert.deepEqual(after.state.invoices,before.state.invoices);assert.deepEqual(after.state.transactions.map(row=>[row.id,row.amount,row.parentId]),before.state.transactions.map(row=>[row.id,row.amount,row.parentId]));assert.equal(f.objects.size,2);assert.equal(f.audits().length,2);assert.ok(f.audits().some(row=>row.action==='bank.import_rejected'));
 await f.service.runBankgiroSource(f.owner);assert.deepEqual(f.read(),after);assert.equal(f.audits().length,2);
});
