import test from 'node:test';
import assert from 'node:assert/strict';

const account='mg.vitvaror@gmail.com';
const scope='https://www.googleapis.com/auth/gmail.readonly';
const tokens=()=>({access_token:'synthetic-access',expires_at:Date.now()+3600000,scope});
const privateDetail='synthetic-private-provider-secret';
const safeError=(error,code)=>error.code===code&&!error.message.includes(privateDetail);
const original=Buffer.from('%PDF-synthetic-original');
const part=(id='1')=>({partId:id,filename:'synthetic.pdf',mimeType:'application/pdf',body:{size:original.length,data:original.toString('base64url')}});
function invoiceMessage(id='one'){
  return {id,labelIds:['INBOX'],internalDate:'1792992000000',payload:{mimeType:'multipart/mixed',headers:[{name:'Subject',value:'Synthetic document'},{name:'From',value:'Supplier <supplier@example.test>'},{name:'To',value:account}],parts:[part()]}};
}
function provider(t,messages,{attachment,listing}={}){
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const parsed=new URL(url),path=parsed.pathname;calls.push({path,method:options?.method||'GET'});
    if(path.endsWith('/profile'))return Response.json({emailAddress:account});
    if(path.endsWith('/messages'))return Response.json(listing?listing(parsed):{messages:Object.keys(messages).map(id=>({id}))});
    if(path.includes('/attachments/'))return attachment?attachment(parsed):Response.json({size:original.length,data:original.toString('base64url')});
    const id=decodeURIComponent(path.slice(path.lastIndexOf('/')+1));assert.ok(Object.hasOwn(messages,id));return Response.json(messages[id]);
  });
  return calls;
}
function interruptedResponse(error){
  let started=false;
  return new Response(new ReadableStream({pull(controller){
    if(started){controller.error(error);return;}
    started=true;controller.enqueue(Buffer.from('{"partial":'));
  }}),{status:200,headers:{'Content-Type':'application/json'}});
}

