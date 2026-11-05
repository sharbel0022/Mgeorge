import test from 'node:test';
import assert from 'node:assert/strict';
import {ingestFixture,reportBytes,hash} from './helpers/bankgiro-ingest-fixture.mjs';
import {provisionCompany,changeCompanyMembership,resolveCompanyScope} from '../lib/company-storage.js';

test('a correctly bound company source uses the existing original, account proof and atomic import exactly once',async t=>{
 const f=await ingestFixture(t),bytes=reportBytes(),report={reportId:'synthetic-company-delivery',filename:'Synthetic.xml',sha256:hash(bytes)};let providerCalls=0;
 f.sql.prepare('DELETE FROM bankgiro_ingest_leases').run();
 await provisionCompany(f.database,{id:'synthetic-company',name:'Synthetic bound company',actorId:f.owner,legacyOwner:f.owner,verifiedLegacyOwner:f.owner,verifiedBy:'synthetic-operator',verificationEvidence:'Synthetic explicit verified legacy owner relation.'});
 f.source={id:'synthetic-source',mode:'production',async authorize({owner}){providerCalls++;assert.equal(owner,f.owner);return{...f.authorization};},async listReports({owner}){providerCalls++;assert.equal(owner,f.owner);return{reports:[report],nextCursor:null};},async fetchReport({owner}){providerCalls++;assert.equal(owner,f.owner);return bytes;}};
 const server=await import(f.moduleUrls.server),handler=server.withCompanyRequest(async req=>{const user=await server.identity(req);return server.response(await f.service.runBankgiroSource(user.userId));});
 const request=()=>new Request('https://synthetic.test/api/bankgiro/source/run',{method:'POST',headers:{Origin:'https://synthetic.test','Content-Type':'application/json','X-Company-Id':'synthetic-company','X-Company-Context-Version':'1'},body:'{}'});
 const before=f.read(),response=await handler(request());assert.equal(response.status,200);const result=await response.json();assert.equal(result.counts.IMPORTED,1,JSON.stringify(result));
 const saved=f.read();assert.equal(saved.state.transactions.length,2);assert.equal(saved.state.allocations.length,0);assert.deepEqual(saved.state.invoices,before.state.invoices);assert.equal(f.objects.size,1);assert.equal(f.sql.prepare('SELECT sha256 FROM documents').get().sha256,report.sha256);
 assert.equal((await handler(request())).status,200);assert.deepEqual(f.read(),saved);assert.equal(f.audits().length,1);assert.ok(providerCalls>0);
 // A trusted global removal contains no fabricated company ID; it can only
 // revoke the already bound owner and must retain a durable authority receipt.
 f.source={id:'removed-source',mode:'production',configurationValid:false,registration:{},revocation:{owner:f.owner,configurationRevision:2}};
 const callsBeforeRemoval=providerCalls;const removed=await(await handler(request())).json();assert.equal(removed.state,'BLOCKED');assert.equal(providerCalls,callsBeforeRemoval);assert.deepEqual(f.read(),saved);
 assert.equal(f.sql.prepare('SELECT authorization_status FROM bankgiro_ingest_sources WHERE owner=?').get(f.owner).authorization_status,'BLOCKED');
 const scope=await resolveCompanyScope(f.database,f.owner,{companyId:'synthetic-company',contextVersion:1});await changeCompanyMembership(f.database,scope,{actorId:'backup-owner',role:'owner',status:'active'});
 await changeCompanyMembership(f.database,scope,{actorId:f.owner,role:'owner',status:'revoked'});
 const calls=providerCalls;assert.equal((await handler(request())).status,403);assert.equal(providerCalls,calls);assert.deepEqual(f.read(),saved);
});
