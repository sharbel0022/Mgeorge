import test from 'node:test';
import assert from 'node:assert/strict';
import {isGmailConfigured,gmailAccount,gmailAuthorizationUrl,exchangeGmailCode,refreshGmailTokens,gmailProfile,fetchGmailInvoiceDocuments,revokeGmailTokens} from '../src/gmail.js';

process.env.GOOGLE_CLIENT_ID='test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET='test-secret-not-for-production';
process.env.GMAIL_ACCOUNT='mg.vitvaror@gmail.com';
const scope='https://www.googleapis.com/auth/gmail.readonly';
const currentTokens=()=>({access_token:'test-access',refresh_token:'test-refresh',scope,expires_at:Date.now()+3600_000});
const pdf=Buffer.from('%PDF-1.4\nfixture, not an invoice');
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
async function withFetch(mock,fn){const previous=globalThis.fetch;globalThis.fetch=mock;try{return await fn();}finally{globalThis.fetch=previous;}}
function invoiceMessage(id,label='INBOX',subject='Faktura 0606',filename='faktura.pdf'){
  return {id,labelIds:[label],internalDate:'1792992000000',payload:{mimeType:'multipart/mixed',headers:[{name:'Subject',value:subject},{name:'From',value:'Leverantören AB <supplier@example.com>'},{name:'To',value:'Kund AB <customer@example.com>'}],parts:[{partId:'1',mimeType:'application/pdf',filename,body:{size:pdf.length,attachmentId:'attach-'+id}}]}};
}
test('OAuth requests only readonly Gmail, uses offline consent, state and fixed callback',()=>{
  assert.equal(isGmailConfigured(),true);assert.equal(gmailAccount(),'mg.vitvaror@gmail.com');
  const url=new URL(gmailAuthorizationUrl('s'.repeat(43),'https://fakturor.example.com'));
  assert.equal(url.origin,'https://accounts.google.com');assert.equal(url.searchParams.get('scope'),scope);
  assert.equal(url.searchParams.get('redirect_uri'),'https://fakturor.example.com/api/gmail/callback');
  assert.equal(url.searchParams.get('state'),'s'.repeat(43));assert.equal(url.searchParams.get('access_type'),'offline');
  assert.equal(url.searchParams.get('login_hint'),'mg.vitvaror@gmail.com');
  assert.throws(()=>gmailAuthorizationUrl('too-short','https://fakturor.example.com'),/OAuth-status/);
  assert.throws(()=>gmailAuthorizationUrl('s'.repeat(43),'http://evil.example'),/returadress/);
  assert.throws(()=>gmailAuthorizationUrl('s'.repeat(43),'https://fakturor.example.com/extra'),/returadress/);
});
test('missing configuration yields a helpful activation error',()=>{
  const secret=process.env.GOOGLE_CLIENT_SECRET;delete process.env.GOOGLE_CLIENT_SECRET;
  try{assert.equal(isGmailConfigured(),false);assert.throws(()=>gmailAuthorizationUrl('s'.repeat(43),'http://localhost:3000'),e=>e.status===409&&e.code==='not_configured');}finally{process.env.GOOGLE_CLIENT_SECRET=secret;}
});
test('code exchange sends credentials in a POST body and refresh preserves the refresh token',async()=>{
  const calls=[];
  await withFetch(async(url,options)=>{calls.push({url,options});return respond({access_token:'new-access',refresh_token:calls.length===1?'refresh-1':undefined,expires_in:3600,scope:calls.length===1?scope:undefined,token_type:'Bearer'});},async()=>{
    const tokens=await exchangeGmailCode('one-use-code','http://localhost:3000');
    assert.equal(tokens.refresh_token,'refresh-1');assert.ok(tokens.expires_at>Date.now()+3500_000);
    const refreshed=await refreshGmailTokens(tokens);assert.equal(refreshed.refresh_token,'refresh-1');assert.equal(refreshed.scope,scope);
  });
  assert.equal(calls[0].url,'https://oauth2.googleapis.com/token');assert.equal(calls[0].options.method,'POST');
  assert.equal(calls[0].options.body.get('code'),'one-use-code');assert.equal(calls[0].options.body.get('client_secret'),process.env.GOOGLE_CLIENT_SECRET);
  assert.equal(calls[1].options.body.get('grant_type'),'refresh_token');assert.equal(calls[1].options.body.get('refresh_token'),'refresh-1');
});
test('OAuth rejects missing readonly scope and reports expired permission without reflecting provider details',async()=>{
  await withFetch(async()=>respond({access_token:'x',expires_in:3600,scope:'https://www.googleapis.com/auth/userinfo.email'}),async()=>{
    await assert.rejects(exchangeGmailCode('code','http://localhost:3000'),e=>e.code==='missing_scope');
  });
  await withFetch(async()=>respond({error:'invalid_grant',error_description:'never expose private token'},400),async()=>{
    await assert.rejects(refreshGmailTokens(currentTokens()),e=>e.code==='renewal_required'&&!e.message.includes('private token'));
  });
});
test('verified Gmail profile prevents importing another Google account',async()=>{
  await withFetch(async(url,options)=>{assert.equal(url,'https://gmail.googleapis.com/gmail/v1/users/me/profile');assert.equal(options.headers.Authorization,'Bearer test-access');return respond({emailAddress:'other@gmail.com'});},async()=>{
    await assert.rejects(gmailProfile(currentTokens()),e=>e.code==='account_mismatch');
  });
});
test('sync preserves original attachments, direction and source IDs, skips reminders and confirms account',async()=>{
  const requests=[];const messages={one:invoiceMessage('one'),two:invoiceMessage('two','SENT'),three:invoiceMessage('three','INBOX','Betalningspåminnelse för faktura 0606')};
  const result=await withFetch(async(url,options)=>{
    requests.push(url);assert.equal(options.headers.Authorization,'Bearer test-access');
    const parsed=new URL(url);
    if(parsed.pathname.endsWith('/profile'))return respond({emailAddress:'mg.vitvaror@gmail.com'});
    if(parsed.pathname.endsWith('/messages')){assert.match(parsed.searchParams.get('q'),/in:inbox in:sent/);return respond({messages:Object.keys(messages).map(id=>({id}))});}
    const id=parsed.pathname.match(/\/messages\/([^/]+)/)?.[1];
    if(parsed.pathname.includes('/attachments/'))return respond({size:pdf.length,data:pdf.toString('base64url')});
    return respond(messages[id]);
  },()=>fetchGmailInvoiceDocuments(currentTokens()));
  assert.equal(result.received,3);assert.equal(result.skipped,1);assert.equal(result.documents.length,2);
  assert.equal(result.documents[0].source_id,'gmail:mg.vitvaror@gmail.com:one:1');
  assert.equal(result.documents[0].content_base64,pdf.toString('base64'));assert.equal(result.documents[0].direction,'supplier');
  assert.equal(result.documents[0].email,'supplier@example.com');assert.equal(result.documents[1].direction,'customer');
  assert.equal(result.documents[1].party,'Kund AB');assert.equal(result.documents[0].needs_review,true);
  assert.equal(result.documents[0].total_cents,undefined);assert.equal(requests.filter(x=>x.includes('/attachments/')).length,2);
});
test('known source IDs skip the attachment download and same message cannot duplicate a document',async()=>{
  let attachments=0;
  const result=await withFetch(async url=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/profile'))return respond({emailAddress:'mg.vitvaror@gmail.com'});
    if(path.endsWith('/messages'))return respond({messages:[{id:'one'},{id:'one'}]});
    if(path.includes('/attachments/')){attachments++;return respond({data:pdf.toString('base64url')});}
    return respond(invoiceMessage('one'));
  },()=>fetchGmailInvoiceDocuments(currentTokens(),{knownIds:['gmail:mg.vitvaror@gmail.com:one:1']}));
  assert.equal(result.received,1);assert.equal(result.duplicate,1);assert.equal(result.documents.length,0);assert.equal(attachments,0);
});
test('valid MIME attachments with missing or incorrect extensions get safe typed filenames',async()=>{
  const result=await withFetch(async url=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/profile'))return respond({emailAddress:'mg.vitvaror@gmail.com'});
    if(path.endsWith('/messages'))return respond({messages:[{id:'extensionless'},{id:'mismatch'}]});
    if(path.includes('/attachments/'))return respond({data:pdf.toString('base64url')});
    const noExtension=path.endsWith('/extensionless');return respond(invoiceMessage(noExtension?'extensionless':'mismatch','INBOX','Faktura 0606',noExtension?'Faktura_0606':'Faktura_0606.png'));
  },()=>fetchGmailInvoiceDocuments(currentTokens()));
  assert.equal(result.documents.length,2);
  assert.equal(result.documents[0].name,'Faktura_0606.pdf');assert.equal(result.documents[0].metadata.original_filename,'Faktura_0606');
  assert.equal(result.documents[1].name,'Faktura_0606.png.pdf');assert.equal(result.documents[1].metadata.original_filename,'Faktura_0606.png');
});
test('sync checkpoints use UTC epoch seconds with overlap, avoiding Gmail PST date gaps',async()=>{
  await withFetch(async url=>{
    const parsed=new URL(url);
    if(parsed.pathname.endsWith('/profile'))return respond({emailAddress:'mg.vitvaror@gmail.com'});
    assert.match(parsed.searchParams.get('q'),new RegExp(`after:${Date.parse('2026-10-25T00:00:00Z')/1000}\\b`));return respond({messages:[]});
  },()=>fetchGmailInvoiceDocuments(currentTokens(),{after:'2026-10-26'}));
  await assert.rejects(fetchGmailInvoiceDocuments(currentTokens(),{after:'2026-02-30'}),e=>e.code==='invalid_date');
});
test('disguised file payloads and oversized attachments are skipped with review warnings',async()=>{
  const result=await withFetch(async url=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/profile'))return respond({emailAddress:'mg.vitvaror@gmail.com'});
    if(path.endsWith('/messages'))return respond({messages:[{id:'bad'},{id:'large'}]});
    if(path.includes('/attachments/'))return respond({data:Buffer.from('<html>instructions are inert</html>').toString('base64url')});
    const message=invoiceMessage(path.endsWith('/large')?'large':'bad');if(message.id==='large')message.payload.parts[0].body.size=15_000_001;return respond(message);
  },()=>fetchGmailInvoiceDocuments(currentTokens()));
  assert.equal(result.documents.length,0);assert.equal(result.warnings.length,2);assert.equal(result.skipped,2);
});
test('bounded sync clearly reports more mail and refreshes expiring access',async()=>{
  let refreshed=false;
  const result=await withFetch(async(url,options)=>{
    if(url==='https://oauth2.googleapis.com/token'){refreshed=true;return respond({access_token:'renewed',expires_in:3600,scope});}
    assert.equal(options.headers.Authorization,'Bearer renewed');const path=new URL(url).pathname;
    if(path.endsWith('/profile'))return respond({emailAddress:'mg.vitvaror@gmail.com'});
    if(path.endsWith('/messages'))return respond({messages:[{id:'one'}],nextPageToken:'more'});
    if(path.includes('/attachments/'))return respond({data:pdf.toString('base64url')});
    return respond(invoiceMessage('one'));
  },()=>fetchGmailInvoiceDocuments({...currentTokens(),expires_at:Date.now()-1},{maxMessages:1}));
  assert.equal(refreshed,true);assert.equal(result.truncated,true);assert.equal(result.next_page_token,'more');assert.equal(result.tokens.access_token,'renewed');
});
test('invalid attachments cannot exhaust API requests and persisted rejections allow the next batch to progress',async()=>{
  let downloads=0;
  const message=invoiceMessage('many');message.payload.parts=Array.from({length:151},(_,i)=>({partId:String(i),mimeType:'application/pdf',filename:`faktura-${i}.pdf`,body:{attachmentId:String(i),size:100}}));
  const mock=async url=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/profile'))return respond({emailAddress:'mg.vitvaror@gmail.com'});
    if(path.endsWith('/messages'))return respond({messages:[{id:'many'}]});
    if(path.includes('/attachments/')){downloads++;return respond({data:path.endsWith('/150')?pdf.toString('base64url'):Buffer.from('invalid attachment').toString('base64url')});}
    return respond(message);
  };
  await withFetch(mock,async()=>{
    const first=await fetchGmailInvoiceDocuments(currentTokens());
    assert.equal(downloads,150);assert.equal(first.truncated,true);assert.equal(first.next_page_token,'');assert.equal(first.documents.length,0);assert.equal(first.rejected_source_ids.length,150);
    const second=await fetchGmailInvoiceDocuments(currentTokens(),{rejectedIds:first.rejected_source_ids,pageToken:first.next_page_token});
    assert.equal(downloads,151);assert.equal(second.truncated,false);assert.equal(second.documents.length,1);assert.equal(second.documents[0].name,'faktura-150.pdf');assert.equal(second.skipped,150);assert.equal(second.rejected_source_ids.length,0);
  });
});
test('a saved page token resumes older mail instead of repeatedly fetching only the first page',async()=>{
  const result=await withFetch(async url=>{
    const parsed=new URL(url),path=parsed.pathname;
    if(path.endsWith('/profile'))return respond({emailAddress:'mg.vitvaror@gmail.com'});
    if(path.endsWith('/messages')){assert.equal(parsed.searchParams.get('pageToken'),'older-page');return respond({messages:[{id:'older'}]});}
    if(path.includes('/attachments/'))return respond({data:pdf.toString('base64url')});
    return respond(invoiceMessage('older'));
  },()=>fetchGmailInvoiceDocuments(currentTokens(),{pageToken:'older-page'}));
  assert.equal(result.documents[0].source_id,'gmail:mg.vitvaror@gmail.com:older:1');assert.equal(result.truncated,false);assert.equal(result.next_page_token,'');
});
test('revocation is explicit and uses POST body, never tokens in URLs',async()=>{
  await withFetch(async(url,options)=>{assert.equal(url,'https://oauth2.googleapis.com/revoke');assert.equal(options.method,'POST');assert.equal(options.body.get('token'),'test-refresh');return new Response('',{status:200});},()=>revokeGmailTokens(currentTokens()));
});
