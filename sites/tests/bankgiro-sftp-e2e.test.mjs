import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createBridge} from '../../bridge/bankgiro/src/bridge.js';
import {startSftp} from '../../bridge/bankgiro/test/sftp-server.js';
import {resolveBankgiroSource} from '../lib/bankgiro-source-registry.js';
import {publicBankgiroStatus} from '../lib/bankgiro-source.js';
import {balance,economicTransactions} from '../lib/domain.ts';
import {joinedFixture} from './helpers/seven-agent-joined-fixture.mjs';

// The only substituted boundary is TLS termination: the test maps one exact
// fictional HTTPS origin to its private real loopback HTTP server. Production
// has no insecure transport switch and requires the deployment's HTTPS proxy.
test('actual SFTP original flows through bridge HTTPS adapter durable queue parser preview and UI with one economic deposit and zero allocations',{skip:process.platform==='win32'?'The isolated SFTP bridge requires a POSIX private filesystem and OS locks':false},async t=>{
 const networkFetch=globalThis.fetch;
 const f=await joinedFixture(t),initial=f.read(),at=Date.now();
 const entitlement={status:'VERIFIED',origin:'provider_authorization',evidenceId:'isolated-sftp-contract',checkedAt:new Date(at-1000).toISOString(),validUntil:new Date(at+3600000).toISOString(),capabilities:['bankgiro_reports:read']};
 const binding={owner:f.owner,sourceId:'isolated-sftp-source',companyId:'isolated-company',bankgiro:'1234567',scopeId:'isolated-scope',generation:'isolated-generation-1',profileId:'isolated-camt054-profile'};
 const remote=await startSftp({files:{'report.xml':{bytes:Buffer.from(f.report.bytes),mtime:1700000000,mode:0o100400}}});
 const directory=await mkdtemp(join(tmpdir(),'bankgiro-full-e2e-'));let bridge;
 t.after(async()=>{await bridge?.close();await remote.close();await rm(directory,{recursive:true,force:true});});
 const token='isolated-only-012345678901234567890123456789';
 bridge=await createBridge({enabled:true,spoolDirectory:join(directory,'spool'),bearerToken:token,binding,entitlement,
  sftp:{host:'127.0.0.1',port:remote.port,username:'reader',password:'fixture-password',hostKeySha256:remote.hostKeySha256,remoteDirectory:'/reports'},
  allowedFormats:['xml'],maxEntries:10,operationTimeoutMs:3000,scanTimeoutMs:10000});
 assert.deepEqual(await bridge.syncOnce(),{discovered:1,conflicts:0});
 const server=bridge.createHttpServer();server.listen(0,'127.0.0.1');await once(server,'listening');
 const loopback='http://127.0.0.1:'+server.address().port,calls=[];
 const registration={id:binding.sourceId,owner:binding.owner,companyId:binding.companyId,bankgiro:binding.bankgiro,scopeId:binding.scopeId,generation:binding.generation,profileId:binding.profileId,
  mode:'production',enabled:true,transport:'https-v1',baseUrl:'https://reports.example.com',tokenSecret:'ISOLATED_TOKEN',allowedFormats:['xml'],intervalMinutes:15,entitlement};
 f.source=await resolveBankgiroSource(f.owner,{configuration:{version:1,revision:1,registrations:[registration]},secrets:{ISOLATED_TOKEN:token},fetchImpl:async(input,options)=>{
  const url=new URL(input);assert.equal(url.origin,'https://reports.example.com');assert.ok(url.pathname.startsWith('/v1/'));calls.push(url.pathname);
  const response=await networkFetch(loopback+url.pathname+url.search,options);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers});
 }});
 const result=await f.worker().run(f.owner);
 assert.equal(result.counts.IMPORTED,1,JSON.stringify(result));assert.equal(result.authorization.status,'VERIFIED');
 assert.ok(calls.some(path=>/^\/v1\/reports\/[a-f0-9]{64}\/content$/.test(path)));
 const state=f.read().state,payment=state.transactions.find(row=>row.specification),invoice=state.invoices.find(row=>row.number==='0599');
 assert.deepEqual(f.objects.get(f.owner+'/'+payment.bankFileProof.documentId),f.report.bytes);
 assert.equal(payment.party,'Synthetic customer AB');assert.equal(payment.payerReference,'0599');assert.equal(payment.parentId,initial.state.transactions[0].id);
 const preview=await f.preview(payment.id),decision=preview.decisions.find(row=>row.transactionId===payment.id);
 assert.equal(decision.status,'VERIFIED',JSON.stringify(decision.reasonCodes));assert.equal(preview.changed,false);assert.equal(preview.writesAllowed,false);
 assert.deepEqual(state.allocations,[]);assert.deepEqual(state.invoices,initial.state.invoices);assert.equal(balance(state,invoice),62500);
 assert.equal(economicTransactions(state).reduce((sum,row)=>sum+row.amount,0),62500);assert.equal(f.audits().length,1);
 const view=f.presentation.bankPaymentView(state,payment);assert.equal(view.reference.value,'0599');assert.equal(view.reference.ocr,'');assert.equal(view.verified,false);
 assert.match(f.render(),/Synthetic customer AB/);assert.match(f.render(),/Bank-OCR saknas/);
 const html=f.renderSourceStatus(publicBankgiroStatus(result));assert.match(html,/<dt>Behörighet<\/dt><dd>Verifierad<\/dd>/);assert.match(html,/<dt>Inlästa rapporter<\/dt><dd>1<\/dd>/);
 assert.doesNotMatch(html,/isolated-only|reports\.example\.com|fixture-password|isolated-sftp-contract/);
 const before=f.read(),count=calls.length;await f.worker().run(f.owner);assert.deepEqual(f.read(),before);assert.equal(calls.length,count);
 // An explicitly changed upstream original must be a permanent review hold,
 // not an endless transient retry. Advance only isolated scheduling metadata.
 const objects=structuredClone(f.objects),changed=Buffer.from(new TextDecoder().decode(f.report.bytes).replace('0599','0600'));
 remote.files.set('report.xml',{bytes:changed,mtime:1700000001,mode:0o100400});
 assert.deepEqual(await bridge.syncOnce(),{discovered:0,conflicts:1});
 f.sql.prepare('UPDATE bankgiro_ingest_sources SET next_poll_at=0 WHERE owner=?').run(f.owner);
 const blocked=await f.worker().run(f.owner);assert.equal(blocked.state,'BLOCKED');assert.equal(blocked.counts.BLOCKED,1);assert.equal(blocked.counts.RETRY,0);
 assert.equal(blocked.jobs.find(job=>job.status==='BLOCKED').lastError,'IDENTITY_CONFLICT');assert.equal(blocked.lastSuccessAt,result.lastSuccessAt);
 assert.equal(f.sql.prepare('SELECT cursor FROM bankgiro_ingest_sources WHERE owner=?').get(f.owner).cursor,'1');
 assert.deepEqual(f.read(),before);assert.deepEqual(f.objects,objects);assert.equal(f.audits().length,1);
 assert.equal((await readdir(join(directory,'spool','blobs'))).length,2,'bridge retains both conflicting immutable originals');
 assert.match(f.renderSourceStatus(publicBankgiroStatus(blocked)),/Rapportens identitet eller innehåll har ändrats/);
});
