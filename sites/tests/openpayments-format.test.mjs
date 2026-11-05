import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReportPage,publicBankgiroStatus} from '../lib/bankgiro-source.js';
import {ingestFixture,hash} from './helpers/bankgiro-ingest-fixture.mjs';
test('report queue accepts only the named native Bankgiro capture JSON extension',()=>{
 const descriptor={reportId:'capture-1',filename:'capture.opbg.json',sha256:'a'.repeat(64)};
 assert.equal(validateReportPage({reports:[descriptor],nextCursor:null},50).reports.length,1);
 assert.throws(()=>validateReportPage({reports:[{...descriptor,filename:'anything.json'}],nextCursor:null},50),{code:'INVALID_PAGE'});
});
test('retention can preserve a native capture for validation without creating financial state',async t=>{
 const f=await ingestFixture(t),bytes=new TextEncoder().encode('{"unvalidated":"retained-original"}'),sha256=hash(bytes),before=f.read();
 const saved=await f.sink.retain({owner:f.owner,report:{reportId:'capture-1',filename:'capture.opbg.json',sha256},bytes,sha256,lease:f.lease});
 assert.deepEqual(f.objects.get(f.owner+'/'+saved.documentId),bytes);assert.deepEqual(f.read(),before);
 assert.equal(f.sql.prepare('SELECT mime FROM documents').get().mime,'application/vnd.mgeorge.openpayments-bankgiro+json');
});
test('source status preserves the safe unavailable-details code for the existing UI',()=>{
 const output=publicBankgiroStatus({counts:{REVIEW:1},jobs:[{id:'job',reportId:'report',status:'REVIEW',lastError:'BANKGIRO_INFORMATION_UNAVAILABLE'}]});
 assert.equal(output.jobs[0].lastError,'BANKGIRO_INFORMATION_UNAVAILABLE');
});
test('a browser file import cannot enter the authenticated provider capture path',async t=>{
 const f=await ingestFixture(t),bytes=new TextEncoder().encode('{"unvalidated":"retained-original"}'),input=await f.prepare(bytes,{filename:'capture.opbg.json'}),service=await import(f.moduleUrls.bankgiro),before=f.read();
 await assert.rejects(()=>service.readBankgiroOriginal(f.owner,{type:'bankgiro.import',documentId:input.documentId}),{code:'AUTHORIZATION_BLOCKED'});
 await assert.rejects(()=>service.bankgiroPreview(f.owner,new File([bytes],'capture.opbg.json'),''),{code:'AUTHORIZATION_BLOCKED'});
 assert.deepEqual(f.read(),before);assert.equal(f.audits().length,0);
});
