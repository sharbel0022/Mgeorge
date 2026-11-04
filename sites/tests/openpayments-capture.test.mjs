import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const api=await import('../lib/bankgiro-openpayments-capture.js').catch(()=>({}));
const context={owner:'tenant-owner',companyId:'company-a',sourceId:'openpayments-a',scopeId:'scope-a',accountId:'account-a',iban:'SE4280000890119146168423',bankgiro:'1234567'};
const path='/psd2/accountinformation/v1/accounts/account-a/transactions?bookingStatus=booked&dateFrom=2026-10-26&dateTo=2026-10-26';
const raw=()=>({account:{iban:context.iban},transactions:{booked:[],bankgiro:[],_links:{}}});
const body=()=>JSON.stringify(raw(),null,2)+'\n';
const sha=value=>createHash('sha256').update(value).digest('hex');
function make(overrides={}){
 assert.equal(typeof api.createOpenPaymentsBankgiroCapture,'function','native provider capture must be implemented');
 return api.createOpenPaymentsBankgiroCapture({context,captureId:'request-capture-1',pages:[{body:body(),requestPath:path,requestId:'request-1',receivedAt:'2026-11-04T18:00:00Z'}],...overrides});
}
test('capture retains original UTF-8 bytes, response hashes and typed arrival receipt',()=>{
 const result=make(),read=api.readOpenPaymentsBankgiroCapture(result.bytes);
 assert.equal(result.sha256,sha(result.bytes));assert.match(result.filename,/\.opbg\.json$/);
 assert.equal(read.pages[0].body,body());assert.equal(read.pages[0].sha256,sha(body()));
 assert.equal(read.pages[0].requestId,'request-1');assert.equal(read.pages[0].receivedAt,'2026-11-04T18:00:00Z');
 assert.equal(read.context.companyId,'company-a');assert.equal(read.normalization.coverage.status,'unavailable');
});
test('same capture is deterministic; company identity changes its report identity',()=>{
 assert.deepEqual(make(),make());
 assert.notEqual(make().reportId,make({context:{...context,companyId:'company-b'}}).reportId);
});
test('changed nested original fails its exact byte hash',()=>{
 const captured=make(),tampered=JSON.parse(new TextDecoder().decode(captured.bytes));tampered.pages[0].body+=' ';
 assert.throws(()=>api.readOpenPaymentsBankgiroCapture(new TextEncoder().encode(JSON.stringify(tampered))),{code:'HASH_MISMATCH'});
});
test('original reformatting without replacing its hash is not accepted',()=>{
 const captured=make(),tampered=JSON.parse(new TextDecoder().decode(captured.bytes));tampered.pages[0].body=JSON.stringify(JSON.parse(tampered.pages[0].body));
 assert.throws(()=>api.readOpenPaymentsBankgiroCapture(new TextEncoder().encode(JSON.stringify(tampered))),{code:'HASH_MISMATCH'});
});
test('invalid UTF-8 and duplicate identity keys are rejected rather than rewritten',()=>{
 assert.throws(()=>make({pages:[{body:new Uint8Array([0xff]),requestPath:path,requestId:'r',receivedAt:'2026-11-04T18:00:00Z'}]}),{code:'INVALID_ORIGINAL'});
 assert.throws(()=>make({pages:[{body:'{"account":{"iban":"wrong","iban":"'+context.iban+'"},"transactions":{"booked":[],"bankgiro":[]}}',requestPath:path,requestId:'r',receivedAt:'2026-11-04T18:00:00Z'}]}),{code:'INVALID_ORIGINAL'});
});
for(const requestPath of ['https://evil.example/transactions',path.replace('account-a','account-b'),path.replace('bookingStatus=booked','bookingStatus=both'),path+'&bookingStatus=booked',path+'&access_token=private'])test('capture refuses an unexpected request scope: '+requestPath,()=>{
 assert.throws(()=>make({pages:[{body:body(),requestPath,requestId:'r',receivedAt:'2026-11-04T18:00:00Z'}]}),{code:'ACCOUNT_MISMATCH'});
});
test('pagination must follow the exact same-account next link',()=>{
 const first=raw(),next=path+'&continuationKey=next';first.transactions._links.next={href:next};
 const pages=[{body:JSON.stringify(first),requestPath:path,requestId:'r1',receivedAt:'2026-11-04T18:00:00Z'},{body:body(),requestPath:next,requestId:'r2',receivedAt:'2026-11-04T18:00:01Z'}];
 assert.equal(make({pages}).normalization.coverage.status,'unavailable');
 assert.throws(()=>make({pages:[pages[0],{...pages[1],requestPath:next+'2'}]}),{code:'INVALID_ORIGINAL'});
});
test('missing mandatory company scope is blocked',()=>{
 assert.throws(()=>make({context:{...context,companyId:''}}),{code:'AUTHORIZATION_BLOCKED'});
});
function authority(){return {status:'VERIFIED',origin:'provider_authorization',owner:context.owner,companyId:context.companyId,sourceId:context.sourceId,scopeId:context.scopeId,generation:'generation-1',bankgiro:context.bankgiro,accountId:context.accountId,iban:context.iban,profileId:'openpayments-bankgiro-v1',evidenceId:'verified-provider-receipt',checkedAt:'2026-11-04T18:00:00Z',validUntil:'2026-11-04T19:00:00Z',capabilities:['bankgiro_reports:read','accountinformation','bankgiroinformation','corporate']};}
test('current corporate Bankgiro authority is distinct from an original checksum',()=>{
 const captured=api.readOpenPaymentsBankgiroCapture(make().bytes),scope={...context,now:Date.parse('2026-11-04T18:00:01Z')};
 assert.doesNotThrow(()=>api.assertOpenPaymentsBankgiroAuthority(captured,authority(),scope));
 for(const patch of [{accountId:'account-b'},{iban:'SE3550000000054910000003'},{companyId:'company-b'},{owner:'other'},{sourceId:'other'},{scopeId:'other'},{origin:'manual_review'},{validUntil:'2026-11-04T17:00:00Z'},{checkedAt:'2026-11-04T19:00:00Z'},{capabilities:['accountinformation','corporate']},{profileId:'generic-csv'}]){
  assert.throws(()=>api.assertOpenPaymentsBankgiroAuthority(captured,{...authority(),...patch},scope),{code:'AUTHORIZATION_BLOCKED'});
 }
 assert.throws(()=>api.assertOpenPaymentsBankgiroAuthority(captured,authority(),{...scope,companyId:'company-b'}),{code:'AUTHORIZATION_BLOCKED'});
});
test('authorization receipt requires an opaque generation and excludes credentials and unrelated fields',()=>{
 const captured=api.readOpenPaymentsBankgiroCapture(make().bytes),scope={...context,now:Date.parse('2026-11-04T18:00:01Z')};
 for(const generation of [undefined,0,'','\n','x'.repeat(201)])assert.throws(()=>api.assertOpenPaymentsBankgiroAuthority(captured,{...authority(),generation},scope),{code:'AUTHORIZATION_BLOCKED'});
 const receipt=api.assertOpenPaymentsBankgiroAuthority(captured,{...authority(),accessToken:'synthetic-secret',clientCertificate:'synthetic-certificate'},scope);
 assert.deepEqual(receipt,authority());
});
test('omitting capture Bankgiro cannot bypass a registered source Bankgiro binding',()=>{
 const {bankgiro:ignored,...unbound}=context,captured=api.readOpenPaymentsBankgiroCapture(make({context:unbound}).bytes),scope={...context,now:Date.parse('2026-11-04T18:00:01Z')};
 assert.throws(()=>api.assertOpenPaymentsBankgiroAuthority(captured,authority(),scope),{code:'AUTHORIZATION_BLOCKED'});
 assert.throws(()=>api.assertOpenPaymentsBankgiroAuthority(captured,{...authority(),bankgiro:undefined},scope),{code:'AUTHORIZATION_BLOCKED'});
});
test('fallback selects SFTP only for a current company-specific approved agreement',()=>{
 assert.equal(typeof api.bankgiroEnrichmentFallback,'function');
 const base={companyId:'company-a',coverage:{status:'unavailable'},now:Date.parse('2026-11-04T18:00:00Z')};
 assert.equal(api.bankgiroEnrichmentFallback(base).source,'manual_file');
 const sftp={companyId:'company-a',status:'VERIFIED',origin:'provider_authorization',agreementId:'approved',validUntil:'2026-11-05T18:00:00Z'};
 assert.equal(api.bankgiroEnrichmentFallback({...base,sftp}).source,'camt054c_sftp');
 assert.equal(api.bankgiroEnrichmentFallback({...base,sftp:{...sftp,companyId:'company-b'}}).source,'manual_file');
 assert.equal(api.bankgiroEnrichmentFallback({...base,sftp:{...sftp,validUntil:'2026-11-03T00:00:00Z'}}).source,'manual_file');
 assert.equal(api.bankgiroEnrichmentFallback({...base,coverage:{status:'available'}}).source,'api');
 assert.match(api.bankgiroEnrichmentFallback(base).message,/Individuell betalningsinformation.*inte tillgänglig/);
});