// The shared cases exercise both real adapters; only the provider boundary is fake.
export function gmailAdapterReliabilityTests(adapter){
  for(const reason of ['rateLimitExceeded','userRateLimitExceeded','dailyLimitExceeded'])test(`Gmail structured 403 ${reason} preserves the provider retry deadline`,async t=>{
    let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{code:403,message:privateDetail,errors:[{reason}]}},{status:403,headers:{'Retry-After':'7200'}});});
    await assert.rejects(adapter.gmailProfile(tokens()),error=>safeError(error,'rate_limited')&&error.status===429&&error.retryAfter===7200&&error.retryBlocked===false);
    assert.equal(calls,1);
  });

  for(const reason of ['domainPolicy','insufficientPermissions'])test(`Gmail 403 ${reason} remains a permanent access failure`,async t=>{
    let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{code:403,message:privateDetail,errors:[{reason}]}},{status:403});});
    await assert.rejects(adapter.gmailProfile(tokens()),error=>safeError(error,'access_denied')&&error.retryAfter===undefined);
    assert.equal(calls,1);
  });

  for(const status of [500,502,503,504])test(`Gmail HTML ${status} remains a retryable provider failure with Retry-After`,async t=>{
    let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('<html>'+privateDetail+'</html>',{status,headers:{'Retry-After':'7200','Content-Type':'text/html'}});});
    await assert.rejects(adapter.gmailProfile(tokens()),error=>safeError(error,'provider_error')&&error.status===502&&error.retryAfter===7200&&error.retryBlocked===false);
    assert.equal(calls,1);
  });

  test('Gmail JSON 503 preserves Retry-After instead of losing it during error conversion',async t=>{
    t.mock.method(globalThis,'fetch',async()=>Response.json({error:{message:privateDetail}},{status:503,headers:{'Retry-After':'7200'}}));
    await assert.rejects(adapter.gmailProfile(tokens()),error=>safeError(error,'provider_error')&&error.retryAfter===7200);
  });

  for(const kind of ['error','timeout'])test(`Gmail successful response stream ${kind} is a safe connection failure`,async t=>{
    const originalError=kind==='timeout'?new DOMException(privateDetail,'TimeoutError'):new Error(privateDetail);
    let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return interruptedResponse(originalError);});
    await assert.rejects(adapter.gmailProfile(tokens()),error=>safeError(error,'connection_error')&&error.status===502&&error!==originalError);
    assert.equal(calls,1);
  });

  test('Gmail attachment response stream failure remains retryable instead of rejecting the source',async t=>{
    const message=invoiceMessage();message.payload.parts[0].body={attachmentId:'stream-interrupted'};
    provider(t,{one:message},{attachment:()=>interruptedResponse(new Error(privateDetail))});
    await assert.rejects(adapter.fetchGmailInvoiceDocuments(tokens()),error=>safeError(error,'connection_error')&&error.status===502);
  });

  test('Gmail send POST is not repeated after its response stream fails',async t=>{
    let posts=0,refreshes=0;
    t.mock.method(globalThis,'fetch',async(url,options)=>{
      const path=new URL(url).pathname;
      if(path.endsWith('/profile'))return Response.json({emailAddress:account});
      if(path==='/token'){refreshes++;throw Error('Unexpected refresh after dispatch');}
      assert.ok(path.endsWith('/messages/send'));assert.equal(options.method,'POST');posts++;
      return interruptedResponse(new Error(privateDetail));
    });
    const send=await adapter.prepareGmailSend({...tokens(),scope:scope+' https://www.googleapis.com/auth/gmail.send'});
    await assert.rejects(send({recipient:'recipient@example.test',subject:'Synthetic test',body:'Synthetic body',rfc_message_id:'<abc-123@mg-fakturakoll.local>'}),error=>safeError(error,'connection_error')&&error.status===502);
    assert.equal(posts,1);assert.equal(refreshes,0);
  });

  test('Gmail provider HTTP-date wait remains later than a local retry cap',async t=>{
    const wait=new Date(Date.now()+7200000).toUTCString();
    t.mock.method(globalThis,'fetch',async()=>new Response(privateDetail,{status:503,headers:{'Retry-After':wait}}));
    await assert.rejects(adapter.gmailProfile(tokens()),error=>safeError(error,'provider_error')&&error.retryAfter>=7198&&error.retryAfter<=7200);
  });

  for(const status of [403,503])test(`Gmail ${status} unreasonable retry deadline requires manual control`,async t=>{
    t.mock.method(globalThis,'fetch',async()=>Response.json({error:{errors:[{reason:'rateLimitExceeded'}],message:privateDetail}},{status,headers:{'Retry-After':'99999999999999999'}}));
    await assert.rejects(adapter.gmailProfile(tokens()),error=>safeError(error,status===403?'rate_limited':'provider_error')&&error.retryBlocked===true&&error.retryAfter>=1&&error.retryAfter<=365*86400);
  });

  test('Gmail HTML 401 still requires renewed authorization',async t=>{
    let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(privateDetail,{status:401});});
    await assert.rejects(adapter.gmailProfile(tokens()),error=>safeError(error,'renewal_required'));
    assert.equal(calls,1);
  });

  test('Gmail token endpoint 401 invalid_client still identifies the administrator credential failure',async t=>{
    let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:'invalid_client',error_description:privateDetail},{status:401});});
    await assert.rejects(adapter.refreshGmailTokens({...tokens(),refresh_token:'synthetic-refresh'}),error=>safeError(error,'invalid_client'));
    assert.equal(calls,1);
  });

  test('Gmail revoked refresh token is permanent and is never replayed automatically',async t=>{
    let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:'invalid_grant',error_description:privateDetail},{status:400});});
    await assert.rejects(adapter.refreshGmailTokens({...tokens(),refresh_token:'synthetic-refresh'}),error=>safeError(error,'renewal_required'));
    assert.equal(calls,1);
  });

  test('Gmail send dispatch is attempted once even when the provider returns retryable failure',async t=>{
    let posts=0,refreshes=0;
    t.mock.method(globalThis,'fetch',async(url,options)=>{
      const path=new URL(url).pathname;
      if(path.endsWith('/profile'))return Response.json({emailAddress:account});
      if(path==='/token'){refreshes++;throw Error('Unexpected refresh after dispatch');}
      assert.ok(path.endsWith('/messages/send'));assert.equal(options.method,'POST');posts++;
      return new Response(privateDetail,{status:503,headers:{'Retry-After':'7200'}});
    });
    const send=await adapter.prepareGmailSend({...tokens(),scope:scope+' https://www.googleapis.com/auth/gmail.send'});
    await assert.rejects(send({recipient:'recipient@example.test',subject:'Synthetic test',body:'Synthetic body',rfc_message_id:'<abc-123@mg-fakturakoll.local>'}),error=>safeError(error,'provider_error')&&error.retryAfter===7200);
    assert.equal(posts,1);assert.equal(refreshes,0);
  });

  for(const filename of [undefined,'',null,123])test(`Gmail PDF without a usable filename is preserved for review (${String(filename)})`,async t=>{
    const message=invoiceMessage();message.payload.parts[0].filename=filename;provider(t,{one:message});
    const result=await adapter.fetchGmailInvoiceDocuments(tokens());assert.equal(result.documents.length,1);
    const [document]=result.documents;assert.deepEqual(Buffer.from(document.content_base64,'base64'),original);
    assert.equal(document.name,'gmail-attachment.pdf');assert.equal(document.metadata.original_filename,'');
    assert.equal(document.source_id,'gmail:mg.vitvaror@gmail.com:one:1');assert.equal(document.needs_review,true);
    assert.equal(document.metadata.direction_confident,false);assert.ok(document.metadata.missing_fields.includes('original_filename'));
    assert.deepEqual(result.rejected_source_ids,[]);
  });

  for(const internalDate of [undefined,null,'',' ',true,[],{},'1e12','not-a-date','9007199254740992'])test(`Gmail missing or malformed internalDate is never manufactured as epoch (${JSON.stringify(internalDate)})`,async t=>{
    const message=invoiceMessage();message.internalDate=internalDate;provider(t,{one:message});
    const result=await adapter.fetchGmailInvoiceDocuments(tokens());assert.equal(result.documents.length,1);
    const [document]=result.documents;assert.equal(document.received_at,'');assert.equal(document.metadata.direction_confident,false);
    assert.ok(document.metadata.missing_fields.includes('received_at'));assert.deepEqual(result.rejected_source_ids,[]);
  });

  for(const headers of [undefined,null,{},[null], [{name:42,value:'invalid'}]])test(`Gmail malformed message headers preserve originals and later messages (${JSON.stringify(headers)})`,async t=>{
    const bad=invoiceMessage('bad'),good=invoiceMessage('good');bad.payload.headers=headers;provider(t,{bad,good});
    const result=await adapter.fetchGmailInvoiceDocuments(tokens());assert.equal(result.documents.length,2);
    assert.equal(result.documents[0].metadata.direction_confident,false);assert.equal(result.documents[1].metadata.direction_confident,true);
    assert.ok(result.warnings.some(w=>w.code==='message_metadata_invalid'&&w.message_id==='bad'&&!w.source_id));
    assert.deepEqual(result.rejected_source_ids,[]);
  });

  test('Gmail conflicting duplicate sender headers cannot produce confident direction',async t=>{
    const message=invoiceMessage();message.payload.headers.push({name:'From',value:'Different <different@example.test>'});provider(t,{one:message});
    const result=await adapter.fetchGmailInvoiceDocuments(tokens());assert.equal(result.documents.length,1);assert.equal(result.documents[0].metadata.direction_confident,false);
  });

  test('Gmail normal repeated transport headers do not make complete metadata uncertain',async t=>{
    const message=invoiceMessage();message.payload.headers.push({name:'Received',value:'from first.example.test'},{name:'Received',value:'from second.example.test'},{name:'Authentication-Results',value:'first.example.test; dkim=pass'},{name:'Authentication-Results',value:'second.example.test; dkim=pass'});
    provider(t,{one:message});const result=await adapter.fetchGmailInvoiceDocuments(tokens());
    assert.equal(result.documents.length,1);assert.equal(result.documents[0].metadata.direction_confident,true);
    assert.deepEqual(result.documents[0].metadata.missing_fields,[]);assert.deepEqual(result.warnings,[]);
  });

  test('Gmail malformed labels and part headers do not poison valid attachments',async t=>{
    const message=invoiceMessage();message.labelIds={invalid:true};message.payload.parts[0].headers=[null,{name:42,value:'invalid'}];provider(t,{one:message});
    const result=await adapter.fetchGmailInvoiceDocuments(tokens());assert.equal(result.documents.length,1);assert.equal(result.documents[0].metadata.direction_confident,false);
    assert.deepEqual(result.rejected_source_ids,[]);
  });

  test('Gmail malformed multipart elements preserve valid siblings and later messages',async t=>{
    const message=invoiceMessage();message.payload.parts.unshift(null,42);provider(t,{one:message,two:invoiceMessage('two')});
    const result=await adapter.fetchGmailInvoiceDocuments(tokens());assert.equal(result.documents.length,2);
    assert.equal(result.documents[0].source_id,'gmail:mg.vitvaror@gmail.com:one:1');assert.equal(result.documents[1].source_id,'gmail:mg.vitvaror@gmail.com:two:1');
    assert.equal(result.documents[0].metadata.direction_confident,false);assert.deepEqual(result.rejected_source_ids,[]);
    assert.ok(result.warnings.some(w=>w.code==='message_metadata_invalid'&&!w.source_id));
  });

  for(const body of [null,[],42,{data:42},{size:-1,data:original.toString('base64url')},{size:'not-a-size',data:original.toString('base64url')},{attachmentId:{},data:original.toString('base64url')},{attachmentId:42,data:original.toString('base64url')}])test(`Gmail malformed stable attachment body is rejected without blocking a later original (${JSON.stringify(body)})`,async t=>{
    const message=invoiceMessage();message.payload.parts=[{...part('bad'),filename:privateDetail+'.pdf',body},part('good')];provider(t,{one:message});
    const result=await adapter.fetchGmailInvoiceDocuments(tokens());assert.equal(result.documents.length,1);assert.equal(result.documents[0].metadata.part_id,'good');
    assert.deepEqual(result.rejected_source_ids,['gmail:mg.vitvaror@gmail.com:one:bad']);
    assert.equal(result.warnings[0].code,'attachment_unreadable');assert.doesNotMatch(result.warnings[0].message,/synthetic-private/);
  });

  test('Gmail oversized declared part has a safe stable rejection code and does not prevent pagination',async t=>{
    const bad=invoiceMessage('bad');bad.payload.parts[0].body={size:15000001,attachmentId:'must-not-download'};
    const calls=provider(t,{bad,good:invoiceMessage('good')},{listing:url=>url.searchParams.get('pageToken')==='next'?{messages:[{id:'good'}]}:{messages:[{id:'bad'}],nextPageToken:'next'}});
    const first=await adapter.fetchGmailInvoiceDocuments(tokens(),{maxMessages:1});assert.equal(first.truncated,true);assert.equal(first.next_page_token,'next');
    assert.equal(first.warnings[0].code,'attachment_too_large');assert.deepEqual(first.rejected_source_ids,['gmail:mg.vitvaror@gmail.com:bad:1']);
    const second=await adapter.fetchGmailInvoiceDocuments(tokens(),{pageToken:first.next_page_token,rejectedIds:first.rejected_source_ids});
    assert.equal(second.documents.length,1);assert.equal(second.documents[0].source_id,'gmail:mg.vitvaror@gmail.com:good:1');
    assert.equal(calls.filter(call=>call.path.includes('/attachments/')).length,0);
  });

  test('Gmail oversized downloaded attachment envelope is rejected before trusting its data',async t=>{
    const message=invoiceMessage();message.payload.parts[0].body={attachmentId:'large'};
    provider(t,{one:message},{attachment:()=>Response.json({size:15000001,data:original.toString('base64url')})});
    const result=await adapter.fetchGmailInvoiceDocuments(tokens());assert.equal(result.documents.length,0);
    assert.equal(result.warnings[0].code,'attachment_too_large');assert.deepEqual(result.rejected_source_ids,['gmail:mg.vitvaror@gmail.com:one:1']);
  });

  test('Gmail bounded oversized attachment response has a stable rejection and preserves later parts',async t=>{
    const message=invoiceMessage();message.payload.parts=[{...part('large'),body:{attachmentId:'large'}},part('good')];
    provider(t,{one:message},{attachment:()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(22000001));controller.close();}}))});
    const result=await adapter.fetchGmailInvoiceDocuments(tokens());assert.equal(result.documents.length,1);assert.equal(result.documents[0].metadata.part_id,'good');
    assert.equal(result.warnings[0].code,'attachment_too_large');assert.deepEqual(result.rejected_source_ids,['gmail:mg.vitvaror@gmail.com:one:large']);
  });

  test('Gmail wrong signature has a safe format rejection without exposing attachment names',async t=>{
    const message=invoiceMessage();message.payload.parts[0].filename=privateDetail+'.pdf';message.payload.parts[0].body={data:Buffer.from(privateDetail).toString('base64url')};provider(t,{one:message});
    const result=await adapter.fetchGmailInvoiceDocuments(tokens());assert.equal(result.documents.length,0);
    assert.equal(result.warnings[0].code,'attachment_format_invalid');assert.doesNotMatch(result.warnings[0].message,/synthetic-private/);
  });

  for(const message of [null,[],42,{}, {payload:null}, {payload:{}}])test(`Gmail entirely malformed envelope stops safely before advancing its checkpoint (${JSON.stringify(message)})`,async t=>{
    provider(t,{one:message});await assert.rejects(adapter.fetchGmailInvoiceDocuments(tokens()),error=>safeError(error,'invalid_response'));
  });

  test('Gmail transient attachment failure is never persisted as a permanent source rejection',async t=>{
    const message=invoiceMessage();message.payload.parts[0].body={attachmentId:'temporarily-unavailable'};
    provider(t,{one:message},{attachment:()=>new Response(privateDetail,{status:503,headers:{'Retry-After':'7200'}})});
    await assert.rejects(adapter.fetchGmailInvoiceDocuments(tokens()),error=>safeError(error,'provider_error')&&error.retryAfter===7200);
  });

  test('Gmail source identity uses immutable message and part IDs even when attachment locator changes',async t=>{
    const message=invoiceMessage();message.payload.parts[0].body={attachmentId:'locator-1'};
    const calls=provider(t,{one:message});const first=await adapter.fetchGmailInvoiceDocuments(tokens());
    message.payload.parts[0].body.attachmentId='locator-2';const second=await adapter.fetchGmailInvoiceDocuments(tokens(),{knownIds:[first.documents[0].source_id]});
    assert.equal(first.documents[0].source_id,'gmail:mg.vitvaror@gmail.com:one:1');assert.equal(second.duplicate,1);assert.equal(second.documents.length,0);
    assert.equal(calls.filter(call=>call.path.includes('/attachments/')).length,1);
  });

  test('Gmail membership lookup batches encountered sources before downloads and preserves rejection semantics',async t=>{
    const message=invoiceMessage();
    message.payload.parts=Array.from({length:132},(_,index)=>({...part(String(index)),body:{attachmentId:'attachment-'+index}}));
    const calls=provider(t,{one:message}),batches=[];
    const result=await adapter.fetchGmailInvoiceDocuments(tokens(),{lookupSources:async ids=>{
      batches.push([...ids]);
      return {knownIds:ids.filter(id=>Number(id.split(':').at(-1))<100),rejectedIds:ids.filter(id=>{const index=Number(id.split(':').at(-1));return index>=100&&index<131;})};
    }});
    assert.deepEqual(batches.map(ids=>ids.length),[50,50,32]);
    assert.equal(new Set(batches.flat()).size,132);
    assert.equal(result.duplicate,100);assert.equal(result.skipped,31);
    assert.equal(result.documents.length,1);assert.equal(result.documents[0].source_id,'gmail:mg.vitvaror@gmail.com:one:131');
    assert.equal(calls.filter(call=>call.path.includes('/attachments/')).length,1);
  });

  test('Gmail membership lookup failure stops before downloading an unknown original',async t=>{
    const message=invoiceMessage();message.payload.parts[0].body={attachmentId:'must-not-download'};
    const calls=provider(t,{one:message}),failure=new Error('synthetic membership outage');
    await assert.rejects(adapter.fetchGmailInvoiceDocuments(tokens(),{lookupSources:async()=>{throw failure;}}),error=>error===failure);
    assert.equal(calls.filter(call=>call.path.includes('/attachments/')).length,0);
  });

  for(const response of [{knownIds:['gmail:another-account:other:1'],rejectedIds:[]},{knownIds:null,rejectedIds:[]}])test('Gmail membership lookup rejects invalid or unrelated returned references '+JSON.stringify(response),async t=>{
    const message=invoiceMessage();message.payload.parts[0].body={attachmentId:'must-not-download'};
    const calls=provider(t,{one:message});
    await assert.rejects(adapter.fetchGmailInvoiceDocuments(tokens(),{lookupSources:async()=>response}),error=>error.code==='invalid_sources');
    assert.equal(calls.filter(call=>call.path.includes('/attachments/')).length,0);
  });

  test('Gmail membership lookup cannot extend the existing work deadline or lose its resume cursor',async t=>{
    let clock=Date.now();t.mock.method(Date,'now',()=>clock);
    const message=invoiceMessage();message.payload.parts[0].body={attachmentId:'must-not-download'};
    const calls=provider(t,{one:message});
    const result=await adapter.fetchGmailInvoiceDocuments(tokens(),{pageToken:'resume-current-page',lookupSources:async()=>{clock+=120001;return {knownIds:[],rejectedIds:[]};}});
    assert.equal(result.truncated,true);assert.equal(result.next_page_token,'resume-current-page');
    assert.equal(result.documents.length,0);assert.equal(calls.filter(call=>call.path.includes('/attachments/')).length,0);
  });
}
